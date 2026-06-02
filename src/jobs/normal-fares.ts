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

const MIN_ADVANCE_DAYS = 14;
const DEFAULT_TRIP_LENGTH_DAYS = 5;

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

function todayAsDateString(): string {
    return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

function minAdvanceDateString(minAdvanceDays: number): string {
    return addDays(todayAsDateString(), minAdvanceDays);
}

export async function runNormalFaresJob(deps: NormalFaresJobDeps): Promise<void> {
    const destinations = await deps.repository.listActiveTrackedDestinations();
    const minValidDate = minAdvanceDateString(MIN_ADVANCE_DAYS);

    for (const destination of destinations) {
        const expandedOrigins = buildExpandedOrigins(destination);
        const historicalLowestFares = await deps.repository.listLowestHistoricalFares(destination.id, 3);

        for (const originAirportCode of expandedOrigins) {
            if (!destination.departureDateFrom) {
                console.info(
                    `[normal-fares] skipping ${originAirportCode}->${destination.destinationAirportCode}: no departureDateFrom configured`
                );
                continue;
            }

            if (!destination.departureDateTo) {
                console.info(
                    `[normal-fares] skipping ${originAirportCode}->${destination.destinationAirportCode}: no departureDateTo configured`
                );
                continue;
            }

            if (destination.departureDateTo < minValidDate) {
                console.info(
                    `[normal-fares] skipping ${originAirportCode}->${destination.destinationAirportCode}: search window entirely before ${minValidDate}`
                );
                continue;
            }

            const adjustedDepartureFrom =
                destination.departureDateFrom < minValidDate
                    ? minValidDate
                    : destination.departureDateFrom;

            if (adjustedDepartureFrom !== destination.departureDateFrom) {
                console.info(
                    `[normal-fares] adjusting departureDateFrom for ${originAirportCode}->${destination.destinationAirportCode} from ${destination.departureDateFrom} to ${adjustedDepartureFrom}`
                );
            }

            const departureWindowFrom = adjustedDepartureFrom;
            const departureWindowTo = destination.departureDateTo;
            const tripLengthDays = DEFAULT_TRIP_LENGTH_DAYS;

            // Phase 1: 強制使用單程票 (one_way) 來查日曆，只找出發日期的便宜點
            const calendarQueryDestination: TrackedDestination = {
                ...destination,
                originAirportCode,
                departureDateFrom: adjustedDepartureFrom,
                tripType: "one_way" // 強制改為單程
            };

            const candidateDates = await runCalendarPhase(
                deps,
                calendarQueryDestination,
                departureWindowFrom,
                departureWindowTo,
                historicalLowestFares
            );

            if (candidateDates.length === 0) {
                console.info(
                    `[normal-fares] no calendar candidates for ${originAirportCode}->${destination.destinationAirportCode}`
                );
                continue;
            }

            for (const departDate of candidateDates) {
                const returnDate = addDays(departDate, tripLengthDays);

                console.info(
                    `[normal-fares] phase 2 ${originAirportCode}->${destination.destinationAirportCode}: departDate=${departDate} returnDate=${returnDate}`
                );

                const searchDestination: TrackedDestination = {
                    ...destination, // 使用原始的 destination (包含原本的 tripType)
                    originAirportCode,
                    departureDateFrom: departDate,
                    departureDateTo: returnDate,
                    returnDateFrom: returnDate
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

                        console.error(
                            `[normal-fares] failed to insert observation for ${originAirportCode}->${destination.destinationAirportCode}:`,
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

                    const { messageId } = await deps.discordClient.sendEmbed(
                        buildNormalFareEmbed(observation, {
                            historicalLowestPriceAmountMinor: sortedHistoricalPrices[0],
                            thirdLowestPriceAmountMinor: sortedHistoricalPrices[2]
                        })
                    );

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
    calendarQueryDestination: TrackedDestination,
    departureWindowFrom: string,
    departureWindowTo: string,
    historicalFares: Awaited<ReturnType<FlightPriceRepository["listLowestHistoricalFares"]>>
): Promise<string[]> {
    console.info(
        `[normal-fares] phase 1 ${calendarQueryDestination.originAirportCode}->${calendarQueryDestination.destinationAirportCode}: ` +
        `outbound=${calendarQueryDestination.departureDateFrom} tripType=${calendarQueryDestination.tripType}`
    );

    let calendarDays;
    try {
        calendarDays = await deps.serpApiClient.searchCalendar(
            calendarQueryDestination,
            calendarQueryDestination.departureDateFrom!
        );
    } catch (error) {
        console.warn(
            `[normal-fares] calendar scan failed for ` +
            `${calendarQueryDestination.originAirportCode}->${calendarQueryDestination.destinationAirportCode}:`,
            error
        );
        return [];
    }

    const filtered = calendarDays.filter((day) =>
        isWithinDepartureDateRange(day.date, departureWindowFrom, departureWindowTo)
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
