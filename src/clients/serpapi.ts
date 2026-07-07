import { serpApiFlightResultSchema } from "../schemas/domain.js";
import type { SerpApiFlightResult, TrackedDestination } from "../types/domain.js";
import type { SerpApiKeyPool } from "./serpapi-key-pool.js";

export interface SerpApiClient {
  searchFlights(destination: TrackedDestination): Promise<SerpApiFlightResult[]>;
  searchCalendar(destination: TrackedDestination, dateYYYYMMDD: string): Promise<SerpApiCalendarDay[]>;
}

export interface SerpApiCalendarDay {
  date: string;   // YYYY-MM-DD
  price: number;  // decimal amount in destination currency
}

export interface SerpApiClientConfig {
  apiKey: string;
  keyPool?: SerpApiKeyPool;
  baseUrl?: string;
  fetch?: typeof fetch;
}

interface SerpApiSearchResponse {
  best_flights?: unknown;
  other_flights?: unknown;
}

const DEFAULT_SERPAPI_BASE_URL = "https://serpapi.com/search.json";

/**
 * Metro-code → comma-separated IATA airport list for SerpAPI departure_id.
 * Google Flights does not reliably resolve metro codes (e.g. LON) on its own;
 * expanding to individual airports ensures results are returned.
 */
const METRO_CODE_EXPANSIONS: Readonly<Record<string, string>> = {
  LON: "LHR,LGW,STN,LTN,LCY",
  NYC: "JFK,LGA,EWR",
  PAR: "CDG,ORY",
  TYO: "NRT,HND",
  OSA: "KIX,ITM",
  MIL: "MXP,LIN",
  BUH: "OTP,BBU",
};

/** Redacts the api_key param value for safe logging. */
function redactApiKey(url: string): string {
  return url.replace(/(api_key=)[^&]+/, "$1[REDACTED]");
}

/**
 * Resolves a potentially metro airport code to the SerpAPI departure_id value.
 * Returns comma-separated individual airports if the code is a known metro code,
 * otherwise returns the code unchanged.
 */
function resolveSerpapiDepartureId(airportCode: string): string {
  return METRO_CODE_EXPANSIONS[airportCode.toUpperCase()] ?? airportCode;
}

export function parseSerpApiFlightResults(payload: unknown): SerpApiFlightResult[] {
  if (!Array.isArray(payload)) {
    throw new Error("Expected SerpApi flights array");
  }

  return payload.flatMap((item, index) => {
    const normalized = normalizeSerpApiFlightResult(item);
    const parsed = serpApiFlightResultSchema.safeParse(normalized);

    if (!parsed.success) {
      console.warn(`[serpapi] skipped invalid flight result at index ${index}`, parsed.error.issues);
      return [];
    }

    return [parsed.data];
  });
}

export function createSerpApiClient(config: SerpApiClientConfig): SerpApiClient {
  const fetchImpl = config.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is not available for SerpApi client");
  }

  return {
    async searchFlights(destination: TrackedDestination): Promise<SerpApiFlightResult[]> {
      const requestUrl = buildSerpApiUrl(destination, config);
      console.info(`[serpapi] GET ${redactApiKey(requestUrl)}`);

      const response = await fetchWithPoolRetry(requestUrl, config, fetchImpl);
      console.info(`[serpapi] response status=${response.status} for ${destination.originAirportCode}->${destination.destinationAirportCode}`);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `SerpApi request failed with status ${response.status} url=${redactApiKey(requestUrl)} body=${errorText}`
        );
      }

      const payload = (await response.json()) as SerpApiSearchResponse & Record<string, unknown>;

      const topKeys = Object.keys(payload);
      console.info(`[serpapi] response keys: [${topKeys.join(", ")}]`);
      if (payload["error"]) {
        console.warn(`[serpapi] error field present: ${JSON.stringify(payload["error"])}`);
      }
      const bestCount = Array.isArray(payload.best_flights) ? payload.best_flights.length : 0;
      const otherCount = Array.isArray(payload.other_flights) ? payload.other_flights.length : 0;
      console.info(`[serpapi] best_flights=${bestCount} other_flights=${otherCount}`);

      return parseSerpApiSearchResponse(payload);
    },

    async searchCalendar(destination: TrackedDestination, dateYYYYMMDD: string): Promise<SerpApiCalendarDay[]> {
      const requestUrl = buildSerpApiCalendarUrl(destination, dateYYYYMMDD, config);
      const response = await fetchWithPoolRetry(requestUrl, config, fetchImpl);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `SerpApi calendar request failed with status ${response.status} url=${redactApiKey(requestUrl)} body=${errorText}`
        );
      }

      const payload = await response.json();
      return parseSerpApiCalendarResponse(payload);
    }
  };
}

async function fetchWithPoolRetry(
  requestUrl: string,
  config: SerpApiClientConfig,
  fetchImpl: typeof fetch
): Promise<Response> {
  const swapKey = (url: string, key: string): string =>
    url.replace(/(api_key=)[^&]*/, `$1${encodeURIComponent(key)}`);

  const activeKey = config.keyPool ? config.keyPool.getActiveKey() : config.apiKey;
  const response = await fetchImpl(swapKey(requestUrl, activeKey), {
    method: "GET",
    headers: { Accept: "application/json" }
  });

  if ((response.status === 403 || response.status === 429) && config.keyPool) {
    config.keyPool.markExhausted(activeKey);
    const nextKey = config.keyPool.getActiveKey();
    return fetchImpl(swapKey(requestUrl, nextKey), {
      method: "GET",
      headers: { Accept: "application/json" }
    });
  }

  return response;
}

