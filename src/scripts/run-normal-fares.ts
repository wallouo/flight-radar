import "dotenv/config";
import { runNormalFaresFromEnvironment } from "../jobs/runtime.js";

async function main(): Promise<void> {
  console.log("[script] Starting normal fares scanner...");
  const startTime = Date.now();

  try {
    await runNormalFaresFromEnvironment();
    const duration = Date.now() - startTime;
    console.log(`[script] Normal fares scanner completed successfully in ${duration}ms`);
    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[script] Normal fares scanner failed after ${duration}ms`, error);
    process.exit(1);
  }
}

void main();
