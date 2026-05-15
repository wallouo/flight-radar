import { bootstrapApplication, type ApplicationBootstrapResult } from "./bootstrap.js";
import { createInMemoryCronScheduler, type InMemoryCronScheduler } from "./in-memory-scheduler.js";
import type { JobRunner } from "./runtime.js";

export interface StartApplicationOptions {
  processEnv?: NodeJS.ProcessEnv;
  scheduler?: InMemoryCronScheduler;
  onJobError?: (error: unknown, job: JobRunner) => void;
  logger?: Pick<Console, "info" | "error">;
  shutdownSignals?: NodeJS.Signals[];
}

export interface StartedApplication extends ApplicationBootstrapResult {
  scheduler: InMemoryCronScheduler;
  stop: () => Promise<void>;
}

const DEFAULT_SHUTDOWN_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export async function startApplication(options: StartApplicationOptions = {}): Promise<StartedApplication> {
  const scheduler = options.scheduler ?? createInMemoryCronScheduler();
  const logger = options.logger ?? console;
  const shutdownSignals = options.shutdownSignals ?? DEFAULT_SHUTDOWN_SIGNALS;

  const result = await bootstrapApplication({
    scheduler,
    processEnv: options.processEnv,
    onJobError: (error, job) => {
      logger.error(`[jobs] ${job.name} failed`, error);
      options.onJobError?.(error, job);
    }
  });

  let stoppingPromise: Promise<void> | null = null;

  const stop = async (): Promise<void> => {
    if (stoppingPromise) {
      return stoppingPromise;
    }

    stoppingPromise = (async () => {
      logger.info("[app] stopping scheduler");
      await scheduler.stop?.();
      removeShutdownHandlers();
      logger.info("[app] scheduler stopped");
    })();

    return stoppingPromise;
  };

  const shutdownHandlers = new Map<NodeJS.Signals, () => void>();

  const removeShutdownHandlers = (): void => {
    for (const [signal, handler] of shutdownHandlers) {
      process.off(signal, handler);
    }

    shutdownHandlers.clear();
  };

  for (const signal of shutdownSignals) {
    const handler = () => {
      logger.info(`[app] received ${signal}`);
      void stop().catch((error) => {
        logger.error("[app] failed to stop scheduler", error);
      });
    };

    shutdownHandlers.set(signal, handler);
    process.on(signal, handler);
  }

  logger.info(`[jobs] scheduler started with ${scheduler.scheduledJobs.length} job(s)`);

  return {
    ...result,
    scheduler,
    stop
  };
}
