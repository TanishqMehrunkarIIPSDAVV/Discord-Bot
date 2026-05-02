/**
 * Example: Updating a Data Store for Dual Storage
 * This shows how to refactor an existing data store to use MongoDB
 * 
 * File: utils/questStore.js (example refactor)
 */

const { loadData, saveData } = require("./dataSync");

// Constants remain the same
const MIN_REFRESH_MS = 2 * 60 * 60 * 1000;
const MAX_REFRESH_MS = 3 * 60 * 60 * 1000;
const QUEST_LEVEL_XP_STEP = 100;

// Cache to avoid constant reloading
let cachedQuestState = null;
let cachedQuestCatalog = null;

/**
 * Load quest state (user progress, active quests, etc.)
 * Automatically loads from file or MongoDB
 */
async function loadQuestState() {
  try {
    // Return cached if available
    if (cachedQuestState) {
      return cachedQuestState;
    }

    // Load from file/MongoDB with fallback
    cachedQuestState = await loadData("quest-state", {
      users: {},
      catalog: {},
    });

    return cachedQuestState;
  } catch (error) {
    console.error("Error loading quest state:", error.message);
    return { users: {}, catalog: {} };
  }
}

/**
 * Save quest state (automatically syncs to both file and MongoDB)
 */
async function saveQuestState(data) {
  try {
    // Update cache
    cachedQuestState = data;

    // Save to both file and MongoDB
    await saveData("quest-state", data);

    return true;
  } catch (error) {
    console.error("Error saving quest state:", error.message);
    return false;
  }
}

/**
 * Load quest catalog
 */
async function loadQuestCatalog() {
  try {
    if (cachedQuestCatalog) {
      return cachedQuestCatalog;
    }

    cachedQuestCatalog = await loadData("quest-catalog", []);
    return cachedQuestCatalog;
  } catch (error) {
    console.error("Error loading quest catalog:", error.message);
    return [];
  }
}

/**
 * Save quest catalog
 */
async function saveQuestCatalog(data) {
  try {
    cachedQuestCatalog = data;
    await saveData("quest-catalog", data);
    return true;
  } catch (error) {
    console.error("Error saving quest catalog:", error.message);
    return false;
  }
}

/**
 * Update user's quest progress
 */
async function updateUserQuests(userId, questData) {
  const state = await loadQuestState();

  if (!state.users) state.users = {};

  state.users[userId] = {
    ...state.users[userId],
    ...questData,
    lastUpdated: new Date().toISOString(),
  };

  return await saveQuestState(state);
}

/**
 * Get user's quest progress
 */
async function getUserQuests(userId) {
  const state = await loadQuestState();
  return state.users?.[userId] || null;
}

/**
 * Clear cache (useful when reloading data externally)
 */
function clearCache() {
  cachedQuestState = null;
  cachedQuestCatalog = null;
}

module.exports = {
  loadQuestState,
  saveQuestState,
  loadQuestCatalog,
  saveQuestCatalog,
  updateUserQuests,
  getUserQuests,
  clearCache,
};
