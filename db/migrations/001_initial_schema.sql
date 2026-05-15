-- 001_initial_schema.sql
-- Edge DB schema for Flight Price Radar

CREATE TABLE IF NOT EXISTS tracked_destinations (
  id TEXT PRIMARY KEY,
  origin_airport_code TEXT NOT NULL,
  destination_airport_code TEXT NOT NULL,
  destination_city TEXT,
  destination_country TEXT,
  trip_type TEXT NOT NULL CHECK (trip_type IN ('round_trip', 'one_way')),
  cabin_class TEXT NOT NULL CHECK (cabin_class IN ('economy', 'premium_economy', 'business', 'first')),
  departure_date_from TEXT,
  departure_date_to TEXT,
  return_date_from TEXT,
  return_date_to TEXT,
  max_stops INTEGER,
  currency_code TEXT NOT NULL DEFAULT 'GBP',
  locale TEXT NOT NULL DEFAULT 'en-GB',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_destinations_route_unique
  ON tracked_destinations (
    origin_airport_code,
    destination_airport_code,
    trip_type,
    cabin_class,
    departure_date_from,
    departure_date_to,
    return_date_from,
    return_date_to
  );

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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (tracked_destination_id) REFERENCES tracked_destinations(id)
);

CREATE INDEX IF NOT EXISTS idx_fare_observations_destination_price
  ON fare_observations (tracked_destination_id, price_amount_minor, observed_at);

CREATE INDEX IF NOT EXISTS idx_fare_observations_fingerprint
  ON fare_observations (flight_fingerprint);

CREATE TABLE IF NOT EXISTS fare_alerts (
  id TEXT PRIMARY KEY,
  fare_observation_id TEXT NOT NULL,
  tracked_destination_id TEXT NOT NULL,
  alert_fingerprint TEXT NOT NULL,
  discord_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (fare_observation_id) REFERENCES fare_observations(id),
  FOREIGN KEY (tracked_destination_id) REFERENCES tracked_destinations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fare_alerts_alert_fingerprint
  ON fare_alerts (alert_fingerprint);

CREATE TABLE IF NOT EXISTS business_deals (
  id TEXT PRIMARY KEY,
  source_feed TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_summary TEXT,
  source_link TEXT NOT NULL,
  source_link_hash TEXT NOT NULL,
  published_at TEXT,
  llm_model TEXT,
  llm_confidence REAL,
  parsed_origin TEXT,
  parsed_destination TEXT,
  parsed_price_text TEXT,
  parsed_price_amount_minor INTEGER,
  parsed_currency_code TEXT,
  parsed_cabin_class TEXT,
  parsed_is_long_haul INTEGER,
  parsed_is_error_fare INTEGER,
  parsed_json TEXT,
  qualifies_for_alert INTEGER NOT NULL DEFAULT 0,
  alert_sent_at TEXT,
  discord_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_deals_source_link_hash
  ON business_deals (source_link_hash);

CREATE INDEX IF NOT EXISTS idx_business_deals_alert_lookup
  ON business_deals (qualifies_for_alert, alert_sent_at, parsed_price_amount_minor);
