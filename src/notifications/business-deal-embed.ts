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

  // Only include timestamp if publishedAt is defined
  // Only include timestamp if publishedAt is defined and valid
if (item.publishedAt) {
  try {
    const parsedDate = new Date(item.publishedAt);
    // 確保日期是合法的，再轉換為 ISO 字串
    if (!isNaN(parsedDate.getTime())) {
      embed.timestamp = parsedDate.toISOString();
    }
  } catch (error) {
    // 若解析失敗則忽略，不阻擋整個 embed 發送
    console.warn(`[Discord] 略過無效的日期格式: ${item.publishedAt}`);
  }
}

return embed;
}
