import type { DiscordWebhookClient } from "../clients/discord.js";
import type { FlightPriceRepository } from "../db/repositories.js";
import type { SerpApiClient } from "../clients/serpapi.js";
import { buildFareAlertFingerprint, qualifiesForTopThreeAlert } from "../logic/fare-ranking.js";
import { buildNormalFareEmbed } from "../notifications/normal-fare-embed.js";
import type { NormalizedFareObservation, SerpApiFlightResult, TrackedDestination } from "../types/domain.js";
import { createStableId } from "../utils/id.js";
import { decimalToMinorUnits } from "../utils/currency.js";

// Empty: Google Flights natively resolves LON (and other metro codes) to all
// constituent airports, so client-side expansion is unnecessary and wastes API quota.
const airportSearchExpansions: Readonly<Record<string, string[]>> = {};

/**
 * Max candidate dates per destination that proceed from Phase 1 to Phase 2.
 * Lowered to 3 to stay within free-tier SerpAPI limits (300 calls/month total
 * across 3 keys, 7 LON destinations, scanning every 48 hours).
 */
const MAX_PHASE2_DATES_PER_DESTINATION = 3;

export interface NormalFaresJobDeps {
    repository: FlightPriceRepository;
    serpApiClient: SerpApiClient;
    discordClient: DiscordWebhookClient;
    normalizeObservation: (args: {
        trackedDestinationId: string;
        providerQueryKey: string;
        destination: TrackedDestination;
        result: SerpApiFlightResult;
    }) => NormalizedFareObservation;
}

export async function runNormalFaresJob(deps: NormalFaresJobDeps): Promise<void> {
    const destinations = await deps.repository.listActiveTrackedDestinations();
    // 取得當前日期的 YYYY-MM-DD 格式
    const todayStr = new Date().toISOString().split("T")[0];

    for (const destination of destinations) {
        const expandedOrigins = buildExpandedOrigins(destination);

        // 優化：將歷史資料查詢提到最外層，不需要每筆航班結果都查一次 DB
        const historicalLowestFares = await deps.repository.listLowestHistoricalFares(destination.id, 3);

        for (const originAirportCode of expandedOrigins) {
            const searchBase: TrackedDestination = { ...destination, originAirportCode };

            // Skip if destination has no configured departure date range
            if (!searchBase.departureDateFrom) {
                console.info(
                    `[normal-fares] skipping ${originAirportCode}->${destination.destinationAirportCode}: no departureDateFrom configured`
                );
                continue;
            }

            // 修正：檢查是否為過去日期，避免 SerpAPI 查無資料報錯
            if (searchBase.departureDateFrom < todayStr) {
                if (searchBase.departureDateTo && searchBase.departureDateTo < todayStr) {
                    console.info(
                        `[normal-fares] skipping ${originAirportCode}->${destination.destinationAirportCode}: date range entirely in the past`
                    );
                    continue;
                }
                console.info(
                    `[normal-fares] adjusting departureDateFrom for ${originAirportCode}->${destination.destinationAirportCode} from ${searchBase.departureDateFrom} to ${todayStr}`
                );
                searchBase.departureDateFrom = todayStr;
            }

            // ── Phase 1: calendar scan (1 API call per origin) ─────────────────
            const candidateDates = await runCalendarPhase(deps, searchBase, historicalLowestFares);

            if (candidateDates.length === 0) {
                console.info(
                    `[normal-fares] no calendar candidates for ${originAirportCode}->${destination.destinationAirportCode}`
                );
                continue;
            }

            console.info(
                `[normal-fares] ${originAirportCode}->${destination.destinationAirportCode}: ` +
                `${candidateDates.length} candidate date(s) for Phase 2: ${candidateDates.join(", ")}`
            );

            // ── Phase 2: full flight details for each candidate date ────────────
            for (const departDate of candidateDates) {
                const searchDestination: TrackedDestination = {
                    ...searchBase,
                    departureDateFrom: departDate
                };

                const results = await deps.serpApiClient.searchFlights(searchDestination);
                const filteredResults = results.filter((result) =>
                    matchesTargetOriginAirport(result, destination.originAirportCode)
                );

                for (const result of filteredResults) {
                    const observation = deps.normalizeObservation({
                        trackedDestinationId: destination.id,
                        providerQueryKey: buildProviderQueryKey(destination.id, originAirportCode),
                        destination: searchDestination,
                        result
                    });

                    let observationRecord;
                    try {
                        observationRecord = await deps.repository.insertFareObservation(observation);
                    } catch (error) {
                        if (isUniqueConstraintError(error)) {
                            continue;
                        }
                        // 修正：遇到非唯一鍵衝突的錯誤（如連線超時）記錄錯誤並繼續，不要中斷整個任務
                        console.error(
                            `[normal-fares] Failed to insert observation for ${originAirportCode}->${destination.destinationAirportCode}:`,
                            error
                        );
                        continue;
                    }

                    const alertFingerprint = buildFareAlertFingerprint(observation);
                    const alreadyAlerted = await deps.repository.hasSentFareAlert(alertFingerprint);

                    if (!qualifiesForTopThreeAlert(historicalLowestFares, observation) || alreadyAlerted) {
                        continue;
                    }

                    const sortedHistoricalPrices = historicalLowestFares
                        .map((fare) => fare.priceAmountMinor)
                        .sort((left, right) => left - right);

                    const { messageId } = await deps.discordClient.sendEmbed(buildNormalFareEmbed(observation, {
                        historicalLowestPriceAmountMinor: sortedHistoricalPrices[0],
                        thirdLowestPriceAmountMinor: sortedHistoricalPrices[2]
                    }));

                    await deps.repository.recordFareAlert({
                        id: createStableId("fare_alert", alertFingerprint),
                        fareObservationId: observationRecord.id,
                        trackedDestinationId: destination.id,
                        alertFingerprint,
                        discordMessageId: messageId
                    });
                }
            }
        }
    }
}

