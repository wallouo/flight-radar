import type { BusinessDealExtraction, DiscordEmbed, RssItem } from "../types/domain.js";

export function buildBusinessDealEmbed(item: RssItem, deal: BusinessDealExtraction): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: `Business class deal: ${deal.origin} -> ${deal.destination}`,
    description: item.title,
    url: item.link,
    color: 0x9b59b6,
    fields: [
      { name: "Price", value: deal.priceText, inline: true },
      { name: "Currency", value: deal.currencyCode ?? "Unknown", inline: true },
      { name: "Cabin", value: deal.cabinClass, inline: true },
      { name: "Long-haul", value: deal.isLongHaul ? "Yes" : "No", inline: true },
      { name: "Confidence", value: deal.confidence.toFixed(2), inline: true }
    ]
  };

  if (item.publishedAt) {
    try {
      const parsedDate = new Date(item.publishedAt);
      if (!isNaN(parsedDate.getTime())) {
        embed.timestamp = parsedDate.toISOString();
      }
    } catch (error) {
      console.warn(`[Discord] 略過無效的日期格式: ${item.publishedAt}`);
    }
  }

  return embed;
}

export function buildErrorFareDealEmbed(item: RssItem, deal: BusinessDealExtraction): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: `⚠️ Error Fare Detected: ${deal.origin} -> ${deal.destination}`,
    description: item.title,
    url: item.link,
    color: 0xe74c3c,
    fields: [
      { name: "⚠️ Error Fare", value: "Yes — book at your own risk", inline: false },
      { name: "Price", value: deal.priceText, inline: true },
      { name: "Currency", value: deal.currencyCode ?? "Unknown", inline: true },
      { name: "Cabin", value: deal.cabinClass, inline: true },
      { name: "Long-haul", value: deal.isLongHaul ? "Yes" : "No", inline: true },
      { name: "Confidence", value: deal.confidence.toFixed(2), inline: true }
    ]
  };

  if (item.publishedAt) {
    try {
      const parsedDate = new Date(item.publishedAt);
      if (!isNaN(parsedDate.getTime())) {
        embed.timestamp = parsedDate.toISOString();
      }
    } catch (error) {
      console.warn(`[Discord] 略過無效的日期格式: ${item.publishedAt}`);
    }
  }

  return embed;
}
