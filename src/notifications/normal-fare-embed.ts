import type { DiscordEmbed, NormalizedFareObservation } from "../types/domain.js";

export interface NormalFarePriceComparison {
  thirdLowestPriceAmountMinor?: number;
  historicalLowestPriceAmountMinor?: number;
}

export function buildNormalFareEmbed(
  fare: NormalizedFareObservation,
  comparison: NormalFarePriceComparison = {}
): DiscordEmbed {
  return {
    title: `Cheap fare found: ${fare.originAirportCode} -> ${fare.destinationAirportCode}`,
    description: buildDescription(comparison),
    url: fare.deepLink,
    color: 0x2ecc71,
    fields: [
      { name: "Price", value: formatMoney(fare.currencyCode, fare.priceAmountMinor), inline: true },
      { name: "Trip", value: fare.tripType, inline: true },
      { name: "Cabin", value: fare.cabinClass, inline: true },
      { name: "Source", value: buildSourceLabel(fare), inline: true },
      { name: "Departure", value: fare.departDate ?? "unknown", inline: true },
      { name: "Return", value: fare.returnDate ?? "unknown", inline: true },
      { name: "Price vs history", value: buildPriceComparison(fare, comparison), inline: false }
    ],
    timestamp: fare.observedAt
  };
}

function buildDescription(comparison: NormalFarePriceComparison): string {
  if (typeof comparison.thirdLowestPriceAmountMinor === "number") {
    return "New fare entered the historical top 3 for this destination.";
  }

  return "New fare found while historical baseline is still being built.";
}

function buildSourceLabel(fare: NormalizedFareObservation): string {
  return fare.providerQueryKey;
}

function buildPriceComparison(
  fare: NormalizedFareObservation,
  comparison: NormalFarePriceComparison
): string {
  const lines: string[] = [];

  if (typeof comparison.historicalLowestPriceAmountMinor === "number") {
    const delta = fare.priceAmountMinor - comparison.historicalLowestPriceAmountMinor;
    const sign = delta <= 0 ? "below" : "above";
    lines.push(
      `Lowest seen: ${formatMoney(fare.currencyCode, comparison.historicalLowestPriceAmountMinor)} (${formatMoney(fare.currencyCode, Math.abs(delta))} ${sign})`
    );
  }

  if (typeof comparison.thirdLowestPriceAmountMinor === "number") {
    const delta = comparison.thirdLowestPriceAmountMinor - fare.priceAmountMinor;
    const percentage = comparison.thirdLowestPriceAmountMinor > 0
      ? ((delta / comparison.thirdLowestPriceAmountMinor) * 100).toFixed(1)
      : "0.0";

    lines.push(
      `Top-3 threshold: ${formatMoney(fare.currencyCode, comparison.thirdLowestPriceAmountMinor)} (${formatMoney(fare.currencyCode, Math.abs(delta))} cheaper, ${percentage}% below)`
    );
  }

  if (lines.length === 0) {
    return "Not enough historical fares yet.";
  }

  return lines.join("\n");
}

function formatMoney(currencyCode: string, amountMinor: number): string {
  return `${currencyCode} ${(amountMinor / 100).toFixed(2)}`;
}
