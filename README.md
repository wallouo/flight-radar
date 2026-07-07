# flight-price-radar

<div align="center">

[![English](https://img.shields.io/badge/README-English-blue?style=flat-square)](#english)
[![繁體中文](https://img.shields.io/badge/README-繁體中文-red?style=flat-square)](#繁體中文)
[![简体中文](https://img.shields.io/badge/README-简体中文-green?style=flat-square)](#简体中文)

</div>

---

<a name="english"></a>

# flight-price-radar — English

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
- ScraperAPI key (see [ScraperAPI usage guidance](#scraperapi-usage) below)
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
- `SERPAPI_API_KEY` — primary SerpApi key; or use `SERPAPI_API_KEYS` for a comma-separated pool
- `SCRAPERAPI_KEY` — primary ScraperAPI key; or use `SCRAPERAPI_API_KEYS` for a comma-separated pool
- `RSS_FEED_URLS`
- `DISCORD_WEBHOOK_URL`

### Optional environment variables

- `TURSO_URL` and `TURSO_AUTH_TOKEN`
  - If present, they override `DATABASE_URL` and `DATABASE_AUTH_TOKEN`
- `SERPAPI_API_KEYS`
  - Comma-separated list of SerpApi keys used in rotation (see [SerpApi usage guidance](#serpapi-usage-and-api-key-pool)).
  - Example: `SERPAPI_API_KEYS=key_a,key_b,key_c`
  - When provided, takes precedence over `SERPAPI_API_KEY`. Rotates automatically on HTTP 429 / monthly limit.
- `SCRAPERAPI_API_KEYS`
  - Comma-separated list of ScraperAPI keys used in rotation.
  - Example: `SCRAPERAPI_API_KEYS=key_a,key_b`
  - When provided, takes precedence over `SCRAPERAPI_KEY`. Rotates automatically on HTTP 403.
- `OPENAI_API_KEY`
- `OPENAI_MODEL` default: `gpt-4o-mini`
- `GROQ_API_KEY`
- `BUSINESS_DEAL_THRESHOLD_GBP` default: `1000`
- `BUSINESS_DEAL_MIN_CONFIDENCE` default: `0.8`
- `NORMAL_FARES_CRON` default: `0 2 * * *` (daily at 02:00 UTC)
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

Each tracked route consumes approximately **3 SerpApi calls per scan** (one per rolling departure-date window). With the default cron of once per day, a single route generates roughly **~90 calls/month**.

SerpApi's free tier provides **250 searches/month per key**.

| Tracked routes | Calls/month (est.) | Recommended keys |
|---|---|---|
| 1–2 | ~90–180 | 1 |
| 3–5 | ~270–450 | 1–2 |
| 6–10 | ~540–900 | 2–4 |

> **Tip:** Register 2–3 free SerpApi accounts and add all keys to `SERPAPI_API_KEYS`. The key pool rotates automatically when a key hits its rate limit (HTTP 429).

### `deep_search` requirement

The SerpApi Google Flights integration requires `deep_search=true` to be sent with every request. Without this parameter, Google Flights consistently returns an empty result set (`flights_results_state: "Fully empty"`) for many valid routes, even when flights exist. This is set automatically by the service and requires no manual configuration.

### London metro-code expansion

Google Flights does not reliably resolve the `LON` metro code via the API. The service automatically expands `LON` to `LHR,LGW,STN,LTN,LCY` in the `departure_id` parameter so all London airports are searched. The `originAirportCode` field in the database remains `LON` (3 chars). The same expansion logic is applied to other major metro codes (`NYC`, `PAR`, `TYO`, etc.).

## ScraperAPI Usage

This service uses [ScraperAPI](https://www.scraperapi.com/) to fetch RSS/Atom feed content reliably behind anti-bot protections.

- `SCRAPERAPI_KEY` sets a single key.
- `SCRAPERAPI_API_KEYS` sets a comma-separated pool; takes precedence over `SCRAPERAPI_KEY` and rotates automatically on HTTP 403.
- ScraperAPI's free tier provides **1,000 API credits/month**.

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

## Available Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist` |
| `npm run typecheck` | Run TypeScript checks without emitting files |
| `npm test` | Run tests against compiled output |
| `npm run init:database` | Initialize database schema from compiled script |
| `npm run seed:tracked-destinations` | Seed initial tracked destinations into the database |
| `npm run sync:tracked-destinations` | Sync tracked destinations |
| `npm run bootstrap:fare-history` | Backfill fare observations using SerpApi |
| `npm start` | Start the scheduler and application runtime |

## Running Locally

Recommended setup flow:

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in your environment variables
cp .env.example .env

# 3. Compile TypeScript
npm run build

# 4. Initialise the database schema (run once)
npm run init:database

# 5. Seed tracked destinations (run once — required before the normal-fares job)
npm run seed:tracked-destinations

# 6. Start the application
npm start
```

The application starts the runtime, optionally runs startup jobs (`RUN_NORMAL_FARES_ON_STARTUP`, `RUN_BUSINESS_DEALS_ON_STARTUP`), and continues running the scheduler.

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

**Problem:** A single SerpApi free-tier key (250 searches/month) is insufficient for users tracking multiple routes.

**Fix:** Added support for `SERPAPI_API_KEYS` — a comma-separated list of SerpApi keys. The key-pool client rotates to the next available key automatically when a key returns HTTP 429. See [SerpApi usage guidance](#serpapi-usage-and-api-key-pool) for quota estimates.

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

---

<a name="繁體中文"></a>

# flight-price-radar — 繁體中文

一個以 TypeScript 撰寫的服務，用於監控機票價格及精選旅遊優惠，結合 LLM 進行資料擷取，並透過 Discord 自動發送通知。

## 功能特色

- **一般票價追蹤**：透過 SerpApi / Google Flights 監控指定航線的票價動態。
- **歷史基準比對**：將票價觀測資料儲存至 Turso / libSQL 資料庫，建立歷史基準線。
- **智慧票價提醒**：僅當新發現的票價進入該航線歷史前三低時，才發送 Discord 通知。
- **RSS/Atom 訂閱解析**：持續監控旅遊優惠訂閱來源（如 Secret Flying、Premium Deals）。
- **AI 資料擷取**：使用 GPT-4o-mini 從訂閱內容中精準擷取結構化優惠資訊（出發地、目的地、價格、艙等）。
- **商務艙優惠通知**：當商務艙票價符合設定的價格門檻與 AI 信心分數時，自動透過 Discord Webhook 發送通知。
- **實用工具腳本**：內建資料庫初始化、航線資料植入、同步及票價歷史回填等腳本。

<img width="1426" height="633" alt="image" src="https://github.com/user-attachments/assets/ffbc5165-45d3-4d6b-b548-44ac665b74d1" />
<img width="1438" height="633" alt="image" src="https://github.com/user-attachments/assets/ca5c5bf4-dcfa-4e75-aaf6-5eaeaf2f8e67" />

## 技術堆疊

- **執行環境與語言**：Node.js 20+、TypeScript
- **資料庫**：Turso / libSQL
- **資料來源**：SerpApi（Google Flights）、RSS/Atom 訂閱
- **AI 整合**：OpenAI 相容的對話補全 API（如 gpt-4o-mini）
- **通知**：Discord Webhooks
- **CI/CD**：GitHub Actions

## 前置需求

- Node.js 20+
- npm
- Turso / libSQL 資料庫
- SerpApi API 金鑰（請參閱下方 [SerpApi 用量說明](#serpapi-用量與-api-金鑰池繁)）
- ScraperAPI 金鑰（請參閱下方 [ScraperAPI 說明](#scraperapi-說明繁)）
- Discord Webhook URL
- 有效的 RSS 訂閱網址
- OpenAI API 金鑰（或相容服務）以啟用商務艙優惠的 LLM 擷取功能

## 安裝

```bash
npm install
```

## 設定

複製範例環境設定檔並填入您的設定值：

```bash
cp .env.example .env
```

### 必要環境變數

- `DATABASE_URL`
- `DATABASE_AUTH_TOKEN`
- `SERPAPI_API_KEY` — 主要 SerpApi 金鑰；或使用 `SERPAPI_API_KEYS` 設定逗號分隔的金鑰池
- `SCRAPERAPI_KEY` — 主要 ScraperAPI 金鑰；或使用 `SCRAPERAPI_API_KEYS` 設定逗號分隔的金鑰池
- `RSS_FEED_URLS`
- `DISCORD_WEBHOOK_URL`

### 選用環境變數

- `TURSO_URL` 與 `TURSO_AUTH_TOKEN`
  - 若存在，將覆蓋 `DATABASE_URL` 與 `DATABASE_AUTH_TOKEN`
- `SERPAPI_API_KEYS`
  - 以逗號分隔的 SerpApi 金鑰清單，用於輪替使用（請參閱 [SerpApi 用量說明](#serpapi-用量與-api-金鑰池繁)）
  - 範例：`SERPAPI_API_KEYS=key_a,key_b,key_c`
  - 若已設定，優先於 `SERPAPI_API_KEY`，於 HTTP 429 時自動切換
- `SCRAPERAPI_API_KEYS`
  - 以逗號分隔的 ScraperAPI 金鑰清單，用於輪替使用
  - 範例：`SCRAPERAPI_API_KEYS=key_a,key_b`
  - 若已設定，優先於 `SCRAPERAPI_KEY`，於 HTTP 403 時自動切換
- `OPENAI_API_KEY`
- `OPENAI_MODEL` 預設：`gpt-4o-mini`
- `GROQ_API_KEY`
- `BUSINESS_DEAL_THRESHOLD_GBP` 預設：`1000`
- `BUSINESS_DEAL_MIN_CONFIDENCE` 預設：`0.8`
- `NORMAL_FARES_CRON` 預設：`0 2 * * *`（每天 UTC 02:00 執行）
- `BUSINESS_DEALS_CRON` 預設：`0 */2 * * *`
- `RUN_NORMAL_FARES_ON_STARTUP` 預設：`true`
- `RUN_BUSINESS_DEALS_ON_STARTUP` 預設：`true`
- `SCHEDULER_LEASE_DURATION_MS` 預設：`1800000`

### `RSS_FEED_URLS` 格式

支援以逗號分隔的兩種格式：

- `https://example.com/feed.xml`
- `訂閱名稱|https://example.com/feed.xml`

範例：

```env
RSS_FEED_URLS=SecretFlying|https://example.com/feed.xml,PremiumDeals|https://example.com/another-feed.xml
```

## SerpApi 用量與 API 金鑰池（繁）

本服務使用 [SerpApi Google Flights API](https://serpapi.com/google-flights-api) 取得票價資料。

### 用量估算

每條追蹤航線每次掃描約消耗 **3 次 SerpApi 呼叫**（每個滾動出發日期視窗各一次）。以預設每天執行一次的排程計算，單條航線每月約產生 **~90 次呼叫**。

SerpApi 免費方案每個金鑰每月提供 **250 次搜尋**。

| 追蹤航線數 | 每月呼叫次數（估算） | 建議金鑰數量 |
|---|---|---|
| 1–2 條 | ~90–180 | 1 組 |
| 3–5 條 | ~270–450 | 1–2 組 |
| 6–10 條 | ~540–900 | 2–4 組 |

> **建議**：申請 2–3 個 SerpApi 免費帳號，將所有金鑰填入 `SERPAPI_API_KEYS`。當某組金鑰達到用量上限（HTTP 429）時，金鑰池會自動切換至下一組。

### `deep_search` 參數說明

SerpApi Google Flights 整合需要在每次請求中附帶 `deep_search=true`。若缺少此參數，Google Flights 即使在航班存在的情況下，仍會對許多航線回傳空結果（`flights_results_state: "Fully empty"`）。此參數由服務自動設定，無需手動調整。

### 倫敦大都會代碼展開

Google Flights API 無法可靠地解析 `LON` 等大都會代碼。本服務會自動將 `LON` 展開為 `LHR,LGW,STN,LTN,LCY`，填入 `departure_id` 參數，確保搜尋涵蓋所有倫敦機場。資料庫中的 `originAirportCode` 欄位仍保留 3 碼格式（如 `LON`），展開邏輯僅作用於 HTTP 請求層。同樣的展開邏輯也適用於其他主要大都會代碼（`NYC`、`PAR`、`TYO` 等）。

## ScraperAPI 說明（繁）

本服務使用 [ScraperAPI](https://www.scraperapi.com/) 在繞過反爬機制的情況下，可靠地取得 RSS/Atom 訂閱內容。

- `SCRAPERAPI_KEY` 設定單一金鑰。
- `SCRAPERAPI_API_KEYS` 設定逗號分隔的金鑰池；優先於 `SCRAPERAPI_KEY`，於 HTTP 403 時自動輪替。
- ScraperAPI 免費方案每月提供 **1,000 個 API 點數**。

## 資料庫設定

依序套用 SQL 遷移腳本：

1. `db/migrations/001_initial_schema.sql`
2. `db/migrations/002_add_job_scheduler_state.sql`

資料庫結構包含以下資料表：

- `tracked_destinations`
- `fare_observations`
- `fare_alerts`
- `business_deals`
- `job_scheduler_state`

## 可用指令

| 指令 | 說明 |
|---|---|
| `npm run build` | 將 TypeScript 編譯至 `dist` |
| `npm run typecheck` | 執行 TypeScript 型別檢查（不輸出檔案）|
| `npm test` | 對編譯後的輸出執行測試 |
| `npm run init:database` | 從編譯腳本初始化資料庫結構描述 |
| `npm run seed:tracked-destinations` | 植入初始追蹤航線資料至資料庫 |
| `npm run sync:tracked-destinations` | 同步追蹤航線資料 |
| `npm run bootstrap:fare-history` | 使用 SerpApi 回填票價歷史記錄 |
| `npm start` | 啟動排程器與應用程式執行環境 |

## 本機執行

建議流程：

```bash
# 1. 安裝相依套件
npm install

# 2. 複製並填寫環境變數
cp .env.example .env

# 3. 編譯 TypeScript
npm run build

# 4. 初始化資料庫結構（僅需執行一次）
npm run init:database

# 5. 植入追蹤航線資料（僅需執行一次，一般票價任務執行前必要步驟）
npm run seed:tracked-destinations

# 6. 啟動應用程式
npm start
```

應用程式啟動後，會視設定執行啟動任務（`RUN_NORMAL_FARES_ON_STARTUP`、`RUN_BUSINESS_DEALS_ON_STARTUP`），並持續運行排程器。

## 運作原理

### 一般票價
1. 從資料庫讀取作用中的追蹤航線。
2. 使用**日期滾動**邏輯計算掃描視窗：服務以今日為基準，計算接下來 `N` 個出發日期視窗，避免掃描已過期的日期。
3. 透過 SerpApi Google Flights 查詢各航線及日期視窗的票價。
4. 正規化並儲存票價觀測資料。
5. 將新票價與歷史觀測資料進行排名比對。
6. 當新票價進入該航線歷史前三低時，發送 Discord 通知。
7. 透過 `fare_alerts` 資料表進行重複通知過濾。

### 商務艙優惠
1. 持續讀取設定的 RSS / Atom 訂閱。
2. 使用 LLM 從每則項目中擷取結構化優惠資訊。
3. 儲存解析後的商務艙優惠記錄。
4. 套用基於門檻的商務艙通知規則（價格上限與 LLM 信心分數門檻）。
5. 對符合條件的優惠發送格式化的 Discord Webhook 通知。

## 疑難排解

### 找到航班但未收到 Discord 通知

這是正常行為。當所有觀測票價均高於或等於該航線的歷史中位數時，通知不會觸發。提醒僅在新票價進入**歷史前三低**時才會發出。旅遊旺季（如 7–8 月）票價普遍偏高，因此鮮少觸發通知門檻。

### Google Flights 回傳零筆結果（`Fully empty`）

- 確認已設定 `deep_search=true`（2026-07-07 更新後已自動處理）。
- 若以大都會代碼作為出發地（如 `LON`、`NYC`），服務會自動展開至各機場代碼。
- 確認 `outbound_date` 相對於今日 UTC 時間為未來日期。

### Discord Webhook 回傳 `{"embeds": ["0"]}` (HTTP 400)

此錯誤通常由無效的日期格式引起。

- **原因**：Discord Embed 的 `timestamp` 欄位嚴格要求 **ISO 8601 格式**（如 `2026-05-14T15:57:51.372Z`）。部分 RSS 訂閱使用 RFC 2822 格式（如 `Wed, 14 May 2026 15:57:51 GMT`）。
- **解決方式**：確保 `item.publishedAt` 已安全解析為有效的 Date 物件，並使用 `.toISOString()` 格式化後再指派給 `embed.timestamp`。無效日期應明確設為 `undefined`，而非直接傳遞給 Discord。（此問題已在 `src/notifications/business-deal-embed.ts` 中修復。）

## 專案結構

- `src/main.ts` — 執行環境進入點
- `src/index.ts` — 匯出的公開進入點
- `src/jobs` — 排程任務協調
- `src/clients` — SerpApi、RSS、Discord 及 LLM API 整合
- `src/db` — 資料倉儲與資料庫存取層
- `src/logic` — 正規化與業務邏輯
- `src/scripts` — 設定與回填用輔助腳本
- `db/migrations` — SQL 遷移腳本

## 備注

- `OPENAI_API_KEY` 在環境設定結構中為選用，但商務艙優惠擷取功能在實際使用時需要有效的 API 金鑰。
- `bootstrap-fare-history` 包含硬式編碼的季節性取樣設定及初始航線 ID，專為回填工作流程設計。
- 測試是對已編譯的檔案執行，因此在執行 `npm test` 前請先執行 `npm run build`。

---

<a name="简体中文"></a>

# flight-price-radar — 简体中文

一个基于 TypeScript 的服务，用于监控机票价格及精选特惠信息，结合 LLM 进行数据提取，并通过 Discord 自动推送通知。

## 功能特性

- **普通票价追踪**：通过 SerpApi / Google Flights 监控配置航线的票价动态。
- **历史基准对比**：将票价观测数据存储至 Turso / libSQL 数据库，建立历史基准线。
- **智能票价提醒**：仅当新发现的票价进入该航线历史前三低时，才发送 Discord 通知。
- **RSS/Atom 订阅解析**：持续监控旅游特惠订阅源（如 Secret Flying、Premium Deals）。
- **AI 数据提取**：使用 GPT-4o-mini 从订阅内容中精准提取结构化优惠信息（出发地、目的地、价格、舱位等级）。
- **商务舱特惠通知**：当商务舱票价符合设定的价格阈值与 AI 置信度时，自动通过 Discord Webhook 推送通知。
- **实用工具脚本**：内置数据库初始化、航线数据填充、同步及票价历史回填等脚本。

<img width="1426" height="633" alt="image" src="https://github.com/user-attachments/assets/ffbc5165-45d3-4d6b-b548-44ac665b74d1" />
<img width="1438" height="633" alt="image" src="https://github.com/user-attachments/assets/ca5c5bf4-dcfa-4e75-aaf6-5eaeaf2f8e67" />

## 技术栈

- **运行环境与语言**：Node.js 20+、TypeScript
- **数据库**：Turso / libSQL
- **数据来源**：SerpApi（Google Flights）、RSS/Atom 订阅
- **AI 集成**：OpenAI 兼容的对话补全 API（如 gpt-4o-mini）
- **通知**：Discord Webhooks
- **CI/CD**：GitHub Actions

## 前置要求

- Node.js 20+
- npm
- Turso / libSQL 数据库
- SerpApi API 密钥（请参阅下方 [SerpApi 用量说明](#serpapi-用量与-api-密钥池简)）
- ScraperAPI 密钥（请参阅下方 [ScraperAPI 说明](#scraperapi-说明简)）
- Discord Webhook URL
- 有效的 RSS 订阅地址
- OpenAI API 密钥（或兼容服务）以启用商务舱特惠的 LLM 提取功能

## 安装

```bash
npm install
```

## 配置

复制示例环境配置文件并填入您的配置值：

```bash
cp .env.example .env
```

### 必填环境变量

- `DATABASE_URL`
- `DATABASE_AUTH_TOKEN`
- `SERPAPI_API_KEY` — 主 SerpApi 密钥；或使用 `SERPAPI_API_KEYS` 配置逗号分隔的密钥池
- `SCRAPERAPI_KEY` — 主 ScraperAPI 密钥；或使用 `SCRAPERAPI_API_KEYS` 配置逗号分隔的密钥池
- `RSS_FEED_URLS`
- `DISCORD_WEBHOOK_URL`

### 可选环境变量

- `TURSO_URL` 与 `TURSO_AUTH_TOKEN`
  - 若存在，将覆盖 `DATABASE_URL` 与 `DATABASE_AUTH_TOKEN`
- `SERPAPI_API_KEYS`
  - 以逗号分隔的 SerpApi 密钥列表，用于轮换使用（请参阅 [SerpApi 用量说明](#serpapi-用量与-api-密钥池简)）
  - 示例：`SERPAPI_API_KEYS=key_a,key_b,key_c`
  - 若已配置，优先于 `SERPAPI_API_KEY`，于 HTTP 429 时自动切换
- `SCRAPERAPI_API_KEYS`
  - 以逗号分隔的 ScraperAPI 密钥列表，用于轮换使用
  - 示例：`SCRAPERAPI_API_KEYS=key_a,key_b`
  - 若已配置，优先于 `SCRAPERAPI_KEY`，于 HTTP 403 时自动切换
- `OPENAI_API_KEY`
- `OPENAI_MODEL` 默认：`gpt-4o-mini`
- `GROQ_API_KEY`
- `BUSINESS_DEAL_THRESHOLD_GBP` 默认：`1000`
- `BUSINESS_DEAL_MIN_CONFIDENCE` 默认：`0.8`
- `NORMAL_FARES_CRON` 默认：`0 2 * * *`（每天 UTC 02:00 执行）
- `BUSINESS_DEALS_CRON` 默认：`0 */2 * * *`
- `RUN_NORMAL_FARES_ON_STARTUP` 默认：`true`
- `RUN_BUSINESS_DEALS_ON_STARTUP` 默认：`true`
- `SCHEDULER_LEASE_DURATION_MS` 默认：`1800000`

### `RSS_FEED_URLS` 格式

支持以逗号分隔的两种格式：

- `https://example.com/feed.xml`
- `订阅名称|https://example.com/feed.xml`

示例：

```env
RSS_FEED_URLS=SecretFlying|https://example.com/feed.xml,PremiumDeals|https://example.com/another-feed.xml
```

## SerpApi 用量与 API 密钥池（简）

本服务使用 [SerpApi Google Flights API](https://serpapi.com/google-flights-api) 获取票价数据。

### 用量估算

每条追踪航线每次扫描约消耗 **3 次 SerpApi 调用**（每个滚动出发日期窗口各一次）。以默认每天执行一次的定时任务计算，单条航线每月约产生 **~90 次调用**。

SerpApi 免费套餐每个密钥每月提供 **250 次搜索**。

| 追踪航线数 | 每月调用次数（估算） | 建议密钥数量 |
|---|---|---|
| 1–2 条 | ~90–180 | 1 组 |
| 3–5 条 | ~270–450 | 1–2 组 |
| 6–10 条 | ~540–900 | 2–4 组 |

> **建议**：注册 2–3 个 SerpApi 免费账号，将所有密钥填入 `SERPAPI_API_KEYS`。当某组密钥达到用量上限（HTTP 429）时，密钥池会自动切换至下一组。

### `deep_search` 参数说明

SerpApi Google Flights 集成需要在每次请求中携带 `deep_search=true`。若缺少此参数，Google Flights 即使在航班存在的情况下，仍会对许多航线返回空结果（`flights_results_state: "Fully empty"`）。此参数由服务自动设置，无需手动配置。

### 伦敦大都市代码展开

Google Flights API 无法可靠地解析 `LON` 等大都市代码。本服务会自动将 `LON` 展开为 `LHR,LGW,STN,LTN,LCY`，填入 `departure_id` 参数，确保搜索覆盖所有伦敦机场。数据库中的 `originAirportCode` 字段仍保留 3 位代码格式（如 `LON`），展开逻辑仅作用于 HTTP 请求层。同样的展开逻辑也适用于其他主要大都市代码（`NYC`、`PAR`、`TYO` 等）。

## ScraperAPI 说明（简）

本服务使用 [ScraperAPI](https://www.scraperapi.com/) 在绕过反爬机制的情况下，可靠地获取 RSS/Atom 订阅内容。

- `SCRAPERAPI_KEY` 配置单一密钥。
- `SCRAPERAPI_API_KEYS` 配置逗号分隔的密钥池；优先于 `SCRAPERAPI_KEY`，于 HTTP 403 时自动轮换。
- ScraperAPI 免费套餐每月提供 **1,000 个 API 额度**。

## 数据库初始化

按顺序执行 SQL 迁移脚本：

1. `db/migrations/001_initial_schema.sql`
2. `db/migrations/002_add_job_scheduler_state.sql`

数据库结构包含以下数据表：

- `tracked_destinations`
- `fare_observations`
- `fare_alerts`
- `business_deals`
- `job_scheduler_state`

## 可用命令

| 命令 | 说明 |
|---|---|
| `npm run build` | 将 TypeScript 编译至 `dist` |
| `npm run typecheck` | 执行 TypeScript 类型检查（不输出文件）|
| `npm test` | 对编译后的输出执行测试 |
| `npm run init:database` | 从编译脚本初始化数据库结构 |
| `npm run seed:tracked-destinations` | 向数据库填充初始追踪航线数据 |
| `npm run sync:tracked-destinations` | 同步追踪航线数据 |
| `npm run bootstrap:fare-history` | 使用 SerpApi 回填票价历史记录 |
| `npm start` | 启动调度器与应用运行环境 |

## 本地运行

推荐流程：

```bash
# 1. 安装依赖
npm install

# 2. 复制并填写环境变量
cp .env.example .env

# 3. 编译 TypeScript
npm run build

# 4. 初始化数据库结构（仅需执行一次）
npm run init:database

# 5. 填充追踪航线数据（仅需执行一次，运行普通票价任务前的必要步骤）
npm run seed:tracked-destinations

# 6. 启动应用
npm start
```

应用启动后，将按配置执行启动任务（`RUN_NORMAL_FARES_ON_STARTUP`、`RUN_BUSINESS_DEALS_ON_STARTUP`），并持续运行调度器。

## 工作原理

### 普通票价
1. 从数据库读取激活的追踪航线。
2. 使用**日期滚动**逻辑计算扫描窗口：服务以今日为基准，计算接下来 `N` 个出发日期窗口，避免扫描已过期的日期。
3. 通过 SerpApi Google Flights 查询各航线及日期窗口的票价。
4. 规范化并存储票价观测数据。
5. 将新票价与历史观测数据进行排名对比。
6. 当新票价进入该航线历史前三低时，发送 Discord 通知。
7. 通过 `fare_alerts` 数据表进行重复通知过滤。

### 商务舱特惠
1. 持续读取配置的 RSS / Atom 订阅源。
2. 使用 LLM 从每条条目中提取结构化优惠信息。
3. 存储解析后的商务舱特惠记录。
4. 应用基于阈值的商务舱通知规则（价格上限与 LLM 置信度阈值）。
5. 对符合条件的特惠发送格式化的 Discord Webhook 通知。

## 常见问题

### 找到航班但未收到 Discord 通知

这是正常行为。当所有观测票价均高于或等于该航线的历史中位数时，通知不会触发。提醒仅在新票价进入**历史前三低**时才会发出。旅游旺季（如 7–8 月）票价普遍偏高，因此较少触发通知阈值。

### Google Flights 返回零条结果（`Fully empty`）

- 确认已设置 `deep_search=true`（2026-07-07 更新后已自动处理）。
- 若以大都市代码作为出发地（如 `LON`、`NYC`），服务会自动展开至各机场代码。
- 确认 `outbound_date` 相对于今日 UTC 时间为未来日期。

### Discord Webhook 返回 `{"embeds": ["0"]}` (HTTP 400)

此错误通常由无效的日期格式引起。

- **原因**：Discord Embed 的 `timestamp` 字段严格要求 **ISO 8601 格式**（如 `2026-05-14T15:57:51.372Z`）。部分 RSS 订阅使用 RFC 2822 格式（如 `Wed, 14 May 2026 15:57:51 GMT`）。
- **解决方案**：确保 `item.publishedAt` 已安全解析为有效的 Date 对象，并使用 `.toISOString()` 格式化后再赋值给 `embed.timestamp`。无效日期应明确设为 `undefined`，而非直接传递给 Discord。（此问题已在 `src/notifications/business-deal-embed.ts` 中修复。）

## 项目结构

- `src/main.ts` — 运行环境入口
- `src/index.ts` — 导出的公共入口
- `src/jobs` — 定时任务协调
- `src/clients` — SerpApi、RSS、Discord 及 LLM API 集成
- `src/db` — 数据仓库与数据库访问层
- `src/logic` — 规范化与业务逻辑
- `src/scripts` — 配置与回填用辅助脚本
- `db/migrations` — SQL 迁移脚本

## 备注

- `OPENAI_API_KEY` 在环境配置中为可选项，但商务舱特惠提取功能在实际使用时需要有效的 API 密钥。
- `bootstrap-fare-history` 包含硬编码的季节性采样配置及初始航线 ID，专为回填工作流设计。
- 测试针对已编译的文件执行，因此在运行 `npm test` 前请先执行 `npm run build`。
