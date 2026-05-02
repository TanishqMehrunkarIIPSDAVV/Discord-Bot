/**
 * Database Status & Monitoring Utilities
 * Check the health and status of your MongoDB connection
 */

const { isDatabaseConnected, getDB } = require("./db");
const { getDataFiles } = require("./dataSync");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Get complete sync status
 */
async function getSyncStatus() {
  const status = {
    timestamp: new Date().toISOString(),
    mongodb: {
      connected: isDatabaseConnected(),
      status: isDatabaseConnected() ? "✅ Connected" : "⚠️  Disconnected",
    },
    files: {
      dataDir: path.join(__dirname, "..", "data"),
      exists: fs.existsSync(path.join(__dirname, "..", "data")),
      files: getDataFiles(),
      count: getDataFiles().length,
    },
    config: {
      path: path.join(__dirname, "..", "config.json"),
      exists: fs.existsSync(path.join(__dirname, "..", "config.json")),
    },
    environment: {
      mongoUriSet: !!process.env.MONGODB_URI,
      nodeEnv: process.env.NODE_ENV || "development",
    },
  };

  return status;
}

/**
 * Print formatted sync status
 */
async function printSyncStatus() {
  const status = await getSyncStatus();

  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║        DISCORD BOT - DATA SYNC STATUS              ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  // MongoDB Status
  console.log("📊 MONGODB STATUS");
  console.log(`   ${status.mongodb.status}`);
  if (status.mongodb.connected) {
    console.log("   ✓ Cloud backup enabled");
    console.log("   ✓ Database: discord-bot");
  } else {
    console.log("   ⚠️  Set MONGODB_URI in .env to enable");
  }

  // File Storage Status
  console.log("\n💾 FILE STORAGE STATUS");
  console.log(`   ${status.files.exists ? "✅" : "❌"} Data directory exists`);
  console.log(`   📁 Location: ${status.files.dataDir}`);
  console.log(`   📄 Files: ${status.files.count}`);

  if (status.files.count > 0) {
    console.log("   Files synced:");
    status.files.files.forEach((file) => {
      const filePath = path.join(status.files.dataDir, file);
      const stats = fs.statSync(filePath);
      const sizeKB = (stats.size / 1024).toFixed(2);
      console.log(`      • ${file.padEnd(30)} (${sizeKB} KB)`);
    });
  }

  // Config Status
  console.log("\n⚙️  CONFIGURATION");
  console.log(`   ${status.config.exists ? "✅" : "❌"} config.json exists`);
  console.log(`   ${status.environment.mongoUriSet ? "✅" : "⚠️"} MONGODB_URI set`);

  // Summary
  console.log("\n📈 SYNC SUMMARY");
  if (status.mongodb.connected) {
    console.log("   ✅ Dual storage active");
    console.log("   ✅ Data saved to files AND MongoDB");
    console.log("   ✅ Full redundancy enabled");
  } else {
    console.log("   ⚠️  File storage only");
    console.log("   ⚠️  Set MONGODB_URI to enable cloud backup");
  }

  console.log("\n");
}

/**
 * Get file sizes info
 */
function getFileSizes() {
  const dataDir = path.join(__dirname, "..", "data");
  const files = getDataFiles();

  const sizes = {};
  let totalSize = 0;

  files.forEach((file) => {
    const filePath = path.join(dataDir, file);
    const stats = fs.statSync(filePath);
    sizes[file] = {
      bytes: stats.size,
      kb: (stats.size / 1024).toFixed(2),
      mb: (stats.size / (1024 * 1024)).toFixed(4),
    };
    totalSize += stats.size;
  });

  return {
    files: sizes,
    total: {
      bytes: totalSize,
      kb: (totalSize / 1024).toFixed(2),
      mb: (totalSize / (1024 * 1024)).toFixed(4),
    },
  };
}

/**
 * Print file sizes
 */
function printFileSizes() {
  const sizes = getFileSizes();

  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║        DATA FILES - SIZE INFORMATION               ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  Object.entries(sizes.files).forEach(([file, size]) => {
    console.log(`   ${file.padEnd(30)} ${size.kb.padStart(8)} KB`);
  });

  console.log(`\n   ${"TOTAL".padEnd(30)} ${sizes.total.kb.padStart(8)} KB`);
  console.log("\n");
}

/**
 * Get environment info
 */
function getEnvironmentInfo() {
  return {
    nodeVersion: process.version,
    platform: process.platform,
    mongoURI: process.env.MONGODB_URI ? "✅ Set" : "❌ Not set",
    discordToken: process.env.DISCORD_TOKEN || process.env.TOKEN ? "✅ Set" : "❌ Not set",
    env: process.env.NODE_ENV || "development",
  };
}

/**
 * Print environment info
 */
function printEnvironmentInfo() {
  const info = getEnvironmentInfo();

  console.log("\n╔════════════════════════════════════════════════════╗");
  console.log("║        ENVIRONMENT INFORMATION                     ║");
  console.log("╚════════════════════════════════════════════════════╝\n");

  console.log(`   Node Version: ${info.nodeVersion}`);
  console.log(`   Platform: ${info.platform}`);
  console.log(`   Environment: ${info.env}`);
  console.log(`   Discord Token: ${info.discordToken}`);
  console.log(`   MongoDB URI: ${info.mongoURI}`);
  console.log("\n");
}

module.exports = {
  getSyncStatus,
  printSyncStatus,
  getFileSizes,
  printFileSizes,
  getEnvironmentInfo,
  printEnvironmentInfo,
};
