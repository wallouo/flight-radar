import type { SerpApiFlightResult, TrackedDestination } from "../types/domain.js";
import { decimalToMinorUnits } from "../utils/currency.js";
import type { NormalizedFareObservation } from "../types/domain.js";

export interface BuildSerpApiObservationArgs {
  trackedDestinationId: string;
  providerQueryKey: string;
  destination: TrackedDestination;
  result: SerpApiFlightResult;
  observedAt?: string;
}

export function buildSerpApiObservation(args: BuildSerpApiObservationArgs): NormalizedFareObservation {
  const observedAt = args.observedAt ?? new Date().toISOString();
  const departDate = args.result.departure_date ?? args.destination.departureDateFrom;
  const returnDate = args.result.return_date ?? args.destination.returnDateFrom;
  const currencyCode = (args.result.currency ?? args.destination.currencyCode).toUpperCase();

  const actualOriginAirportCode = args.result.flights[0]?.departure_airport?.id ?? args.destination.originAirportCode;

  return {
    trackedDestinationId: args.trackedDestinationId,
    observedAt,
    provider: "serpapi",
    providerQueryKey: args.providerQueryKey,
    originAirportCode: actualOriginAirportCode,
    destinationAirportCode: args.destination.destinationAirportCode,
    departDate,
    returnDate,
    cabinClass: args.destination.cabinClass,
    tripType: args.destination.tripType,
    priceAmountMinor: decimalToMinorUnits(args.result.price),
    currencyCode,
    deepLink: args.result.deep_link,
    flightFingerprint: buildSerpApiFlightFingerprint(args.destination, args.result),
    rawPayloadJson: JSON.stringify(args.result)
  };
}

export function buildSerpApiFlightFingerprint(
  destination: TrackedDestination,
  result: SerpApiFlightResult
): string {
  const segments = result.flights.flatMap((flight) => [
    flight.departure_airport?.id ?? "",
    flight.departure_airport?.time ?? "",
    flight.arrival_airport?.id ?? "",
    flight.arrival_airport?.time ?? "",
    flight.airline ?? "",
    flight.flight_number ?? ""
  ]);

  return [
    destination.originAirportCode,
    destination.destinationAirportCode,
    destination.cabinClass,
    destination.tripType,
    result.departure_date ?? destination.departureDateFrom ?? "",
    result.return_date ?? destination.returnDateFrom ?? "",
    ...segments
  ].join("|");
}
