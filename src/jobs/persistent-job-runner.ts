import type { SchedulerStateRepository } from "../db/repositories.js";
import type { JobRunner } from "./runtime.js";

export interface PersistentJobRunnerOptions {
  repository: SchedulerStateRepository;
  runner: JobRunner;
  lockOwner: string;
  leaseDurationMs: number;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

export function createPersistentJobRunner(options: PersistentJobRunnerOptions): JobRunner {
  const logger = options.logger ?? console;

  return {
    name: options.runner.name,
    async run(): Promise<void> {
      const now = new Date();
      const lockedUntil = new Date(now.getTime() + options.leaseDurationMs);

      const acquired = await options.repository.tryAcquireJobLease({
        jobName: options.runner.name,
        lockOwner: options.lockOwner,
        lockedUntil: lockedUntil.toISOString(),
        now: now.toISOString()
      });

      if (!acquired) {
        const state = await options.repository.getJobState(options.runner.name);
        logger.info(
          `[jobs] skipped ${options.runner.name}: lease not acquired` +
            formatLeaseDebugSuffix(state)
        );
        return;
      }

      logger.info(
        `[jobs] acquired lease for ${options.runner.name} ` +
          `(owner=${options.lockOwner}, until=${lockedUntil.toISOString()})`
      );

      try {
        await options.runner.run();
        const finishedAt = new Date().toISOString();
        await options.repository.completeJobLease({
          jobName: options.runner.name,
          lockOwner: options.lockOwner,
          finishedAt,
          succeededAt: finishedAt
        });
        logger.info(`[jobs] completed ${options.runner.name} successfully`);
      } catch (error) {
        const finishedAt = new Date().toISOString();
        await options.repository.completeJobLease({
          jobName: options.runner.name,
          lockOwner: options.lockOwner,
          finishedAt,
          failedAt: finishedAt,
          lastError: serializeError(error)
        });
        logger.error(`[jobs] completed ${options.runner.name} with failure`, error);
        throw error;
      }
    }
  };
}

function formatLeaseDebugSuffix(
  state: Awaited<ReturnType<SchedulerStateRepository["getJobState"]>>
): string {
  if (!state) {
    return " (no persisted state found)";
  }

  return ` (owner=${state.lockOwner ?? "none"}, lockedUntil=${state.lockedUntil ?? "none"}, lastStartedAt=${state.lastStartedAt ?? "none"})`;
}

function serializeError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
