# flight-price-radar

A TypeScript service for monitoring flight prices and curated travel deal feeds, utilizing LLMs for data extraction, and sending automated Discord alerts.

## Features

- **Normal Fares Tracking**: Monitors configured flight routes using SerpApi / Google Flights results.
- **Historical Benchmarking**: Stores fare observations in a Turso / libSQL database to build a historical baseline.
- **Smart Fare Alerts**: Sends Discord alerts only when a newly found fare enters the historical top 3 for a specific tracked route.
- **RSS/Atom Feed Parsing**: Continuously monitors travel deal feeds (e.g., Secret Flying, Premium Deals).
- **AI-Powered Extraction**: Uses GPT-4o-mini to accurately extract structured deal details (origin, destination, price, cabin class) directly from feed descriptions.
- **Business-Class Deal Alerts**: Automatically sends Discord webhook notifications for business-class deals that match configured price thresholds and confidence scores.
- **Robust Tools**: Includes built-in scripts for database initialization, destination seeding, syncing, and fare history bootstrapping.

<img width="1426" height="633" alt="image" src="https://github.com/user-attachments/assets/ffbc5165-45d3-4d6b-b548-44ac665b74d1" />
<img width="1438" height="633" alt="image" src="https://github.com/user-attachments/assets/ca5c5bf4-dcfa-4e75-aaf6-5eaeaf2f8e67" />

## Tech Stack

- **Runtime & Language**: Node.js 20+, TypeScript
- **Database**: Turso / libSQL
- **Data Sources**: SerpApi (Google Flights), RSS/Atom feeds
- **AI Integration**: OpenAI-compatible chat completions API (e.g., gpt-4o-mini)
- **Notifications**: Discord Webhooks
- **CI/CD**: GitHub Actions

## Prerequisites

