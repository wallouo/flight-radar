import { createClient } from "@libsql/client";
import {
  businessDealExtractionSchema,
  normalizedFareObservationSchema,
  trackedDestinationSchema
} from "../schemas/domain.js";
import type {
  BusinessDealExtraction,
  NormalizedFareObservation,
  TrackedDestination
} from "../types/domain.js";

export interface InsertFareObservationResult {
  id: string;
}

export interface RecordFareAlertArgs {
  id: string;
  fareObservationId: string;
  trackedDestinationId: string;
  alertFingerprint: string;
  discordMessageId?: string;
}

export interface InsertParsedDealArgs {
  id: string;
  sourceFeed: string;
  sourceTitle: string;
  sourceSummary?: string;
  sourceLink: string;
  sourceLinkHash: string;
  publishedAt?: string;
  llmModel?: string;
  parsed: BusinessDealExtraction;
  qualifiesForAlert: boolean;
  discordMessageId?: string;
  alertSentAt?: string;
}

export interface FlightPriceRepository {
  listActiveTrackedDestinations(): Promise<TrackedDestination[]>;
  insertFareObservation(observation: NormalizedFareObservation): Promise<InsertFareObservationResult>;
  listLowestHistoricalFares(trackedDestinationId: string, limit: number): Promise<NormalizedFareObservation[]>;
  hasSentFareAlert(alertFingerprint: string): Promise<boolean>;
  recordFareAlert(args: RecordFareAlertArgs): Promise<void>;
}

export interface SchedulerJobStateRecord {
  jobName: string;
  lastStartedAt?: string;
  lastFinishedAt?: string;
  lastSucceededAt?: string;
  lastFailedAt?: string;
  lastError?: string;
  lockOwner?: string;
  lockedUntil?: string;
  updatedAt: string;
}

export interface TryAcquireJobLeaseArgs {
  jobName: string;
  lockOwner: string;
  lockedUntil: string;
  now: string;
}

export interface CompleteJobLeaseArgs {
  jobName: string;
  lockOwner: string;
  finishedAt: string;
  succeededAt?: string;
  failedAt?: string;
  lastError?: string;
}

export interface SchedulerStateRepository {
  getJobState(jobName: string): Promise<SchedulerJobStateRecord | null>;
  tryAcquireJobLease(args: TryAcquireJobLeaseArgs): Promise<boolean>;
  completeJobLease(args: CompleteJobLeaseArgs): Promise<void>;
}

export interface BusinessDealRepository {
  deleteNonQualifyingDeals(): Promise<void>;
  hasSeenDealLink(linkHash: string): Promise<boolean>;
  insertParsedDeal(args: InsertParsedDealArgs): Promise<void>;
}

export interface TursoConnectionConfig {
  url: string;
  authToken: string;
}

export type TursoRepository = FlightPriceRepository & BusinessDealRepository & SchedulerStateRepository;

type DatabaseClient = ReturnType<typeof createClient>;

export function createTursoClient(config: TursoConnectionConfig): DatabaseClient {
  return createClient({
    url: config.url,
    authToken: config.authToken
  });
}

