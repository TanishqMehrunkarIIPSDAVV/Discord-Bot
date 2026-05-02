/**
 * MongoDB Connection & Database Management
 * Handles connection to MongoDB Atlas and provides database utilities
 */

const { MongoClient } = require("mongodb");

let client = null;
let db = null;
let isConnected = false;

const MONGODB_URI = (
  process.env.MONGODB_URI ||
  process.env.MONGO_URI ||
  ""
).trim();

const DB_NAME = "discord-bot";

/**
 * Connect to MongoDB Atlas
 */
async function connectDB() {
  if (isConnected && db) {
    console.log("✅ Already connected to MongoDB");
    return db;
  }

  if (!MONGODB_URI) {
    console.warn(
      "⚠️  MONGODB_URI not set. Set it in .env file or as environment variable."
    );
    console.warn("   Database features will be disabled.");
    return null;
  }

  try {
    console.log("🔗 Connecting to MongoDB Atlas...");
    client = new MongoClient(MONGODB_URI, {
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    await client.connect();
    db = client.db(DB_NAME);

    // Test connection
    const adminDb = client.db("admin");
    await adminDb.command({ ping: 1 });

    isConnected = true;
    console.log("✅ Connected to MongoDB Atlas successfully!");

    return db;
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error.message);
    isConnected = false;
    return null;
  }
}

/**
 * Disconnect from MongoDB
 */
async function disconnectDB() {
  if (client) {
    await client.close();
    isConnected = false;
    db = null;
    client = null;
    console.log("✅ Disconnected from MongoDB");
  }
}

/**
 * Get database connection
 */
function getDB() {
  if (!isConnected || !db) {
    console.warn(
      "⚠️  Database not connected. Some features may not work."
    );
  }
  return db;
}

/**
 * Check if database is connected
 */
function isDatabaseConnected() {
  return isConnected && db !== null;
}

/**
 * Get or create a collection
 */
async function getCollection(collectionName) {
  if (!db) {
    console.warn(`⚠️  Cannot get collection '${collectionName}' - DB not connected`);
    return null;
  }

  try {
    // Check if collection exists
    const collections = await db.listCollections({ name: collectionName }).toArray();

    if (collections.length === 0) {
      // Create collection
      await db.createCollection(collectionName);
      console.log(`📦 Created MongoDB collection: ${collectionName}`);
    }

    return db.collection(collectionName);
  } catch (error) {
    console.error(`❌ Error getting collection '${collectionName}':`, error.message);
    return null;
  }
}

/**
 * Save/update a document
 * Handles both objects and arrays properly
 */
async function saveDocument(collectionName, query, data) {
  if (!isDatabaseConnected()) return false;

  try {
    const collection = await getCollection(collectionName);
    if (!collection) return false;

    // If data is an array, wrap it in an object
    const documentData = Array.isArray(data) ? { items: data, isArray: true } : data;

    const result = await collection.updateOne(query, { $set: documentData }, { upsert: true });
    return true;
  } catch (error) {
    console.error(`❌ Error saving to ${collectionName}:`, error.message);
    return false;
  }
}

/**
 * Get a document
 * Unwraps arrays that were wrapped during save
 */
async function getDocument(collectionName, query) {
  if (!isDatabaseConnected()) return null;

  try {
    const collection = await getCollection(collectionName);
    if (!collection) return null;

    const doc = await collection.findOne(query);
    if (!doc) return null;

    // If document has items array marker, unwrap it
    if (doc.isArray && doc.items) {
      return doc.items;
    }

    return doc;
  } catch (error) {
    console.error(`❌ Error getting from ${collectionName}:`, error.message);
    return null;
  }
}

/**
 * Get all documents
 */
async function getDocuments(collectionName, query = {}) {
  if (!isDatabaseConnected()) return [];

  try {
    const collection = await getCollection(collectionName);
    if (!collection) return [];

    const docs = await collection.find(query).toArray();
    return docs;
  } catch (error) {
    console.error(`❌ Error getting documents from ${collectionName}:`, error.message);
    return [];
  }
}

/**
 * Delete a document
 */
async function deleteDocument(collectionName, query) {
  if (!isDatabaseConnected()) return false;

  try {
    const collection = await getCollection(collectionName);
    if (!collection) return false;

    await collection.deleteOne(query);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting from ${collectionName}:`, error.message);
    return false;
  }
}

/**
 * Create indexes for performance
 */
async function createIndexes() {
  if (!isDatabaseConnected()) return;

  try {
    // Create indexes for common queries
    const collections = {
      "user-ratings": [{ key: "participants" }],
      "quest-state": [{ key: "userId" }, { key: "guildId" }],
      "vc-points": [{ key: "userId" }, { key: "guildId" }],
      "mod-cases": [{ key: "userId" }, { key: "guildId" }],
      "gradient-roles": [{ key: "userId" }],
      "channel-names": [{ key: "channelId" }],
    };

    for (const [colName, indexes] of Object.entries(collections)) {
      const collection = await getCollection(colName);
      if (collection) {
        for (const indexSpec of indexes) {
          await collection.createIndex(indexSpec.key);
        }
      }
    }

    console.log("✅ Database indexes created");
  } catch (error) {
    console.error("❌ Error creating indexes:", error.message);
  }
}

module.exports = {
  connectDB,
  disconnectDB,
  getDB,
  isDatabaseConnected,
  getCollection,
  saveDocument,
  getDocument,
  getDocuments,
  deleteDocument,
  createIndexes,
};
