const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const dataPath = path.join(__dirname, "..", "data", "user-ratings.json");

const RATING_FIELDS = [
  { key: "behavior", label: "Behavior" },
  { key: "pfp", label: "PFP" },
  { key: "profileEffect", label: "Profile Effect" },
  { key: "deco", label: "Deco" },
  { key: "overall", label: "Overall" },
];

const DEFAULT_STATE = {
  prompts: {},
  ratings: {},
  channels: {},
};

const DEFAULT_MESSAGE_WINDOW_SIZE = 8;
const DEFAULT_MESSAGE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_PROMPT_COOLDOWN_MS = 30 * 60 * 1000;
const DEFAULT_PROMPT_EXPIRE_MS = 4 * 60 * 60 * 1000;
const DEFAULT_VOICE_ACTIVITY_THRESHOLD = 6;
const DEFAULT_VOICE_ACTIVITY_INTERVAL_MS = 60 * 1000;

let cachedState = null;

const toInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const cloneDefaultState = () => ({
  prompts: {},
  ratings: {},
  channels: {},
});

const normalizePrompt = (prompt, promptId) => {
  if (!prompt || typeof prompt !== "object") {
    return null;
  }

  const participants = Array.isArray(prompt.participants)
    ? [...new Set(prompt.participants.map((value) => String(value)).filter(Boolean))]
    : [];

  if (participants.length !== 2) {
    return null;
  }

  return {
    promptId: String(prompt.promptId || promptId),
    guildId: String(prompt.guildId || ""),
    channelId: String(prompt.channelId || ""),
    participants: participants.sort(),
    createdAt: toInteger(prompt.createdAt, Date.now()),
    expiresAt: toInteger(prompt.expiresAt, Date.now()),
    ratedBy: prompt.ratedBy && typeof prompt.ratedBy === "object" ? prompt.ratedBy : {},
    closedAt: prompt.closedAt ? toInteger(prompt.closedAt, null) : null,
  };
};

const normalizeChannelState = (channelState) => {
  if (!channelState || typeof channelState !== "object") {
    return {
      recentMessages: [],
      lastPromptAt: 0,
      voiceActivity: {
        pairKey: "",
        participantIds: [],
        ticks: 0,
        lastSeenAt: 0,
        lastPromptAt: 0,
      },
    };
  }

  const recentMessages = Array.isArray(channelState.recentMessages)
    ? channelState.recentMessages
        .map((entry) => {
          if (!entry || typeof entry !== "object") return null;
          const userId = String(entry.userId || "").trim();
          if (!userId) return null;
          return {
            userId,
            at: toInteger(entry.at, Date.now()),
          };
        })
        .filter(Boolean)
    : [];

  return {
    recentMessages,
    lastPromptAt: toInteger(channelState.lastPromptAt, 0),
    voiceActivity: normalizeVoiceActivity(channelState.voiceActivity),
  };
};

const normalizeVoiceActivity = (voiceActivity) => {
  if (!voiceActivity || typeof voiceActivity !== "object") {
    return {
      pairKey: "",
      participantIds: [],
      ticks: 0,
      lastSeenAt: 0,
      lastPromptAt: 0,
    };
  }

  const participantIds = Array.isArray(voiceActivity.participantIds)
    ? [...new Set(voiceActivity.participantIds.map((value) => String(value)).filter(Boolean))]
    : [];

  return {
    pairKey: typeof voiceActivity.pairKey === "string" ? voiceActivity.pairKey : "",
    participantIds,
    ticks: Math.max(0, toInteger(voiceActivity.ticks, 0)),
    lastSeenAt: Math.max(0, toInteger(voiceActivity.lastSeenAt, 0)),
    lastPromptAt: Math.max(0, toInteger(voiceActivity.lastPromptAt, 0)),
  };
};

