# MongoDB Atlas Integration Guide

## Overview
Your Discord bot now has **dual storage** - all data is automatically saved to both JSON files AND MongoDB Atlas. This provides:
- ☁️ **Cloud Backup**: Data persisted in MongoDB Atlas
- 💾 **Local Storage**: Data still saved in JSON files as primary source
- 🔄 **Automatic Sync**: When bot runs, data syncs to MongoDB
- 🛡️ **Redundancy**: If one system fails, you have the other

## Setup Instructions

### 1. Create MongoDB Atlas Account & Cluster

1. Go to https://www.mongodb.com/cloud/atlas/register
2. Create a free account
3. Create a new project
4. Create a M0 (free) cluster
5. Create a database user with a password
6. Whitelist your IP address
7. Copy the connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/`)

### 2. Add MongoDB URI to .env

Create or edit your `.env` file in the bot root directory:

```env
DISCORD_TOKEN=your_discord_bot_token_here
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

**Important**: Keep this `.env` file private and never commit it to version control.

### 3. Install MongoDB Driver

```bash
npm install mongodb
```

### 4. Run Migration Script

This script will:
- Connect to MongoDB
- Create necessary collections
- Migrate all existing JSON data to MongoDB
- Create performance indexes

```bash
node scripts/setupMongoDB.js
```

Or to just migrate data without setup:

```bash
node scripts/migrateDataToMongoDB.js
```

### 5. Start Your Bot

```bash
node index.js
```

You should see:
```
🚀 Initializing Discord Bot with MongoDB Support...

[1/3] Connecting to MongoDB Atlas...
✅ Connected to MongoDB Atlas successfully!

[2/3] Setting up database indexes...
✅ Database indexes created

[3/3] Syncing data to MongoDB...
✅ Migrated afk-state
✅ Migrated ai-conversation-history
...
✅ Bot initialized! Data is synced between files and MongoDB.
```

## Data Files Being Synced

The following JSON files are automatically synced to MongoDB:

- `data/afk-state.json` → Collection: `afk-state`
- `data/ai-conversation-history.json` → Collection: `ai-conversation-history`
- `data/channel-names.json` → Collection: `channel-names`
- `data/gradient-roles.json` → Collection: `gradient-roles`
- `data/mod-cases.json` → Collection: `mod-cases`
- `data/quest-catalog.json` → Collection: `quest-catalog`
- `data/quest-shop.json` → Collection: `quest-shop`
- `data/quest-state.json` → Collection: `quest-state`
- `data/user-ratings.json` → Collection: `user-ratings`
- `data/vc-points.json` → Collection: `vc-points`
- `config.json` → Collection: `bot-config`

## How It Works

### Load Data
```javascript
const { loadData } = require("./utils/dataSync");

// Loads from file first, falls back to MongoDB
const questState = await loadData("quest-state", {});
```

### Save Data
```javascript
const { saveData } = require("./utils/dataSync");

// Saves to BOTH file and MongoDB simultaneously
await saveData("quest-state", updatedData);
```

### Batch Save (Optimized)
```javascript
const { batchSaveData } = require("./utils/dataSync");

// Save multiple collections at once (recommended for performance)
await batchSaveData({
  "quest-state": questData,
  "vc-points": vcPointsData,
  "mod-cases": casesData,
});
```

## Updating Existing Data Stores

All existing data stores should be updated to use the `dataSync` module instead of directly using `fs`. Here's how:

### Before (File-only):
```javascript
const fs = require("node:fs");
const path = require("node:path");

const DATA_PATH = path.join(__dirname, "..", "data", "quest-state.json");

const loadQuestState = () => {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
};

const saveQuestState = (data) => {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), "utf8");
};
```

### After (Dual Storage):
```javascript
const { loadData, saveData } = require("./dataSync");

const loadQuestState = async () => {
  return await loadData("quest-state", {});
};

const saveQuestState = async (data) => {
  await saveData("quest-state", data);
};
```

## Database Utilities

### Get a Collection
```javascript
const { getCollection } = require("./utils/db");

const collection = await getCollection("quest-state");
if (collection) {
  const document = await collection.findOne({ userId: "123" });
}
```

### Query Documents
```javascript
const { getDocument, getDocuments } = require("./utils/db");

// Get single document
const doc = await getDocument("user-ratings", { _id: "main" });

// Get multiple documents
const docs = await getDocuments("quest-state", { userId: "123" });
```

### Save Document
```javascript
const { saveDocument } = require("./utils/db");

await saveDocument("quest-state", { _id: "main" }, {
  users: { "123": { points: 100 } }
});
```

### Delete Document
```javascript
const { deleteDocument } = require("./utils/db");

await deleteDocument("quest-state", { userId: "123" });
```

## Monitoring Database Status

```javascript
const { isDatabaseConnected } = require("./utils/db");

if (isDatabaseConnected()) {
  console.log("✅ MongoDB is connected and syncing data");
} else {
  console.log("⚠️  MongoDB not available - using file storage only");
}
```

## Troubleshooting

### Connection Issues

**Error: "MONGODB_URI not set"**
- Add `MONGODB_URI=...` to your `.env` file

**Error: "Failed to connect to MongoDB"**
- Check MongoDB Atlas cluster is running
- Verify connection string is correct
- Check IP whitelist in MongoDB Atlas security settings
- Ensure `npm install mongodb` is run

### Data Issues

**Data not syncing**
- Check bot logs for errors
- Verify `.env` file exists and has correct `MONGODB_URI`
- Run: `node scripts/setupMongoDB.js` to manually sync

**Stale data**
- Files are the primary source of truth
- If inconsistency occurs, file data takes precedence
- Run migration script to resync: `node scripts/migrateDataToMongoDB.js`

## Performance Tips

1. **Batch Save**: Use `batchSaveData()` for multiple updates instead of individual saves
2. **Async Operations**: Always use `await` with data operations
3. **Error Handling**: Wrap operations in try-catch blocks
4. **Indexes**: Indexes are automatically created for common queries

## Security Notes

⚠️ **IMPORTANT**: 
- Never commit `.env` to version control
- Keep `MONGODB_URI` secret
- The string contains your database password
- Add `.env` to `.gitignore` if using Git

## Need Help?

If something isn't working:
1. Check bot console logs for error messages
2. Verify MongoDB Atlas cluster status
3. Run: `node scripts/setupMongoDB.js` to reset
4. Check `.env` file exists and is properly formatted

## File Structure

```
discord-bot/
├── .env (create this with MONGODB_URI)
├── .env.example (template)
├── config.json
├── data/
│   ├── quest-state.json
│   ├── vc-points.json
│   └── ...
├── utils/
│   ├── db.js (MongoDB connection & utilities)
│   ├── dataSync.js (Dual storage manager)
│   └── ...
├── scripts/
│   ├── setupMongoDB.js (Initial setup)
│   └── migrateDataToMongoDB.js (Data migration)
└── index.js (Updated with DB initialization)
```
