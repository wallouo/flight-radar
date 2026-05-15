import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ExchangeRates {
  base: string;
  lastUpdated: string;
  rates: Record<string, number>;
}

const EXCHANGE_RATES_FILE = join(import.meta.dirname, "exchange-rates.json");
const STALE_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let cachedRates: ExchangeRates | null = null;

/**
 * Load exchange rates from file
 */
export async function loadExchangeRates(): Promise<ExchangeRates> {
  if (cachedRates) {
    return cachedRates;
  }

  try {
    const content = await readFile(EXCHANGE_RATES_FILE, "utf-8");
    cachedRates = JSON.parse(content);
    return cachedRates!;
  } catch (error: any) {
    // If file doesn't exist, fetch and create it
    if (error.code === "ENOENT") {
      console.log("[Exchange Rates] File not found, fetching initial rates...");
      const newRates = await fetchExchangeRates();
      await saveExchangeRates(newRates);
      return newRates;
    }
    throw error;
  }
}

/**
 * Check if exchange rates are stale (older than 7 days)
 */
export function isExchangeRateStale(rates: ExchangeRates): boolean {
  const lastUpdated = new Date(rates.lastUpdated);
  const now = new Date();
  return now.getTime() - lastUpdated.getTime() > STALE_THRESHOLD_MS;
}

/**
 * Convert price to GBP using exchange rates
 */
export function convertToGbp(
  price: number,
  currency: string,
  rates: ExchangeRates
): number {
  if (currency === "GBP") {
    return price;
  }

  const rate = rates.rates[currency];
  if (!rate) {
    throw new Error(`Unknown currency: ${currency}`);
  }

  return price * rate;
}

/**
 * Fetch latest exchange rates from API
 */
async function fetchExchangeRates(): Promise<ExchangeRates> {
  // Using exchangerate-api.com free tier (1500 requests/month)
  const response = await fetch(
    "https://api.exchangerate-api.com/v4/latest/GBP"
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch exchange rates: ${response.statusText}`);
  }

  const data = await response.json();

  // Convert from GBP base to rates relative to GBP
  const rates: Record<string, number> = {};
  for (const [currency, rate] of Object.entries(data.rates)) {
    if (currency !== "GBP") {
      rates[currency] = 1 / (rate as number);
    }
  }

  return {
    base: "GBP",
    lastUpdated: new Date().toISOString(),
    rates,
  };
}

/**
 * Update exchange rates file with latest data
 */
async function saveExchangeRates(rates: ExchangeRates): Promise<void> {
  await writeFile(EXCHANGE_RATES_FILE, JSON.stringify(rates, null, 2), "utf-8");
  cachedRates = rates;
}

/**
 * Update exchange rates if stale
 * Returns true if updated, false if already fresh
 */
export async function updateExchangeRatesIfStale(): Promise<boolean> {
  const currentRates = await loadExchangeRates();

  if (!isExchangeRateStale(currentRates)) {
    console.log(
      `[Exchange Rates] Fresh (last updated: ${currentRates.lastUpdated})`
    );
    return false;
  }

  console.log(
    `[Exchange Rates] Stale (last updated: ${currentRates.lastUpdated}), fetching latest...`
  );

  try {
    const newRates = await fetchExchangeRates();
    await saveExchangeRates(newRates);
    console.log(`[Exchange Rates] Updated successfully (${newRates.lastUpdated})`);
    return true;
  } catch (error) {
    console.error(
      `[Exchange Rates] Failed to update, using existing rates:`,
      error
    );
    return false;
  }
}
