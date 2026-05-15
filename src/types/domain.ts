import type { z } from "zod";
import {
  businessDealExtractionSchema,
  discordEmbedSchema,
  normalizedFareObservationSchema,
  rssItemSchema,
  serpApiFlightResultSchema,
  trackedDestinationSchema
} from "../schemas/domain.js";

export type TrackedDestination = z.infer<typeof trackedDestinationSchema>;
export type SerpApiFlightResult = z.infer<typeof serpApiFlightResultSchema>;
export type NormalizedFareObservation = z.infer<typeof normalizedFareObservationSchema>;
export type RssItem = z.infer<typeof rssItemSchema>;
export type BusinessDealExtraction = z.infer<typeof businessDealExtractionSchema>;
export type DiscordEmbed = z.infer<typeof discordEmbedSchema>;
