#!/usr/bin/env node

/**
 * 驗證 GitHub Actions 遷移是否完成
 */

import { existsSync } from "fs";
import { join } from "path";

const requiredFiles = [
  ".github/workflows/business-deals.yml",
  ".github/workflows/normal-fares.yml",
  "src/scripts/run-business-deals.ts",
  "src/scripts/run-normal-fares.ts",
  "GITHUB_ACTIONS_SETUP.md",
  "MIGRATION_SUMMARY.md"
];

console.log("🔍 驗證 GitHub Actions 遷移...\n");

let allFilesExist = true;

for (const file of requiredFiles) {
  const exists = existsSync(file);
  const status = exists ? "✅" : "❌";
  console.log(`${status} ${file}`);
  
  if (!exists) {
    allFilesExist = false;
  }
}

console.log("\n" + "=".repeat(50));

if (allFilesExist) {
  console.log("✅ 所有必要檔案都已建立！");
  console.log("\n下一步：");
  console.log("1. 執行 'npm run build' 建置專案");
  console.log("2. 執行 'npm run typecheck' 檢查型別");
  console.log("3. 參考 GITHUB_ACTIONS_SETUP.md 設定 GitHub Secrets");
  console.log("4. 推送程式碼到 GitHub");
  process.exit(0);
} else {
  console.log("❌ 部分檔案缺失，請檢查上方列表");
  process.exit(1);
}
