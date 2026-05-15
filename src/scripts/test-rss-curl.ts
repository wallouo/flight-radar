import { createRssClient } from "../clients/rss.js";

const FLYERTALK_RSS_URL = "https://www.flyertalk.com/forum/external.php?type=RSS2&forumids=740";

async function testFlyerTalkRss() {
  console.log("=== Testing FlyerTalk RSS with curl-cffi ===");
  console.log(`URL: ${FLYERTALK_RSS_URL}`);
  console.log("");

  const rssClient = createRssClient();

  try {
    const startTime = Date.now();
    const items = await rssClient.fetchFeedItems(FLYERTALK_RSS_URL, "flyertalk-test");
    const duration = Date.now() - startTime;

    console.log("");
    console.log(`✅ Success! Fetched ${items.length} items in ${duration}ms`);
    console.log("");
    console.log("=== First 3 Items ===");
    
    items.slice(0, 3).forEach((item, index) => {
      console.log(`\n[${index + 1}] ${item.title}`);
      console.log(`    Link: ${item.link}`);
      console.log(`    Published: ${item.publishedAt}`);
      console.log(`    Summary: ${item.summary?.slice(0, 100)}...`);
    });

    console.log("");
    console.log("=== Test Complete ===");
  } catch (error) {
    console.error("");
    console.error("❌ Test Failed:");
    if (error instanceof Error) {
      console.error(`   Error: ${error.message}`);
      if (error.cause) {
        console.error(`   Cause:`, error.cause);
      }
    } else {
      console.error(`   Unknown error:`, error);
    }
    process.exit(1);
  }
}

testFlyerTalkRss();
