import "dotenv/config";
import { startApplication } from "./jobs/app.js";

void startApplication().catch((error) => {
  console.error("[app] failed to start application", error);
  process.exitCode = 1;
});
