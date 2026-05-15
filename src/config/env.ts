import { z } from "zod";
import type { TursoConnectionConfig } from "../db/repositories.js";

export const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().min(1),
  TURSO_URL: z.string().min(1).optional(),
  TURSO_AUTH_TOKEN: z.string().min(1).optional(),
  SERPAPI_API_KEY: z.string().min(1),
  SCRAPERAPI_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  GROQ_API_KEY: z.string().min(1).optional(),
  RSS_FEED_URLS: z.string().min(1),
  DISCORD_WEBHOOK_URL: z.string().url(),
  BUSINESS_DEAL_THRESHOLD_GBP: z.coerce.number().int().positive().default(1000),
  BUSINESS_DEAL_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  SCHEDULER_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30 * 60 * 1000)
}).transform((env) => ({
  ...env,
  DATABASE_URL: env.TURSO_URL ?? env.DATABASE_URL,
  DATABASE_AUTH_TOKEN: env.TURSO_AUTH_TOKEN ?? env.DATABASE_AUTH_TOKEN
}));

export type Environment = z.infer<typeof environmentSchema>;

export function loadEnvironment(input: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(input);
}

export function getTursoConnectionConfig(env: Environment): TursoConnectionConfig {
  return {
    url: env.DATABASE_URL,
    authToken: env.DATABASE_AUTH_TOKEN
  };
}

