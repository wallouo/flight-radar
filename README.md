<div align="center">

# flight-price-radar

**Monitor flight prices. Catch the best deals. Get notified instantly.**

A production-grade TypeScript service that tracks flight fares via Google Flights, parses travel deal RSS feeds with AI extraction, and fires Discord alerts when prices hit historical lows.

---

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Turso](https://img.shields.io/badge/Turso-libSQL-4FF8D2?style=for-the-badge&logo=turso&logoColor=black)](https://turso.tech/)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--4o--mini-412991?style=for-the-badge&logo=openai&logoColor=white)](https://openai.com/)
[![Discord](https://img.shields.io/badge/Discord-Webhooks-5865F2?style=for-the-badge&logo=discord&logoColor=white)](https://discord.com/)
[![GitHub Actions](https://img.shields.io/badge/CI%2FCD-GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=for-the-badge)](LICENSE)

---

[English](#english) · [繁體中文](#繁體中文) · [简体中文](#简体中文)

</div>

---

<a name="english"></a>

## English

### Overview

`flight-price-radar` is a self-hosted flight monitoring service that combines real-time fare tracking with AI-powered deal extraction. It watches configured routes via SerpApi (Google Flights), builds a historical fare baseline in a Turso/libSQL database, and sends a Discord alert only when a fare enters the **historical top 3** for that route. A separate pipeline continuously parses travel deal RSS/Atom feeds using GPT-4o-mini to surface business-class bargains.

---

### Preview

<img width="1426" alt="Normal fares Discord alert" src="https://github.com/user-attachments/assets/ffbc5165-45d3-4d6b-b548-44ac665b74d1" />
<img width="1438" alt="Business deal Discord alert" src="https://github.com/user-attachments/assets/ca5c5bf4-dcfa-4e75-aaf6-5eaeaf2f8e67" />

---

### Tech Stack

| Layer | Technology |
|---|---|
| **Language / Runtime** | TypeScript · Node.js 20+ |
| **Database** | [Turso](https://turso.tech/) / libSQL |
| **Flight Data** | [SerpApi](https://serpapi.com/google-flights-api) (Google Flights) |
| **Feed Scraping** | [ScraperAPI](https://www.scraperapi.com/) + RSS/Atom parsing |
| **AI Extraction** | OpenAI-compatible API (default: `gpt-4o-mini`) · Groq (optional) |
| **Notifications** | Discord Webhooks |
| **CI / CD** | GitHub Actions |

---

### Features

- **Normal Fares Tracking** — monitors configured routes via SerpApi / Google Flights
- **Historical Benchmarking** — stores fare observations in Turso/libSQL to build a rolling baseline
- **Smart Fare Alerts** — fires Discord notifications only when a fare reaches the historical top 3 for a route
- **RSS/Atom Feed Parsing** — continuously monitors travel deal feeds (e.g. Secret Flying, Premium Deals)
- **AI-Powered Extraction** — uses GPT-4o-mini to parse structured deal details (origin, destination, price, cabin class) from feed descriptions
- **Business-Class Deal Alerts** — sends Discord webhook notifications for business-class deals matching configured price thresholds and confidence scores
- **Robust Tooling** — built-in scripts for DB init, destination seeding, syncing, and fare history bootstrapping

---

### Prerequisites

| Requirement | Notes |
|---|---|
| Node.js 20+ | Runtime |
| npm | Package manager |
| Turso / libSQL DB | Persistent storage |
| SerpApi key | See [quota guide](#serpapi-usage--api-key-pool) |
| ScraperAPI key | See [usage notes](#scraperapi-usage) |
| Discord Webhook URL | For alerts |
| RSS feed URL(s) | e.g. Secret Flying |
| OpenAI API key | Required for business-deal LLM extraction |

---

### Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your keys

# 3. Compile TypeScript
npm run build

# 4. Initialise the database (once)
npm run init:database

# 5. Seed tracked destinations (once)
npm run seed:tracked-destinations

# 6. Start the service
npm start
```

The service starts, optionally runs startup jobs (`RUN_NORMAL_FARES_ON_STARTUP`, `RUN_BUSINESS_DEALS_ON_STARTUP`), and continues running the scheduler.

---

### Configuration

Copy and populate the environment file:

```bash
cp .env.example .env
```

#### Required Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Turso/libSQL connection URL |
| `DATABASE_AUTH_TOKEN` | Auth token for the database |
| `SERPAPI_API_KEY` | Primary SerpApi key (or use pool below) |
| `SCRAPERAPI_KEY` | Primary ScraperAPI key (or use pool below) |
| `RSS_FEED_URLS` | Comma-separated feed URLs (see format below) |
| `DISCORD_WEBHOOK_URL` | Discord channel webhook |

#### Optional Variables

| Variable | Default | Description |
|---|---|---|
| `TURSO_URL` | — | Overrides `DATABASE_URL` if set |
| `TURSO_AUTH_TOKEN` | — | Overrides `DATABASE_AUTH_TOKEN` if set |
| `SERPAPI_API_KEYS` | — | Comma-separated key pool; rotates on HTTP 429 |
| `SCRAPERAPI_API_KEYS` | — | Comma-separated key pool; rotates on HTTP 403 |
| `OPENAI_API_KEY` | — | Required for business-deal extraction |
| `OPENAI_MODEL` | `gpt-4o-mini` | OpenAI model to use |
| `GROQ_API_KEY` | — | Optional Groq alternative |
| `BUSINESS_DEAL_THRESHOLD_GBP` | `1000` | Max price (GBP) to alert on |
| `BUSINESS_DEAL_MIN_CONFIDENCE` | `0.8` | Minimum LLM confidence score |
| `NORMAL_FARES_CRON` | `0 2 * * *` | Cron for normal fares job (daily 02:00 UTC) |
| `BUSINESS_DEALS_CRON` | `0 */2 * * *` | Cron for business deals job |
| `RUN_NORMAL_FARES_ON_STARTUP` | `true` | Run normal fares job on launch |
| `RUN_BUSINESS_DEALS_ON_STARTUP` | `true` | Run business deals job on launch |
| `SCHEDULER_LEASE_DURATION_MS` | `1800000` | Lease duration for scheduler lock |

#### `RSS_FEED_URLS` Format

Supports comma-separated entries in either form:

```env
# URL only
RSS_FEED_URLS=https://example.com/feed.xml

# Named feeds (recommended)
RSS_FEED_URLS=SecretFlying|https://example.com/feed.xml,PremiumDeals|https://example.com/another.xml
```

---

### SerpApi Usage & API Key Pool

This service uses the [SerpApi Google Flights API](https://serpapi.com/google-flights-api).

#### Quota Estimation

Each tracked route consumes ~**3 SerpApi calls per scan** (one per rolling departure-date window). With the default daily cron, a single route generates ~**90 calls/month**. SerpApi's free tier provides **250 searches/month per key**.

| Tracked Routes | Calls/month (est.) | Recommended Keys |
|---|---|---|
| 1–2 | ~90–180 | 1 |
| 3–5 | ~270–450 | 1–2 |
| 6–10 | ~540–900 | 2–4 |

> **Tip:** Register 2–3 free SerpApi accounts and add all keys to `SERPAPI_API_KEYS`. The pool rotates automatically on HTTP 429.

#### `deep_search` Requirement

`deep_search=true` is **required** for reliable results. Without it, Google Flights returns `flights_results_state: "Fully empty"` for many valid routes. This flag is set automatically by the service.

#### London Metro-Code Expansion

The `LON` metro code is unreliable via the API. The service auto-expands `LON` → `LHR,LGW,STN,LTN,LCY` in `departure_id`. The same logic applies to `NYC`, `PAR`, `TYO`, and other metro codes. The `originAirportCode` field in the DB remains 3 chars (e.g. `LON`).

---

### ScraperAPI Usage

[ScraperAPI](https://www.scraperapi.com/) is used to reliably fetch RSS/Atom feeds through anti-bot protections.

- `SCRAPERAPI_KEY` — single key mode
- `SCRAPERAPI_API_KEYS` — pool mode; auto-rotates on HTTP 403; takes precedence over `SCRAPERAPI_KEY`
- Free tier: **1,000 API credits/month**

---

### Database Setup

Apply migrations in order:

```bash
# 1.
db/migrations/001_initial_schema.sql

# 2.
db/migrations/002_add_job_scheduler_state.sql
```

The schema includes these tables:

| Table | Purpose |
|---|---|
| `tracked_destinations` | Routes to monitor |
| `fare_observations` | Historical fare records |
| `fare_alerts` | Deduplication log for sent alerts |
| `business_deals` | Parsed business-class deals |
| `job_scheduler_state` | Distributed scheduler lock |

---

### Available Scripts

| Command | Description |
|---|---|
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run typecheck` | Type-check without emitting files |
| `npm test` | Run tests against compiled output |
| `npm run init:database` | Initialise database schema |
| `npm run seed:tracked-destinations` | Seed initial tracked routes |
| `npm run sync:tracked-destinations` | Sync tracked destinations |
| `npm run bootstrap:fare-history` | Backfill fare history via SerpApi |
| `npm start` | Start scheduler and runtime |

> **Note:** Tests run against compiled files — always `npm run build` before `npm test`.

---

### How It Works

#### Normal Fares Pipeline

```
DB (active routes)
  → Rolling date window computation
  → SerpApi Google Flights query
  → Normalise & store fare observations
  → Rank vs. historical data
  → Top-3 threshold check
  → Discord alert (deduplicated via fare_alerts)
```

#### Business Deals Pipeline

```
RSS/Atom feeds (via ScraperAPI)
  → LLM extraction (GPT-4o-mini)
  → Store parsed business deals
  → Price & confidence threshold check
  → Discord webhook notification
```

---

### Project Structure

```
src/
├── main.ts          # Runtime entry point
├── index.ts         # Public entry / exports
├── jobs/            # Scheduled job orchestration
├── clients/         # SerpApi, RSS, Discord, LLM integrations
├── db/              # Repository & database access layer
├── logic/           # Normalisation & business logic
└── scripts/         # Setup and backfill helper scripts
db/
└── migrations/      # SQL migration files
```

---

### Troubleshooting

<details>
<summary><strong>No Discord notifications despite flights being found</strong></summary>

This is expected behaviour. Alerts only fire when a new fare ranks in the **historical top 3** for its route. During peak travel periods (e.g. July–August) fares are elevated and rarely cross the threshold.
</details>

<details>
<summary><strong>Google Flights returns zero results (<code>Fully empty</code>)</strong></summary>

- `deep_search=true` is handled automatically since the 2026-07-07 update.
- Metro codes like `LON` and `NYC` are auto-expanded to individual airport codes.
- Confirm `outbound_date` is in the future relative to today's UTC date.
</details>

<details>
<summary><strong>Discord Webhook returns <code>{"embeds": ["0"]}</code> (HTTP 400)</strong></summary>

**Cause:** Discord's embed `timestamp` field requires strict ISO 8601 format (e.g. `2026-05-14T15:57:51.372Z`). Some RSS feeds emit RFC 2822 dates.

**Fix:** `item.publishedAt` is safely parsed and formatted via `.toISOString()` before being passed to Discord. Invalid dates are coerced to `undefined`. Resolved in `src/notifications/business-deal-embed.ts`.
</details>

---

### Changelog

<details>
<summary><strong>2026-07-07 — Normal Fares date-rollover & SerpApi fixes</strong></summary>

#### Bug: Scan dates hardcoded to early June
**Problem:** Departure-date logic was anchored to a fixed seed in early June 2026. Once those dates passed, all scan windows were historical and the job silently inserted zero observations.

**Fix:** Replaced static range with a **rollover-based scan window** always computed relative to today.

#### Bug: `deep_search=true` missing from SerpApi requests
**Problem:** This flag was removed in a prior refactor, causing Google Flights to return `"Fully empty"` for most routes.

**Fix:** `deep_search=true` is now unconditionally appended to every `buildSerpApiUrl` and `buildSerpApiCalendarUrl` call.

#### Bug: `LON` metro code not resolved
**Problem:** `departure_id=LON` returned empty results for all 7 London-origin routes.

**Fix:** `METRO_CODE_EXPANSIONS` map in `serpapi.ts` now expands metro codes to comma-separated IATA codes at the HTTP layer.

#### Enhancement: Multi-key SerpApi pool
**Problem:** A single free-tier key (250 searches/month) is insufficient for multiple routes.

**Fix:** Added `SERPAPI_API_KEYS` support with automatic rotation on HTTP 429.
</details>

---

### Notes

- `OPENAI_API_KEY` is technically optional in the env schema but **required** in practice for business-deal extraction.
- `bootstrap-fare-history` contains hard-coded seasonal sampling and a start destination ID — intended for backfill workflows only.

---

<a name="繁體中文"></a>

## 繁體中文

一個以 TypeScript 撰寫的服務，用於監控機票價格及精選旅遊優惠，結合 LLM 進行資料擷取，並透過 Discord 自動發送通知。

---

### 預覽

<img width="1426" alt="一般票價 Discord 通知" src="https://github.com/user-attachments/assets/ffbc5165-45d3-4d6b-b548-44ac665b74d1" />
<img width="1438" alt="商務艙優惠 Discord 通知" src="https://github.com/user-attachments/assets/ca5c5bf4-dcfa-4e75-aaf6-5eaeaf2f8e67" />

---

### 技術堆疊

| 層級 | 技術 |
|---|---|
| **語言 / 執行環境** | TypeScript · Node.js 20+ |
| **資料庫** | Turso / libSQL |
| **航班資料** | SerpApi（Google Flights） |
| **訂閱抓取** | ScraperAPI + RSS/Atom 解析 |
| **AI 擷取** | OpenAI 相容 API（預設：`gpt-4o-mini`）· Groq（選用） |
| **通知** | Discord Webhooks |
| **CI / CD** | GitHub Actions |

---

### 功能特色

- **一般票價追蹤** — 透過 SerpApi / Google Flights 監控指定航線的票價動態
- **歷史基準比對** — 將票價觀測資料儲存至 Turso/libSQL，建立歷史基準線
- **智慧票價提醒** — 僅當新票價進入該航線歷史前三低時，才發送 Discord 通知
- **RSS/Atom 訂閱解析** — 持續監控旅遊優惠訂閱來源（如 Secret Flying、Premium Deals）
- **AI 資料擷取** — 使用 GPT-4o-mini 從訂閱內容中精準擷取結構化優惠資訊
- **商務艙優惠通知** — 當商務艙票價符合設定的價格門檻與 AI 信心分數時，自動推送通知
- **實用工具腳本** — 內建資料庫初始化、航線資料植入、同步及票價歷史回填等腳本

---

### 快速開始

```bash
# 1. 安裝相依套件
npm install

# 2. 複製並填寫環境變數
cp .env.example .env

# 3. 編譯 TypeScript
npm run build

# 4. 初始化資料庫結構（僅需執行一次）
npm run init:database

# 5. 植入追蹤航線資料（僅需執行一次）
npm run seed:tracked-destinations

# 6. 啟動應用程式
npm start
```

---

### 環境變數設定

#### 必要環境變數

| 變數 | 說明 |
|---|---|
| `DATABASE_URL` | Turso/libSQL 連線 URL |
| `DATABASE_AUTH_TOKEN` | 資料庫驗證 Token |
| `SERPAPI_API_KEY` | 主要 SerpApi 金鑰 |
| `SCRAPERAPI_KEY` | 主要 ScraperAPI 金鑰 |
| `RSS_FEED_URLS` | 逗號分隔的訂閱網址 |
| `DISCORD_WEBHOOK_URL` | Discord 頻道 Webhook |

#### 選用環境變數

| 變數 | 預設值 | 說明 |
|---|---|---|
| `TURSO_URL` | — | 若存在，覆蓋 `DATABASE_URL` |
| `TURSO_AUTH_TOKEN` | — | 若存在，覆蓋 `DATABASE_AUTH_TOKEN` |
| `SERPAPI_API_KEYS` | — | 逗號分隔金鑰池；HTTP 429 時自動輪替 |
| `SCRAPERAPI_API_KEYS` | — | 逗號分隔金鑰池；HTTP 403 時自動輪替 |
| `OPENAI_API_KEY` | — | 商務艙優惠擷取必要 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 使用的 OpenAI 模型 |
| `GROQ_API_KEY` | — | 選用 Groq 替代方案 |
| `BUSINESS_DEAL_THRESHOLD_GBP` | `1000` | 商務艙價格門檻（GBP） |
| `BUSINESS_DEAL_MIN_CONFIDENCE` | `0.8` | 最低 LLM 信心分數 |
| `NORMAL_FARES_CRON` | `0 2 * * *` | 一般票價排程（每天 UTC 02:00） |
| `BUSINESS_DEALS_CRON` | `0 */2 * * *` | 商務艙優惠排程 |
| `RUN_NORMAL_FARES_ON_STARTUP` | `true` | 啟動時執行一般票價任務 |
| `RUN_BUSINESS_DEALS_ON_STARTUP` | `true` | 啟動時執行商務艙優惠任務 |
| `SCHEDULER_LEASE_DURATION_MS` | `1800000` | 排程器鎖定時長（毫秒） |

#### `RSS_FEED_URLS` 格式

```env
RSS_FEED_URLS=SecretFlying|https://example.com/feed.xml,PremiumDeals|https://example.com/another.xml
```

---

### SerpApi 用量與 API 金鑰池

每條追蹤航線每次掃描約消耗 **3 次 SerpApi 呼叫**，每月約 **~90 次呼叫**。免費方案每金鑰每月 **250 次搜尋**。

| 追蹤航線數 | 每月呼叫次數（估算） | 建議金鑰數量 |
|---|---|---|
| 1–2 條 | ~90–180 | 1 組 |
| 3–5 條 | ~270–450 | 1–2 組 |
| 6–10 條 | ~540–900 | 2–4 組 |

> **建議：** 申請 2–3 個 SerpApi 免費帳號，並將所有金鑰填入 `SERPAPI_API_KEYS`。

---

### 資料庫設定

依序套用 SQL 遷移腳本：

1. `db/migrations/001_initial_schema.sql`
2. `db/migrations/002_add_job_scheduler_state.sql`

| 資料表 | 用途 |
|---|---|
| `tracked_destinations` | 監控航線 |
| `fare_observations` | 歷史票價記錄 |
| `fare_alerts` | 已發送通知去重記錄 |
| `business_deals` | 解析後的商務艙優惠 |
| `job_scheduler_state` | 排程器分散式鎖定 |

---

### 可用指令

| 指令 | 說明 |
|---|---|
| `npm run build` | 將 TypeScript 編譯至 `dist/` |
| `npm run typecheck` | TypeScript 型別檢查（不輸出） |
| `npm test` | 對編譯後輸出執行測試 |
| `npm run init:database` | 初始化資料庫結構描述 |
| `npm run seed:tracked-destinations` | 植入初始追蹤航線 |
| `npm run sync:tracked-destinations` | 同步追蹤航線資料 |
| `npm run bootstrap:fare-history` | 使用 SerpApi 回填票價歷史 |
| `npm start` | 啟動排程器與應用程式 |

---

### 疑難排解

<details>
<summary><strong>找到航班但未收到 Discord 通知</strong></summary>

正常行為。提醒僅在新票價進入**歷史前三低**時觸發。旅遊旺季（7–8 月）票價偏高，較少達到門檻。
</details>

<details>
<summary><strong>Google Flights 回傳零筆結果（<code>Fully empty</code>）</strong></summary>

- `deep_search=true` 已於 2026-07-07 更新後自動設定。
- `LON`、`NYC` 等大都會代碼由服務自動展開。
- 確認 `outbound_date` 為未來日期（UTC）。
</details>

<details>
<summary><strong>Discord Webhook 回傳 HTTP 400</strong></summary>

**原因：** `timestamp` 欄位需嚴格使用 ISO 8601 格式。部分 RSS 訂閱使用 RFC 2822 格式。

**解決：** 已在 `src/notifications/business-deal-embed.ts` 中修復，無效日期設為 `undefined`。
</details>

---

### 專案結構

```
src/
├── main.ts          # 執行環境進入點
├── index.ts         # 公開進入點
├── jobs/            # 排程任務協調
├── clients/         # SerpApi、RSS、Discord、LLM 整合
├── db/              # 資料倉儲與資料庫存取層
├── logic/           # 正規化與業務邏輯
└── scripts/         # 設定與回填輔助腳本
db/
└── migrations/      # SQL 遷移腳本
```

---

<a name="简体中文"></a>

## 简体中文

一个基于 TypeScript 的服务，用于监控机票价格及精选特惠信息，结合 LLM 进行数据提取，并通过 Discord 自动推送通知。

---

### 预览

<img width="1426" alt="普通票价 Discord 提醒" src="https://github.com/user-attachments/assets/ffbc5165-45d3-4d6b-b548-44ac665b74d1" />
<img width="1438" alt="商务舱特惠 Discord 提醒" src="https://github.com/user-attachments/assets/ca5c5bf4-dcfa-4e75-aaf6-5eaeaf2f8e67" />

---

### 技术栈

| 层级 | 技术 |
|---|---|
| **语言 / 运行环境** | TypeScript · Node.js 20+ |
| **数据库** | Turso / libSQL |
| **航班数据** | SerpApi（Google Flights） |
| **订阅抓取** | ScraperAPI + RSS/Atom 解析 |
| **AI 提取** | OpenAI 兼容 API（默认：`gpt-4o-mini`）· Groq（可选） |
| **通知** | Discord Webhooks |
| **CI / CD** | GitHub Actions |

---

### 功能特性

- **普通票价追踪** — 通过 SerpApi / Google Flights 监控配置航线的票价动态
- **历史基准对比** — 将票价观测数据存储至 Turso/libSQL，建立历史基准线
- **智能票价提醒** — 仅当新票价进入该航线历史前三低时，才发送 Discord 通知
- **RSS/Atom 订阅解析** — 持续监控旅游特惠订阅源（如 Secret Flying、Premium Deals）
- **AI 数据提取** — 使用 GPT-4o-mini 从订阅内容中精准提取结构化优惠信息
- **商务舱特惠通知** — 当商务舱票价符合设定的价格阈值与 AI 置信度时，自动推送通知
- **实用工具脚本** — 内置数据库初始化、航线数据填充、同步及票价历史回填等脚本

---

### 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 复制并填写环境变量
cp .env.example .env

# 3. 编译 TypeScript
npm run build

# 4. 初始化数据库结构（仅执行一次）
npm run init:database

# 5. 填充追踪航线数据（仅执行一次）
npm run seed:tracked-destinations

# 6. 启动应用
npm start
```

---

### 环境变量配置

#### 必填变量

| 变量 | 说明 |
|---|---|
| `DATABASE_URL` | Turso/libSQL 连接 URL |
| `DATABASE_AUTH_TOKEN` | 数据库认证 Token |
| `SERPAPI_API_KEY` | 主 SerpApi 密钥 |
| `SCRAPERAPI_KEY` | 主 ScraperAPI 密钥 |
| `RSS_FEED_URLS` | 逗号分隔的订阅地址 |
| `DISCORD_WEBHOOK_URL` | Discord 频道 Webhook |

#### 可选变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `TURSO_URL` | — | 若存在，覆盖 `DATABASE_URL` |
| `TURSO_AUTH_TOKEN` | — | 若存在，覆盖 `DATABASE_AUTH_TOKEN` |
| `SERPAPI_API_KEYS` | — | 逗号分隔密钥池；HTTP 429 时自动轮换 |
| `SCRAPERAPI_API_KEYS` | — | 逗号分隔密钥池；HTTP 403 时自动轮换 |
| `OPENAI_API_KEY` | — | 商务舱特惠提取必需 |
| `OPENAI_MODEL` | `gpt-4o-mini` | 使用的 OpenAI 模型 |
| `GROQ_API_KEY` | — | 可选 Groq 替代方案 |
| `BUSINESS_DEAL_THRESHOLD_GBP` | `1000` | 商务舱价格阈值（GBP） |
| `BUSINESS_DEAL_MIN_CONFIDENCE` | `0.8` | 最低 LLM 置信度 |
| `NORMAL_FARES_CRON` | `0 2 * * *` | 普通票价定时任务（每天 UTC 02:00） |
| `BUSINESS_DEALS_CRON` | `0 */2 * * *` | 商务舱特惠定时任务 |
| `RUN_NORMAL_FARES_ON_STARTUP` | `true` | 启动时运行普通票价任务 |
| `RUN_BUSINESS_DEALS_ON_STARTUP` | `true` | 启动时运行商务舱特惠任务 |
| `SCHEDULER_LEASE_DURATION_MS` | `1800000` | 调度器租约时长（毫秒） |

#### `RSS_FEED_URLS` 格式

```env
RSS_FEED_URLS=SecretFlying|https://example.com/feed.xml,PremiumDeals|https://example.com/another.xml
```

---

### SerpApi 用量与密钥池

每条追踪航线每次扫描约消耗 **3 次 SerpApi 调用**，每月约 **~90 次调用**。免费套餐每密钥每月 **250 次搜索**。

| 追踪航线数 | 每月调用次数（估算） | 建议密钥数量 |
|---|---|---|
| 1–2 条 | ~90–180 | 1 组 |
| 3–5 条 | ~270–450 | 1–2 组 |
| 6–10 条 | ~540–900 | 2–4 组 |

> **建议：** 注册 2–3 个 SerpApi 免费账号，将所有密钥填入 `SERPAPI_API_KEYS`。

---

### 数据库初始化

按顺序执行 SQL 迁移脚本：

1. `db/migrations/001_initial_schema.sql`
2. `db/migrations/002_add_job_scheduler_state.sql`

| 数据表 | 用途 |
|---|---|
| `tracked_destinations` | 监控航线 |
| `fare_observations` | 历史票价记录 |
| `fare_alerts` | 已发送通知去重记录 |
| `business_deals` | 解析后的商务舱特惠 |
| `job_scheduler_state` | 调度器分布式锁 |

---

### 可用命令

| 命令 | 说明 |
|---|---|
| `npm run build` | 将 TypeScript 编译至 `dist/` |
| `npm run typecheck` | 类型检查（不输出文件） |
| `npm test` | 对编译后输出执行测试 |
| `npm run init:database` | 初始化数据库结构 |
| `npm run seed:tracked-destinations` | 填充初始追踪航线 |
| `npm run sync:tracked-destinations` | 同步追踪航线数据 |
| `npm run bootstrap:fare-history` | 使用 SerpApi 回填票价历史 |
| `npm start` | 启动调度器与应用运行环境 |

---

### 常见问题

<details>
<summary><strong>找到航班但未收到 Discord 通知</strong></summary>

正常行为。提醒仅在新票价进入**历史前三低**时触发。旅游旺季（7–8 月）票价偏高，较少达到阈值。
</details>

<details>
<summary><strong>Google Flights 返回零条结果（<code>Fully empty</code>）</strong></summary>

- `deep_search=true` 已于 2026-07-07 更新后自动设置。
- `LON`、`NYC` 等大都市代码由服务自动展开。
- 确认 `outbound_date` 为未来日期（UTC）。
</details>

<details>
<summary><strong>Discord Webhook 返回 HTTP 400</strong></summary>

**原因：** `timestamp` 字段需严格使用 ISO 8601 格式。部分 RSS 订阅使用 RFC 2822 格式。

**解决：** 已在 `src/notifications/business-deal-embed.ts` 中修复，无效日期设为 `undefined`。
</details>

---

### 项目结构

```
src/
├── main.ts          # 运行环境入口
├── index.ts         # 公共入口 / 导出
├── jobs/            # 定时任务协调
├── clients/         # SerpApi、RSS、Discord、LLM 集成
├── db/              # 数据仓库与数据库访问层
├── logic/           # 规范化与业务逻辑
└── scripts/         # 配置与回填辅助脚本
db/
└── migrations/      # SQL 迁移文件
```

---

<div align="center">

[Report an Issue](https://github.com/wallouo/flight-radar/issues)

</div>
