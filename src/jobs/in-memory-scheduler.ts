import type { ScheduledJobDefinition, CronScheduler } from "./scheduler.js";

export interface InMemoryScheduledJobState {
  running: boolean;
  runCount: number;
  successCount: number;
  failureCount: number;
  skipCount: number;
  lastStartedAt: Date | null;
  lastFinishedAt: Date | null;
  lastSucceededAt: Date | null;
  lastFailedAt: Date | null;
  lastError: unknown;
  nextRunAt: Date | null;
}

export interface InMemoryScheduledJob {
  definition: ScheduledJobDefinition;
  intervalMs: number;
  state: InMemoryScheduledJobState;
}

export interface InMemoryCronScheduler extends CronScheduler {
  readonly scheduledJobs: InMemoryScheduledJob[];
  readonly started: boolean;
  readonly stopped: boolean;
}

export function createInMemoryCronScheduler(): InMemoryCronScheduler {
  const entries: InternalScheduledJob[] = [];
  let started = false;
  let stopped = false;

  const scheduleNext = (entry: InternalScheduledJob): void => {
    if (!started || stopped) {
      entry.state.nextRunAt = null;
      return;
    }

    const nextRunAt = new Date(Date.now() + entry.intervalMs);
    entry.state.nextRunAt = nextRunAt;
    entry.timer = setTimeout(() => {
      void executeEntry(entry);
    }, entry.intervalMs);
  };

  const executeEntry = async (entry: InternalScheduledJob): Promise<void> => {
    if (stopped) {
      entry.state.nextRunAt = null;
      return;
    }

    entry.timer = null;
    entry.state.nextRunAt = null;

    if (entry.state.running) {
      entry.state.skipCount += 1;
      scheduleNext(entry);
      return;
    }

    entry.state.running = true;
    entry.state.runCount += 1;
    entry.state.lastStartedAt = new Date();

    try {
      await entry.definition.runner.run();
      entry.state.successCount += 1;
      entry.state.lastSucceededAt = new Date();
      entry.state.lastError = null;
    } catch (error) {
      entry.state.failureCount += 1;
      entry.state.lastFailedAt = new Date();
      entry.state.lastError = error;
    } finally {
      entry.state.running = false;
      entry.state.lastFinishedAt = new Date();
      scheduleNext(entry);
    }
  };

  return {
    get scheduledJobs(): InMemoryScheduledJob[] {
      return entries;
    },
    get started(): boolean {
      return started;
    },
    get stopped(): boolean {
      return stopped;
    },
    schedule(definition: ScheduledJobDefinition): void {
      if (started) {
        throw new Error("Cannot schedule jobs after scheduler has started");
      }

      entries.push({
        definition,
        intervalMs: convertCronToIntervalMs(definition.cron),
        timer: null,
        state: createInitialJobState()
      });
    },
    start(): void {
      if (started) {
        return;
      }

      started = true;
      stopped = false;

      for (const entry of entries) {
        scheduleNext(entry);
      }
    },
    async stop(): Promise<void> {
      if (stopped) {
        return;
      }

      stopped = true;
      started = false;

      for (const entry of entries) {
        if (entry.timer !== null) {
          clearTimeout(entry.timer);
          entry.timer = null;
        }

        entry.state.nextRunAt = null;
      }

      await waitForRunningJobsToFinish(entries);
    }
  };
}

interface InternalScheduledJob extends InMemoryScheduledJob {
  timer: ReturnType<typeof setTimeout> | null;
}

function createInitialJobState(): InMemoryScheduledJobState {
  return {
    running: false,
    runCount: 0,
    successCount: 0,
    failureCount: 0,
    skipCount: 0,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSucceededAt: null,
    lastFailedAt: null,
    lastError: null,
    nextRunAt: null
  };
}

async function waitForRunningJobsToFinish(entries: InternalScheduledJob[]): Promise<void> {
  while (entries.some((entry) => entry.state.running)) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });
  }
}

function convertCronToIntervalMs(cron: string): number {
  const trimmed = cron.trim();
  const parts = trimmed.split(/\s+/);

  if (parts.length !== 5) {
    throw new Error(`Unsupported cron expression: ${cron}`);
  }

  const minuteField = parts[0];
  const hourField = parts[1];

  if (minuteField.startsWith("*/")) {
    const minutes = parsePositiveInteger(minuteField.slice(2), cron);
    return minutes * 60_000;
  }

  if (minuteField === "0" && hourField.startsWith("*/")) {
    const hours = parsePositiveInteger(hourField.slice(2), cron);
    return hours * 60 * 60_000;
  }

  if (minuteField === "0" && hourField === "*") {
    return 60 * 60_000;
  }

  throw new Error(`Unsupported cron expression: ${cron}`);
}

function parsePositiveInteger(value: string, cron: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Unsupported cron expression: ${cron}`);
  }

  return parsed;
}
