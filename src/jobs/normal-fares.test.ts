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
