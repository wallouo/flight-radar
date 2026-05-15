import "dotenv/config";
import { createTursoClient, createTursoRepository } from "../db/repositories.js";
import { loadEnvironment, getTursoConnectionConfig } from "../config/env.js";

interface SeedTrackedDestinationRow {
  id: string;
  originAirportCode: string;
  destinationAirportCode: string;
  destinationCity?: string;
  destinationCountry?: string;
  tripType: "round_trip" | "one_way";
  cabinClass: "economy" | "premium_economy" | "business" | "first";
  departureDateFrom?: string;
  departureDateTo?: string;
  returnDateFrom?: string;
  returnDateTo?: string;
  maxStops?: number | null;
  currencyCode: string;
  locale: string;
}

const seedRows: SeedTrackedDestinationRow[] = [
  {
    id: "lon-kef-rt-econ",
    originAirportCode: "LON",
    destinationAirportCode: "KEF",
    destinationCity: "Reykjavik",
    destinationCountry: "Iceland",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-06-30",
    returnDateFrom: "2026-06-04",
    returnDateTo: "2026-07-10",
    maxStops: 1,
    currencyCode: "GBP",
    locale: "en-GB"
  },
  {
    id: "lon-cph-rt-econ",
    originAirportCode: "LON",
    destinationAirportCode: "CPH",
    destinationCity: "Copenhagen",
    destinationCountry: "Denmark",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-06-30",
    returnDateFrom: "2026-06-04",
    returnDateTo: "2026-07-10",
    maxStops: 1,
    currencyCode: "GBP",
    locale: "en-GB"
  },
  {
    id: "lon-arn-rt-econ",
    originAirportCode: "LON",
    destinationAirportCode: "ARN",
    destinationCity: "Stockholm",
    destinationCountry: "Sweden",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-06-30",
    returnDateFrom: "2026-06-04",
    returnDateTo: "2026-07-10",
    maxStops: 1,
    currencyCode: "GBP",
    locale: "en-GB"
  },
  {
    id: "lon-osl-rt-econ",
    originAirportCode: "LON",
    destinationAirportCode: "OSL",
    destinationCity: "Oslo",
    destinationCountry: "Norway",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-06-30",
    returnDateFrom: "2026-06-04",
    returnDateTo: "2026-07-10",
    maxStops: 1,
    currencyCode: "GBP",
    locale: "en-GB"
  },
  {
    id: "lon-hel-rt-econ",
    originAirportCode: "LON",
    destinationAirportCode: "HEL",
    destinationCity: "Helsinki",
    destinationCountry: "Finland",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-06-30",
    returnDateFrom: "2026-06-04",
    returnDateTo: "2026-07-10",
    maxStops: 1,
    currencyCode: "GBP",
    locale: "en-GB"
  },
  {
    id: "lon-bud-rt-econ",
    originAirportCode: "LON",
    destinationAirportCode: "BUD",
    destinationCity: "Budapest",
    destinationCountry: "Hungary",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-06-30",
    returnDateFrom: "2026-06-04",
    returnDateTo: "2026-07-10",
    maxStops: 1,
    currencyCode: "GBP",
    locale: "en-GB"
  },
  {
    id: "lon-prg-rt-econ",
    originAirportCode: "LON",
    destinationAirportCode: "PRG",
    destinationCity: "Prague",
    destinationCountry: "Czech Republic",
    tripType: "round_trip",
    cabinClass: "economy",
    departureDateFrom: "2026-06-01",
    departureDateTo: "2026-06-30",
    returnDateFrom: "2026-06-04",
    returnDateTo: "2026-07-10",
    maxStops: 1,
    currencyCode: "GBP",
    locale: "en-GB"
  }
];

async function main(): Promise<void> {
  const env = loadEnvironment();
  const client = createTursoClient(getTursoConnectionConfig(env));
  const repository = createTursoRepository(client);

  for (const row of seedRows) {
    await client.execute({
      sql: `
        INSERT OR REPLACE INTO tracked_destinations (
          id,
          origin_airport_code,
          destination_airport_code,
          destination_city,
          destination_country,
          trip_type,
          cabin_class,
          departure_date_from,
          departure_date_to,
          return_date_from,
          return_date_to,
          max_stops,
          currency_code,
          locale,
          is_active,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)
      `,
      args: [
        row.id,
        row.originAirportCode,
        row.destinationAirportCode,
        row.destinationCity ?? null,
        row.destinationCountry ?? null,
        row.tripType,
        row.cabinClass,
        row.departureDateFrom ?? null,
        row.departureDateTo ?? null,
        row.returnDateFrom ?? null,
        row.returnDateTo ?? null,
        typeof row.maxStops === "number" ? row.maxStops : null,
        row.currencyCode,
        row.locale
      ]
    });
  }

  const activeDestinations = await repository.listActiveTrackedDestinations();

  console.log(`[seed-tracked-destinations] inserted or updated ${seedRows.length} rows`);
  console.log(`[seed-tracked-destinations] active tracked destinations: ${activeDestinations.length}`);

  for (const destination of activeDestinations) {
    console.log(
      `- ${destination.id}: ${destination.originAirportCode} -> ${destination.destinationAirportCode} (${destination.cabinClass})`
    );
  }

  await client.close();
}

void main().catch((error) => {
  console.error("[seed-tracked-destinations] failed", error);
  process.exitCode = 1;
});