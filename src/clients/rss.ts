import { XMLParser } from "fast-xml-parser";
import { rssItemSchema } from "../schemas/domain.js";
import type { RssItem } from "../types/domain.js";
import { createScraperApiKeyPool, type ScraperApiKeyPool } from "./scraperapi-key-pool.js";

export interface RssHttpResponse {
  statusCode: number;
  body: string;
}

export type RssHttpFetcher = (request: {
  url: string;
  method: "GET";
  headers: Record<string, string>;
  timeout: number;
}) => Promise<RssHttpResponse>;

export interface XmlParser {
  parse(xml: string): unknown;
}

export interface RssClient {
  fetchFeedItems(feedUrl: string, feedName: string): Promise<RssItem[]>;
}

export interface RssClientConfig {
  parser?: XmlParser;
  headers?: HeadersInit;
  fetcher?: RssHttpFetcher;
}

interface ParsedRssDocument {
  rss?: {
    channel?: {
      item?: unknown;
    };
  };
  feed?: {
    entry?: unknown;
  };
}

export function parseRssItems(payload: unknown): RssItem[] {
  return rssItemSchema.array().parse(payload);
}

export function createRssClient(config: RssClientConfig = {}): RssClient {
  const parser = config.parser ?? new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true
  });
  const fetcher = config.fetcher ?? defaultRssHttpFetcher;
  const requestHeaders = {
    Accept: "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
    ...toHeaderObject(config.headers)
  } satisfies Record<string, string>;

  return {
    async fetchFeedItems(feedUrl: string, feedName: string): Promise<RssItem[]> {
      try {
        const response = await fetcher({
          url: feedUrl,
          method: "GET",
          headers: requestHeaders,
          timeout: 30000
        });

        if (response.statusCode < 200 || response.statusCode >= 300) {
          throw new Error(formatHttpError(response.statusCode, response.body));
        }

        console.log("=== Response Body Preview ===");
        console.log(response.body.slice(0, 300));
        console.log("=============================");

        const document = parser.parse(response.body) as ParsedRssDocument;
        const items = parseRssItems(extractRssItems(document, feedName));

        if (items.length === 0) {
          throw new Error(`RSS request succeeded but returned 0 items for feed \"${feedName}\"`);
        }

        return items;
      } catch (error) {
        throw new Error(formatRequestError(error), { cause: error });
      }
    }
  };
}

// Singleton key pool instance
let keyPool: ScraperApiKeyPool | null = null;

function getKeyPool(): ScraperApiKeyPool {
  if (!keyPool) {
    keyPool = createScraperApiKeyPool();
  }
  return keyPool;
}

async function defaultRssHttpFetcher(request: Parameters<RssHttpFetcher>[0]): Promise<RssHttpResponse> {
  const pool = getKeyPool();
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const scraperApiKey = pool.getNextKey();
    
    if (!scraperApiKey) {
      throw new Error("All ScraperAPI keys have exhausted their monthly quota");
    }

    // Build ScraperAPI URL with query parameters
    const scraperApiUrl = new URL("http://api.scraperapi.com");
    scraperApiUrl.searchParams.set("api_key", scraperApiKey);
    scraperApiUrl.searchParams.set("url", request.url);
    scraperApiUrl.searchParams.set("render", "false");

    try {
      const response = await fetch(scraperApiUrl.toString(), {
        method: "GET",
        headers: request.headers,
        signal: AbortSignal.timeout(request.timeout)
      });

      const body = await response.text();

      // Check if this is a quota exhaustion error (403)
      if (response.status === 403) {
        console.warn(`[RSS Client] ScraperAPI key exhausted (403), marking and trying next key (attempt ${attempt}/${maxRetries})`);
        pool.markKeyExhausted(scraperApiKey);
        
        // If this is not the last attempt, try with next key
        if (attempt < maxRetries) {
          continue;
        }
      }

      return {
        statusCode: response.status,
        body
      };
    } catch (error: any) {
      // Handle fetch errors
      if (error.name === "AbortError" || error.name === "TimeoutError") {
        throw new Error(`RSS request timed out after ${request.timeout}ms`);
      }

      // If it's the last attempt, throw the error
      if (attempt === maxRetries) {
        throw error;
      }

      // Otherwise, log and retry with next key
      console.warn(`[RSS Client] Request failed (attempt ${attempt}/${maxRetries}):`, error.message);
    }
  }

  throw new Error("RSS request failed after all retry attempts");
}

