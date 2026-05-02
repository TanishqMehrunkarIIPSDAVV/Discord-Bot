#!/usr/bin/env node

/**
 * MongoDB Status Checker
 * Shows current sync status and data information
 * 
 * Run: node scripts/checkStatus.js
 */

require("dotenv").config();

const {
  printSyncStatus,
  printFileSizes,
  printEnvironmentInfo,
} = require("../utils/statusMonitor");

async function main() {
  console.clear();
  console.log("\n🔍 Checking Discord Bot MongoDB Status...\n");

  try {
    await printSyncStatus();
    printFileSizes();
    printEnvironmentInfo();

    console.log("✅ Status check complete!\n");
  } catch (error) {
    console.error("❌ Error checking status:", error.message);
    process.exit(1);
  }
}

main();
