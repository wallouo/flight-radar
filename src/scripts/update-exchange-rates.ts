import {
  loadExchangeRates,
  convertToGbp,
  updateExchangeRatesIfStale,
} from "../config/exchange-rates.js";

/**
 * Update exchange rates and display current rates
 */
async function main() {
  console.log("=== Exchange Rates Updater ===\n");

  // Check and update if needed
  const updated = await updateExchangeRatesIfStale();

  // Load and display current rates
  const rates = await loadExchangeRates();

  console.log("\n=== Current Exchange Rates ===");
  console.log(`Base: ${rates.base}`);
  console.log(`Last Updated: ${rates.lastUpdated}`);
  console.log("\nRates (to GBP):");

  const sortedCurrencies = Object.keys(rates.rates).sort();
  for (const currency of sortedCurrencies) {
    const rate = rates.rates[currency];
    console.log(`  ${currency}: ${rate.toFixed(4)}`);
  }

  // Example conversions
  console.log("\n=== Example Conversions ===");
  const examples = [
    { amount: 1000, currency: "USD" },
    { amount: 1000, currency: "EUR" },
    { amount: 1000, currency: "JPY" },
  ];

  for (const { amount, currency } of examples) {
    try {
      const gbp = convertToGbp(amount, currency, rates);
      console.log(`  ${amount} ${currency} = £${gbp.toFixed(2)}`);
    } catch (error) {
      console.log(`  ${amount} ${currency} = Error: ${error}`);
    }
  }

  console.log(
    `\n${updated ? "✅ Rates updated successfully" : "ℹ️  Rates are already up to date"}`
  );
}

main().catch(console.error);
