import { buildBusinessDealEmbed } from "./src/notifications/business-deal-embed.js";
import { discordEmbedSchema } from "./src/schemas/domain.js";
import type { RssItem, BusinessDealExtraction } from "./src/types/domain.js";

// Test case 1: Normal case
const normalItem: RssItem = {
  feedName: "SecretFlying",
  title: "London to Tokyo Business Class £899",
  summary: "Great deal on JAL",
  link: "https://example.com/deal1",
  publishedAt: "2026-05-14T10:00:00Z"
};

const normalDeal: BusinessDealExtraction = {
  origin: "London",
  destination: "Tokyo",
  priceText: "£899",
  priceAmount: 899,
  currencyCode: "GBP",
  cabinClass: "business",
  isLongHaul: true,
  isErrorFare: false,
  confidence: 0.95
};

// Test case 2: Missing optional fields
const minimalItem: RssItem = {
  feedName: "SecretFlying",
  title: "Business class deal",
  link: "https://example.com/deal2"
  // No summary, no publishedAt
};

const minimalDeal: BusinessDealExtraction = {
  origin: "NYC",
  destination: "Paris",
  priceText: "$1200",
  priceAmount: undefined,
  currencyCode: undefined,
  cabinClass: "business",
  isLongHaul: true,
  confidence: 0.8
};

console.log("=== Test 1: Normal case ===");
try {
  const embed1 = buildBusinessDealEmbed(normalItem, normalDeal);
  console.log("Generated embed:", JSON.stringify(embed1, null, 2));
  
  const validated1 = discordEmbedSchema.parse(embed1);
  console.log("✅ Validation passed");
} catch (error) {
  console.error("❌ Validation failed:", error);
}

console.log("\n=== Test 2: Minimal case ===");
try {
  const embed2 = buildBusinessDealEmbed(minimalItem, minimalDeal);
  console.log("Generated embed:", JSON.stringify(embed2, null, 2));
  
  const validated2 = discordEmbedSchema.parse(embed2);
  console.log("✅ Validation passed");
} catch (error) {
  console.error("❌ Validation failed:", error);
}
