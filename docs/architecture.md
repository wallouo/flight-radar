# Flight Price Radar Architecture

## Purpose
Serverless, API-first flight monitoring for:
- UK -> Europe economy fares via structured flight APIs
- long-haul business class deals via RSS + LLM extraction

## Non-Negotiable Constraints
- No web scraping
- No email parsing
- No local SQLite persistence
- Edge database only
- API-first integrations only

## Recommended Stack
- Runtime: TypeScript on Node.js 20+
- Orchestration: Trigger.dev
- Validation: Zod
- Database: Turso
- Flight API: SerpApi Google Flights API
- Deal Source: RSS feeds
- LLM extraction: OpenAI `gpt-4o-mini` or Groq-compatible fast model
- Notifications: Discord webhooks

## Module Layout
- `src/config`
  - environment loading and runtime constants
- `src/schemas`
  - Zod schemas for external inputs/outputs and internal DTOs
- `src/types`
  - shared inferred TypeScript types from Zod schemas
- `src/clients`
  - API clients for SerpApi, RSS fetch, LLM extraction, Discord webhook, Turso
- `src/db`
  - SQL strings, repository helpers, migration metadata
- `src/logic`
  - ranking, deduplication, threshold evaluation, embed generation input prep
- `src/jobs`
  - Trigger.dev scheduled jobs for normal fares and business deals
- `src/utils`
  - idempotency keys, dates, currency normalization helpers
- `src/notifications`
  - Discord embed builders
- `db/migrations`
  - schema DDL for edge database setup
- `docs`
  - architecture notes, implementation plan

## Primary Data Interfaces

### `tracked_destinations`
Represents a durable search definition for normal fare polling.
- `id`
- `originAirportCode`
- `destinationAirportCode`
- `tripType`
- `cabinClass`
- optional date windows
- optional `maxStops`
- `currencyCode`
- `locale`
- `isActive`

### `normalizedFareObservation`
Immutable normalized fare snapshot persisted before alert evaluation.
- `trackedDestinationId`
- `observedAt`
- `provider`
- `providerQueryKey`
- route fields
- travel dates
- `priceAmountMinor`
- `currencyCode`
- optional `deepLink`
- `flightFingerprint`
- `rawPayloadJson`

### `businessDealExtraction`
LLM-forced JSON extracted from RSS text.
- `origin`
- `destination`
- `priceText`
- optional `priceAmount`
- optional `currencyCode`
- `cabinClass`
- `isLongHaul`
- optional `isErrorFare`
- `confidence`

### Repository contracts
- `FlightPriceRepository`
  - `listActiveTrackedDestinations()`
  - `insertFareObservation()` -> inserted observation id
  - `listLowestHistoricalFares()`
  - `hasSentFareAlert()`
  - `recordFareAlert()`
- `BusinessDealRepository`
  - `hasSeenDealLink()`
  - `insertParsedDeal()`

## Data Flow

### 1. Normal fares
1. Trigger.dev cron launches normal-fares job.
2. Job loads tracked destinations from DB.
3. SerpApi client fetches structured fare snapshots per route/date pattern.
4. Application normalizes and stores fare observations.
5. Ranking logic calculates top-3 historical cheapest fares for each destination.
6. If the new fare enters the top 3 and has not already been alerted, create Discord embed and send notification.
7. Persist alert fingerprint to avoid duplicates.

### 2. Business class deals
1. Trigger.dev cron launches business-deals job.
2. RSS client fetches feeds and stores raw item metadata temporarily in memory.
3. Each item is deduplicated by canonical link hash before expensive LLM calls.
4. LLM extractor converts title/summary into forced structured JSON.
5. Validation layer rejects malformed outputs.
6. Logic confirms:
   - business class
   - long-haul
   - below configured threshold
   - not already alerted
7. Discord embed is sent and deal dedupe state is persisted.

## Database Model Summary
- `tracked_destinations`: routes/search settings to poll
- `fare_observations`: immutable structured fare snapshots from API
- `fare_alerts`: sent-alert dedupe for normal fares
- `business_deals`: parsed RSS deals with dedupe + alert state

## Edge Database Schema Notes
- `tracked_destinations` has a uniqueness index on route + cabin + trip/date shape to prevent duplicate polling definitions.
- `fare_observations` stores immutable source payload JSON for auditability and supports historical ranking via `(tracked_destination_id, price_amount_minor, observed_at)`.
- `fare_alerts` stores durable alert fingerprints so Discord retries or reruns do not duplicate messages.
- `business_deals` deduplicates by `source_link_hash` and stores both raw source metadata and parsed JSON fields for later review.

## Design Principles
- Store raw source metadata plus normalized fields for auditability.
- Make dedupe explicit and durable in DB.
- Keep LLM outputs schema-constrained and validated before use.
- Separate external client DTOs from internal domain models.
- Treat notifications as side effects after DB persistence decisions.

## Why Trigger.dev
Trigger.dev provides:
- scheduled execution
- retries
- concurrency control
- visibility into failures
- a better fit than GitHub Actions for runtime jobs

## Initial Recommendation on Routing Rules
No `routing_rules` file exists in the workspace. Based on the OMX setup and this task shape, the best execution command is:

`omx team 3`

Recommended worker roles:
1. `architect` - finalize schemas, contracts, and migration review
2. `executor` - implement clients, repositories, and job wiring
3. `verifier` - typecheck, validate interfaces, and review alert/dedupe logic

