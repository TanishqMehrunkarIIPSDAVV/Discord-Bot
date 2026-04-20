const fs = require("node:fs");
const path = require("node:path");

const POINTS_PER_MINUTE = 0.1; // 10 minutes = 1 point
const DATA_PATH = path.join(__dirname, "..", "data", "vc-points.json");
const LEADERBOARD_TIMEFRAMES = Object.freeze({
  ALL: "all",
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
});

const MILESTONES = [
  { points: 50, name: "🎧 ✦ 𝐕𝐂 𝐍𝐄𝐖𝐁𝐈𝐄 ✦ 🎧", roleId: "1491883856083550228" },
  { points: 100, name: "💬 ✦ 𝐕𝐂 𝐋𝐈𝐒𝐓𝐄𝐍𝐄𝐑 ✦ 💬", roleId: "1491884162905280662" },
  { points: 200, name: "🎙️ ✦ 𝐕𝐂 𝐑𝐄𝐆𝐔𝐋𝐀𝐑 ✦ 🎙️", roleId: "1491884351711875082" },
  { points: 400, name: "🔥 ✦ 𝐀𝐃𝐃𝐀 𝐀𝐂𝐓𝐈𝐕𝐄 ✦ 🔥", roleId: "1491884436399194373" },
  { points: 1000, name: "⚡ ✦ 𝐕𝐂 𝐏𝐑𝐎 ✦ ⚡", roleId: "1491884535955198012" },
  { points: 2000, name: "💫 ✦ 𝐓𝐀𝐏𝐑𝐈 𝐕𝐈𝐁𝐄𝐑 ✦ 💫", roleId: "1491884706667696188" },
  { points: 4000, name: "👑 ✦ 𝐀𝐃𝐃𝐀 𝐒𝐓𝐀𝐑 ✦ 👑", roleId: "1491884784677290168" },
  { points: 8500, name: "💎 ✦ 𝐕𝐂 𝐄𝐋𝐈𝐓𝐄 ✦ 💎", roleId: "1491884879808299088" },
  { points: 10000, name: "🌟 ✦ 𝐓𝐀𝐏𝐑𝐈 𝐋𝐄𝐆𝐄𝐍𝐃 ✦ 🌟", roleId: "1491885038189674567" },
  { points: 35000, name: "🚀 ✦ 𝐀𝐃𝐃𝐀 𝐈𝐂𝐎𝐍 ✦ 🚀", roleId: "1491885111652646933" },
];

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

const normalizeLeaderboardTimeframe = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return LEADERBOARD_TIMEFRAMES.ALL;

  if (["daily", "day", "d"].includes(normalized)) return LEADERBOARD_TIMEFRAMES.DAILY;
  if (["weekly", "week", "w"].includes(normalized)) return LEADERBOARD_TIMEFRAMES.WEEKLY;
  if (["monthly", "month", "m"].includes(normalized)) return LEADERBOARD_TIMEFRAMES.MONTHLY;
  if (["all", "alltime", "all-time", "lifetime", "overall", "a"].includes(normalized)) {
    return LEADERBOARD_TIMEFRAMES.ALL;
  }

  return LEADERBOARD_TIMEFRAMES.ALL;
};

const getLeaderboardTimeframeLabel = (timeframe) => {
  const normalized = normalizeLeaderboardTimeframe(timeframe);
  if (normalized === LEADERBOARD_TIMEFRAMES.DAILY) return "Daily";
  if (normalized === LEADERBOARD_TIMEFRAMES.WEEKLY) return "Weekly";
  if (normalized === LEADERBOARD_TIMEFRAMES.MONTHLY) return "Monthly";
  return "All Time";
};

const getUtcDateKey = (valueMs) => {
  const date = new Date(valueMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getUtcNextDayStartMs = (valueMs) => {
  const date = new Date(valueMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1, 0, 0, 0, 0);
};

const getLeaderboardRangeStartMs = (timeframe, nowMs = Date.now()) => {
  const normalized = normalizeLeaderboardTimeframe(timeframe);
  const now = new Date(nowMs);

  if (normalized === LEADERBOARD_TIMEFRAMES.DAILY) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0);
  }

  if (normalized === LEADERBOARD_TIMEFRAMES.WEEKLY) {
    const weekday = now.getUTCDay(); // Sunday=0
    const daysFromMonday = (weekday + 6) % 7;
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday, 0, 0, 0, 0);
  }

  if (normalized === LEADERBOARD_TIMEFRAMES.MONTHLY) {
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
  }

  return null;
};

const getDateKeysInRange = (startMs, endMs) => {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  const keys = [];
  let cursor = startMs;
  while (cursor < endMs) {
    keys.push(getUtcDateKey(cursor));
    cursor = getUtcNextDayStartMs(cursor);
  }
  return keys;
};

const getPendingMinutes = (guildId, userId, nowMs = Date.now()) => {
  const data = loadStore();
  const session = data.activeSessions[sessionKey(guildId, userId)];
  if (!session) return 0;

  const start = Number(session.startedAt) || nowMs;
  let endTime = nowMs;

  // If paused, use pausedAt instead of current time
  if (session.pausedAt) {
    endTime = Number(session.pausedAt);
  }

  const elapsedMs = Math.max(0, endTime - start);
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
      dailyMinutes: {},
      lastUpdatedAt: Date.now(),
    };
  }

  if (!data.guilds[guildId].users[userId].dailyMinutes || typeof data.guilds[guildId].users[userId].dailyMinutes !== "object") {
    data.guilds[guildId].users[userId].dailyMinutes = {};
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
  const todayKey = getUtcDateKey(Date.now());
  entry.dailyMinutes[todayKey] = Number(entry.dailyMinutes[todayKey] || 0) + safeMinutes;
  entry.lastUpdatedAt = Date.now();
  return pointsDelta;
};

