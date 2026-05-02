# 🚀 Discord Bot - MongoDB Atlas Integration

Your Discord bot now has **dual storage with MongoDB Atlas**! All data is automatically synchronized between local JSON files and cloud MongoDB.

## ⚡ Quick Start (5 Minutes)

### 1. Get MongoDB Connection String
- Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas/register)
- Create account → Create cluster → Create user → Copy connection string

### 2. Create `.env` File
```env
DISCORD_TOKEN=your_bot_token
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
```

### 3. Setup MongoDB
```bash
npm install
node scripts/setupMongoDB.js
```

### 4. Start Bot
```bash
node index.js
```

You should see the bot connecting to MongoDB! 🎉

## 📖 Full Documentation

- **[SETUP_GUIDE.txt](./SETUP_GUIDE.txt)** - Step-by-step checklist
- **[MONGODB_SETUP.md](./MONGODB_SETUP.md)** - Complete guide with troubleshooting
- **[QUICK_START.js](./QUICK_START.js)** - Code examples
- **[EXAMPLE_REFACTOR.js](./EXAMPLE_REFACTOR.js)** - How to update data stores

## 🛠️ Useful Commands

```bash
# Check sync status
node scripts/checkStatus.js

# Manually migrate data
node scripts/migrateDataToMongoDB.js

# Full setup
node scripts/setupMongoDB.js

# Start bot
node index.js
```

## 🎯 What's Synced

All 11 data collections automatically sync to MongoDB:
- ✅ afk-state.json
- ✅ ai-conversation-history.json
- ✅ channel-names.json
- ✅ gradient-roles.json
- ✅ mod-cases.json
- ✅ quest-catalog.json
- ✅ quest-shop.json
- ✅ quest-state.json
- ✅ user-ratings.json
- ✅ vc-points.json
- ✅ config.json

## 🔐 Security

- ⚠️ Keep `.env` file private - it contains your MongoDB password!
- ⚠️ Add `.env` to `.gitignore` - never commit it
- ⚠️ Don't share your `MONGODB_URI`

## 🔄 How It Works

```
Your Code
    ↓
[dataSync Module]
    ↙        ↘
JSON Files  MongoDB Atlas
```

**Dual Storage Benefits:**
- ✓ Cloud backup in MongoDB
- ✓ Local files as primary storage
- ✓ Automatic sync on bot startup
- ✓ Works if either system fails

## 🆘 Need Help?

1. **Read**: [SETUP_GUIDE.txt](./SETUP_GUIDE.txt) - Has checklist
2. **Check**: [MONGODB_SETUP.md](./MONGODB_SETUP.md) - Complete guide + troubleshooting
3. **Examples**: [QUICK_START.js](./QUICK_START.js) - Code examples

## 📦 New Utilities

```javascript
// Load data (file or MongoDB)
const { loadData } = require("./utils/dataSync");
const data = await loadData("quest-state", {});

// Save data (to both file AND MongoDB)
const { saveData } = require("./utils/dataSync");
await saveData("quest-state", data);

// Check status
const { isDatabaseConnected } = require("./utils/db");
if (isDatabaseConnected()) console.log("✅ MongoDB active");
```

## ✨ Features

- **Automatic Sync**: Data syncs on bot startup
- **Dual Storage**: Files + MongoDB for redundancy
- **Smart Caching**: Efficient data loading
- **Performance**: Optimized indexes
- **Error Handling**: Fallback mechanisms
- **Monitoring**: Status checking utilities

---

**Everything is set up and ready!** Just follow the Quick Start above to activate MongoDB. 🎉
