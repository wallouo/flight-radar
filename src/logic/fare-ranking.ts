import type { NormalizedFareObservation } from "../types/domain.js";

export function qualifiesForTopThreeAlert(
  historicalLowestFares: NormalizedFareObservation[],
  candidate: NormalizedFareObservation
): boolean {
  if (historicalLowestFares.length < 3) {
    return true;
  }

  const thirdLowest = historicalLowestFares
    .map((fare) => fare.priceAmountMinor)
    .sort((left, right) => left - right)[2];

  return candidate.priceAmountMinor < thirdLowest;
}

export function buildFareAlertFingerprint(candidate: NormalizedFareObservation): string {
  return [
    candidate.trackedDestinationId,
    candidate.originAirportCode,
    candidate.destinationAirportCode,
    candidate.departDate ?? "",
    candidate.returnDate ?? "",
    candidate.cabinClass,
    candidate.tripType,
    String(candidate.priceAmountMinor),
    candidate.currencyCode,
    candidate.flightFingerprint
  ].join("|");
}
