const fs = require("node:fs");
const path = require("node:path");

const STORE_PATH = path.join(__dirname, "..", "data", "counting-state.json");

let countingState = null;

const loadState = () => {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
      if (parsed && typeof parsed === "object") {
        if (!parsed.guilds || typeof parsed.guilds !== "object") {
          parsed.guilds = {};
        }
        return parsed;
      }
    }
  } catch (error) {
    console.error("countingStore: failed to load state", error);
  }

  return { guilds: {} };
};

const saveState = () => {
  if (!countingState) return;
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(countingState, null, 2)}\n`, "utf8");
};

const getState = () => {
  if (!countingState) {
    countingState = loadState();
  }

  return countingState;
};

const ensureGuildState = (guildId) => {
  const state = getState();
  if (!state.guilds[guildId] || typeof state.guilds[guildId] !== "object") {
    state.guilds[guildId] = { channels: {} };
  }

  if (!state.guilds[guildId].channels || typeof state.guilds[guildId].channels !== "object") {
    state.guilds[guildId].channels = {};
  }

  return state.guilds[guildId];
};

const ensureChannelState = (guildId, channelId) => {
  const guildState = ensureGuildState(guildId);

  if (!guildState.channels[channelId] || typeof guildState.channels[channelId] !== "object") {
    guildState.channels[channelId] = {
      count: "0",
      warnings: 0,
      lastUserId: null,
      users: {},
    };
  }

  const channelState = guildState.channels[channelId];

  if (typeof channelState.count !== "string") {
    channelState.count = String(channelState.count || "0");
  }

  if (!Number.isFinite(Number(channelState.warnings)) || Number(channelState.warnings) < 0) {
    channelState.warnings = 0;
  }

  if (!channelState.users || typeof channelState.users !== "object") {
    channelState.users = {};
  }

  return channelState;
};

const ensureUserState = (channelState, userId) => {
  if (!channelState.users[userId] || typeof channelState.users[userId] !== "object") {
    channelState.users[userId] = {
      saves: 0,
      progress: 0,
      correctCount: 0,
      warnings: 0,
    };
  }

  const userState = channelState.users[userId];

  if (!Number.isFinite(Number(userState.saves)) || Number(userState.saves) < 0) {
    userState.saves = 0;
  }

  if (!Number.isFinite(Number(userState.progress)) || Number(userState.progress) < 0) {
    userState.progress = 0;
  }

  if (!Number.isFinite(Number(userState.correctCount)) || Number(userState.correctCount) < 0) {
    userState.correctCount = 0;
  }

  if (!Number.isFinite(Number(userState.warnings)) || Number(userState.warnings) < 0) {
    userState.warnings = 0;
  }

  return userState;
};

const recordCorrectCount = (guildId, channelId, userId) => {
  const channelState = ensureChannelState(guildId, channelId);
  const userState = ensureUserState(channelState, userId);

  const currentCount = BigInt(channelState.count || "0");
  const nextCount = currentCount + 1n;

  channelState.count = nextCount.toString();
  channelState.lastUserId = String(userId);

  userState.correctCount += 1;
  userState.progress += 1;

  let savesEarned = 0;
  while (userState.progress >= 100) {
    userState.progress -= 100;
    userState.saves += 1;
    savesEarned += 1;
  }

  saveState();

  return {
    count: nextCount,
    userState,
    savesEarned,
  };
};

const recordWrongCount = (guildId, channelId, userId) => {
  const channelState = ensureChannelState(guildId, channelId);
  const userState = ensureUserState(channelState, userId);

  // Always increment a channel-level warning when a wrong input occurs
  channelState.warnings += 1;

  const hadSave = userState.saves > 0;
  if (hadSave) {
    // Consume a save but preserve the current channel count and last user
    userState.saves -= 1;
  } else {
    // No save available: reset the channel count and add a personal warning
    channelState.count = "0";
    channelState.lastUserId = null;
    userState.warnings += 1;
  }

  saveState();

  return {
    channelWarnings: channelState.warnings,
    userWarnings: userState.warnings,
    remainingSaves: userState.saves,
    usedSave: hadSave,
  };
};

const getChannelSnapshot = (guildId, channelId) => {
  const channelState = ensureChannelState(guildId, channelId);
  return {
    count: BigInt(channelState.count || "0"),
    warnings: Number(channelState.warnings) || 0,
    lastUserId: channelState.lastUserId || null,
  };
};

const getUserSnapshot = (guildId, channelId, userId) => {
  const channelState = ensureChannelState(guildId, channelId);
  const userState = ensureUserState(channelState, userId);
  return {
    saves: Number(userState.saves) || 0,
    progress: Number(userState.progress) || 0,
    correctCount: Number(userState.correctCount) || 0,
    warnings: Number(userState.warnings) || 0,
  };
};

module.exports = {
  getState,
  saveState,
  ensureGuildState,
  ensureChannelState,
  ensureUserState,
  recordCorrectCount,
  recordWrongCount,
  getChannelSnapshot,
  getUserSnapshot,
};