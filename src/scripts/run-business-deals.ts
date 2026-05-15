import "dotenv/config";
import { runBusinessDealsFromEnvironment } from "../jobs/runtime.js";

async function main(): Promise<void> {
  console.log("[script] Starting business deals scanner...");
  const startTime = Date.now();

  try {
    await runBusinessDealsFromEnvironment();
    const duration = Date.now() - startTime;
    console.log(`[script] Business deals scanner completed successfully in ${duration}ms`);
    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[script] Business deals scanner failed after ${duration}ms`, error);
    process.exit(1);
  }
}

void main();
