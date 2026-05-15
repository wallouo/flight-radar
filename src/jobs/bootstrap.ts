import { buildApplicationJobSchedulePlan, runStartupJobs, scheduleApplicationJobs, type CronScheduler } from "./scheduler.js";
import {
  createApplicationRuntime,
  createBusinessDealsJobRunner,
  createNormalFaresJobRunner,
  type JobRunner
} from "./runtime.js";

export interface ApplicationBootstrapOptions {
  scheduler: CronScheduler;
  processEnv?: NodeJS.ProcessEnv;
  onJobError?: (error: unknown, job: JobRunner) => void;
}

export interface ApplicationBootstrapResult {
  runtime: ReturnType<typeof createApplicationRuntime>;
  runners: {
    normalFares: JobRunner;
    businessDeals: JobRunner;
  };
}

export async function bootstrapApplication(options: ApplicationBootstrapOptions): Promise<ApplicationBootstrapResult> {
  const runtime = createApplicationRuntime(options.processEnv);
  const normalFares = createNormalFaresJobRunner(options.processEnv);
  const businessDeals = createBusinessDealsJobRunner(options.processEnv);
  const plan = buildApplicationJobSchedulePlan({
    env: runtime.env,
    normalFaresRunner: wrapJobRunner(normalFares, options.onJobError),
    businessDealsRunner: wrapJobRunner(businessDeals, options.onJobError)
  });

  scheduleApplicationJobs({
    scheduler: options.scheduler,
    jobs: plan.scheduledJobs
  });

  await runStartupJobs(plan.startupJobs);

  return {
    runtime,
    runners: {
      normalFares,
      businessDeals
    }
  };
}

function wrapJobRunner(runner: JobRunner, onJobError?: (error: unknown, job: JobRunner) => void): JobRunner {
  if (!onJobError) {
    return runner;
  }

  return {
    name: runner.name,
    async run(): Promise<void> {
      try {
        await runner.run();
      } catch (error) {
        onJobError(error, runner);
        throw error;
      }
    }
  };
}