export function createTursoRepository(client: DatabaseClient): TursoRepository {
  return {
    async listActiveTrackedDestinations(): Promise<TrackedDestination[]> {
      const result = await client.execute({
        sql: `
          SELECT
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
            is_active
          FROM tracked_destinations
          WHERE is_active = 1
          ORDER BY origin_airport_code, destination_airport_code, id
        `,
        args: []
      });

      return result.rows.map((row) => trackedDestinationSchema.parse({
        id: asString(row.id),
        originAirportCode: asString(row.origin_airport_code),
        destinationAirportCode: asString(row.destination_airport_code),
        destinationCity: asOptionalString(row.destination_city),
        destinationCountry: asOptionalString(row.destination_country),
        tripType: asString(row.trip_type),
        cabinClass: asString(row.cabin_class),
        departureDateFrom: asOptionalString(row.departure_date_from),
        departureDateTo: asOptionalString(row.departure_date_to),
        returnDateFrom: asOptionalString(row.return_date_from),
        returnDateTo: asOptionalString(row.return_date_to),
        maxStops: asNullableInteger(row.max_stops),
        currencyCode: asString(row.currency_code),
        locale: asString(row.locale),
        isActive: asBoolean(row.is_active)
      }));
    },

    async insertFareObservation(observation: NormalizedFareObservation): Promise<InsertFareObservationResult> {
      const validatedObservation = normalizedFareObservationSchema.parse(observation);
      const id = createFareObservationId(validatedObservation);

      await client.execute({
        sql: `
          INSERT INTO fare_observations (
            id,
            tracked_destination_id,
            observed_at,
            provider,
            provider_query_key,
            origin_airport_code,
            destination_airport_code,
            depart_date,
            return_date,
            cabin_class,
            trip_type,
            price_amount_minor,
            currency_code,
            deep_link,
            flight_fingerprint,
            raw_payload_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          id,
          validatedObservation.trackedDestinationId,
          validatedObservation.observedAt,
          validatedObservation.provider,
          validatedObservation.providerQueryKey,
          validatedObservation.originAirportCode,
          validatedObservation.destinationAirportCode,
          validatedObservation.departDate ?? null,
          validatedObservation.returnDate ?? null,
          validatedObservation.cabinClass,
          validatedObservation.tripType,
          validatedObservation.priceAmountMinor,
          validatedObservation.currencyCode,
          validatedObservation.deepLink ?? null,
          validatedObservation.flightFingerprint,
          validatedObservation.rawPayloadJson
        ]
      });

      return { id };
    },

    async listLowestHistoricalFares(trackedDestinationId: string, limit: number): Promise<NormalizedFareObservation[]> {
      const safeLimit = assertPositiveInteger(limit, "limit");
      const result = await client.execute({
        sql: `
          SELECT
            tracked_destination_id,
            observed_at,
            provider,
            provider_query_key,
            origin_airport_code,
            destination_airport_code,
            depart_date,
            return_date,
            cabin_class,
            trip_type,
            price_amount_minor,
            currency_code,
            deep_link,
            flight_fingerprint,
            raw_payload_json
          FROM fare_observations
          WHERE tracked_destination_id = ?
          ORDER BY price_amount_minor ASC, observed_at ASC
          LIMIT ?
        `,
        args: [trackedDestinationId, safeLimit]
      });

      return result.rows.map((row) => normalizedFareObservationSchema.parse({
        trackedDestinationId: asString(row.tracked_destination_id),
        observedAt: asString(row.observed_at),
        provider: asString(row.provider),
        providerQueryKey: asString(row.provider_query_key),
        originAirportCode: asString(row.origin_airport_code),
        destinationAirportCode: asString(row.destination_airport_code),
        departDate: asOptionalString(row.depart_date),
        returnDate: asOptionalString(row.return_date),
        cabinClass: asString(row.cabin_class),
        tripType: asString(row.trip_type),
        priceAmountMinor: asInteger(row.price_amount_minor),
        currencyCode: asString(row.currency_code),
        deepLink: asOptionalString(row.deep_link),
        flightFingerprint: asString(row.flight_fingerprint),
        rawPayloadJson: asString(row.raw_payload_json)
      }));
    },

    async hasSentFareAlert(alertFingerprint: string): Promise<boolean> {
      const result = await client.execute({
        sql: `
          SELECT 1
          FROM fare_alerts
          WHERE alert_fingerprint = ?
          LIMIT 1
        `,
        args: [alertFingerprint]
      });

      return result.rows.length > 0;
    },

    async recordFareAlert(args: RecordFareAlertArgs): Promise<void> {
      await client.execute({
        sql: `
          INSERT INTO fare_alerts (
            id,
            fare_observation_id,
            tracked_destination_id,
            alert_fingerprint,
            discord_message_id
          ) VALUES (?, ?, ?, ?, ?)
        `,
        args: [
          args.id,
          args.fareObservationId,
          args.trackedDestinationId,
          args.alertFingerprint,
          args.discordMessageId ?? null
        ]
      });
    },

    async getJobState(jobName: string): Promise<SchedulerJobStateRecord | null> {
      const result = await client.execute({
        sql: `
          SELECT
            job_name,
            last_started_at,
            last_finished_at,
            last_succeeded_at,
            last_failed_at,
            last_error,
            lock_owner,
            locked_until,
            updated_at
          FROM job_scheduler_state
          WHERE job_name = ?
          LIMIT 1
        `,
        args: [jobName]
      });

      const row = result.rows[0];

      if (!row) {
        return null;
      }

      return {
        jobName: asString(row.job_name),
        lastStartedAt: asOptionalString(row.last_started_at),
        lastFinishedAt: asOptionalString(row.last_finished_at),
        lastSucceededAt: asOptionalString(row.last_succeeded_at),
        lastFailedAt: asOptionalString(row.last_failed_at),
        lastError: asOptionalString(row.last_error),
        lockOwner: asOptionalString(row.lock_owner),
        lockedUntil: asOptionalString(row.locked_until),
        updatedAt: asString(row.updated_at)
      };
    },

    async tryAcquireJobLease(args: TryAcquireJobLeaseArgs): Promise<boolean> {
      await client.execute({
        sql: `
          INSERT OR IGNORE INTO job_scheduler_state (
            job_name,
            updated_at
          ) VALUES (?, ?)
        `,
        args: [args.jobName, args.now]
      });

      const result = await client.execute({
        sql: `
          UPDATE job_scheduler_state
          SET
            last_started_at = ?,
            lock_owner = ?,
            locked_until = ?,
            updated_at = ?
          WHERE job_name = ?
            AND (
              locked_until IS NULL
              OR locked_until <= ?
              OR lock_owner = ?
            )
        `,
        args: [
          args.now,
          args.lockOwner,
          args.lockedUntil,
          args.now,
          args.jobName,
          args.now,
          args.lockOwner
        ]
      });

      return Number(result.rowsAffected ?? 0) > 0;
    },

    async completeJobLease(args: CompleteJobLeaseArgs): Promise<void> {
      await client.execute({
        sql: `
          UPDATE job_scheduler_state
          SET
            last_finished_at = ?,
            last_succeeded_at = COALESCE(?, last_succeeded_at),
            last_failed_at = COALESCE(?, last_failed_at),
            last_error = ?,
            lock_owner = NULL,
            locked_until = NULL,
            updated_at = ?
          WHERE job_name = ?
            AND lock_owner = ?
        `,
        args: [
          args.finishedAt,
          args.succeededAt ?? null,
          args.failedAt ?? null,
          args.lastError ?? null,
          args.finishedAt,
          args.jobName,
          args.lockOwner
        ]
      });
    },

    async deleteNonQualifyingDeals(): Promise<void> {
      await client.execute({
        sql: `
          DELETE FROM business_deals
          WHERE qualifies_for_alert = 0
        `,
        args: []
      });
    },

    async hasSeenDealLink(linkHash: string): Promise<boolean> {
      const result = await client.execute({
        sql: `
          SELECT 1
          FROM business_deals
          WHERE source_link_hash = ?
          LIMIT 1
        `,
        args: [linkHash]
      });

      return result.rows.length > 0;
    },

    async insertParsedDeal(args: InsertParsedDealArgs): Promise<void> {
      const parsed = businessDealExtractionSchema.parse(args.parsed);

      await client.execute({
        sql: `
          INSERT INTO business_deals (
            id,
            source_feed,
            source_title,
            source_summary,
            source_link,
            source_link_hash,
            published_at,
            llm_model,
            llm_confidence,
            parsed_origin,
            parsed_destination,
            parsed_price_text,
            parsed_price_amount_minor,
            parsed_currency_code,
            parsed_cabin_class,
            parsed_is_long_haul,
            parsed_is_error_fare,
            parsed_json,
            qualifies_for_alert,
            alert_sent_at,
            discord_message_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        args: [
          args.id,
          args.sourceFeed,
          args.sourceTitle,
          args.sourceSummary ?? null,
          args.sourceLink,
          args.sourceLinkHash,
          args.publishedAt ?? null,
          args.llmModel ?? null,
          parsed.confidence,
          parsed.origin,
          parsed.destination,
          parsed.priceText,
          typeof parsed.priceAmount === "number" ? Math.round(parsed.priceAmount * 100) : null,
          parsed.currencyCode ?? null,
          parsed.cabinClass,
          parsed.isLongHaul ? 1 : 0,
          typeof parsed.isErrorFare === "boolean" ? (parsed.isErrorFare ? 1 : 0) : null,
          JSON.stringify(parsed),
          args.qualifiesForAlert ? 1 : 0,
          args.alertSentAt ?? null,
          args.discordMessageId ?? null
        ]
      });
    }
  };
}

function createFareObservationId(observation: NormalizedFareObservation): string {
  return [
    observation.trackedDestinationId,
    observation.observedAt,
    observation.provider,
    observation.flightFingerprint
  ].join(":");
}

function assertPositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function asString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error(`Expected string value but received ${typeof value}`);
  }

  return value;
}

function asOptionalString(value: unknown): string | undefined {
  if (value === null || typeof value === "undefined") {
    return undefined;
  }

  return asString(value);
}

function asInteger(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  throw new Error(`Expected integer value but received ${typeof value}`);
}

function asNullableInteger(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === "undefined") {
    return undefined;
  }

  return asInteger(value);
}

function asBoolean(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "bigint") {
    return value !== 0n;
  }

  throw new Error(`Expected boolean-like value but received ${typeof value}`);
}