const normalizeState = (state) => {
  const normalized = cloneDefaultState();

  if (!state || typeof state !== "object") {
    return normalized;
  }

  if (state.prompts && typeof state.prompts === "object") {
    for (const [promptId, prompt] of Object.entries(state.prompts)) {
      const normalizedPrompt = normalizePrompt(prompt, promptId);
      if (normalizedPrompt) {
        normalized.prompts[normalizedPrompt.promptId] = normalizedPrompt;
      }
    }
  }

  if (state.ratings && typeof state.ratings === "object") {
    for (const [guildId, guildRatings] of Object.entries(state.ratings)) {
      if (!guildRatings || typeof guildRatings !== "object") continue;
      normalized.ratings[guildId] = {};

      for (const [targetUserId, entries] of Object.entries(guildRatings)) {
        if (!Array.isArray(entries)) continue;
        normalized.ratings[guildId][targetUserId] = entries
          .map((entry) => {
            if (!entry || typeof entry !== "object") return null;
            const scores = entry.scores && typeof entry.scores === "object" ? entry.scores : {};
            return {
              guildId: String(entry.guildId || guildId),
              targetUserId: String(entry.targetUserId || targetUserId),
              raterUserId: String(entry.raterUserId || ""),
              promptId: String(entry.promptId || ""),
              channelId: String(entry.channelId || ""),
              scores: {
                behavior: toInteger(scores.behavior, 0),
                pfp: toInteger(scores.pfp, 0),
                profileEffect: toInteger(scores.profileEffect, 0),
                deco: toInteger(scores.deco, 0),
                overall: toInteger(scores.overall, 0),
              },
              comment: typeof entry.comment === "string" ? entry.comment : "",
              createdAt: toInteger(entry.createdAt, Date.now()),
            };
          })
          .filter(Boolean);
      }
    }
  }

  if (state.channels && typeof state.channels === "object") {
    for (const [guildId, guildChannels] of Object.entries(state.channels)) {
      if (!guildChannels || typeof guildChannels !== "object") continue;
      normalized.channels[guildId] = {};

      for (const [channelId, channelState] of Object.entries(guildChannels)) {
        normalized.channels[guildId][channelId] = normalizeChannelState(channelState);
      }
    }
  }

  return normalized;
};

const loadState = () => {
  if (cachedState) {
    return cachedState;
  }

  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    cachedState = normalizeState(JSON.parse(raw));
  } catch {
    cachedState = cloneDefaultState();
  }

  return cachedState;
};

const saveState = (state) => {
  cachedState = normalizeState(state);
  fs.writeFileSync(dataPath, `${JSON.stringify(cachedState, null, 2)}\n`, "utf8");
};

const ensureGuildRatings = (state, guildId) => {
  if (!state.ratings[guildId] || typeof state.ratings[guildId] !== "object") {
    state.ratings[guildId] = {};
  }

  return state.ratings[guildId];
};

const ensureGuildChannels = (state, guildId) => {
  if (!state.channels[guildId] || typeof state.channels[guildId] !== "object") {
    state.channels[guildId] = {};
  }

  return state.channels[guildId];
};

const ensureChannelState = (state, guildId, channelId) => {
  const guildChannels = ensureGuildChannels(state, guildId);

  if (!guildChannels[channelId] || typeof guildChannels[channelId] !== "object") {
    guildChannels[channelId] = {
      recentMessages: [],
      lastPromptAt: 0,
      voiceActivity: {
        pairKey: "",
        participantIds: [],
        ticks: 0,
        lastSeenAt: 0,
        lastPromptAt: 0,
      },
    };
  }

  if (!Array.isArray(guildChannels[channelId].recentMessages)) {
    guildChannels[channelId].recentMessages = [];
  }

  if (!Number.isFinite(Number(guildChannels[channelId].lastPromptAt))) {
    guildChannels[channelId].lastPromptAt = 0;
  }

  guildChannels[channelId].voiceActivity = normalizeVoiceActivity(
    guildChannels[channelId].voiceActivity
  );

  return guildChannels[channelId];
};

const pruneChannelMessages = (channelState, now, windowMs) => {
  channelState.recentMessages = channelState.recentMessages.filter(
    (entry) => now - toInteger(entry.at, 0) <= windowMs
  );

  if (channelState.recentMessages.length > 20) {
    channelState.recentMessages = channelState.recentMessages.slice(-20);
  }
};

const getActivePromptForChannel = (state, guildId, channelId, now) => {
  for (const prompt of Object.values(state.prompts)) {
    if (!prompt || prompt.guildId !== guildId || prompt.channelId !== channelId) continue;
    if (prompt.closedAt) continue;
    if (toInteger(prompt.expiresAt, 0) <= now) continue;
    return prompt;
  }

  return null;
};

const getPairKey = (participantIds) => participantIds.map((id) => String(id)).sort().join(":");

const buildScoreAverage = (entries, field) => {
  if (!entries.length) return null;
  const sum = entries.reduce((total, entry) => total + toInteger(entry.scores?.[field], 0), 0);
  return Number((sum / entries.length).toFixed(1));
};

