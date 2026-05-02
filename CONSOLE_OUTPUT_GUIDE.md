╔═══════════════════════════════════════════════════════════════════════════╗
║               CONSOLE OUTPUT EXAMPLES - PRIMARY/SECONDARY STORAGE          ║
╚═══════════════════════════════════════════════════════════════════════════╝

📋 BOT STARTUP
═══════════════════════════════════════════════════════════════════════════

✅ Bot connected as 𝑪𝒉𝒂𝒊 𝑻𝒂𝒑𝒓𝒊.𝒆𝒙𝒆#8384

🚀 Initializing Discord Bot with MongoDB Support...

[1/3] Connecting to MongoDB Atlas...
✅ Connected to MongoDB Atlas successfully!

[2/3] Setting up database indexes...
✅ Database indexes created

[3/3] Syncing data to MongoDB...
📦 Migrating 12 data files to MongoDB (SECONDARY)...
✅ afk-state - File saved (PRIMARY)
☁️  afk-state - Database updated (SECONDARY)
✅ ai-conversation-history - File saved (PRIMARY)
☁️  ai-conversation-history - Database updated (SECONDARY)
✅ quest-state - File saved (PRIMARY)
☁️  quest-state - Database updated (SECONDARY)
✅ vc-points - File saved (PRIMARY)
☁️  vc-points - Database updated (SECONDARY)
✅ quest-catalog - File saved (PRIMARY)
☁️  quest-catalog - Database updated (SECONDARY)
✅ mod-cases - File saved (PRIMARY)
☁️  mod-cases - Database updated (SECONDARY)
✅ user-ratings - File saved (PRIMARY)
☁️  user-ratings - Database updated (SECONDARY)
✅ gradient-roles - File saved (PRIMARY)
☁️  gradient-roles - Database updated (SECONDARY)
✅ channel-names - File saved (PRIMARY)
☁️  channel-names - Database updated (SECONDARY)
✅ quest-shop - File saved (PRIMARY)
☁️  quest-shop - Database updated (SECONDARY)
✅ chat-lore-history - File saved (PRIMARY)
☁️  chat-lore-history - Database updated (SECONDARY)
✅ night-channel-rename-state - File saved (PRIMARY)
☁️  night-channel-rename-state - Database updated (SECONDARY)
📦 Migration complete: 12/12 collections synced to database
☁️  bot-config - Database updated (SECONDARY)

✅ Bot initialized! Data is synced between files and MongoDB.


📊 SAVING SINGLE COLLECTION
═══════════════════════════════════════════════════════════════════════════

When a feature saves data (e.g., quest completion):

    await saveData("quest-state", questData);

Console output:
    ✅ quest-state - File saved (PRIMARY)
    ☁️  quest-state - Database updated (SECONDARY)


📊 SAVING MULTIPLE COLLECTIONS (BATCH)
═══════════════════════════════════════════════════════════════════════════

When multiple features save simultaneously:

    await batchSaveData({
      "quest-state": questData,
      "vc-points": pointsData,
      "mod-cases": casesData,
    });

Console output:
    📦 Batch saving 3 collections...
    ✅ quest-state - File saved (PRIMARY)
    ✅ vc-points - File saved (PRIMARY)
    ✅ mod-cases - File saved (PRIMARY)
    ☁️  quest-state - Database updated (SECONDARY)
    ☁️  vc-points - Database updated (SECONDARY)
    ☁️  mod-cases - Database updated (SECONDARY)
    ✅ Batch save complete: 3 collections synced


🚨 ERROR SCENARIO 1: FILE SAVE FAILS
═══════════════════════════════════════════════════════════════════════════

If the file system has issues:

Console output:
    ❌ File save failed for quest-state: Permission denied
    ☁️  quest-state - Database updated (SECONDARY)

Status:
    • File update: ❌ FAILED
    • Database update: ✅ SUCCESS
    • Result: Data is in MongoDB, will retry file save next update

Fix:
    Check file permissions, disk space, ensure data directory exists


🚨 ERROR SCENARIO 2: DATABASE UPDATE FAILS
═══════════════════════════════════════════════════════════════════════════

If MongoDB has connection issues:

Console output:
    ✅ quest-state - File saved (PRIMARY)
    ⚠️  quest-state - Database update failed (will retry on next save)

Status:
    • File update: ✅ SUCCESS
    • Database update: ⚠️ FAILED
    • Result: Data is safe in file, will try MongoDB again next update

