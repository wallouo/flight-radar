import "dotenv/config";
import { createTursoClient } from "../db/repositories.js";
import { loadEnvironment, getTursoConnectionConfig } from "../config/env.js";

interface SyncTrackedDestinationRow {
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
  isActive: number;
}

const trackedRows: SyncTrackedDestinationRow[] = [
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
    locale: "en-GB",
    isActive: 1
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
    locale: "en-GB",
    isActive: 1
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
    locale: "en-GB",
    isActive: 1
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
    locale: "en-GB",
    isActive: 1
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
    locale: "en-GB",
    isActive: 1
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
    locale: "en-GB",
    isActive: 1
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
    locale: "en-GB",
    isActive: 1
  }
];

async function main(): Promise<void> {
  const env = loadEnvironment();
  const client = createTursoClient(getTursoConnectionConfig(env));

  const beforeResult = await client.execute(`
    SELECT
      id,
      origin_airport_code,
      destination_airport_code,
      cabin_class,
      trip_type,
      currency_code,
      locale,
      is_active
    FROM tracked_destinations
    ORDER BY origin_airport_code, destination_airport_code, id
  `);

  console.log(`[tracked-destinations-sync] before count: ${beforeResult.rows.length}`);
  for (const row of beforeResult.rows) {
    console.log(
      `- ${String(row.id)}: ${String(row.origin_airport_code)} -> ${String(row.destination_airport_code)} (${String(row.cabin_class)})`
    );
  }

  for (const row of trackedRows) {
    await client.execute({
      sql: `
        INSERT INTO tracked_destinations (
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
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          origin_airport_code = excluded.origin_airport_code,
          destination_airport_code = excluded.destination_airport_code,
          destination_city = excluded.destination_city,
          destination_country = excluded.destination_country,
          trip_type = excluded.trip_type,
          cabin_class = excluded.cabin_class,
          departure_date_from = excluded.departure_date_from,
          departure_date_to = excluded.departure_date_to,
          return_date_from = excluded.return_date_from,
          return_date_to = excluded.return_date_to,
          max_stops = excluded.max_stops,
          currency_code = excluded.currency_code,
          locale = excluded.locale,
          is_active = excluded.is_active,
          updated_at = CURRENT_TIMESTAMP
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
        row.locale,
        row.isActive
      ]
    });
  }

  const afterResult = await client.execute(`
    SELECT
      id,
      origin_airport_code,
      destination_airport_code,
      cabin_class,
      trip_type,
      currency_code,
      locale,
      is_active
    FROM tracked_destinations
    ORDER BY origin_airport_code, destination_airport_code, id
  `);

  console.log(`[tracked-destinations-sync] synced rows: ${trackedRows.length}`);
  console.log(`[tracked-destinations-sync] after count: ${afterResult.rows.length}`);

  for (const row of afterResult.rows) {
    console.log(
      `- ${String(row.id)}: ${String(row.origin_airport_code)} -> ${String(row.destination_airport_code)} (${String(row.cabin_class)})`
    );
  }

  await client.close();
}

void main().catch((error) => {
  console.error("[tracked-destinations-sync] failed", error);
  process.exitCode = 1;
});