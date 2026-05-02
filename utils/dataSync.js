/**
 * Dual Storage Sync Service
 * Synchronizes data between JSON files and MongoDB Atlas
 * Writes to both systems for redundancy
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  saveDocument,
  getDocument,
  isDatabaseConnected,
} = require("./db");

const DATA_DIR = path.join(__dirname, "..", "data");
const CONFIG_PATH = path.join(__dirname, "..", "config.json");
const ROOT_SYNC_FILES = [path.join(__dirname, "..", "scheduledRemovals.json")];
const DB_SYNC_INTERVAL_MS = 30 * 60 * 1000;
const watchedFiles = new Set();
const debounceTimers = new Map();
const dirtyFiles = new Set();
let fileWatchersStarted = false;
let dataDirectoryWatcher = null;
let dbSyncInterval = null;
let isSyncInProgress = false;

/**
 * Ensure data directory exists
 */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getCollectionFromFilePath(filePath) {
  if (filePath === CONFIG_PATH) {
    return "bot-config";
  }

  if (path.dirname(filePath) !== DATA_DIR) {
    return null;
  }

  return path.basename(filePath, ".json");
}

function markFileDirty(filePath) {
  const collectionName = getCollectionFromFilePath(filePath);
  if (!collectionName) {
    return;
  }

  dirtyFiles.add(filePath);
}

async function syncFileToMongoDB(filePath) {
  if (!isDatabaseConnected()) {
    return false;
  }

  const collectionName = getCollectionFromFilePath(filePath);
  if (!collectionName) {
    return false;
  }

  try {
    const fileData = fs.readFileSync(filePath, "utf8");
    const parsedData = JSON.parse(fileData);
    const success = await saveDocument(collectionName, { _id: "main" }, parsedData);

    if (success) {
      const label = collectionName === "bot-config" ? "config.json" : `${collectionName}.json`;
      console.log(`☁️  ${label} - Database updated (SECONDARY)`);
    }

    return success;
  } catch (error) {
    const label = collectionName === "bot-config" ? "config.json" : `${collectionName}.json`;
    console.error(`⚠️  ${label} - Database update failed (will retry on next save):`, error.message);
    return false;
  }
}

function scheduleMongoSync(filePath) {
  const existingTimer = debounceTimers.get(filePath);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  const timer = setTimeout(() => {
    debounceTimers.delete(filePath);
    markFileDirty(filePath);
  }, 150);

  debounceTimers.set(filePath, timer);
}

async function syncDirtyFilesToMongoDB() {
  if (isSyncInProgress || !isDatabaseConnected() || dirtyFiles.size === 0) {
    return;
  }

  isSyncInProgress = true;
  const pendingFiles = Array.from(dirtyFiles);
  dirtyFiles.clear();

  console.log(`⏱️  Running scheduled database sync for ${pendingFiles.length} file(s)...`);

  for (const filePath of pendingFiles) {
    const success = await syncFileToMongoDB(filePath);
    if (!success) {
      // Keep failed files queued for the next 30-minute cycle.
      markFileDirty(filePath);
    }
  }

  isSyncInProgress = false;
}

function watchFileForSync(filePath) {
  if (watchedFiles.has(filePath)) {
    return;
  }

  try {
    fs.watch(filePath, { persistent: false }, (eventType) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }

      scheduleMongoSync(filePath);
    });

    watchedFiles.add(filePath);
  } catch (error) {
    console.warn(`⚠️  Could not watch ${path.basename(filePath)} for MongoDB sync:`, error.message);
  }
}

function startFileSyncWatchers() {
  if (fileWatchersStarted) {
    return;
  }

  ensureDataDir();

  if (!dataDirectoryWatcher) {
    try {
      dataDirectoryWatcher = fs.watch(DATA_DIR, { persistent: false }, (eventType, filename) => {
        if (!filename || (!String(filename).endsWith(".json") && eventType !== "rename")) {
          return;
        }

        const filePath = path.join(DATA_DIR, String(filename));
        if (fs.existsSync(filePath)) {
          watchFileForSync(filePath);
          scheduleMongoSync(filePath);
        }
      });
    } catch (error) {
      console.warn("⚠️  Could not watch data directory for MongoDB sync:", error.message);
    }
  }

  for (const fileName of getDataFiles()) {
    watchFileForSync(path.join(DATA_DIR, fileName));
  }

  watchFileForSync(CONFIG_PATH);
  for (const filePath of ROOT_SYNC_FILES) {
    watchFileForSync(filePath);
  }

  if (!dbSyncInterval) {
    dbSyncInterval = setInterval(() => {
      syncDirtyFilesToMongoDB().catch((error) => {
        console.error("❌ Scheduled database sync failed:", error.message);
      });
    }, DB_SYNC_INTERVAL_MS);
  }

  fileWatchersStarted = true;

  console.log("👀 File sync watchers started for JSON files and config.json");
  console.log("⏱️  Database sync scheduled every 30 minutes (SECONDARY)");
}

/**
 * Load data from JSON file with fallback to MongoDB
 */
