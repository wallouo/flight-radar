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

function generateCandidateDates(startDateStr: string, numberOfDays: number): string[] {
    const dates: string[] = [];
    for (let i = 0; i < numberOfDays; i++) {
        dates.push(addDays(startDateStr, i));
    }
    return dates;
}

/**
 * Resolves the effective departure window for a destination, honouring any
 * partial date configuration and rolling forward stale windows.
 */
export function resolveEffectiveDepartureWindow(
    destination: TrackedDestination,
    minValidDate: string
): { from: string; to: string } {
    const { departureDateFrom, departureDateTo } = destination;

    if (!departureDateFrom && !departureDateTo) {
        return { from: minValidDate, to: addDays(minValidDate, SCAN_WINDOW_DAYS - 1) };
    }

    if (departureDateFrom && !departureDateTo) {
        const from = departureDateFrom < minValidDate ? minValidDate : departureDateFrom;
        return { from, to: addDays(from, SCAN_WINDOW_DAYS - 1) };
    }

    if (!departureDateFrom && departureDateTo) {
        if (departureDateTo < minValidDate) {
            console.info(
                `[normal-fares] departureDateTo=${departureDateTo} is stale for ` +
                `${destination.originAirportCode}->${destination.destinationAirportCode}, rolling forward.`
            );
            return { from: minValidDate, to: addDays(minValidDate, SCAN_WINDOW_DAYS - 1) };
        }
        return { from: minValidDate, to: departureDateTo };
    }

    const from = departureDateFrom!;
    const to = departureDateTo!;

    if (to < minValidDate) {
        console.info(
            `[normal-fares] search window stale (departureDateTo=${to} < minValidDate=${minValidDate}) ` +
            `for ${destination.originAirportCode}->${destination.destinationAirportCode}. Rolling forward.`
        );
        return { from: minValidDate, to: addDays(minValidDate, SCAN_WINDOW_DAYS - 1) };
    }

    const effectiveFrom = from < minValidDate ? minValidDate : from;
    if (effectiveFrom !== from) {
        console.info(
            `[normal-fares] clamping departureDateFrom for ` +
            `${destination.originAirportCode}->${destination.destinationAirportCode} ` +
            `from ${from} to ${effectiveFrom}`
        );
    }

    return { from: effectiveFrom, to };
}

export async function runNormalFaresJob(deps: NormalFaresJobDeps): Promise<void> {
    const destinations = await deps.repository.listActiveTrackedDestinations();
    const minValidDate = minAdvanceDateString(MIN_ADVANCE_DAYS);

    console.info(`[normal-fares] minValidDate=${minValidDate}, destinations=${destinations.length}`);

    for (const destination of destinations) {
        const expandedOrigins = buildExpandedOrigins(destination);
        const historicalLowestFares = await deps.repository.listLowestHistoricalFares(destination.id, 3);

        for (const originAirportCode of expandedOrigins) {
            const effectiveWindow = resolveEffectiveDepartureWindow(destination, minValidDate);
            const candidateDates = generateCandidateDates(effectiveWindow.from, SCAN_WINDOW_DAYS);

            console.info(
                `[normal-fares] scanning ${originAirportCode}->${destination.destinationAirportCode}: ` +
                `window=${effectiveWindow.from}..${effectiveWindow.to} ` +
                `dates=${candidateDates.join(", ")}`
            );

            for (const departDate of candidateDates) {
                if (departDate > effectiveWindow.to) break;

                const returnDate = addDays(departDate, DEFAULT_TRIP_LENGTH_DAYS);

                const searchDestination: TrackedDestination = {
                    ...destination,
                    originAirportCode,
                    departureDateFrom: departDate,
                    departureDateTo: returnDate,
                    returnDateFrom: returnDate
                };

                let results: SerpApiFlightResult[];
                try {
                    results = await deps.serpApiClient.searchFlights(searchDestination);
                } catch (error) {
                    console.error(
                        `[normal-fares] searchFlights failed for ${originAirportCode}->${destination.destinationAirportCode} ` +
                        `departDate=${departDate}:`,
                        error
                    );
                    throw error;
                }

                // DIAGNOSTIC: log raw results count + first result's departure airport
                const firstOrigin = results[0]?.flights?.[0]?.departure_airport?.id ?? "(none)";
                console.info(
                    `[normal-fares] serpapi returned ${results.length} result(s) for ` +
                    `${originAirportCode}->${destination.destinationAirportCode} departDate=${departDate} ` +
                    `(first origin=${firstOrigin})`
                );

                const filteredResults = results.filter((result) =>
                    matchesTargetOriginAirport(result, destination.originAirportCode)
                );

                // DIAGNOSTIC: log how many passed the origin filter
                if (results.length > 0 && filteredResults.length === 0) {
                    const allOrigins = results
                        .map((r) => r.flights?.[0]?.departure_airport?.id ?? "(unknown)")
                        .join(", ");
                    console.warn(
                        `[normal-fares] ALL ${results.length} result(s) filtered out for ` +
                        `${originAirportCode}->${destination.destinationAirportCode} departDate=${departDate}. ` +
                        `Expected origin matching '${destination.originAirportCode}', ` +
                        `got: [${allOrigins}]`
                    );
                } else {
                    console.info(
                        `[normal-fares] ${filteredResults.length}/${results.length} result(s) passed origin filter ` +
                        `for ${originAirportCode}->${destination.destinationAirportCode} departDate=${departDate}`
                    );
                }

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
                        console.info(
                            `[normal-fares] inserted observation ${observationRecord.id} ` +
                            `for ${originAirportCode}->${destination.destinationAirportCode} ` +
                            `departDate=${departDate} price=${observation.priceAmountMinor}`
                        );
                    } catch (error) {
                        if (isUniqueConstraintError(error)) {
                            console.info(
                                `[normal-fares] duplicate observation skipped for ` +
                                `${originAirportCode}->${destination.destinationAirportCode} departDate=${departDate}`
                            );
                            continue;
                        }
                        console.error(
                            `[normal-fares] unexpected error inserting observation for ` +
                            `${originAirportCode}->${destination.destinationAirportCode} ` +
                            `departDate=${departDate}:`,
                            error
                        );
                        throw error;
                    }

                    const alertFingerprint = buildFareAlertFingerprint(observation);
                    const alreadyAlerted = await deps.repository.hasSentFareAlert(alertFingerprint);

                    if (!qualifiesForTopThreeAlert(historicalLowestFares, observation) || alreadyAlerted) {
                        console.info(
                            `[normal-fares] observation does not qualify for alert ` +
                            `(qualifies=${qualifiesForTopThreeAlert(historicalLowestFares, observation)}, ` +
                            `alreadyAlerted=${alreadyAlerted}) ` +
                            `for ${originAirportCode}->${destination.destinationAirportCode} departDate=${departDate}`
                        );
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

                    console.info(
                        `[normal-fares] sent Discord alert messageId=${messageId} ` +
                        `for ${originAirportCode}->${destination.destinationAirportCode} departDate=${departDate}`
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
