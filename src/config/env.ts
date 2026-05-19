import { z } from "zod";
import type { TursoConnectionConfig } from "../db/repositories.js";

export const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().min(1),
  TURSO_URL: z.string().min(1).optional(),
  TURSO_AUTH_TOKEN: z.string().min(1).optional(),
  // Single key (legacy). If SERPAPI_API_KEYS is also set, KEYS takes precedence.
  SERPAPI_API_KEY: z.string().min(1).optional(),
  // Comma-separated list of SerpAPI keys. Pool rotates on 429 / monthly limit.
  SERPAPI_API_KEYS: z.string().min(1).optional(),
  SCRAPERAPI_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
  GROQ_API_KEY: z.string().min(1).optional(),
  RSS_FEED_URLS: z.string().min(1),
  DISCORD_WEBHOOK_URL: z.string().url(),
  BUSINESS_DEAL_THRESHOLD_GBP: z.coerce.number().int().positive().default(1000),
  BUSINESS_DEAL_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),
  SCHEDULER_LEASE_DURATION_MS: z.coerce.number().int().positive().default(30 * 60 * 1000),
  NORMAL_FARES_CRON: z.string().min(1).default("0 */12 * * *"),
  BUSINESS_DEALS_CRON: z.string().min(1).default("0 */2 * * *"),
  RUN_NORMAL_FARES_ON_STARTUP: z.coerce.boolean().default(true),
  RUN_BUSINESS_DEALS_ON_STARTUP: z.coerce.boolean().default(true)
})
  .refine(
    (env) => Boolean(env.SERPAPI_API_KEY ?? env.SERPAPI_API_KEYS),
    { message: "Either SERPAPI_API_KEY or SERPAPI_API_KEYS must be set" }
  )
  .transform((env) => ({
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
