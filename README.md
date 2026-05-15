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
- SerpApi API key
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
- `SERPAPI_API_KEY`
- `RSS_FEED_URLS`
- `DISCORD_WEBHOOK_URL`

### Optional environment variables

- `TURSO_URL` and `TURSO_AUTH_TOKEN`
  - If present, they override `DATABASE_URL` and `DATABASE_AUTH_TOKEN`
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
2. Queries SerpApi Google Flights results for those specific routes.
3. Normalizes and stores fare observations.
4. Ranks new fares against historical observations.
5. Sends a Discord alert when a new fare reaches the historical top 3 for that route.
6. Deduplicates alerts using the `fare_alerts` table.

### Business Deals
1. Continuously reads configured RSS / Atom feeds.
2. Extracts structured deal information from each item using an LLM.
3. Stores parsed business deal records.
4. Applies threshold-based business-class alert rules (price limits and LLM confidence thresholds).
5. Sends a formatted Discord webhook notification for matching deals.

## Troubleshooting

### Discord Webhook returns `{"embeds": ["0"]}` (HTTP 400)
If you encounter this error while sending Business Deals notifications, it is usually caused by invalid date formats. 
- **Cause:** Discord's Embed `timestamp` field strictly requires **ISO 8601 format** (e.g., `2026-05-14T15:57:51.372Z`). Some RSS feeds return dates in RFC 2822 format (e.g., `Wed, 14 May 2026 15:57:51 GMT`).
- **Solution:** Ensure `item.publishedAt` is safely parsed into a valid Date object and formatted using `.toISOString()` before assigning it to `embed.timestamp`. Invalid dates should be caught and explicitly set to `undefined` rather than passed to Discord. (This has been resolved in `src/notifications/business-deal-embed.ts`).

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
