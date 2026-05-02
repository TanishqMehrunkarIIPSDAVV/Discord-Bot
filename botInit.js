/**
 * Bot Initialization Module
 * Handles MongoDB connection and data migration on startup
 */

const { connectDB, isDatabaseConnected, createIndexes } = require("./utils/db");
const {
  migrateToMongoDB,
  migrateConfigToMongoDB,
  startFileSyncWatchers,
} = require("./utils/dataSync");

let isInitialized = false;

/**
 * Initialize the bot with MongoDB support
 * Call this once on startup
 */
async function initializeBot() {
  if (isInitialized) {
    console.log("✅ Bot already initialized");
    return true;
  }

  console.log("\n🚀 Initializing Discord Bot with MongoDB Support...\n");

  // Step 1: Connect to MongoDB
  console.log("[1/3] Connecting to MongoDB Atlas...");
  const db = await connectDB();

  if (!db) {
    console.warn(
      "⚠️  MongoDB not available. Bot will use file-based storage only."
    );
    console.warn("    Set MONGODB_URI in .env to enable cloud backup.\n");
    isInitialized = true;
    return true;
  }

  // Step 2: Create indexes
  console.log("[2/3] Setting up database indexes...");
  await createIndexes();

  // Step 3: Migrate data (if needed)
  console.log("[3/3] Syncing data to MongoDB...");
  try {
    await migrateToMongoDB();
    await migrateConfigToMongoDB();
    startFileSyncWatchers();
  } catch (error) {
    console.warn("⚠️  Could not sync data:", error.message);
  }

  console.log(
    "\n✅ Bot initialized! Data is synced between files and MongoDB.\n"
  );

  isInitialized = true;
  return true;
}

/**
 * Check if MongoDB is available
 */
function isMongoDBAvailable() {
  return isDatabaseConnected();
}

module.exports = {
  initializeBot,
  isMongoDBAvailable,
};
