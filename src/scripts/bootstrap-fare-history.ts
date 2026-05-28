import "dotenv/config";
import { createSerpApiClient } from "../clients/serpapi.js";
import { loadEnvironment } from "../config/env.js";
import { createTursoClient, createTursoRepository } from "../db/repositories.js";
import { buildSerpApiObservation } from "../logic/serpapi-normalization.js";
import type { SerpApiFlightResult, TrackedDestination } from "../types/domain.js";

const seasonalWindows: ReadonlyArray<SeasonalWindow> = [
  {
    label: "2026-summer",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-08-31",
    returnDateFrom: "2026-06-05",
    returnDateTo: "2026-09-15"
  },
  {
    label: "2026-autumn",
    departureDateFrom: "2026-09-01",
    departureDateTo: "2026-11-30",
    returnDateFrom: "2026-09-05",
    returnDateTo: "2026-12-15"
  },
  {
    label: "2026-winter",
    departureDateFrom: "2026-12-01",
    departureDateTo: "2027-02-28",
    returnDateFrom: "2026-12-05",
    returnDateTo: "2027-03-15"
  },
  {
    label: "2027-spring",
    departureDateFrom: "2027-03-01",
    departureDateTo: "2027-05-31",
    returnDateFrom: "2027-03-05",
    returnDateTo: "2027-06-15"
  },
  {
    label: "2027-summer",
    departureDateFrom: "2027-06-01",
    departureDateTo: "2027-08-31",
    returnDateFrom: "2027-06-05",
    returnDateTo: "2027-09-15"
  },
  {
    label: "2027-autumn",
    departureDateFrom: "2027-09-01",
    departureDateTo: "2027-11-30",
    returnDateFrom: "2027-09-05",
    returnDateTo: "2027-12-15"
  }
];

const samplesPerWindow = 2;
const dryRun = process.argv.includes("--dry-run");
const startFromDestinationId = "lon-osl-rt-econ";
const searchHorizonDays = 180;
const minTripLengthDays = 3;
const maxTripLengthDays = 7;
const airportSearchExpansions: Readonly<Record<string, readonly string[]>> = {
  LON: ["LHR", "LGW", "LCY", "LTN", "STN", "SEN"]
};

interface SeasonalWindow {
  label: string;
  departureDateFrom: string;
  departureDateTo: string;
  returnDateFrom: string;
  returnDateTo: string;
}

interface WindowSample {
  label: string;
  departureDateFrom: string;
  departureDateTo: string;
  returnDateFrom: string;
  returnDateTo: string;
}