export function parseSerpApiSearchResponse(payload: unknown): SerpApiFlightResult[] {
  if (!payload || typeof payload !== "object") {
    throw new Error("Expected SerpApi response object");
  }

  const response = payload as SerpApiSearchResponse;
  const bestFlights = Array.isArray(response.best_flights) ? response.best_flights : [];
  const otherFlights = Array.isArray(response.other_flights) ? response.other_flights : [];

  return parseSerpApiFlightResults([...bestFlights, ...otherFlights]);
}

export function parseSerpApiCalendarResponse(payload: unknown): SerpApiCalendarDay[] {
  if (!payload || typeof payload !== "object") return [];

  const response = payload as Record<string, unknown>;

  console.log("[serpapi] calendar response keys:", Object.keys(response));
  if (response["error"]) {
    console.log("[serpapi] calendar error:", JSON.stringify(response["error"]));
  }

  const candidateArrays = [
    response["flights_results"],
    response["price_insights"],
    response["graph_results"]
  ];

  for (const candidate of candidateArrays) {
    if (!Array.isArray(candidate)) continue;

    console.log("[serpapi] found candidate array with", candidate.length, "items");

    const days = candidate.flatMap((item: unknown): SerpApiCalendarDay[] => {
      if (!item || typeof item !== "object") return [];
      const entry = item as Record<string, unknown>;
      const date = typeof entry["date"] === "string" ? entry["date"] : undefined;
      const rawPrice = entry["price"] ?? entry["lowest_price"];
      const price = typeof rawPrice === "number" ? rawPrice : undefined;
      if (!date || typeof price !== "number") return [];
      return [{ date, price }];
    });

    if (days.length > 0) return days;
  }

  return [];
}

export function buildSerpApiUrl(destination: TrackedDestination, config: SerpApiClientConfig): string {
  const baseUrl = config.baseUrl ?? DEFAULT_SERPAPI_BASE_URL;
  const url = new URL(baseUrl);
  const params = url.searchParams;

  params.set("engine", "google_flights");
  params.set("api_key", config.apiKey);
  params.set("departure_id", resolveSerpapiDepartureId(destination.originAirportCode));
  params.set("arrival_id", destination.destinationAirportCode);
  params.set("gl", extractGoogleMarket(destination.locale));
  params.set("hl", extractGoogleLanguage(destination.locale));
  params.set("currency", destination.currencyCode);
  params.set("type", destination.tripType === "one_way" ? "2" : "1");
  params.set("travel_class", mapCabinClass(destination.cabinClass));
  params.set("deep_search", "true");

  if (destination.departureDateFrom) {
    params.set("outbound_date", destination.departureDateFrom);
  }

  if (destination.tripType === "round_trip" && destination.returnDateFrom) {
    params.set("return_date", destination.returnDateFrom);
  }

  if (typeof destination.maxStops === "number") {
    // DB: 0 = nonstop → SerpAPI: 1; DB: 1 = ≤1 stop → SerpAPI: 2; etc.
    params.set("stops", String(destination.maxStops + 1));
  }

  return url.toString();
}

export function buildSerpApiCalendarUrl(
  destination: TrackedDestination,
  dateYYYYMMDD: string,
  config: SerpApiClientConfig
): string {
  const baseUrl = config.baseUrl ?? DEFAULT_SERPAPI_BASE_URL;
  const url = new URL(baseUrl);
  const params = url.searchParams;

  params.set("engine", "google_flights");
  params.set("api_key", config.apiKey);
  params.set("departure_id", resolveSerpapiDepartureId(destination.originAirportCode));
  params.set("arrival_id", destination.destinationAirportCode);
  params.set("gl", extractGoogleMarket(destination.locale));
  params.set("hl", extractGoogleLanguage(destination.locale));
  params.set("currency", destination.currencyCode);
  params.set("type", destination.tripType === "one_way" ? "2" : "1");
  params.set("outbound_date", dateYYYYMMDD);
  params.set("deep_search", "true");

  if (destination.tripType === "round_trip" && destination.returnDateFrom) {
    params.set("return_date", destination.returnDateFrom);
  }

  return url.toString();
}

function normalizeSerpApiFlightResult(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  const result = { ...(payload as Record<string, unknown>) };

  if (typeof result.price !== "number") {
    const extractedPrice = extractNumericPrice(result.price);
    if (typeof extractedPrice === "number") {
      result.price = extractedPrice;
    }
  }

  return result;
}

function extractNumericPrice(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
    if (normalized) {
      return Number(normalized[0]);
    }
  }

  return undefined;
}

function mapCabinClass(cabinClass: TrackedDestination["cabinClass"]): string {
  switch (cabinClass) {
    case "economy": return "1";
    case "premium_economy": return "2";
    case "business": return "3";
    case "first": return "4";
    default: return "1";
  }
}

function extractGoogleLanguage(locale: string): string {
  const [language] = locale.split(/[-_]/);
  return language || "en";
}

function extractGoogleMarket(locale: string): string {
  const [, region] = locale.split(/[-_]/);
  return (region || "us").toLowerCase();
}