async function loadData(collectionName, defaultValue = {}) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${collectionName}.json`);

  try {
    // Try to load from file first
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(fileData);
      return parsed;
    }

    // If file doesn't exist, try MongoDB
    if (isDatabaseConnected()) {
      const dbData = await getDocument(collectionName, { _id: "main" });
      if (dbData) {
        // Check if it's an unwrapped array or object
        if (Array.isArray(dbData)) {
          return dbData;
        }
        // If it's an object with _id, remove the _id field
        if (typeof dbData === 'object' && dbData._id) {
          const { _id, isArray, items, ...data } = dbData;
          return Object.keys(data).length > 0 ? data : defaultValue;
        }
        return dbData;
      }
    }

    return defaultValue;
  } catch (error) {
    console.error(`❌ Error loading ${collectionName}:`, error.message);

    // Try MongoDB as fallback
    if (isDatabaseConnected()) {
      try {
        const dbData = await getDocument(collectionName, { _id: "main" });
        if (dbData) {
          if (Array.isArray(dbData)) {
            return dbData;
          }
          const { _id, isArray, items, ...data } = dbData;
          return Object.keys(data).length > 0 ? data : defaultValue;
        }
      } catch (dbError) {
        console.error(`❌ MongoDB fallback failed for ${collectionName}:`, dbError.message);
      }
    }

    return defaultValue;
  }
}

/**
 * Save data to JSON file (PRIMARY).
 * MongoDB (SECONDARY) sync runs every 30 minutes.
 */
async function saveData(collectionName, data) {
  ensureDataDir();
  const filePath = path.join(DATA_DIR, `${collectionName}.json`);

  const promises = [];
  let fileSaved = false;

  // Save to file
  try {
    promises.push(
      new Promise((resolve) => {
        fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8", (err) => {
          if (err) {
            console.error(`❌ Error saving ${collectionName} to file:`, err.message);
          } else {
            console.log(`💾 Saved ${collectionName} to file`);
            fileSaved = true;
          }
          resolve();
        });
      })
    );
  } catch (error) {
    console.error(`❌ Error saving ${collectionName} to file:`, error.message);
  }

  // Wait for file save
  await Promise.all(promises);

  if (fileSaved) {
    markFileDirty(filePath);
    console.log(`⏱️  ${collectionName} - Database sync queued (next 30-minute cycle)`);
  }
}

/**
 * Batch save multiple data collections (optimized).
 * MongoDB (SECONDARY) sync runs every 30 minutes.
 */
async function batchSaveData(dataMap) {
  ensureDataDir();

  // Save all files in parallel
  const fileSavePromises = Object.entries(dataMap).map(
    ([collectionName, data]) => {
      return new Promise((resolve) => {
        const filePath = path.join(DATA_DIR, `${collectionName}.json`);
        fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8", (err) => {
          if (err) {
            console.error(`❌ Error saving ${collectionName} to file:`, err.message);
          }
          resolve();
        });
      });
    }
  );

  await Promise.all(fileSavePromises);

  for (const collectionName of Object.keys(dataMap)) {
    markFileDirty(path.join(DATA_DIR, `${collectionName}.json`));
  }

  console.log(`✅ Batch saved ${Object.keys(dataMap).length} collections (PRIMARY)`);
  console.log("⏱️  Database sync queued for next 30-minute cycle (SECONDARY)");
}

/**
 * Get all data files that exist
 */
function getDataFiles() {
  ensureDataDir();
  const files = fs.readdirSync(DATA_DIR);
  return files.filter((file) => file.endsWith(".json"));
}

/**
 * Migrate all existing JSON data to MongoDB
 */
async function migrateToMongoDB() {
  if (!isDatabaseConnected()) {
    console.warn("⚠️  Database not connected. Cannot migrate data to MongoDB.");
    return false;
  }

  ensureDataDir();
  const files = getDataFiles();

  console.log(`📦 Migrating ${files.length} data files to MongoDB...`);

  let successCount = 0;
  for (const file of files) {
    const collectionName = file.replace(".json", "");
    const filePath = path.join(DATA_DIR, file);

    try {
      const fileData = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(fileData);

      const success = await saveDocument(collectionName, { _id: "main" }, data);
      if (success) {
        console.log(`✅ ${collectionName} - File saved (PRIMARY)`);
        console.log(`☁️  ${collectionName} - Database updated (SECONDARY)`);
        successCount++;
      }
    } catch (error) {
      console.error(`❌ Failed to migrate ${collectionName}:`, error.message);
    }
  }

  console.log(`📦 Migration complete: ${successCount}/${files.length} files migrated`);
  return successCount === files.length;
}

/**
 * Migrate config.json to MongoDB
 */
async function migrateConfigToMongoDB() {
  if (!isDatabaseConnected()) {
    console.warn("⚠️  Database not connected. Cannot migrate config to MongoDB.");
    return false;
  }

  try {
    const configData = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));

    const success = await saveDocument("bot-config", { _id: "main" }, configData);
    if (success) {
      console.log("✅ config.json - File saved (PRIMARY)");
      console.log("☁️  config.json - Database updated (SECONDARY)");
      return true;
    }
  } catch (error) {
    console.error("❌ Failed to migrate config.json:", error.message);
    return false;
  }
}

/**
 * Load config from MongoDB or file
 */
async function loadConfig() {
  try {
    // Try file first
    const configPath = path.join(__dirname, "..", "config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return config;
    }

    // Try MongoDB
    if (isDatabaseConnected()) {
      const dbConfig = await getDocument("bot-config", { _id: "main" });
      if (dbConfig) {
        if (Array.isArray(dbConfig)) {
          return dbConfig;
        }
        const { _id, isArray, items, ...config } = dbConfig;
        return Object.keys(config).length > 0 ? config : require("../config.json");
      }
    }

    return require("../config.json");
  } catch (error) {
    console.error("❌ Error loading config:", error.message);
    return require("../config.json");
  }
}

module.exports = {
  loadData,
  saveData,
  batchSaveData,
  getDataFiles,
  migrateToMongoDB,
  migrateConfigToMongoDB,
  loadConfig,
  ensureDataDir,
  startFileSyncWatchers,
  syncFileToMongoDB,
};
