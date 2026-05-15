# Implementation Plan

## Assumptions
- Runtime will be TypeScript.
- Trigger.dev is the orchestrator of record.
- Turso is the persistence layer of record.
- SerpApi is the first normal-fare provider implementation.
- RSS parsing uses XML parsing only, not HTML scraping.

## Step-by-Step Plan

### Phase 1: Project foundation
1. Initialize TypeScript project and directory layout.
2. Add strict schema definitions for environment and external payloads.
3. Create SQL migration files for all durable tables and indexes.
4. Create typed repository interfaces before concrete client code.

### Phase 2: Database initialization
1. Provision Turso database.
2. Apply migration `001_initial_schema.sql`.
3. Seed `tracked_destinations` with UK-origin search definitions.
4. Validate uniqueness and dedupe indexes.

### Phase 3: Provider clients
1. Implement SerpApi client for Google Flights structured results.
2. Implement RSS client to fetch and normalize feed entries.
3. Implement LLM extraction client with JSON-schema/Zod validated outputs.
4. Implement Discord webhook client for embeds.

### Phase 4: Processing logic
1. Build fare normalization logic into a consistent internal shape.
2. Persist fare observations with source metadata.
3. Query lowest historical fares for each tracked destination.
4. Evaluate “breaks into top 3” alert condition.
5. Compute stable normal-fare dedupe fingerprint.
6. Normalize RSS deals and short-circuit already-seen links.
7. Run LLM extraction for unseen deals.
8. Evaluate business rules:
   - long-haul
   - business class
   - threshold under configured max
   - not previously alerted

### Phase 5: Notification formatting
1. Create embed builder for normal fare alerts.
2. Create embed builder for business deal alerts.
3. Include route, price, travel window, provider link, and why-alerted reason.

### Phase 6: Orchestration
1. Create Trigger.dev scheduled job for normal fares.
2. Create Trigger.dev scheduled job for business deals.
3. Add retry policy and concurrency guards.
4. Add structured logs and failure summaries.

### Phase 7: Deployment and operations
1. Configure environment secrets in Trigger.dev.
2. Deploy worker runtime.
3. Run dry tests against a small tracked destination set.
4. Validate Discord formatting and dedupe behavior.
5. Expand destination coverage.

## Suggested Delivery Order for Coding
1. Environment schema
2. DB migration
3. Domain schemas
4. Repositories
5. SerpApi client
6. RSS + LLM pipeline
7. Alert logic
8. Discord embeds
9. Trigger.dev jobs

## Acceptance Criteria
- Database schema supports historical ranking and durable dedupe.
- Normal-fare alerts fire only when a new fare enters top 3 historical cheapest.
- Business-deal alerts require validated LLM output and threshold pass.
- Duplicate alerts are blocked by DB-backed fingerprints/link uniqueness.
- All external payloads are schema-validated.
