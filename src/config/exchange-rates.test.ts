import { test } from "node:test";
import assert from "node:assert";
import { convertToGbp, isExchangeRateStale } from "./exchange-rates.js";
import type { ExchangeRates } from "./exchange-rates.js";

test("convertToGbp - GBP to GBP", () => {
  const rates: ExchangeRates = {
    base: "GBP",
    lastUpdated: "2026-05-14T00:00:00.000Z",
    rates: { USD: 0.79 },
  };

  const result = convertToGbp(1000, "GBP", rates);
  assert.strictEqual(result, 1000);
});

test("convertToGbp - USD to GBP", () => {
  const rates: ExchangeRates = {
    base: "GBP",
    lastUpdated: "2026-05-14T00:00:00.000Z",
    rates: { USD: 0.79 },
  };

  const result = convertToGbp(1000, "USD", rates);
  assert.strictEqual(result, 790);
});

test("convertToGbp - EUR to GBP", () => {
  const rates: ExchangeRates = {
    base: "GBP",
    lastUpdated: "2026-05-14T00:00:00.000Z",
    rates: { EUR: 0.86 },
  };

  const result = convertToGbp(1000, "EUR", rates);
  assert.strictEqual(result, 860);
});

test("convertToGbp - unknown currency throws error", () => {
  const rates: ExchangeRates = {
    base: "GBP",
    lastUpdated: "2026-05-14T00:00:00.000Z",
    rates: { USD: 0.79 },
  };

  assert.throws(() => {
    convertToGbp(1000, "XYZ", rates);
  }, /Unknown currency: XYZ/);
});

test("isExchangeRateStale - fresh rates", () => {
  const rates: ExchangeRates = {
    base: "GBP",
    lastUpdated: new Date().toISOString(),
    rates: {},
  };

  assert.strictEqual(isExchangeRateStale(rates), false);
});

test("isExchangeRateStale - stale rates", () => {
  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

  const rates: ExchangeRates = {
    base: "GBP",
    lastUpdated: eightDaysAgo.toISOString(),
    rates: {},
  };

  assert.strictEqual(isExchangeRateStale(rates), true);
});