Reason:
    • MongoDB temporarily down/unreachable
    • Connection timeout
    • Network issue

Recovery:
    Automatic - will retry on next save


🚨 ERROR SCENARIO 3: BOTH FAIL
═══════════════════════════════════════════════════════════════════════════

If both file and database have issues:

Console output:
    ❌ File save failed for quest-state: ENOENT - no such file
    ⚠️  quest-state - Database update failed (will retry on next save)

Status:
    • File update: ❌ FAILED
    • Database update: ⚠️ FAILED
    • Result: Data NOT saved

Fix:
    1. Check what error messages say
    2. Fix file system or network issue
    3. Manually run: node scripts/setupMongoDB.js
    4. Restart bot


🚨 ERROR SCENARIO 4: MONGODB NOT CONNECTED
═══════════════════════════════════════════════════════════════════════════

If bot starts without MongoDB connection:

Console output:
    ✅ quest-state - File saved (PRIMARY)
    ℹ️  quest-state - MongoDB not connected (file only mode)

Status:
    • File update: ✅ SUCCESS
    • Database update: ℹ️ SKIPPED (not connected)
    • Result: Bot works in file-only mode

Note:
    • Features work normally
    • All data saved to files
    • MongoDB backup not available until connected
    • Check .env has MONGODB_URI set


📊 MONITORING DATA UPDATES IN REAL-TIME
═══════════════════════════════════════════════════════════════════════════

Look for these patterns in console:

✅ [collection] - File saved (PRIMARY)
   └─> File update successful

☁️  [collection] - Database updated (SECONDARY)
   └─> MongoDB update successful

⚠️  [collection] - Database update failed
   └─> MongoDB update failed but file is safe

ℹ️  [collection] - MongoDB not connected
   └─> Only file storage active

❌ File save failed
   └─> File system error

Each line is timestamped with when the operation happened.


✨ EXPECTED PATTERNS
═══════════════════════════════════════════════════════════════════════════

NORMAL OPERATION:
    ✅ ... File saved (PRIMARY)
    ☁️  ... Database updated (SECONDARY)
    ✅ ... File saved (PRIMARY)
    ☁️  ... Database updated (SECONDARY)

MONGODB TEMPORARILY DOWN:
    ✅ ... File saved (PRIMARY)
    ⚠️  ... Database update failed
    [after MongoDB recovers]
    ✅ ... File saved (PRIMARY)
    ☁️  ... Database updated (SECONDARY)

FILE-ONLY MODE:
    ✅ ... File saved (PRIMARY)
    ℹ️  ... MongoDB not connected (file only mode)
    ✅ ... File saved (PRIMARY)
    ℹ️  ... MongoDB not connected (file only mode)


🔍 HOW TO CHECK STATUS
═══════════════════════════════════════════════════════════════════════════

Run status checker:
    node scripts/checkStatus.js

Output:
    ╔════════════════════════════════════════════════════════════╗
    ║        DISCORD BOT - DATA SYNC STATUS                     ║
    ╚════════════════════════════════════════════════════════════╝
    
    📊 MONGODB STATUS
       ✅ Connected
       ✓ Cloud backup enabled
       ✓ Database: discord-bot
    
    💾 FILE STORAGE STATUS
       ✅ Data directory exists
       📁 Location: d:\Discord Bot\data
       📄 Files: 12
       Files synced:
          • quest-state.json (45.3 KB)
          • vc-points.json (12.1 KB)
          • mod-cases.json (8.7 KB)
          ...
    
    📈 SYNC SUMMARY
       ✅ Dual storage active
       ✅ Data saved to files AND MongoDB
       ✅ Full redundancy enabled


💡 TIPS FOR MONITORING
═══════════════════════════════════════════════════════════════════════════

1. Check console regularly for error patterns
2. Run checkStatus.js periodically
3. If you see ⚠️ Database update failed:
   • Check MongoDB connection
   • Verify MONGODB_URI in .env
   • Check internet connection
   • MongoDB might be temporarily down

4. If you see ❌ File save failed:
   • Check disk space
   • Verify file permissions
   • Ensure data directory exists
   • Check disk is not corrupted

5. If everything works:
   • Should see ✅ and ☁️ messages
   • Data is fully backed up
   • System is resilient

═══════════════════════════════════════════════════════════════════════════
