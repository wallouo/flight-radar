import type { BusinessDealExtraction } from "../types/domain.js";
import type { ExchangeRates } from "../config/exchange-rates.js";
import { convertToGbp } from "../config/exchange-rates.js";

export function qualifiesBusinessDealForAlert(
  deal: BusinessDealExtraction,
  thresholdGbp: number,
  minimumConfidence: number,
  exchangeRates: ExchangeRates
): boolean {
  if (deal.cabinClass !== "business") {
    return false;
  }

  if (!deal.isLongHaul) {
    return false;
  }

  if (deal.isErrorFare === true) {
    return false;
  }

  if (deal.confidence < minimumConfidence) {
    return false;
  }

  if (typeof deal.priceAmount !== "number") {
    return false;
  }

  if (!deal.currencyCode) {
    console.warn(`[Business Deal] Missing currency code, skipping deal`);
    return false;
  }

  // Convert price to GBP for comparison
  let priceInGbp: number;
  try {
    priceInGbp = convertToGbp(deal.priceAmount, deal.currencyCode, exchangeRates);
  } catch (error) {
    // Unknown currency, skip this deal
    console.warn(`[Business Deal] Unknown currency ${deal.currencyCode}, skipping deal`);
    return false;
  }

  return priceInGbp < thresholdGbp;
}

export function shouldRunDealExtraction(confidence: number | undefined): boolean {
  return typeof confidence !== "number" || confidence < 0.7;
}
