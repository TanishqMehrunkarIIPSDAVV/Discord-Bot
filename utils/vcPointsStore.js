const fs = require("node:fs");
const path = require("node:path");

const POINTS_PER_MINUTE = 0.1; // 10 minutes = 1 point
const DATA_PATH = path.join(__dirname, "..", "data", "vc-points.json");

let cache = null;

const createDefaultStore = () => ({
  guilds: {},
  activeSessions: {},
  updatedAt: Date.now(),
});

const loadStore = () => {
  if (cache) return cache;

  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = {
      guilds: parsed.guilds && typeof parsed.guilds === "object" ? parsed.guilds : {},
      activeSessions:
        parsed.activeSessions && typeof parsed.activeSessions === "object"
          ? parsed.activeSessions
          : {},
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
    return cache;
  } catch {
    cache = createDefaultStore();
    saveStore();
    return cache;
  }
};

const saveStore = () => {
  const data = loadStore();
  data.updatedAt = Date.now();
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const sessionKey = (guildId, userId) => `${guildId}:${userId}`;

const getPendingMinutes = (guildId, userId, nowMs = Date.now()) => {
  const data = loadStore();
  const session = data.activeSessions[sessionKey(guildId, userId)];
  if (!session) return 0;

  const start = Number(session.startedAt) || nowMs;
  const elapsedMs = Math.max(0, nowMs - start);
  return elapsedMs / 60000;
};

const ensureGuildUser = (guildId, userId) => {
  const data = loadStore();
  if (!data.guilds[guildId] || typeof data.guilds[guildId] !== "object") {
    data.guilds[guildId] = { users: {} };
  }

  if (!data.guilds[guildId].users || typeof data.guilds[guildId].users !== "object") {
    data.guilds[guildId].users = {};
  }

  if (!data.guilds[guildId].users[userId] || typeof data.guilds[guildId].users[userId] !== "object") {
    data.guilds[guildId].users[userId] = {
      points: 0,
      trackedMinutes: 0,
      lastUpdatedAt: Date.now(),
    };
  }

  return data.guilds[guildId].users[userId];
};

const awardMinutes = (guildId, userId, minutesDelta) => {
  const safeMinutes = Number(minutesDelta);
  if (!Number.isFinite(safeMinutes) || safeMinutes <= 0) return 0;

  const entry = ensureGuildUser(guildId, userId);
  const pointsDelta = safeMinutes * POINTS_PER_MINUTE;
  entry.trackedMinutes = Number(entry.trackedMinutes || 0) + safeMinutes;
  entry.points = Number(entry.points || 0) + pointsDelta;
  entry.lastUpdatedAt = Date.now();
  return pointsDelta;
};

const startSession = (guildId, userId, startedAtMs = Date.now()) => {
  const data = loadStore();
  const key = sessionKey(guildId, userId);
  if (data.activeSessions[key]) return false;

  data.activeSessions[key] = {
    guildId,
    userId,
    startedAt: Number(startedAtMs) || Date.now(),
  };
  saveStore();
  return true;
};

const stopSession = (guildId, userId, endedAtMs = Date.now()) => {
  const data = loadStore();
  const key = sessionKey(guildId, userId);
  const session = data.activeSessions[key];
  if (!session) return 0;

  const end = Number(endedAtMs) || Date.now();
  const start = Number(session.startedAt) || end;
  const elapsedMs = Math.max(0, end - start);
  const elapsedMinutes = elapsedMs / 60000;

  const pointsDelta = awardMinutes(guildId, userId, elapsedMinutes);
  delete data.activeSessions[key];
  saveStore();
  return pointsDelta;
};

const dropSession = (guildId, userId) => {
  const data = loadStore();
  const key = sessionKey(guildId, userId);
  if (!data.activeSessions[key]) return false;
  delete data.activeSessions[key];
  saveStore();
  return true;
};

const getUserStats = (guildId, userId) => {
  const entry = ensureGuildUser(guildId, userId);
  const pendingMinutes = getPendingMinutes(guildId, userId);
  const trackedMinutes = Number(entry.trackedMinutes || 0) + pendingMinutes;
  const points = Number(entry.points || 0) + pendingMinutes * POINTS_PER_MINUTE;

  return {
    points,
    trackedMinutes,
    trackedHours: trackedMinutes / 60,
    lastUpdatedAt: Number(entry.lastUpdatedAt || 0),
  };
};

const getLeaderboard = (guildId, limit = 10) => {
  const data = loadStore();
  const guild = data.guilds[guildId];
  const users = guild?.users && typeof guild.users === "object" ? guild.users : {};
  const combined = new Map();

  for (const [userId, value] of Object.entries(users)) {
    combined.set(userId, {
      userId,
      points: Number(value?.points || 0),
      trackedMinutes: Number(value?.trackedMinutes || 0),
    });
  }

  for (const session of Object.values(data.activeSessions || {})) {
    if (session.guildId !== guildId) continue;
    const pendingMinutes = getPendingMinutes(guildId, session.userId);
    const existing = combined.get(session.userId) || {
      userId: session.userId,
      points: 0,
      trackedMinutes: 0,
    };

    existing.trackedMinutes += pendingMinutes;
    existing.points += pendingMinutes * POINTS_PER_MINUTE;
    combined.set(session.userId, existing);
  }

  return Array.from(combined.values())
    .filter((entry) => entry.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, Math.max(1, Number(limit) || 10));
};

const listActiveSessions = () => {
  const data = loadStore();
  return Object.values(data.activeSessions || {});
};

module.exports = {
  POINTS_PER_MINUTE,
  loadStore,
  saveStore,
  startSession,
  stopSession,
  dropSession,
  getUserStats,
  getLeaderboard,
  listActiveSessions,
};
