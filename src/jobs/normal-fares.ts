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
const airportSearchExpansions: Readonly<Record<string, readonly string[]>> = {};

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
    destination: Parameters<SerpApiClient["searchFlights"]>[0];
    result: SerpApiFlightResult;
  }) => NormalizedFareObservation;
  /** Override the scan month (YYYY-MM). Defaults to next calendar month. */
  scanMonthOverride?: string;
}

export async function runNormalFaresJob(deps: NormalFaresJobDeps): Promise<void> {
  const destinations = await deps.repository.listActiveTrackedDestinations();
  const scanMonth = deps.scanMonthOverride ?? buildNextMonthYYYYMM();

  for (const destination of destinations) {
    const expandedOrigins = buildExpandedOrigins(destination);

    for (const originAirportCode of expandedOrigins) {
      const searchBase: TrackedDestination = { ...destination, originAirportCode };

      // ── Phase 1: calendar scan (1 API call per origin) ─────────────────
      const candidateDates = await runCalendarPhase(deps, searchBase, scanMonth);

      if (candidateDates.length === 0) {
        console.info(
          `[normal-fares] no calendar candidates for ${originAirportCode}->${destination.destinationAirportCode} in ${scanMonth}`
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

          const historicalLowestFares = await deps.repository.listLowestHistoricalFares(destination.id, 3);

          let observationRecord;
          try {
            observationRecord = await deps.repository.insertFareObservation(observation);
          } catch (error) {
            if (isUniqueConstraintError(error)) {
              continue;
            }
            throw error;
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
 * Phase 1: fetch the price calendar for the given month, filter dates
 * within the destination's configured range, pre-screen against the
 * historical top-3 threshold, and return up to MAX_PHASE2_DATES cheapest.
 */
async function runCalendarPhase(
  deps: NormalFaresJobDeps,
  destination: TrackedDestination,
  scanMonth: string
): Promise<string[]> {
  let calendarDays;
  try {
    calendarDays = await deps.serpApiClient.searchCalendar(destination, scanMonth);
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

  const historicalFares = await deps.repository.listLowestHistoricalFares(destination.id, 3);
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

/** Returns YYYY-MM for the next calendar month relative to today. */
export function buildNextMonthYYYYMM(now: Date = new Date()): string {
  const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const year = next.getFullYear();
  const month = String(next.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
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
