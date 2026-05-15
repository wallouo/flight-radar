import test from "node:test";
import assert from "node:assert/strict";
import { createRssClient } from "./rss.js";

test("secretflying connection errors are surfaced in RSS client error message", async () => {
  const client = createRssClient({
    fetcher: async () => {
      const error = new Error("getaddrinfo ENOTFOUND www.secretflying.com");
      throw error;
    }
  });

  await assert.rejects(
    () => client.fetchFeedItems("https://www.secretflying.com/feed", "secretflying"),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /RSS request failed: getaddrinfo ENOTFOUND www\.secretflying\.com/);
      return true;
    }
  );
});
