import type { Environment } from "../config/env.js";
import type { JobRunner } from "./runtime.js";

export interface ScheduledJobDefinition {
  name: JobRunner["name"];
  cron: string;
  runner: JobRunner;
}

export interface CronScheduler {
  schedule(definition: ScheduledJobDefinition): void;
  start(): void;
  stop?(): Promise<void> | void;
}

export interface StartupJobExecution {
  runner: JobRunner;
  enabled: boolean;
}

export interface ScheduleApplicationJobsInput {
  scheduler: CronScheduler;
  jobs: ScheduledJobDefinition[];
}

export interface ApplicationJobSchedulePlan {
  scheduledJobs: ScheduledJobDefinition[];
  startupJobs: StartupJobExecution[];
}

export function scheduleApplicationJobs(input: ScheduleApplicationJobsInput): void {
  for (const job of input.jobs) {
    input.scheduler.schedule(job);
  }

  input.scheduler.start();
}

export function buildApplicationJobSchedulePlan(input: {
  env: Environment;
  normalFaresRunner: JobRunner;
  businessDealsRunner: JobRunner;
}): ApplicationJobSchedulePlan {
  // Note: Local scheduling is deprecated. Use GitHub Actions for production.
  // These defaults are only for local development.
  return {
    scheduledJobs: [
      {
        name: input.normalFaresRunner.name,
        cron: "0 */6 * * *", // Every 6 hours (default)
        runner: input.normalFaresRunner
      },
      {
        name: input.businessDealsRunner.name,
        cron: "0 */2 * * *", // Every 2 hours (default)
        runner: input.businessDealsRunner
      }
    ],
    startupJobs: [
      {
        runner: input.normalFaresRunner,
        enabled: true // Run on startup by default
      },
      {
        runner: input.businessDealsRunner,
        enabled: true // Run on startup by default
      }
    ]
  };
}

export async function runStartupJobs(jobs: StartupJobExecution[]): Promise<void> {
  for (const job of jobs) {
    if (!job.enabled) {
      continue;
    }

    await job.runner.run();
  }
}
