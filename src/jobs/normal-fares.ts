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
 * Number of consecutive departure dates to scan per destination.
 * Lowered to 3 to stay within free-tier SerpAPI limits (300 calls/month total
 * across 3 keys, 7 LON destinations, scanning every 48 hours).
 */
const SCAN_WINDOW_DAYS = 3;

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

// 從指定日期開始，產生連續 N 天的日期字串陣列
function generateCandidateDates(startDateStr: string, numberOfDays: number): string[] {
    const dates: string[] = [];
    for (let i = 0; i < numberOfDays; i++) {
        dates.push(addDays(startDateStr, i));
    }
    return dates;
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

            const tripLengthDays = DEFAULT_TRIP_LENGTH_DAYS;

            const candidateDates = generateCandidateDates(adjustedDepartureFrom, SCAN_WINDOW_DAYS);

            console.info(
                `[normal-fares] generated ${candidateDates.length} candidate date(s) locally for Phase 2: ${candidateDates.join(", ")}`
            );

            for (const departDate of candidateDates) {
                const returnDate = addDays(departDate, tripLengthDays);

                console.info(
                    `[normal-fares] phase 2 ${originAirportCode}->${destination.destinationAirportCode}: departDate=${departDate} returnDate=${returnDate}`
                );

                const searchDestination: TrackedDestination = {
                    ...destination,
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
