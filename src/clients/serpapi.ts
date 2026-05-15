import { serpApiFlightResultSchema } from "../schemas/domain.js";
import type { SerpApiFlightResult, TrackedDestination } from "../types/domain.js";

export interface SerpApiClient {
  searchFlights(destination: TrackedDestination): Promise<SerpApiFlightResult[]>;
}

export interface SerpApiClientConfig {
  apiKey: string;
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
      const response = await fetchImpl(requestUrl, {
        method: "GET",
        headers: {
          Accept: "application/json"
        }
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `SerpApi request failed with status ${response.status} url=${requestUrl} body=${errorText}`
        );
      }

      const payload = (await response.json()) as SerpApiSearchResponse;
      return parseSerpApiSearchResponse(payload);
    }
  };
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

export function buildSerpApiUrl(destination: TrackedDestination, config: SerpApiClientConfig): string {
  const baseUrl = config.baseUrl ?? DEFAULT_SERPAPI_BASE_URL;
  const url = new URL(baseUrl);
  const params = url.searchParams;

  params.set("engine", "google_flights");
  params.set("api_key", config.apiKey);
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
    case "economy":
      return "1";
    case "premium_economy":
      return "2";
    case "business":
      return "3";
    case "first":
      return "4";
    default:
      return "1";
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