async function main(): Promise<void> {
  const env = loadEnvironment();
  const client = createTursoClient({
    url: env.DATABASE_URL,
    authToken: env.DATABASE_AUTH_TOKEN
  });
  const repository = createTursoRepository(client);
  const serpApiApiKey = env.SERPAPI_API_KEY;
  if (!serpApiApiKey) {
    throw new Error("[bootstrap-fare-history] SERPAPI_API_KEY is required");
  }

  const serpApiClient = createSerpApiClient({
    apiKey: serpApiApiKey
  });

  const destinations = await repository.listActiveTrackedDestinations();
  const destinationsToProcess = selectDestinationsToProcess(destinations, startFromDestinationId);
  console.log(`[bootstrap-fare-history] mode: ${dryRun ? "dry-run" : "write"}`);
  console.log(`[bootstrap-fare-history] active destinations: ${destinations.length}`);
  console.log(`[bootstrap-fare-history] processing destinations: ${destinationsToProcess.length}`);
  console.log(`[bootstrap-fare-history] start from destination: ${startFromDestinationId}`);
  console.log(`[bootstrap-fare-history] seasonal windows: ${seasonalWindows.length}`);
  console.log(`[bootstrap-fare-history] samples per window: ${samplesPerWindow}`);

  let insertedCount = 0;
  let skippedCount = 0;
  let skippedAirportMismatchCount = 0;
  let dryRunCandidateCount = 0;

  for (const destination of destinationsToProcess) {
    for (const seasonalWindow of seasonalWindows) {
      const windowSamples = buildWindowSamples(seasonalWindow, destination.tripType === "round_trip");

      for (const windowSample of windowSamples) {
        const queryDestination = applyWindowSample(destination, windowSample);
        const searchDestinations = buildSearchDestinations(queryDestination);

        for (const searchDestination of searchDestinations) {
          console.log(
            `[bootstrap-fare-history] fetching ${destination.id} search=${searchDestination.originAirportCode} target=${destination.originAirportCode} -> ${destination.destinationAirportCode} window=${windowSample.label} depart=${queryDestination.departureDateFrom}${queryDestination.returnDateFrom ? ` return=${queryDestination.returnDateFrom}` : ""}`
          );

          const results = await serpApiClient.searchFlights(searchDestination);
          const filteredResults = results.filter((result) => {
            if (matchesTargetOriginAirport(result, destination.originAirportCode)) {
              return true;
            }

            skippedAirportMismatchCount += 1;
            console.log(
              `[bootstrap-fare-history] skipped airport mismatch for ${destination.id} window=${windowSample.label} actual=${extractActualOriginAirportCode(result) ?? "unknown"} expected=${destination.originAirportCode}`
            );
            return false;
          });

          console.log(
            `[bootstrap-fare-history] ${destination.id} window=${windowSample.label} results: ${results.length} kept: ${filteredResults.length}`
          );

          logResultPreview(destination.id, windowSample.label, searchDestination.originAirportCode, results, filteredResults);

          for (const [index, result] of filteredResults.entries()) {
            const observedAt = new Date(Date.now() - (insertedCount + skippedCount + dryRunCandidateCount + index) * 1000).toISOString();
            const observation = buildSerpApiObservation({
              trackedDestinationId: destination.id,
              providerQueryKey: `bootstrap:serpapi:${destination.id}:${windowSample.label}:search-origin=${searchDestination.originAirportCode}`,
              destination: queryDestination,
              result,
              observedAt
            });

            if (dryRun) {
              dryRunCandidateCount += 1;
              console.log(
                `[bootstrap-fare-history] dry-run candidate ${destination.id} window=${windowSample.label} price=${result.price ?? "unknown"} actualOrigin=${extractActualOriginAirportCode(result) ?? "unknown"} fingerprint=${observation.flightFingerprint}`
              );
              continue;
            }

            try {
              await repository.insertFareObservation(observation);
              insertedCount += 1;
            } catch (error) {
              if (isUniqueConstraintError(error)) {
                skippedCount += 1;
                console.warn(
                  `[bootstrap-fare-history] skipped duplicate observation for ${destination.id} window=${windowSample.label} fingerprint=${observation.flightFingerprint}`
                );
                continue;
              }

              throw error;
            }
          }
        }
      }
    }
  }

  console.log(`[bootstrap-fare-history] inserted: ${insertedCount}`);
  console.log(`[bootstrap-fare-history] skipped duplicates: ${skippedCount}`);
  console.log(`[bootstrap-fare-history] skipped airport mismatches: ${skippedAirportMismatchCount}`);
  console.log(`[bootstrap-fare-history] dry-run candidates: ${dryRunCandidateCount}`);

  await client.close();
}

function selectDestinationsToProcess(
  destinations: TrackedDestination[],
  startDestinationId: string
): TrackedDestination[] {
  const startIndex = destinations.findIndex((destination) => destination.id === startDestinationId);

  if (startIndex === -1) {
    throw new Error(`[bootstrap-fare-history] start destination not found: ${startDestinationId}`);
  }

  return destinations.slice(startIndex);
}

function applyWindowSample(destination: TrackedDestination, windowSample: WindowSample): TrackedDestination {
  return {
    ...destination,
    departureDateFrom: clampDepartureDate(windowSample.departureDateFrom),
    departureDateTo: clampDepartureDate(windowSample.departureDateTo),
    returnDateFrom:
      destination.tripType === "round_trip"
        ? clampReturnDate(windowSample.departureDateFrom, windowSample.returnDateFrom)
        : undefined,
    returnDateTo:
      destination.tripType === "round_trip"
        ? clampReturnDate(windowSample.departureDateTo, windowSample.returnDateTo)
        : undefined
  };
}

function buildWindowSamples(window: SeasonalWindow, includeReturnDate: boolean): WindowSample[] {
  const departureSamples = buildSampleDates(window.departureDateFrom, window.departureDateTo, samplesPerWindow);
  const returnSamples = includeReturnDate
    ? buildSampleDates(window.returnDateFrom, window.returnDateTo, samplesPerWindow)
    : [];

  return departureSamples.map((departureDate, index) => ({
    label: `${window.label}-sample-${index + 1}`,
    departureDateFrom: departureDate,
    departureDateTo: departureDate,
    returnDateFrom: includeReturnDate ? returnSamples[index] ?? returnSamples[returnSamples.length - 1] : "",
    returnDateTo: includeReturnDate ? returnSamples[index] ?? returnSamples[returnSamples.length - 1] : ""
  }));
}

