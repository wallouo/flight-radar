import { z } from "zod";

export const tripTypeSchema = z.enum(["round_trip", "one_way"]);
export const cabinClassSchema = z.enum(["economy", "premium_economy", "business", "first"]);

export const trackedDestinationSchema = z.object({
  id: z.string().min(1),
  originAirportCode: z.string().length(3),
  destinationAirportCode: z.string().length(3),
  destinationCity: z.string().optional(),
  destinationCountry: z.string().optional(),
  tripType: tripTypeSchema,
  cabinClass: cabinClassSchema,
  departureDateFrom: z.string().optional(),
  departureDateTo: z.string().optional(),
  returnDateFrom: z.string().optional(),
  returnDateTo: z.string().optional(),
  maxStops: z.number().int().nonnegative().nullable().optional(),
  currencyCode: z.string().length(3),
  locale: z.string().min(2),
  isActive: z.boolean()
});

export const serpApiFlightResultSchema = z.object({
  price: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  flights: z.array(z.object({
    departure_airport: z.object({ id: z.string().optional(), time: z.string().optional() }).optional(),
    arrival_airport: z.object({ id: z.string().optional(), time: z.string().optional() }).optional(),
    airline: z.string().optional(),
    flight_number: z.string().optional()
  })).default([]),
  layovers: z.array(z.unknown()).optional(),
  total_duration: z.number().optional(),
  carbon_emissions: z.unknown().optional(),
  booking_token: z.string().optional(),
  departure_token: z.string().optional(),
  departure_date: z.string().optional(),
  return_date: z.string().optional(),
  deep_link: z.string().url().optional()
});

export const normalizedFareObservationSchema = z.object({
  trackedDestinationId: z.string().min(1),
  observedAt: z.string().min(1),
  provider: z.literal("serpapi"),
  providerQueryKey: z.string().min(1),
  originAirportCode: z.string().length(3),
  destinationAirportCode: z.string().length(3),
  departDate: z.string().optional(),
  returnDate: z.string().optional(),
  cabinClass: cabinClassSchema,
  tripType: tripTypeSchema,
  priceAmountMinor: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  deepLink: z.string().url().optional(),
  flightFingerprint: z.string().min(1),
  rawPayloadJson: z.string().min(2)
});

export const rssItemSchema = z.object({
  feedName: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().optional(),
  link: z.string().url(),
  publishedAt: z.string().optional()
});

export const businessDealExtractionSchema = z.object({
  origin: z.string().min(1),
  destination: z.string().min(1),
  priceText: z.string().min(1),
  priceAmount: z.number().nonnegative().optional(),
  currencyCode: z.string().length(3).optional(),
  cabinClass: cabinClassSchema,
  isLongHaul: z.boolean(),
  isErrorFare: z.boolean().optional(),
  confidence: z.number().min(0).max(1)
});

export const discordEmbedSchema = z.object({
  title: z.string().min(1).max(256),
  description: z.string().min(1).max(4096),
  url: z.string().url().optional(),
  color: z.number().int().nonnegative().optional(),
  fields: z.array(z.object({
    name: z.string().min(1).max(256),
    value: z.string().min(1).max(1024),
    inline: z.boolean().optional()
  })).default([]),
  timestamp: z.string().optional()
});
