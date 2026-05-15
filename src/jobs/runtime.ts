import { buildDiscordWebhookPayload, createDiscordWebhookClient } from "../clients/discord.js";
import { createOpenAiDealExtractionClient } from "../clients/llm.js";
import { createRssClient } from "../clients/rss.js";
import { createSerpApiClient } from "../clients/serpapi.js";
import { getTursoConnectionConfig, loadEnvironment, type Environment } from "../config/env.js";
import { createTursoClient, createTursoRepository, type TursoRepository } from "../db/repositories.js";
import { buildSerpApiObservation } from "../logic/serpapi-normalization.js";
import { createPersistentJobRunner } from "./persistent-job-runner.js";
import { runBusinessDealsJob } from "./business-deals.js";
import { runNormalFaresJob } from "./normal-fares.js";

export type JobName = "normal-fares" | "business-deals";

export interface JobRunner {
  name: JobName;
  run(): Promise<void>;
}

export interface ApplicationRuntime {
  env: Environment;
  repository: TursoRepository;
}

export function createApplicationRuntime(input: NodeJS.ProcessEnv = process.env): ApplicationRuntime {
  const env = loadEnvironment(input);
  const client = createTursoClient(getTursoConnectionConfig(env));
  const repository = createTursoRepository(client);

  return {
    env,
    repository
  };
}

export async function runNormalFaresFromEnvironment(input: NodeJS.ProcessEnv = process.env): Promise<void> {
  await createNormalFaresJobRunner(input).run();
}

export async function runBusinessDealsFromEnvironment(input: NodeJS.ProcessEnv = process.env): Promise<void> {
  await createBusinessDealsJobRunner(input).run();
}

export function createNormalFaresJobRunner(input: NodeJS.ProcessEnv = process.env): JobRunner {
  const runtime = createApplicationRuntime(input);
  const serpApiClient = createSerpApiClient({
    apiKey: runtime.env.SERPAPI_API_KEY
  });
  const discordClient = createDiscordWebhookClient({
    webhookUrl: runtime.env.DISCORD_WEBHOOK_URL
  });

  return createPersistentJobRunner({
    repository: runtime.repository,
    runner: {
      name: "normal-fares",
      run: () => runNormalFaresJob({
        repository: runtime.repository,
        serpApiClient,
        discordClient,
        normalizeObservation: buildSerpApiObservation
      })
    },
    lockOwner: buildJobLockOwner("normal-fares"),
    leaseDurationMs: runtime.env.SCHEDULER_LEASE_DURATION_MS
  });
}

export function createBusinessDealsJobRunner(input: NodeJS.ProcessEnv = process.env): JobRunner {
  const runtime = createApplicationRuntime(input);
  const feeds = parseFeedConfigurations(runtime.env.RSS_FEED_URLS);

  if (!runtime.env.OPENAI_API_KEY) {
    return {
      name: "business-deals",
      async run(): Promise<void> {
        console.info("[jobs] business-deals skipped because OPENAI_API_KEY is not configured");
      }
    };
  }

  const rssClient = createRssClient();
  const discordClient = createDiscordWebhookClient({
    webhookUrl: runtime.env.DISCORD_WEBHOOK_URL
  });
  const extractionClient = createOpenAiDealExtractionClient({
    apiKey: runtime.env.OPENAI_API_KEY,
    model: runtime.env.OPENAI_MODEL
  });

  return createPersistentJobRunner({
    repository: runtime.repository,
    runner: {
      name: "business-deals",
      run: () => runBusinessDealsJob(
        {
          repository: runtime.repository,
          rssClient,
          extractionClient,
          discordClient,
          thresholdGbp: runtime.env.BUSINESS_DEAL_THRESHOLD_GBP,
          minimumConfidence: runtime.env.BUSINESS_DEAL_MIN_CONFIDENCE,
          llmModel: runtime.env.OPENAI_MODEL
        },
        feeds
      )
    },
    lockOwner: buildJobLockOwner("business-deals"),
    leaseDurationMs: runtime.env.SCHEDULER_LEASE_DURATION_MS
  });
}

export function parseFeedConfigurations(input: string): Array<{ url: string; name: string }> {
  const entries = input
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new Error("RSS_FEED_URLS must contain at least one feed URL");
  }

  return entries.map((entry, index) => {
      const separatorIndex = entry.indexOf("|");

      if (separatorIndex === -1) {
        return {
          url: entry,
          name: `feed-${index + 1}`
        };
      }

      const name = entry.slice(0, separatorIndex).trim();
      const url = entry.slice(separatorIndex + 1).trim();

      if (name.length === 0 || url.length === 0) {
        throw new Error(`Invalid RSS feed configuration: ${entry}`);
      }

      return { name, url };
    });
}

function buildJobLockOwner(jobName: JobName): string {
  return `${jobName}:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
}

export { buildDiscordWebhookPayload };