/**
 * Phase 1: fetch the price calendar using the destination's departureDateFrom,
 * filter dates within the destination's configured range, pre-screen against the
 * historical top-3 threshold, and return up to MAX_PHASE2_DATES cheapest.
 */
async function runCalendarPhase(
    deps: NormalFaresJobDeps,
    destination: TrackedDestination,
    historicalFares: Awaited<ReturnType<FlightPriceRepository["listLowestHistoricalFares"]>>
): Promise<string[]> {
    let calendarDays;
    try {
        // Use the destination's actual departure date for the calendar query
        calendarDays = await deps.serpApiClient.searchCalendar(destination, destination.departureDateFrom!);
    } catch (error) {
        console.warn(
            `[normal-fares] calendar scan failed for ` +
            `${destination.originAirportCode}->${destination.destinationAirportCode}:`,
            error
        );
        return [];
    }

    const filtered = calendarDays.filter((day) =>
        isWithinDepartureDateRange(day.date, destination.departureDateFrom, destination.departureDateTo)
    );

    if (filtered.length === 0) return [];

    const thirdLowestMinor =
        historicalFares.length >= 3
            ? historicalFares.map((f) => f.priceAmountMinor).sort((a, b) => a - b)[2]
            : Infinity;

    return filtered
        .sort((a, b) => a.price - b.price)
        .filter((day) => decimalToMinorUnits(day.price) < thirdLowestMinor)
        .slice(0, MAX_PHASE2_DATES_PER_DESTINATION)
        .map((day) => day.date);
}

function isWithinDepartureDateRange(
    date: string,
    from?: string,
    to?: string
): boolean {
    if (!from && !to) return true;
    if (from && date < from) return false;
    if (to && date > to) return false;
    return true;
}

function buildExpandedOrigins(destination: TrackedDestination): string[] {
    const code = destination.originAirportCode.toUpperCase();
    return (airportSearchExpansions[code] ?? [code]) as string[];
}

function matchesTargetOriginAirport(
    result: SerpApiFlightResult,
    expectedOriginAirportCode: string
): boolean {
    const actualOriginAirportCode = extractActualOriginAirportCode(result);
    if (!actualOriginAirportCode) return false;

    const normalized = expectedOriginAirportCode.toUpperCase();
    const actual = actualOriginAirportCode.toUpperCase();

    if (normalized === "LON") return isLondonAirportCode(actual);
    return actual === normalized;
}

function isLondonAirportCode(airportCode: string): boolean {
    return ["LON", "LGW", "LTN", "STN", "LHR", "LCY", "SEN"].includes(airportCode);
}

function extractActualOriginAirportCode(result?: SerpApiFlightResult): string | undefined {
    return result?.flights?.[0]?.departure_airport?.id;
}

function isUniqueConstraintError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    return /unique|constraint|already exists/i.test(error.message);
}

function buildProviderQueryKey(trackedDestinationId: string, searchOriginAirportCode: string): string {
    return `serpapi:${trackedDestinationId}:search-origin=${searchOriginAirportCode}`;
}