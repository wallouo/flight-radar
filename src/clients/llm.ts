import { businessDealExtractionSchema } from "../schemas/domain.js";
import type { BusinessDealExtraction, RssItem } from "../types/domain.js";

export interface DealExtractionClient {
  extractBusinessDeal(item: RssItem): Promise<BusinessDealExtraction>;
}

export interface OpenAiDealExtractionClientConfig {
  apiKey: string;
  model?: string;
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
}

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

export function parseBusinessDealExtraction(payload: unknown): BusinessDealExtraction {
  return businessDealExtractionSchema.parse(payload);
}

export function createOpenAiDealExtractionClient(
  config: OpenAiDealExtractionClientConfig
): DealExtractionClient {
  const fetchImpl = config.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("Fetch API is not available for LLM extraction client");
  }

  const model = config.model ?? DEFAULT_OPENAI_MODEL;
  const baseUrl = config.baseUrl ?? DEFAULT_OPENAI_BASE_URL;

  return {
    async extractBusinessDeal(item: RssItem): Promise<BusinessDealExtraction> {
      const response = await fetchImpl(baseUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content: [
                "You extract flight deal information from travel RSS entries.",
                "Return a JSON object with keys:",
                "origin, destination, priceText, priceAmount, currencyCode, cabinClass, isLongHaul, isErrorFare, confidence.",
                'cabinClass must be one of: economy, premium_economy, business, first.',
                "priceAmount must be a number when a numeric price is present, otherwise omit it.",
                "currencyCode must be a 3-letter ISO currency code when known.",
                "confidence must be a number between 0 and 1."
              ].join(" ")
            },
            {
              role: "user",
              content: JSON.stringify({
                title: item.title,
                summary: item.summary,
                link: item.link,
                publishedAt: item.publishedAt,
                feedName: item.feedName
              })
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`LLM extraction request failed with status ${response.status}: ${errorText}`);
      }

      const payload = (await response.json()) as OpenAiChatCompletionResponse;
      const content = extractMessageContent(payload);

      return parseBusinessDealExtraction(JSON.parse(content));
    }
  };
}

function extractMessageContent(payload: OpenAiChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("")
      .trim();

    if (text.length > 0) {
      return text;
    }
  }

  throw new Error("LLM extraction response did not contain message content");
}
