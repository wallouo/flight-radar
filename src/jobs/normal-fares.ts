import type { DiscordWebhookClient } from "../clients/discord.js";
import type { FlightPriceRepository } from "../db/repositories.js";
import type { SerpApiClient } from "../clients/serpapi.js";
import { buildFareAlertFingerprint, qualifiesForTopThreeAlert } from "../logic/fare-ranking.js";
import { buildNormalFareEmbed } from "../notifications/normal-fare-embed.js";
import type { NormalizedFareObservation, SerpApiFlightResult, TrackedDestination } from "../types/domain.js";
import { createStableId } from "../utils/id.js";

const airportSearchExpansions: Readonly<Record<string, readonly string[]>> = {
  LON: ["LHR", "LGW", "LCY", "LTN", "STN", "SEN"]
};

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
}

export async function runNormalFaresJob(deps: NormalFaresJobDeps): Promise<void> {
  const destinations = await deps.repository.listActiveTrackedDestinations();

  for (const destination of destinations) {
    const searchDestinations = buildSearchDestinations(destination);

    for (const searchDestination of searchDestinations) {
      const results = await deps.serpApiClient.searchFlights(searchDestination);
      const filteredResults = results.filter((result) =>
        matchesTargetOriginAirport(result, destination.originAirportCode)
      );

      for (const result of filteredResults) {
        const observation = deps.normalizeObservation({
          trackedDestinationId: destination.id,
          providerQueryKey: buildProviderQueryKey(destination.id, searchDestination.originAirportCode),
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

function isUniqueConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return /unique|constraint|already exists/i.test(error.message);
}

function buildProviderQueryKey(trackedDestinationId: string, searchOriginAirportCode: string): string {
  return `serpapi:${trackedDestinationId}:search-origin=${searchOriginAirportCode}`;
}
