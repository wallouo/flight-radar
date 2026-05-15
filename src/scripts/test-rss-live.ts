import { config as loadDotEnv } from "dotenv";
import { createRssClient } from "../clients/rss.js";
import { loadEnvironment } from "../config/env.js";
import { parseFeedConfigurations } from "../jobs/runtime.js";

loadDotEnv();

async function main(): Promise<void> {
  const env = loadEnvironment(process.env);
  const feeds = parseFeedConfigurations(env.RSS_FEED_URLS);
  const rssClient = createRssClient();

  for (const feed of feeds) {
    const startedAt = Date.now();

    try {
      const items = await rssClient.fetchFeedItems(feed.url, feed.name);
      const durationMs = Date.now() - startedAt;

      console.log(`[${feed.name}] success: fetched ${items.length} items in ${durationMs}ms`);
      console.log(`Parsed items:`);
      console.dir(items, { depth: null, colors: true });
      return;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      console.error(`[${feed.name}] failed after ${durationMs}ms`);
      console.error(error);
    }
  }

  process.exitCode = 1;
  console.error("All RSS feeds from RSS_FEED_URLS failed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});