const recordConversationMessage = ({
  guildId,
  channelId,
  authorId,
  messageWindowSize = DEFAULT_MESSAGE_WINDOW_SIZE,
  messageWindowMs = DEFAULT_MESSAGE_WINDOW_MS,
  promptCooldownMs = DEFAULT_PROMPT_COOLDOWN_MS,
  promptExpireMs = DEFAULT_PROMPT_EXPIRE_MS,
}) => {
  if (!guildId || !channelId || !authorId) {
    return { shouldPrompt: false };
  }

  const state = loadState();
  const now = Date.now();
  const channelState = ensureChannelState(state, guildId, channelId);

  channelState.recentMessages.push({
    userId: String(authorId),
    at: now,
  });

  pruneChannelMessages(channelState, now, messageWindowMs);

  const uniqueParticipants = [...new Set(channelState.recentMessages.map((entry) => entry.userId))];

  if (uniqueParticipants.length !== 2) {
    saveState(state);
    return { shouldPrompt: false };
  }

  const participantCounts = uniqueParticipants.map(
    (participantId) =>
      channelState.recentMessages.filter((entry) => entry.userId === participantId).length
  );

  if (participantCounts.some((count) => count < 2)) {
    saveState(state);
    return { shouldPrompt: false };
  }

  if (channelState.recentMessages.length < Math.max(2, Number(messageWindowSize) || DEFAULT_MESSAGE_WINDOW_SIZE)) {
    saveState(state);
    return { shouldPrompt: false };
  }

  if (now - toInteger(channelState.lastPromptAt, 0) < promptCooldownMs) {
    saveState(state);
    return { shouldPrompt: false };
  }

  const activePrompt = getActivePromptForChannel(state, guildId, channelId, now);
  if (activePrompt) {
    saveState(state);
    return { shouldPrompt: false };
  }

  const promptId = crypto.randomUUID();
  const prompt = {
    promptId,
    guildId: String(guildId),
    channelId: String(channelId),
    participants: uniqueParticipants.sort(),
    createdAt: now,
    expiresAt: now + Math.max(promptExpireMs, promptCooldownMs),
    ratedBy: {},
    closedAt: null,
  };

  state.prompts[promptId] = prompt;
  channelState.lastPromptAt = now;
  channelState.recentMessages = [];
  saveState(state);

  return { shouldPrompt: true, prompt };
};

const clearVoiceActivity = ({ guildId, channelId }) => {
  if (!guildId || !channelId) return;

  const state = loadState();
  const channelState = ensureChannelState(state, guildId, channelId);
  channelState.voiceActivity = {
    pairKey: "",
    participantIds: [],
    ticks: 0,
    lastSeenAt: 0,
    lastPromptAt: channelState.voiceActivity?.lastPromptAt || 0,
  };
  saveState(state);
};

const recordVoiceConversation = ({
  guildId,
  channelId,
  participantIds,
  voiceActivityThreshold = DEFAULT_VOICE_ACTIVITY_THRESHOLD,
  voiceActivityIntervalMs = DEFAULT_VOICE_ACTIVITY_INTERVAL_MS,
  promptCooldownMs = DEFAULT_PROMPT_COOLDOWN_MS,
  promptExpireMs = DEFAULT_PROMPT_EXPIRE_MS,
}) => {
  if (!guildId || !channelId) {
    return { shouldPrompt: false };
  }

  const uniqueParticipants = [...new Set((participantIds || []).map((value) => String(value)).filter(Boolean))];
  if (uniqueParticipants.length !== 2) {
    clearVoiceActivity({ guildId, channelId });
    return { shouldPrompt: false };
  }

  const state = loadState();
  const now = Date.now();
  const channelState = ensureChannelState(state, guildId, channelId);
  const voiceActivity = channelState.voiceActivity;
  const pairKey = getPairKey(uniqueParticipants);

  if (voiceActivity.pairKey !== pairKey || now - voiceActivity.lastSeenAt > voiceActivityIntervalMs * 2) {
    voiceActivity.pairKey = pairKey;
    voiceActivity.participantIds = uniqueParticipants;
    voiceActivity.ticks = 0;
  }

  voiceActivity.lastSeenAt = now;
  voiceActivity.participantIds = uniqueParticipants;
  voiceActivity.ticks += 1;

  const activePrompt = getActivePromptForChannel(state, guildId, channelId, now);
  if (activePrompt) {
    saveState(state);
    return { shouldPrompt: false };
  }

  if (voiceActivity.ticks < Math.max(2, Number(voiceActivityThreshold) || DEFAULT_VOICE_ACTIVITY_THRESHOLD)) {
    saveState(state);
    return { shouldPrompt: false };
  }

  if (now - toInteger(channelState.lastPromptAt, 0) < promptCooldownMs) {
    saveState(state);
    return { shouldPrompt: false };
  }

  const promptId = crypto.randomUUID();
  const prompt = {
    promptId,
    guildId: String(guildId),
    channelId: String(channelId),
    participants: uniqueParticipants.sort(),
    createdAt: now,
    expiresAt: now + Math.max(promptExpireMs, promptCooldownMs),
    ratedBy: {},
    closedAt: null,
  };

  state.prompts[promptId] = prompt;
  channelState.lastPromptAt = now;
  channelState.voiceActivity.ticks = 0;
  channelState.voiceActivity.lastPromptAt = now;
  saveState(state);

  return { shouldPrompt: true, prompt };
};

