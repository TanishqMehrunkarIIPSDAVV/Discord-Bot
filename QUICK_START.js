/**
 * QUICK START: MongoDB Setup
 * Follow these steps to get MongoDB working with your bot
 */

// ==============================================================================
// STEP 1: Install MongoDB Driver
// ==============================================================================
// Run this in terminal:
// npm install mongodb

// ==============================================================================
// STEP 2: Setup .env file
// ==============================================================================
// Create a .env file in your bot's root directory with:
/*
DISCORD_TOKEN=your_discord_bot_token
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
*/

// ==============================================================================
// STEP 3: Get MongoDB URI from MongoDB Atlas
// ==============================================================================
/*
1. Go to https://www.mongodb.com/cloud/atlas/register
2. Create account and verify email
3. Create new project
4. Create M0 (free) cluster
5. Create database user (save username and password)
6. Add your IP to whitelist (or 0.0.0.0 for anywhere)
7. Click "Connect" button
8. Choose "Drivers" connection method
9. Copy the connection string
10. Replace <username>, <password>, and <cluster> with your values
11. Paste into .env as MONGODB_URI
*/

// ==============================================================================
// STEP 4: Run Migration Script
// ==============================================================================
// Run this in terminal:
// node scripts/setupMongoDB.js
//
// This will:
// ✓ Connect to MongoDB
// ✓ Create collections
// ✓ Migrate all data
// ✓ Setup indexes

// ==============================================================================
// STEP 5: Start Your Bot
// ==============================================================================
// Run this in terminal:
// node index.js
//
// You should see:
// [1/3] Connecting to MongoDB Atlas...
// ✅ Connected to MongoDB Atlas successfully!
// [2/3] Setting up database indexes...
// ✅ Database indexes created
// [3/3] Syncing data to MongoDB...
// ✅ Bot initialized!

// ==============================================================================
// HOW TO USE IN YOUR CODE
// ==============================================================================

// Load data (from file or MongoDB)
const { loadData } = require("./utils/dataSync");
async function example1() {
  const questState = await loadData("quest-state", {});
  console.log(questState);
}

// Save data (to both file AND MongoDB)
const { saveData } = require("./utils/dataSync");
async function example2() {
  const data = { users: { "123": { points: 100 } } };
  await saveData("quest-state", data);
}

// Save multiple collections at once (optimized)
const { batchSaveData } = require("./utils/dataSync");
async function example3() {
  await batchSaveData({
    "quest-state": { users: {} },
    "vc-points": { guilds: {} },
    "mod-cases": { cases: {} },
  });
}

// Check if MongoDB is connected
const { isDatabaseConnected } = require("./utils/db");
async function example4() {
  if (isDatabaseConnected()) {
    console.log("✅ Using MongoDB");
  } else {
    console.log("⚠️  Using file storage only");
  }
}

// ==============================================================================
// DATA COLLECTIONS
// ==============================================================================
/*
These JSON files are now synced to MongoDB:

afk-state                  → Collection: afk-state
ai-conversation-history    → Collection: ai-conversation-history
channel-names             → Collection: channel-names
gradient-roles            → Collection: gradient-roles
mod-cases                 → Collection: mod-cases
quest-catalog             → Collection: quest-catalog
quest-shop                → Collection: quest-shop
quest-state               → Collection: quest-state
user-ratings              → Collection: user-ratings
vc-points                 → Collection: vc-points
config.json               → Collection: bot-config
*/

// ==============================================================================
// TROUBLESHOOTING
// ==============================================================================

/*
Problem: MONGODB_URI not set
Solution: 
  1. Create .env file in bot root
  2. Add: MONGODB_URI=mongodb+srv://...

Problem: Connection failed
Solution:
  1. Check MongoDB Atlas cluster is running
  2. Verify connection string is correct
  3. Check IP whitelist in MongoDB security settings
  4. Run: node scripts/setupMongoDB.js again

Problem: Data not appearing in MongoDB
Solution:
  1. Check bot console for errors
  2. Run: node scripts/migrateDataToMongoDB.js
  3. Restart bot: node index.js

Problem: npm install mongodb failed
Solution:
  1. Delete node_modules folder
  2. Delete package-lock.json
  3. Run: npm install
*/

// ==============================================================================
// IMPORTANT NOTES
// ==============================================================================

/*
✓ Data saves to BOTH files and MongoDB automatically
✓ Files are primary source, MongoDB is backup
✓ If one system fails, the other has your data
✓ Never commit .env to version control
✓ Add .env to .gitignore for security
✓ Keep MONGODB_URI secret (it has your password)
*/

// ==============================================================================
// NEXT STEPS
// ==============================================================================

/*
1. Update existing data stores to use dataSync module
   - See EXAMPLE_REFACTOR.js for how
   - Replace fs.readFileSync with loadData()
   - Replace fs.writeFileSync with saveData()

2. Use MongoDB for queries
   - See utils/db.js for available functions
   - Use getCollection() for advanced queries
   - Use getDocuments() for filtering

3. Monitor sync status
   - Check "mongodb setup.md" for full guide
   - Monitor bot console logs
   - Check MongoDB Atlas dashboard

4. Performance optimization
   - Use batchSaveData() for multiple updates
   - Cache frequently accessed data
   - Use indexes for common queries
*/
