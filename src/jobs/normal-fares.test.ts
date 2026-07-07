import test from "node:test";
import assert from "node:assert/strict";
import type { NormalizedFareObservation, SerpApiFlightResult, TrackedDestination } from "../types/domain.js";
import type { DiscordEmbed } from "../types/domain.js";

import { runNormalFaresJob } from "./normal-fares.js";

test("runNormalFaresJob expands LON searches and only keeps matching London-origin flights", async () => {
  const trackedDestination: TrackedDestination = {
    id: "td_lon_cph",
    originAirportCode: "LON",
    destinationAirportCode: "CPH",
    tripType: "round_trip",
    cabinClass: "economy",
    currencyCode: "GBP",
    locale: "en-GB",
    isActive: true
  };

  const searchedOrigins: string[] = [];
  const normalizedOrigins: string[] = [];
  const insertedObservationOrigins: string[] = [];

  const deps = {
    repository: {
      listActiveTrackedDestinations: async () => [trackedDestination],
      listLowestHistoricalFares: async () => [],
      insertFareObservation: async (observation: NormalizedFareObservation) => {
        insertedObservationOrigins.push(observation.originAirportCode);
        return { id: `obs_${insertedObservationOrigins.length}` };
      },
      hasSentFareAlert: async () => false,
      recordFareAlert: async () => undefined
    },
    serpApiClient: {
      searchFlights: async (destination: TrackedDestination): Promise<SerpApiFlightResult[]> => {
        searchedOrigins.push(destination.originAirportCode);

        if (destination.originAirportCode === "LHR") {
          return [buildResult("LHR"), buildResult("CDG")];
        }

        return [];
      }
    },
    discordClient: {
      sendEmbed: async (_embed: DiscordEmbed) => ({ messageId: "discord_message_1" })
    },
    normalizeObservation: ({ destination, result }: {
      trackedDestinationId: string;
      providerQueryKey: string;
      destination: TrackedDestination;
      result: SerpApiFlightResult;
    }): NormalizedFareObservation => {
      const actualOriginAirportCode = result.flights[0]?.departure_airport?.id ?? "UNKNOWN";
      normalizedOrigins.push(destination.originAirportCode);

      return {
        trackedDestinationId: trackedDestination.id,
        provider: "serpapi",
        providerQueryKey: `serpapi:${trackedDestination.id}:${destination.originAirportCode}`,
        observedAt: "2026-01-01T00:00:00.000Z",
        originAirportCode: actualOriginAirportCode,
        destinationAirportCode: "CPH",
        departDate: "2026-11-10",
        returnDate: "2026-11-14",
        tripType: "round_trip",
        cabinClass: "economy",
        priceAmountMinor: 10000,
        currencyCode: "GBP",
        deepLink: "https://example.com",
        flightFingerprint: `fp_${actualOriginAirportCode}`,
        rawPayloadJson: JSON.stringify(result)
      };
    }
  };

  await runNormalFaresJob(deps as never);

  assert.deepEqual(searchedOrigins, ["LHR", "LGW", "LCY", "LTN", "STN", "SEN"]);
  assert.deepEqual(normalizedOrigins, ["LHR"]);
  assert.deepEqual(insertedObservationOrigins, ["LHR"]);
});

/**
 * Regression test: destinations whose departureDateTo is before MIN_ADVANCE_DAYS
 * (i.e. stale / never updated in the DB) must NOT be skipped. Instead the job
 * should roll forward and still emit search calls.
 */
