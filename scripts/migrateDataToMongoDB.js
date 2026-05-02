/**
 * Data Migration Script
 * Migrates all existing data from JSON files to MongoDB Atlas
 * Run: node scripts/migrateDataToMongoDB.js
 */

require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { connectDB, disconnectDB, saveDocument, getCollection } = require("../utils/db");

async function migrateAllData() {
  console.log("📦 Starting Data Migration to MongoDB...\n");

  // Connect to DB
  const db = await connectDB();
  if (!db) {
    console.error("❌ Failed to connect to MongoDB");
    process.exit(1);
  }

  const dataDir = path.join(__dirname, "..", "data");
  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"));

  console.log(`Found ${files.length} data files to migrate:\n`);

  let successCount = 0;

  for (const file of files) {
    const collectionName = file.replace(".json", "");
    const filePath = path.join(dataDir, file);

    try {
      const rawData = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(rawData);

      const fileSize = fs.statSync(filePath).size;
      const fileSizeKB = (fileSize / 1024).toFixed(2);

      // Save to MongoDB
      const success = await saveDocument(collectionName, { _id: "main" }, data);

      if (success) {
        console.log(`✅ ${collectionName.padEnd(30)} (${fileSizeKB} KB)`);
        successCount++;
      } else {
        console.log(`⚠️  ${collectionName.padEnd(30)} (Save returned false)`);
      }
    } catch (error) {
      console.log(`❌ ${collectionName.padEnd(30)} (${error.message})`);
    }
  }

  console.log(`\n📊 Migration Summary:`);
  console.log(`   Success: ${successCount}/${files.length}`);

  // Migrate config.json
  try {
    const configPath = path.join(__dirname, "..", "config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const success = await saveDocument("bot-config", { _id: "main" }, config);

    if (success) {
      console.log(`   Config: ✅`);
    }
  } catch (error) {
    console.log(`   Config: ❌ (${error.message})`);
  }

  await disconnectDB();
  console.log(`\n✅ Migration complete!`);
}

migrateAllData().catch((error) => {
  console.error("❌ Migration failed:", error);
  process.exit(1);
});
