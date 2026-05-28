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
  // Scheduling rationale:
  //
  // normal-fares  → every 12 hours (configurable via NORMAL_FARES_CRON)
  //   Phase 1 (calendar) = 1 API call per destination. Very cheap.
  //   Phase 2 (detail)   = up to MAX_PHASE2_DATES_PER_DESTINATION calls
  //                        per destination, only when calendar finds a deal.
  //   2× / day keeps prices reasonably fresh within SerpAPI free-tier limits.
  //   Bump to "0 */6 * * *" if you have a paid plan and want faster alerts.
  //
  // business-deals → every 2 hours (RSS-driven, no SerpAPI cost).
  return {
    scheduledJobs: [
      {
        name: input.normalFaresRunner.name,
        cron: input.env.NORMAL_FARES_CRON,
        runner: input.normalFaresRunner
      },
      {
        name: input.businessDealsRunner.name,
        cron: input.env.BUSINESS_DEALS_CRON,
        runner: input.businessDealsRunner
      }
    ],
    startupJobs: [
      {
        runner: input.normalFaresRunner,
        enabled: input.env.RUN_NORMAL_FARES_ON_STARTUP
      },
      {
        runner: input.businessDealsRunner,
        enabled: input.env.RUN_BUSINESS_DEALS_ON_STARTUP
      }
    ]
  };
}

export async function runStartupJobs(jobs: StartupJobExecution[]): Promise<void> {
  for (const job of jobs) {
    if (!job.enabled) continue;
    await job.runner.run();
  }
}
