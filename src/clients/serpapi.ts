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
      const response = await fetchWithPoolRetry(requestUrl, config, fetchImpl);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `SerpApi request failed with status ${response.status} url=${requestUrl} body=${errorText}`
        );
      }

      const payload = (await response.json()) as SerpApiSearchResponse;
      return parseSerpApiSearchResponse(payload);
    },

    async searchCalendar(destination: TrackedDestination, dateYYYYMMDD: string): Promise<SerpApiCalendarDay[]> {
      const requestUrl = buildSerpApiCalendarUrl(destination, dateYYYYMMDD, config);
      const response = await fetchWithPoolRetry(requestUrl, config, fetchImpl);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `SerpApi calendar request failed with status ${response.status} url=${requestUrl} body=${errorText}`
        );
      }

      const payload = await response.json();
      return parseSerpApiCalendarResponse(payload);
    }
  };
}

/**
 * Executes a fetch, replacing the api_key param with the active pool key.
 * On HTTP 403 (quota exhausted) or 429 (rate limit), marks the current key 
 * as exhausted and retries once with the next available key. 
 * Throws if all keys are exhausted.
 */
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

  // SerpAPI returns 403 when quota is exhausted, 429 for rate limiting
  if ((response.status === 403 || response.status === 429) && config.keyPool) {
    config.keyPool.markExhausted(activeKey);
    const nextKey = config.keyPool.getActiveKey(); // throws if all exhausted
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

  // Debug: log response keys and error if present
  console.log("[serpapi] calendar response keys:", Object.keys(response));
  if (response["error"]) {
    console.log("[serpapi] calendar error:", JSON.stringify(response["error"]));
  }

  // SerpAPI Google Flights calendar may return data under different keys
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
  params.set("api_key", config.apiKey); // will be swapped by fetchWithPoolRetry
  params.set("departure_id", destination.originAirportCode);
  params.set("arrival_id", destination.destinationAirportCode);
  params.set("gl", extractGoogleMarket(destination.locale));
  params.set("hl", extractGoogleLanguage(destination.locale));
  params.set("currency", destination.currencyCode);
  params.set("type", destination.tripType === "one_way" ? "2" : "1");
  params.set("travel_class", mapCabinClass(destination.cabinClass));

  if (destination.departureDateFrom) {
    params.set("outbound_date", destination.departureDateFrom);
  }

  if (destination.tripType === "round_trip" && destination.returnDateFrom) {
    params.set("return_date", destination.returnDateFrom);
  }

  if (typeof destination.maxStops === "number") {
    params.set("stops", String(destination.maxStops));
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

  // For price calendar/graph, we query with a specific date and Google Flights
  // will return price_insights with data for nearby dates
  params.set("engine", "google_flights");
  params.set("api_key", config.apiKey); // will be swapped by fetchWithPoolRetry
  params.set("departure_id", destination.originAirportCode);
  params.set("arrival_id", destination.destinationAirportCode);
  params.set("gl", extractGoogleMarket(destination.locale));
  params.set("hl", extractGoogleLanguage(destination.locale));
  params.set("currency", destination.currencyCode);
  params.set("type", destination.tripType === "one_way" ? "2" : "1");
  params.set("travel_class", mapCabinClass(destination.cabinClass));
  params.set("outbound_date", dateYYYYMMDD);

  if (destination.tripType === "round_trip" && destination.returnDateFrom) {
    params.set("return_date", destination.returnDateFrom);
  }

  if (typeof destination.maxStops === "number") {
    params.set("stops", String(destination.maxStops));
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
