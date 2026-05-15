import "dotenv/config";
import { createTursoClient } from "../db/repositories.js";
import { loadEnvironment, getTursoConnectionConfig } from "../config/env.js";

const schemaStatements: string[] = [
  `
    CREATE TABLE IF NOT EXISTS tracked_destinations (
      id TEXT PRIMARY KEY,
      origin_airport_code TEXT NOT NULL,
      destination_airport_code TEXT NOT NULL,
      destination_city TEXT,
      destination_country TEXT,
      trip_type TEXT NOT NULL,
      cabin_class TEXT NOT NULL,
      departure_date_from TEXT,
      departure_date_to TEXT,
      return_date_from TEXT,
      return_date_to TEXT,
      max_stops INTEGER,
      currency_code TEXT NOT NULL,
      locale TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_tracked_destinations_active
    ON tracked_destinations (is_active, origin_airport_code, destination_airport_code)
  `,
  `
    CREATE TABLE IF NOT EXISTS fare_observations (
      id TEXT PRIMARY KEY,
      tracked_destination_id TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_query_key TEXT NOT NULL,
      origin_airport_code TEXT NOT NULL,
      destination_airport_code TEXT NOT NULL,
      depart_date TEXT,
      return_date TEXT,
      cabin_class TEXT NOT NULL,
      trip_type TEXT NOT NULL,
      price_amount_minor INTEGER NOT NULL,
      currency_code TEXT NOT NULL,
      deep_link TEXT,
      flight_fingerprint TEXT NOT NULL,
      raw_payload_json TEXT NOT NULL,
      FOREIGN KEY (tracked_destination_id) REFERENCES tracked_destinations(id)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_fare_observations_tracked_destination_price
    ON fare_observations (tracked_destination_id, price_amount_minor, observed_at)
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_fare_observations_fingerprint
    ON fare_observations (flight_fingerprint)
  `,
  `
    CREATE TABLE IF NOT EXISTS fare_alerts (
      id TEXT PRIMARY KEY,
      fare_observation_id TEXT NOT NULL,
      tracked_destination_id TEXT NOT NULL,
      alert_fingerprint TEXT NOT NULL UNIQUE,
      discord_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (fare_observation_id) REFERENCES fare_observations(id),
      FOREIGN KEY (tracked_destination_id) REFERENCES tracked_destinations(id)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_fare_alerts_tracked_destination
    ON fare_alerts (tracked_destination_id, created_at)
  `,
  `
    CREATE TABLE IF NOT EXISTS job_scheduler_state (
      job_name TEXT PRIMARY KEY,
      last_started_at TEXT,
      last_finished_at TEXT,
      last_succeeded_at TEXT,
      last_failed_at TEXT,
      last_error TEXT,
      lock_owner TEXT,
      locked_until TEXT,
      updated_at TEXT NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_job_scheduler_state_locked_until
    ON job_scheduler_state (locked_until)
  `,
  `
    CREATE TABLE IF NOT EXISTS business_deals (
      id TEXT PRIMARY KEY,
      source_feed TEXT NOT NULL,
      source_title TEXT NOT NULL,
      source_summary TEXT,
      source_link TEXT NOT NULL,
      source_link_hash TEXT NOT NULL UNIQUE,
      published_at TEXT,
      llm_model TEXT,
      llm_confidence REAL NOT NULL,
      parsed_origin TEXT NOT NULL,
      parsed_destination TEXT NOT NULL,
      parsed_price_text TEXT NOT NULL,
      parsed_price_amount_minor INTEGER,
      parsed_currency_code TEXT,
      parsed_cabin_class TEXT NOT NULL,
      parsed_is_long_haul INTEGER NOT NULL,
      parsed_is_error_fare INTEGER,
      parsed_json TEXT NOT NULL,
      qualifies_for_alert INTEGER NOT NULL,
      alert_sent_at TEXT,
      discord_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS idx_business_deals_alerts
    ON business_deals (qualifies_for_alert, alert_sent_at, created_at)
  `
];

async function main(): Promise<void> {
  const env = loadEnvironment();
  const client = createTursoClient(getTursoConnectionConfig(env));

  for (const statement of schemaStatements) {
    await client.execute(statement);
  }

  console.log(`[init-database] schema applied: ${schemaStatements.length} statements`);

  const tables = await client.execute(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `);

  console.log(`[init-database] tables: ${tables.rows.length}`);
  for (const row of tables.rows) {
    console.log(`- ${String(row.name)}`);
  }

  await client.close();
}

void main().catch((error) => {
  console.error("[init-database] failed", error);
  process.exitCode = 1;
});