const awardSessionDuration = (guildId, userId, startMs, endMs) => {
  const safeStartMs = Number(startMs);
  const safeEndMs = Number(endMs);
  if (!Number.isFinite(safeStartMs) || !Number.isFinite(safeEndMs) || safeEndMs <= safeStartMs) return 0;

  const entry = ensureGuildUser(guildId, userId);
  let totalMinutes = 0;
  let cursor = safeStartMs;

  while (cursor < safeEndMs) {
    const segmentEnd = Math.min(safeEndMs, getUtcNextDayStartMs(cursor));
    const segmentMinutes = Math.max(0, (segmentEnd - cursor) / 60000);
    if (segmentMinutes > 0) {
      const dateKey = getUtcDateKey(cursor);
      entry.dailyMinutes[dateKey] = Number(entry.dailyMinutes[dateKey] || 0) + segmentMinutes;
      totalMinutes += segmentMinutes;
    }

    cursor = segmentEnd;
  }

  if (totalMinutes <= 0) return 0;

  const pointsDelta = totalMinutes * POINTS_PER_MINUTE;
  entry.trackedMinutes = Number(entry.trackedMinutes || 0) + totalMinutes;
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
  
  // If paused, calculate from pause time, otherwise from now
  let effectiveEnd = end;
  if (session.pausedAt) {
    effectiveEnd = Number(session.pausedAt);
  }

  const pointsDelta = awardSessionDuration(guildId, userId, start, effectiveEnd);
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

const pauseSession = (guildId, userId, pausedAtMs = Date.now()) => {
  const data = loadStore();
  const key = sessionKey(guildId, userId);
  const session = data.activeSessions[key];
  if (!session || session.pausedAt) return false; // Already paused or not in session

  session.pausedAt = Number(pausedAtMs) || Date.now();
  saveStore();
  return true;
};

const resumeSession = (guildId, userId, resumedAtMs = Date.now()) => {
  const data = loadStore();
  const key = sessionKey(guildId, userId);
  const session = data.activeSessions[key];
  if (!session || !session.pausedAt) return false; // Not paused or not in session

  const pausedMs = Number(session.pausedAt);
  const resumeMs = Number(resumedAtMs) || Date.now();
  const pausedDuration = resumeMs - pausedMs;

  // Shift session start time forward by pause duration
  session.startedAt = Number(session.startedAt) + pausedDuration;
  session.pausedAt = null;
  saveStore();
  return true;
};

const getCurrentMilestone = (points) => {
  let current = null;
  for (const milestone of MILESTONES) {
    if (points >= milestone.points) {
      current = milestone;
    } else {
      break;
    }
  }
  return current;
};

const getNextMilestone = (points) => {
  for (const milestone of MILESTONES) {
    if (points < milestone.points) {
      return milestone;
    }
  }
  return null;
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

const getSessionPendingMinutesInRange = (session, rangeStartMs, nowMs) => {
  const sessionStart = Number(session?.startedAt);
  if (!Number.isFinite(sessionStart)) return 0;

  const effectiveEnd = session?.pausedAt ? Number(session.pausedAt) : nowMs;
  if (!Number.isFinite(effectiveEnd) || effectiveEnd <= sessionStart) return 0;

  const overlapStart = Math.max(sessionStart, rangeStartMs);
  const overlapMs = Math.max(0, effectiveEnd - overlapStart);
  return overlapMs / 60000;
};

const getTrackedMinutesInRange = (entry, rangeStartMs, rangeEndMs) => {
  const dailyMinutes = entry?.dailyMinutes && typeof entry.dailyMinutes === "object" ? entry.dailyMinutes : {};
  const keys = getDateKeysInRange(rangeStartMs, rangeEndMs);

  let total = 0;
  for (const key of keys) {
    total += Number(dailyMinutes[key] || 0);
  }

  return total;
};

const getLeaderboard = (guildId, limit = 10, timeframe = LEADERBOARD_TIMEFRAMES.ALL) => {
  const data = loadStore();
  const guild = data.guilds[guildId];
  const users = guild?.users && typeof guild.users === "object" ? guild.users : {};
  const combined = new Map();
  const normalizedTimeframe = normalizeLeaderboardTimeframe(timeframe);
  const nowMs = Date.now();
  const rangeStartMs = getLeaderboardRangeStartMs(normalizedTimeframe, nowMs);

  for (const [userId, value] of Object.entries(users)) {
    const trackedMinutes =
      normalizedTimeframe === LEADERBOARD_TIMEFRAMES.ALL
        ? Number(value?.trackedMinutes || 0)
        : getTrackedMinutesInRange(value, rangeStartMs, nowMs);

    combined.set(userId, {
      userId,
      points: trackedMinutes * POINTS_PER_MINUTE,
      trackedMinutes,
    });
  }

  for (const session of Object.values(data.activeSessions || {})) {
    if (session.guildId !== guildId) continue;
    const pendingMinutes =
      normalizedTimeframe === LEADERBOARD_TIMEFRAMES.ALL
        ? getPendingMinutes(guildId, session.userId, nowMs)
        : getSessionPendingMinutesInRange(session, rangeStartMs, nowMs);

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
  LEADERBOARD_TIMEFRAMES,
  MILESTONES,
  loadStore,
  saveStore,
  startSession,
  stopSession,
  dropSession,
  pauseSession,
  resumeSession,
  getUserStats,
  getLeaderboard,
  normalizeLeaderboardTimeframe,
  getLeaderboardTimeframeLabel,
  listActiveSessions,
  getCurrentMilestone,
  getNextMilestone,
};
