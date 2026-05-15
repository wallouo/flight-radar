import "dotenv/config";
import { createDiscordWebhookClient } from "../clients/discord.js";
import { createOpenAiDealExtractionClient } from "../clients/llm.js";
import { createRssClient } from "../clients/rss.js";
import { loadEnvironment, getTursoConnectionConfig } from "../config/env.js";
import { loadExchangeRates } from "../config/exchange-rates.js";
import { createTursoClient, createTursoRepository } from "../db/repositories.js";
import { parseFeedConfigurations } from "../jobs/runtime.js";
import { qualifiesBusinessDealForAlert } from "../logic/business-deals.js";
import { buildBusinessDealEmbed } from "../notifications/business-deal-embed.js";
import { hashString } from "../utils/hash.js";
import { createStableId } from "../utils/id.js";

async function main(): Promise<void> {
  const env = loadEnvironment();

  if (!env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is required for this script");
  }

  const feeds = parseFeedConfigurations(env.RSS_FEED_URLS);
  const feed = feeds[0];

  if (!feed) {
    throw new Error("RSS_FEED_URLS must contain at least one feed URL");
  }

  const rssClient = createRssClient();
  const extractionClient = createOpenAiDealExtractionClient({
    apiKey: env.OPENAI_API_KEY,
    model: env.OPENAI_MODEL
  });
  const repository = createTursoRepository(createTursoClient(getTursoConnectionConfig(env)));
  const discordClient = createDiscordWebhookClient({
    webhookUrl: env.DISCORD_WEBHOOK_URL
  });

  const items = await rssClient.fetchFeedItems(feed.url, feed.name);

  if (items.length === 0) {
    console.log(`No RSS items fetched from [${feed.name}] ${feed.url}.`);
    return;
  }

  console.log(`Fetched ${items.length} RSS items from [${feed.name}] ${feed.url}.`);

  const item = items[0];
  const sourceLinkHash = hashString(item.link);
  const alreadySeen = await repository.hasSeenDealLink(sourceLinkHash);

  console.log(`Testing first item: ${item.title}`);
  console.log(`Already seen: ${alreadySeen}`);

  const parsed = await extractionClient.extractBusinessDeal(item);
  console.log("Parsed deal:");
  console.dir(parsed, { depth: null, colors: true });

  const exchangeRates = await loadExchangeRates();

  const qualifiesForAlert = qualifiesBusinessDealForAlert(
    parsed,
    env.BUSINESS_DEAL_THRESHOLD_GBP,
    env.BUSINESS_DEAL_MIN_CONFIDENCE,
    exchangeRates
  );

  console.log(`Qualifies for alert: ${qualifiesForAlert}`);

  let discordMessageId: string | undefined;
  let alertSentAt: string | undefined;

  if (qualifiesForAlert) {
    const response = await discordClient.sendEmbed(buildBusinessDealEmbed(item, parsed));
    discordMessageId = response.messageId;
    alertSentAt = new Date().toISOString();
    console.log(`Discord sent. messageId=${discordMessageId ?? "<none>"}`);
  } else {
    console.log("Discord not sent because item did not qualify.");
  }

  if (!alreadySeen) {
    await repository.insertParsedDeal({
      id: createStableId("business_deal", sourceLinkHash),
      sourceFeed: item.feedName,
      sourceTitle: item.title,
      sourceSummary: item.summary,
      sourceLink: item.link,
      sourceLinkHash,
      publishedAt: item.publishedAt,
      llmModel: env.OPENAI_MODEL,
      parsed,
      qualifiesForAlert,
      discordMessageId,
      alertSentAt
    });

    console.log("Inserted parsed deal into database.");
  } else {
    console.log("Skipped DB insert because link already exists.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