test("runNormalFaresJob rolls forward stale search windows instead of skipping", async () => {
  // departureDateTo is in the past relative to today + 14 days (MIN_ADVANCE_DAYS).
  // This simulates the real-world condition that triggered the bug.
  const staleDestination: TrackedDestination = {
    id: "td_lon_arn_stale",
    originAirportCode: "LON",
    destinationAirportCode: "ARN",
    tripType: "round_trip",
    cabinClass: "economy",
    currencyCode: "GBP",
    locale: "en-GB",
    isActive: true,
    departureDateFrom: "2026-01-01",
    departureDateTo: "2026-01-10"  // clearly in the past
  };

  const searchCallDates: string[] = [];

  const deps = {
    repository: {
      listActiveTrackedDestinations: async () => [staleDestination],
      listLowestHistoricalFares: async () => [],
      insertFareObservation: async (_obs: NormalizedFareObservation) => ({ id: "obs_1" }),
      hasSentFareAlert: async () => false,
      recordFareAlert: async () => undefined
    },
    serpApiClient: {
      searchFlights: async (destination: TrackedDestination): Promise<SerpApiFlightResult[]> => {
        searchCallDates.push(destination.departureDateFrom ?? "");
        return [];
      }
    },
    discordClient: {
      sendEmbed: async (_embed: DiscordEmbed) => ({ messageId: "msg_1" })
    },
    normalizeObservation: (): NormalizedFareObservation => ({
      trackedDestinationId: staleDestination.id,
      provider: "serpapi",
      providerQueryKey: "key",
      observedAt: new Date().toISOString(),
      originAirportCode: "LON",
      destinationAirportCode: "ARN",
      departDate: "",
      returnDate: "",
      tripType: "round_trip",
      cabinClass: "economy",
      priceAmountMinor: 0,
      currencyCode: "GBP",
      deepLink: "",
      flightFingerprint: "fp",
      rawPayloadJson: "{}"
    })
  };

  await runNormalFaresJob(deps as never);

  // Must have produced search calls (not been skipped)
  assert.ok(
    searchCallDates.length > 0,
    `Expected search calls to be made for stale window, but got ${searchCallDates.length}`
  );

  // All search dates must be on or after today + MIN_ADVANCE_DAYS (i.e. rolled forward)
  const today = new Date();
  const minAdvance = new Date(today);
  minAdvance.setUTCDate(today.getUTCDate() + 14);
  const minAdvanceStr = minAdvance.toISOString().slice(0, 10);

  for (const date of searchCallDates) {
    assert.ok(
      date >= minAdvanceStr,
      `Search date ${date} should be >= minValidDate ${minAdvanceStr}`
    );
  }
});

/**
 * When only departureDateFrom is stale but departureDateTo is still valid,
 * the job should clamp the start to minValidDate and not roll the entire window.
 */
test("runNormalFaresJob clamps only the stale departureDateFrom, preserving a valid departureDateTo", async () => {
  const today = new Date();
  const futureDate = new Date(today);
  futureDate.setUTCDate(today.getUTCDate() + 60);
  const futureDateStr = futureDate.toISOString().slice(0, 10);

  const destination: TrackedDestination = {
    id: "td_lon_bud_clamp",
    originAirportCode: "LON",
    destinationAirportCode: "BUD",
    tripType: "round_trip",
    cabinClass: "economy",
    currencyCode: "GBP",
    locale: "en-GB",
    isActive: true,
    departureDateFrom: "2026-01-01",  // stale start
    departureDateTo: futureDateStr     // still-valid end
  };

  const searchCallDates: string[] = [];

  const deps = {
    repository: {
      listActiveTrackedDestinations: async () => [destination],
      listLowestHistoricalFares: async () => [],
      insertFareObservation: async (_obs: NormalizedFareObservation) => ({ id: "obs_1" }),
      hasSentFareAlert: async () => false,
      recordFareAlert: async () => undefined
    },
    serpApiClient: {
      searchFlights: async (dest: TrackedDestination): Promise<SerpApiFlightResult[]> => {
        searchCallDates.push(dest.departureDateFrom ?? "");
        return [];
      }
    },
    discordClient: {
      sendEmbed: async (_embed: DiscordEmbed) => ({ messageId: "msg_1" })
    },
    normalizeObservation: (): NormalizedFareObservation => ({
      trackedDestinationId: destination.id,
      provider: "serpapi",
      providerQueryKey: "key",
      observedAt: new Date().toISOString(),
      originAirportCode: "LON",
      destinationAirportCode: "BUD",
      departDate: "",
      returnDate: "",
      tripType: "round_trip",
      cabinClass: "economy",
      priceAmountMinor: 0,
      currencyCode: "GBP",
      deepLink: "",
      flightFingerprint: "fp",
      rawPayloadJson: "{}"
    })
  };

  await runNormalFaresJob(deps as never);

  assert.ok(searchCallDates.length > 0, "Expected search calls to be made");

  const minAdvance = new Date(today);
  minAdvance.setUTCDate(today.getUTCDate() + 14);
  const minAdvanceStr = minAdvance.toISOString().slice(0, 10);

  for (const date of searchCallDates) {
    assert.ok(
      date >= minAdvanceStr,
      `Search date ${date} should be >= minValidDate ${minAdvanceStr}`
    );
    assert.ok(
      date <= futureDateStr,
      `Search date ${date} should not exceed original departureDateTo ${futureDateStr}`
    );
  }
});

function buildResult(originAirportCode: string): SerpApiFlightResult {
  return {
    price: 100,
    currency: "GBP",
    flights: [
      {
        departure_airport: {
          id: originAirportCode,
          time: "2026-11-10 08:00"
        },
        arrival_airport: {
          id: "CPH",
          time: "2026-11-10 11:00"
        },
        airline: "British Airways",
        flight_number: "BA123"
      }
    ],
    layovers: [],
    total_duration: 180,
    departure_date: "2026-11-10",
    return_date: "2026-11-14",
    deep_link: "https://example.com"
  };
}
