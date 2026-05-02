/**
 * MongoDB Setup and Migration Script
 * Run: node scripts/setupMongoDB.js
 * 
 * This script:
 * 1. Connects to MongoDB Atlas
 * 2. Creates necessary collections
 * 3. Migrates existing data from JSON files
 * 4. Migrates config.json
 * 5. Creates database indexes for performance
 */

require("dotenv").config();

const {
  connectDB,
  disconnectDB,
  createIndexes,
  getCollection,
} = require("../utils/db");
const {
  migrateToMongoDB,
  migrateConfigToMongoDB,
} = require("../utils/dataSync");

async function setupMongoDB() {
  console.log("🚀 Starting MongoDB Setup & Migration...\n");

  // Step 1: Connect to MongoDB
  console.log("Step 1: Connecting to MongoDB Atlas...");
  const db = await connectDB();

  if (!db) {
    console.error(
      "\n❌ Failed to connect to MongoDB. Please check your MONGODB_URI in .env file."
    );
    console.error("\n📝 Setup instructions:");
    console.error("   1. Go to https://www.mongodb.com/cloud/atlas/register");
    console.error("   2. Create a free cluster");
    console.error("   3. Create a database user");
    console.error("   4. Copy the connection string");
    console.error("   5. Add it to .env as: MONGODB_URI=mongodb+srv://...");
    process.exit(1);
  }

  console.log("✅ MongoDB connected!\n");

  // Step 2: Create collections
  console.log("Step 2: Creating collections...");
  const collections = [
    "afk-state",
    "ai-conversation-history",
    "channel-names",
    "gradient-roles",
    "mod-cases",
    "quest-catalog",
    "quest-shop",
    "quest-state",
    "user-ratings",
    "vc-points",
    "bot-config",
  ];

  for (const collName of collections) {
    await getCollection(collName);
  }

  console.log("✅ Collections ready!\n");

  // Step 3: Create indexes
  console.log("Step 3: Creating database indexes...");
  await createIndexes();
  console.log("✅ Indexes created!\n");

  // Step 4: Migrate data
  console.log("Step 4: Migrating data from JSON files...");
  await migrateToMongoDB();
  console.log("✅ Data migrated!\n");

  // Step 5: Migrate config
  console.log("Step 5: Migrating config.json...");
  await migrateConfigToMongoDB();
  console.log("✅ Config migrated!\n");

  // Done
  await disconnectDB();
  console.log("✅ Setup complete! Your data is now synced to MongoDB Atlas.");
  console.log("\n📝 Important:");
  console.log("   • Data is automatically synced to both files and MongoDB");
  console.log("   • Files are the primary source, MongoDB is the backup");
  console.log("   • Run this script again anytime to update MongoDB with latest file data");
}

setupMongoDB().catch((error) => {
  console.error("❌ Setup failed:", error.message);
  process.exit(1);
});