function toHeaderObject(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) {
    return {};
  }

  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }

  return Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key, String(value)])
  );
}

function formatRequestError(error: unknown): string {
  if (error instanceof Error && error.message.startsWith("RSS request failed with status ")) {
    return error.message;
  }

  const statusCode = getErrorStatusCode(error);
  const body = getErrorResponseBody(error);

  if (typeof statusCode === "number") {
    return formatHttpError(statusCode, body);
  }

  if (error instanceof Error) {
    return `RSS request failed: ${error.message}`;
  }

  return "RSS request failed with unknown error";
}

function formatHttpError(statusCode: number, body: string | undefined): string {
  const preview = truncateBody(body, 300);
  return `RSS request failed with status ${statusCode}. Response body preview: ${preview}`;
}

function truncateBody(body: string | undefined, maxLength: number): string {
  if (!body) {
    return "<empty>";
  }

  const normalized = body.replace(/\s+/g, " ").trim();

  if (normalized.length === 0) {
    return "<empty>";
  }

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength)}…`;
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = error.response;

  if (isRecord(response) && typeof response.statusCode === "number") {
    return response.statusCode;
  }

  if (isRecord(response) && typeof response.status === "number") {
    return response.status;
  }

  return undefined;
}

function getErrorResponseBody(error: unknown): string | undefined {
  if (!isRecord(error)) {
    return undefined;
  }

  const response = error.response;

  if (!isRecord(response)) {
    return undefined;
  }

  if (typeof response.body === "string") {
    return response.body;
  }

  if (typeof response.text === "string") {
    return response.text;
  }

  return undefined;
}

function extractRssItems(document: ParsedRssDocument, feedName: string): RssItem[] {
  const rssItems = normalizeArray(document.rss?.channel?.item).map((item) => mapRssChannelItem(item, feedName));

  if (rssItems.length > 0) {
    return rssItems;
  }

  return normalizeArray(document.feed?.entry).map((entry) => mapAtomEntry(entry, feedName));
}

function mapRssChannelItem(item: unknown, feedName: string): RssItem {
  const source = asRecord(item);

  return {
    feedName,
    title: asString(source.title),
    summary: firstDefinedString(source.description, source.summary, source["content:encoded"]),
    link: normalizeLinkValue(source.link),
    publishedAt: firstDefinedString(source.pubDate, source.published, source.updated)
  };
}

function mapAtomEntry(entry: unknown, feedName: string): RssItem {
  const source = asRecord(entry);

  return {
    feedName,
    title: asString(source.title),
    summary: firstDefinedString(source.summary, source.content),
    link: normalizeAtomLink(source.link),
    publishedAt: firstDefinedString(source.published, source.updated)
  };
}

function normalizeArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "undefined" || value === null) {
    return [];
  }

  return [value];
}

function normalizeLinkValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string") {
        return entry;
      }

      if (isRecord(entry) && typeof entry["#text"] === "string") {
        return entry["#text"];
      }
    }
  }

  if (isRecord(value) && typeof value["#text"] === "string") {
    return value["#text"];
  }

  throw new Error("RSS item link is missing or invalid");
}

function normalizeAtomLink(value: unknown): string {
  const links = normalizeArray(value);

  for (const entry of links) {
    if (typeof entry === "string") {
      return entry;
    }

    if (!isRecord(entry)) {
      continue;
    }

    if (entry["@_rel"] === "alternate" && typeof entry["@_href"] === "string") {
      return entry["@_href"];
    }

    if (typeof entry["@_href"] === "string") {
      return entry["@_href"];
    }
  }

  throw new Error("Atom entry link is missing or invalid");
}

function firstDefinedString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }

  return undefined;
}

function asString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Expected non-empty string value");
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("Expected object value");
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
