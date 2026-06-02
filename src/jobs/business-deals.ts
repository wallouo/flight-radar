import type { DiscordWebhookClient } from "../clients/discord.js";
import type { DealExtractionClient } from "../clients/llm.js";
import type { RssClient } from "../clients/rss.js";
import type { BusinessDealRepository } from "../db/repositories.js";
import { qualifiesBusinessDealForAlert } from "../logic/business-deals.js";
import { buildBusinessDealEmbed } from "../notifications/business-deal-embed.js";
import { hashString } from "../utils/hash.js";
import { createStableId } from "../utils/id.js";
import {
  loadExchangeRates,
  updateExchangeRatesIfStale,
} from "../config/exchange-rates.js";

export interface BusinessDealsJobDeps {
  repository: BusinessDealRepository;
  rssClient: RssClient;
  extractionClient: DealExtractionClient;
  discordClient: DiscordWebhookClient;
  thresholdGbp: number;
  minimumConfidence: number;
  llmModel?: string;
}

export async function runBusinessDealsJob(
  deps: BusinessDealsJobDeps,
  feeds: Array<{ url: string; name: string }>
): Promise<void> {
  // Update exchange rates if stale
  await updateExchangeRatesIfStale();
  const exchangeRates = await loadExchangeRates();

  await deps.repository.deleteNonQualifyingDeals();

  for (const feed of feeds) {
    let items;

    try {
      items = await deps.rssClient.fetchFeedItems(feed.url, feed.name);
      console.log(`[jobs] business-deals successfully fetched ${items.length} items from ${feed.name}`);
    } catch (error) {
      console.error(`[jobs] business-deals failed to fetch RSS feed ${feed.name} (${feed.url})`);
      console.error(`[jobs] Error details:`, error);
      // 繼續處理其他 feeds，不要因為一個 feed 失敗就中斷整個 job
      continue;
    }

    for (const item of items) {
      const sourceLinkHash = hashString(item.link);
      const alreadySeen = await deps.repository.hasSeenDealLink(sourceLinkHash);

      if (alreadySeen) {
        continue;
      }

      const parsed = await deps.extractionClient.extractBusinessDeal(item);
      const qualifiesForAlert = qualifiesBusinessDealForAlert(
        parsed,
        deps.thresholdGbp,
        deps.minimumConfidence,
        exchangeRates
      );
      let discordMessageId: string | undefined;
      let alertSentAt: string | undefined;

      if (qualifiesForAlert) {
        const response = await deps.discordClient.sendEmbed(buildBusinessDealEmbed(item, parsed));
        discordMessageId = response.messageId;
        alertSentAt = new Date().toISOString();
      }

      await deps.repository.insertParsedDeal({
        id: createStableId("business_deal", sourceLinkHash),
        sourceFeed: item.feedName,
        sourceTitle: item.title,
        sourceSummary: item.summary,
        sourceLink: item.link,
        sourceLinkHash,
        publishedAt: item.publishedAt,
        llmModel: deps.llmModel,
        parsed,
        qualifiesForAlert,
        discordMessageId,
        alertSentAt
      });
    }
  }
}