function buildSampleDates(startDate: string, endDate: string, sampleCount: number): string[] {
  if (sampleCount <= 1 || startDate === endDate) {
    return [startDate];
  }

  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const totalDays = Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000));

  return Array.from({ length: sampleCount }, (_, index) => {
    const ratio = sampleCount === 1 ? 0 : index / (sampleCount - 1);
    const offsetDays = Math.round(totalDays * ratio);
    return addDays(startDate, offsetDays);
  });
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function clampDepartureDate(date: string): string {
  return clampDateToSearchableRange(date);
}

function clampReturnDate(departureDate: string, desiredReturnDate: string): string {
  const clampedDepartureDate = clampDepartureDate(departureDate);
  const minimumReturnDate = addDays(clampedDepartureDate, minTripLengthDays);
  const maximumReturnDate = addDays(clampedDepartureDate, maxTripLengthDays);
  const clampedDesiredReturnDate = clampDateToSearchableRange(desiredReturnDate);

  if (clampedDesiredReturnDate < minimumReturnDate) {
    return minimumReturnDate;
  }

  if (clampedDesiredReturnDate > maximumReturnDate) {
    return maximumReturnDate;
  }

  return clampedDesiredReturnDate;
}

function clampDateToSearchableRange(date: string): string {
  const today = new Date();
  const floorDate = toIsoDate(today);
  const ceilingDate = toIsoDate(addDaysToDate(today, searchHorizonDays));

  if (date < floorDate) {
    return floorDate;
  }

  if (date > ceilingDate) {
    return ceilingDate;
  }

  return date;
}

function addDaysToDate(date: Date, days: number): Date {
  const value = new Date(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildSearchDestinations(destination: TrackedDestination): TrackedDestination[] {
  const normalizedOriginAirportCode = destination.originAirportCode.toUpperCase();
  const expandedOriginAirportCodes = airportSearchExpansions[normalizedOriginAirportCode] ?? [normalizedOriginAirportCode];

  return expandedOriginAirportCodes.map((originAirportCode) => ({
    ...destination,
    originAirportCode
  }));
}

function matchesTargetOriginAirport(result: SerpApiFlightResult, expectedOriginAirportCode: string): boolean {
  const actualOriginAirportCode = extractActualOriginAirportCode(result);

  if (!actualOriginAirportCode) {
    return false;
  }

  const normalizedExpectedOriginAirportCode = expectedOriginAirportCode.toUpperCase();
  const normalizedActualOriginAirportCode = actualOriginAirportCode.toUpperCase();

  if (normalizedExpectedOriginAirportCode === "LON") {
    return isLondonAirportCode(normalizedActualOriginAirportCode);
  }

  return normalizedActualOriginAirportCode === normalizedExpectedOriginAirportCode;
}

function isLondonAirportCode(airportCode: string): boolean {
  return ["LON", "LGW", "LTN", "STN", "LHR", "LCY", "SEN"].includes(airportCode);
}

function extractActualOriginAirportCode(result?: SerpApiFlightResult): string | undefined {
  return result?.flights?.[0]?.departure_airport?.id;
}

function logResultPreview(
  destinationId: string,
  windowLabel: string,
  searchOriginAirportCode: string,
  results: SerpApiFlightResult[],
  filteredResults: SerpApiFlightResult[]
): void {
  const firstResult = results[0];
  const firstKeptResult = filteredResults[0];

  console.log(
    `[bootstrap-fare-history] preview ${destinationId} window=${windowLabel} search=${searchOriginAirportCode} firstPrice=${firstResult?.price ?? "none"} firstOrigin=${extractActualOriginAirportCode(firstResult) ?? "unknown"} keptPrice=${firstKeptResult?.price ?? "none"} keptOrigin=${extractActualOriginAirportCode(firstKeptResult) ?? "unknown"}`
  );
}

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /unique|constraint|already exists/i.test(error.message);
}

void main().catch((error) => {
  console.error("[bootstrap-fare-history] failed", error);
  process.exitCode = 1;
});