- Node.js 20+
- npm
- A Turso / libSQL database
- SerpApi API key (see [SerpApi usage guidance](#serpapi-usage-and-api-key-pool) below)
- Discord webhook URL
- Valid RSS feed URLs
- OpenAI API key (or compatible service) to enable business-deal LLM extraction

## Installation

```bash
npm install
```

## Configuration

Copy the example environment file and update it with your values:

```bash
cp .env.example .env
```

### Required environment variables

- `DATABASE_URL`
- `DATABASE_AUTH_TOKEN`
- `SERPAPI_API_KEY` — primary SerpApi key (see also `SERPAPI_API_KEY_POOL` below)
- `RSS_FEED_URLS`
- `DISCORD_WEBHOOK_URL`

### Optional environment variables

- `TURSO_URL` and `TURSO_AUTH_TOKEN`
  - If present, they override `DATABASE_URL` and `DATABASE_AUTH_TOKEN`
- `SERPAPI_API_KEY_POOL`
  - Comma-separated list of additional SerpApi keys to use in rotation (see [SerpApi usage guidance](#serpapi-usage-and-api-key-pool)).
  - Example: `SERPAPI_API_KEY_POOL=key_b,key_c`
  - When all keys in the pool are exhausted (HTTP 403/429), the service falls back gracefully.
- `OPENAI_API_KEY`
- `OPENAI_MODEL` default: `gpt-4o-mini`
- `GROQ_API_KEY`
- `BUSINESS_DEAL_THRESHOLD_GBP` default: `1000`
- `BUSINESS_DEAL_MIN_CONFIDENCE` default: `0.8`
- `NORMAL_FARES_CRON` default: `0 */6 * * *`
- `BUSINESS_DEALS_CRON` default: `0 */2 * * *`
- `RUN_NORMAL_FARES_ON_STARTUP` default: `true`
- `RUN_BUSINESS_DEALS_ON_STARTUP` default: `true`
- `SCHEDULER_LEASE_DURATION_MS` default: `1800000`

### `RSS_FEED_URLS` Format

Supports comma-separated entries in either form:

- `https://example.com/feed.xml`
- `FeedName|https://example.com/feed.xml`

Example:

```env
RSS_FEED_URLS=SecretFlying|https://example.com/feed.xml,PremiumDeals|https://example.com/another-feed.xml
```

## SerpApi Usage and API Key Pool

This service uses the [SerpApi Google Flights API](https://serpapi.com/google-flights-api) to retrieve fare data.

### Quota estimation

Each tracked route consumes approximately **3 SerpApi calls per scan** (one per rolling departure-date window). With the default cron of every 6 hours, a single route generates roughly **~360 calls/month**.

SerpApi's free tier provides **250 searches/month per key**.

| Tracked routes | Calls/month (est.) | Recommended keys |
|---|---|---|
| 1–2 | ~360–720 | 2 |
| 3–5 | ~1,080–1,800 | 2–3 |
| 6–10 | ~2,160–3,600 | 3+ |

> **Tip:** Register 2–3 free SerpApi accounts and add the keys to `SERPAPI_API_KEY_POOL`. The key-pool rotates automatically when a key hits its rate limit (HTTP 403/429).

### `deep_search` requirement

The SerpApi Google Flights integration requires `deep_search=true` to be sent with every request. Without this parameter, Google Flights consistently returns an empty result set (`flights_results_state: "Fully empty"`) for many valid routes, even when flights exist. This is set automatically by the service and requires no manual configuration.

### London metro-code expansion

Google Flights does not reliably resolve the `LON` metro code via the API. The service automatically expands `LON` to `LHR,LGW,STN,LTN,LCY` in the `departure_id` parameter so all London airports are searched. The `originAirportCode` field in the database remains `LON` (3 chars). The same expansion logic is applied to other major metro codes (`NYC`, `PAR`, `TYO`, etc.).

## Database Setup

Apply the SQL migrations in order:

1. `db/migrations/001_initial_schema.sql`
2. `db/migrations/002_add_job_scheduler_state.sql`

The schema includes tables for:

- `tracked_destinations`
- `fare_observations`
- `fare_alerts`
- `business_deals`
- `job_scheduler_state`

*Note: You will usually want at least one row in `tracked_destinations` before running the normal-fares job.*

## Available Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist` |
| `npm run typecheck` | Run TypeScript checks without emitting files |
| `npm test` | Run tests against compiled output |
| `npm run init:database` | Initialize database objects from compiled script |
| `npm run seed:tracked-destinations`| Seed tracked destinations |
| `npm run sync:tracked-destinations`| Sync tracked destinations |
| `npm run bootstrap:fare-history` | Backfill fare observations using SerpApi |
| `npm start` | Start the scheduler and application runtime |

## Running Locally

Recommended flow:

```bash
npm install
npm run build
npm start
```

The application starts the runtime, optionally runs startup jobs, and continues running the scheduler.

## How it works

### Normal Fares
1. Reads active tracked destinations from the database.
2. Computes a rolling scan window using the **date-rollover** logic: the service determines the next `N` departure windows starting from today, avoiding scanning dates that have already passed.
3. Queries SerpApi Google Flights results for those specific routes and date windows.
4. Normalizes and stores fare observations.
5. Ranks new fares against historical observations.
6. Sends a Discord alert when a new fare reaches the historical top 3 for that route.
7. Deduplicates alerts using the `fare_alerts` table.

### Business Deals
1. Continuously reads configured RSS / Atom feeds.
2. Extracts structured deal information from each item using an LLM.
3. Stores parsed business deal records.
4. Applies threshold-based business-class alert rules (price limits and LLM confidence thresholds).
5. Sends a formatted Discord webhook notification for matching deals.

## Changelog

### 2026-07-07 — Normal Fares date-rollover & SerpApi fixes

This update resolves several issues discovered in production that caused the normal-fares job to return zero results across all tracked routes.

#### Bug: Scan dates hardcoded to early June

**Problem:** The original departure-date logic computed a fixed set of dates anchored to an initial seed date in early June 2026. Once the current date passed those dates, all scan windows fell in the past, so the job silently skipped every route and inserted zero observations.

**Fix:** Replaced the static date range with a **rollover-based scan window** that always computes the next `N` departure dates relative to today. Each run re-anchors automatically, ensuring no valid future dates are ever skipped.

#### Bug: `deep_search=true` missing from SerpApi requests

**Problem:** The SerpApi Google Flights API requires `deep_search=true` to return results consistent with the browser. Without it, Google Flights returns `flights_results_state: "Fully empty"` for a large proportion of routes, even when flights are available. This flag had been removed in a previous refactor.

**Fix:** `deep_search=true` is now unconditionally appended to every `buildSerpApiUrl` and `buildSerpApiCalendarUrl` call.

#### Bug: `LON` metro code not resolved by Google Flights API

**Problem:** Using `departure_id=LON` (a metro code) caused Google Flights to return empty results for all 7 London-origin routes in production.

**Fix:** A `METRO_CODE_EXPANSIONS` map in `serpapi.ts` now expands known metro codes to comma-separated individual airport IATA codes at the HTTP request layer (e.g. `LON` → `LHR,LGW,STN,LTN,LCY`). The database schema and domain types are unchanged.

#### Enhancement: Multi-key SerpApi pool

**Problem:** A single SerpApi free-tier key (250 searches/month) is insufficient for users tracking multiple routes at the default 6-hour cron frequency.

**Fix:** Added support for `SERPAPI_API_KEY_POOL` — a comma-separated list of additional SerpApi keys. The key-pool client rotates to the next available key automatically when a key returns HTTP 403 or 429. See [SerpApi usage guidance](#serpapi-usage-and-api-key-pool) for quota estimates.

## Troubleshooting

### No Discord notifications despite flights being found

This is expected behaviour when all observed fares are at or above the historical median for that route. The alert fires only when a new fare ranks in the **historical top 3** for its route. During peak travel periods (e.g. July–August) fares are elevated and rarely trigger the threshold.

### Google Flights returns zero results (`Fully empty`)

- Ensure `deep_search=true` is set (handled automatically since the 2026-07-07 update).
- If using a metro code as origin (e.g. `LON`, `NYC`), the service automatically expands it to individual airports.
- Check that `outbound_date` is in the future relative to today's UTC date.

### Discord Webhook returns `{"embeds": ["0"]}` (HTTP 400)

If you encounter this error while sending Business Deals notifications, it is usually caused by invalid date formats.

- **Cause:** Discord's Embed `timestamp` field strictly requires **ISO 8601 format** (e.g., `2026-05-14T15:57:51.372Z`). Some RSS feeds return dates in RFC 2822 format (e.g., `Wed, 14 May 2026 15:57:51 GMT`).
- **Solution:** Ensure `item.publishedAt` is safely parsed into a valid Date object and formatted using `.toISOString()` before assigning it to `embed.timestamp`. Invalid dates should be caught and explicitly set to `undefined` rather than passed to Discord. (This has been resolved in `src/notifications/business-deal-embed.ts`.)

## Project Structure

- `src/main.ts` — Runtime entry point
- `src/index.ts` — Exported public entry
- `src/jobs` — Scheduled job orchestration
- `src/clients` — Integrations for SerpApi, RSS, Discord, and LLM APIs
- `src/db` — Repository and database access layer
- `src/logic` — Normalization and business logic
- `src/scripts` — Helper scripts for setup and backfills
- `db/migrations` — SQL migrations

## Notes

- `OPENAI_API_KEY` is optional in the environment schema, but business-deal extraction requires a valid API key in practice.
- `bootstrap-fare-history` contains hard-coded seasonal sampling and a start destination id intended for backfill workflows.
- Tests are run from built files, so run `npm run build` before `npm test`.