const getPrompt = (promptId) => {
  if (!promptId) return null;

  const state = loadState();
  const prompt = state.prompts[String(promptId)];
  if (!prompt) return null;

  if (prompt.closedAt) return null;
  if (toInteger(prompt.expiresAt, 0) <= Date.now()) return null;

  return prompt;
};

const createRatingEntry = ({
  guildId,
  targetUserId,
  raterUserId,
  promptId,
  channelId,
  scores,
}) => ({
  guildId: String(guildId),
  targetUserId: String(targetUserId),
  raterUserId: String(raterUserId),
  promptId: String(promptId),
  channelId: String(channelId),
  scores: {
    behavior: toInteger(scores.behavior, 0),
    pfp: toInteger(scores.pfp, 0),
    profileEffect: toInteger(scores.profileEffect, 0),
    deco: toInteger(scores.deco, 0),
    overall: toInteger(scores.overall, 0),
  },
  comment: typeof scores.comment === "string" ? scores.comment : "",
  createdAt: Date.now(),
});

const submitPromptRating = ({ promptId, raterUserId, scores }) => {
  const state = loadState();
  const prompt = state.prompts[String(promptId)];

  if (!prompt) {
    return { ok: false, reason: "This rating prompt no longer exists." };
  }

  if (prompt.closedAt) {
    return { ok: false, reason: "This rating prompt has already been completed." };
  }

  if (toInteger(prompt.expiresAt, 0) <= Date.now()) {
    return { ok: false, reason: "This rating prompt has expired." };
  }

  const raterId = String(raterUserId);
  if (!prompt.participants.includes(raterId)) {
    return { ok: false, reason: "You were not part of this conversation prompt." };
  }

  if (prompt.ratedBy[raterId]) {
    return { ok: false, reason: "You have already rated this conversation." };
  }

  const targetUserId = prompt.participants.find((id) => id !== raterId);
  if (!targetUserId) {
    return { ok: false, reason: "Could not determine the other user to rate." };
  }

  for (const field of RATING_FIELDS) {
    const value = toInteger(scores?.[field.key], 0);
    if (value < 1 || value > 5) {
      return { ok: false, reason: `${field.label} must be a number from 1 to 5.` };
    }
  }

  const guildRatings = ensureGuildRatings(state, prompt.guildId);
  if (!guildRatings[targetUserId]) {
    guildRatings[targetUserId] = [];
  }

  const entry = createRatingEntry({
    guildId: prompt.guildId,
    targetUserId,
    raterUserId: raterId,
    promptId: prompt.promptId,
    channelId: prompt.channelId,
    scores,
  });

  guildRatings[targetUserId].push(entry);
  prompt.ratedBy[raterId] = { targetUserId, submittedAt: Date.now() };

  if (prompt.participants.every((participantId) => prompt.ratedBy[participantId])) {
    prompt.closedAt = Date.now();
  }

  saveState(state);

  return {
    ok: true,
    targetUserId,
    complete: Boolean(prompt.closedAt),
    entry,
    prompt,
  };
};

const getRatingSummary = (guildId, targetUserId) => {
  const state = loadState();
  const guildRatings = state.ratings[String(guildId)] || {};
  const entries = Array.isArray(guildRatings[String(targetUserId)]) ? guildRatings[String(targetUserId)] : [];

  const averages = {};
  for (const field of RATING_FIELDS) {
    averages[field.key] = buildScoreAverage(entries, field.key);
  }

  return {
    count: entries.length,
    averages,
    latest: entries.slice(-5).reverse(),
  };
};

module.exports = {
  RATING_FIELDS,
  recordConversationMessage,
  recordVoiceConversation,
  clearVoiceActivity,
  getPrompt,
  submitPromptRating,
  getRatingSummary,
};