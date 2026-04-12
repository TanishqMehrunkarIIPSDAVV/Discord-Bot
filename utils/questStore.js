const fs = require("node:fs");
const path = require("node:path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");

const DATA_PATH = path.join(__dirname, "..", "data", "quest-state.json");
const MIN_REFRESH_MS = 2 * 60 * 60 * 1000;
const MAX_REFRESH_MS = 3 * 60 * 60 * 1000;
const QUEST_PANEL_BUTTON_PREFIX = "quest_accept:";
const QUEST_TRASH_BUTTON_ID = "quest_trash_active";
const QUEST_LEVEL_XP_STEP = 100;
const QUEST_HISTORY_LIMIT = 20;
const ECHO_CHAT_COOLDOWN_MS = 8_000;
const QUEST_TRASH_COOLDOWN_MS = 3 * 60 * 1000;
const USER_QUEST_CHOICES_COUNT = 4;

const CHAT_QUEST_TEMPLATES = [
  {
    key: "chat-sprint",
    icon: "💬",
    title: "Chat Sprint",
    kind: "chat",
    unit: "messages",
    minTarget: 12,
    maxTarget: 18,
    rewardXpMin: 20,
    rewardXpMax: 30,
    buildDescription: (target) => `Send ${target} messages in any server text channel.`,
  },
  {
    key: "chat-marathon",
    icon: "🏃",
    title: "Chat Marathon",
    kind: "chat",
    unit: "messages",
    minTarget: 24,
    maxTarget: 34,
    rewardXpMin: 34,
    rewardXpMax: 48,
    buildDescription: (target) => `Keep the momentum and send ${target} messages today.`,
  },
  {
    key: "conversation-driver",
    icon: "🗣️",
    title: "Conversation Driver",
    kind: "chat",
    unit: "messages",
    minTarget: 20,
    maxTarget: 28,
    rewardXpMin: 28,
    rewardXpMax: 40,
    buildDescription: (target) => `Keep the chat moving by sending ${target} messages.`,
  },
  {
    key: "topic-starter",
    icon: "🧠",
    title: "Topic Starter",
    kind: "chat",
    unit: "messages",
    minTarget: 14,
    maxTarget: 20,
    rewardXpMin: 22,
    rewardXpMax: 32,
    buildDescription: (target) => `Start fresh conversations and send ${target} thoughtful messages.`,
  },
  {
    key: "chat-burst",
    icon: "⚡",
    title: "Chat Burst",
    kind: "chat",
    unit: "messages",
    minTarget: 8,
    maxTarget: 14,
    rewardXpMin: 15,
    rewardXpMax: 24,
    buildDescription: (target) => `Fire off ${target} messages without leaving the server chat flow.`,
  },
  {
    key: "echo-word",
    icon: "🪞",
    title: "Echo Word",
    kind: "chat",
    unit: "messages",
    minTarget: 4,
    maxTarget: 7,
    rewardXpMin: 20,
    rewardXpMax: 34,
    chatMode: "echo_phrase",
    repeatWordCount: 3,
    buildDescription: (target) =>
      `Send ${target} quality messages where one word repeats at least 3 times (example: chai chai chai). Keep it natural, no spam floods.`,
  },
  {
    key: "emoji-vibes",
    icon: "😄",
    title: "Emoji Vibes",
    kind: "chat",
    unit: "messages",
    minTarget: 10,
    maxTarget: 16,
    rewardXpMin: 18,
    rewardXpMax: 26,
    buildDescription: (target) => `Light up the chat and send ${target} lively messages.`,
  },
  {
    key: "chat-comeback",
    icon: "🔁",
    title: "Chat Comeback",
    kind: "chat",
    unit: "messages",
    minTarget: 16,
    maxTarget: 24,
    rewardXpMin: 24,
    rewardXpMax: 36,
    buildDescription: (target) => `Drop back into chat and complete ${target} messages this cycle.`,
  },
];

const VOICE_QUEST_TEMPLATES = [
  {
    key: "vc-warmup",
    icon: "🎧",
    title: "VC Warmup",
    kind: "voice",
    unit: "minutes",
    minTarget: 10,
    maxTarget: 15,
    rewardXpMin: 35,
    rewardXpMax: 48,
    buildDescription: (target) => `Stay in a voice channel for ${target} minutes.`,
  },
  {
    key: "vc-quick-pop",
    icon: "🎯",
    title: "Quick VC Pop",
    kind: "voice",
    unit: "minutes",
    minTarget: 8,
    maxTarget: 12,
    rewardXpMin: 28,
    rewardXpMax: 40,
    buildDescription: (target) => `Hop into VC and hang around for ${target} minutes.`,
  },
  {
    key: "vc-hangout",
    icon: "🔊",
    title: "VC Hangout",
    kind: "voice",
    unit: "minutes",
    minTarget: 18,
    maxTarget: 25,
    rewardXpMin: 45,
    rewardXpMax: 60,
    buildDescription: (target) => `Spend ${target} minutes in voice chat.`,
  },
  {
    key: "vc-campfire",
    icon: "🔥",
    title: "VC Campfire",
    kind: "voice",
    unit: "minutes",
    minTarget: 15,
    maxTarget: 22,
    rewardXpMin: 40,
    rewardXpMax: 55,
    buildDescription: (target) => `Sit back and keep a voice conversation going for ${target} minutes.`,
  },
  {
    key: "duo-session",
    icon: "👥",
    title: "Duo Session",
    kind: "voice",
    unit: "minutes",
    minTarget: 10,
    maxTarget: 16,
    rewardXpMin: 44,
    rewardXpMax: 62,
    requiredMembers: 2,
    voiceMode: "active",
    buildDescription: (target) => `Stay in VC with at least 1 other person for ${target} minutes.`,
  },
  {
    key: "trio-party",
    icon: "🧑‍🤝‍🧑",
    title: "Trio Party",
    kind: "voice",
    unit: "minutes",
    minTarget: 9,
    maxTarget: 14,
    rewardXpMin: 52,
    rewardXpMax: 72,
    requiredMembers: 3,
    voiceMode: "active",
    buildDescription: (target) => `Stay in VC with at least 2 other people for ${target} minutes.`,
  },
  {
    key: "muted-monk",
    icon: "🔇",
    title: "Muted Monk",
    kind: "voice",
    unit: "minutes",
    minTarget: 6,
    maxTarget: 10,
    rewardXpMin: 26,
    rewardXpMax: 38,
    voiceMode: "muted",
    buildDescription: (target) => `Stay muted in VC for ${target} minutes as a meme challenge.`,
  },
  {
    key: "deaf-mode",
    icon: "🙉",
    title: "Deafen Mode",
    kind: "voice",
    unit: "minutes",
    minTarget: 4,
    maxTarget: 8,
    rewardXpMin: 22,
    rewardXpMax: 34,
    voiceMode: "deafened",
    buildDescription: (target) => `Stay deafened in VC for ${target} minutes as a joking quest.`,
  },
  {
    key: "vc-deep-session",
    icon: "🎙️",
    title: "Deep VC Session",
    kind: "voice",
    unit: "minutes",
    minTarget: 25,
    maxTarget: 35,
    rewardXpMin: 60,
    rewardXpMax: 80,
    voiceMode: "active",
    buildDescription: (target) => `Stick around in voice chat for ${target} minutes.`,
  },
  {
    key: "vc-night-shift",
    icon: "🌙",
    title: "VC Night Shift",
    kind: "voice",
    unit: "minutes",
    minTarget: 28,
    maxTarget: 40,
    rewardXpMin: 66,
    rewardXpMax: 90,
    voiceMode: "active",
    buildDescription: (target) => `Hold a long VC session and stay connected for ${target} minutes.`,
  },
  {
    key: "vc-lounge",
    icon: "🛋️",
    title: "VC Lounge",
    kind: "voice",
    unit: "minutes",
    minTarget: 20,
    maxTarget: 30,
    rewardXpMin: 50,
    rewardXpMax: 70,
    voiceMode: "active",
    buildDescription: (target) => `Chill in voice and complete ${target} minutes of active presence.`,
  },
];

const ALL_QUEST_TEMPLATES = [...CHAT_QUEST_TEMPLATES, ...VOICE_QUEST_TEMPLATES];

let cache = null;

const createDefaultStore = () => ({
  guilds: {},
  updatedAt: Date.now(),
});

const loadStore = () => {
  if (cache) return cache;

  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    cache = {
      guilds: parsed.guilds && typeof parsed.guilds === "object" ? parsed.guilds : {},
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

const ensureGuildState = (guildId) => {
  const data = loadStore();

  if (!data.guilds[guildId] || typeof data.guilds[guildId] !== "object") {
    data.guilds[guildId] = {
      refreshAt: 0,
      cycleStartedAt: 0,
      users: {},
    };
  }

  const guildState = data.guilds[guildId];
  if (!guildState.users || typeof guildState.users !== "object") guildState.users = {};
  guildState.refreshAt = Number(guildState.refreshAt) || 0;
  guildState.cycleStartedAt = Number(guildState.cycleStartedAt) || 0;

  return guildState;
};

const ensureUserState = (guildState, userId) => {
  if (!guildState.users[userId] || typeof guildState.users[userId] !== "object") {
    guildState.users[userId] = {
      activeQuestId: null,
      activeQuestData: null,
      activeQuestProgress: 0,
      activeQuestLastProgressAt: null,
      activeQuestLastChatCountAt: null,
      questTrashCooldownUntil: null,
      availableQuests: [],
      acceptedAt: null,
      completedCount: 0,
      completedQuestIds: [],
      questXp: 0,
      questHistory: [],
    };
  }

  const userState = guildState.users[userId];
  userState.activeQuestId = typeof userState.activeQuestId === "string" ? userState.activeQuestId : null;
  userState.activeQuestData = userState.activeQuestData && typeof userState.activeQuestData === "object"
    ? userState.activeQuestData
    : null;
  userState.activeQuestProgress = Number(userState.activeQuestProgress) || 0;
  userState.activeQuestLastProgressAt = Number(userState.activeQuestLastProgressAt) || null;
  userState.activeQuestLastChatCountAt = Number(userState.activeQuestLastChatCountAt) || null;
  userState.questTrashCooldownUntil = Number(userState.questTrashCooldownUntil) || null;
  if (!Array.isArray(userState.availableQuests)) userState.availableQuests = [];
  userState.acceptedAt = Number(userState.acceptedAt) || null;
  userState.completedCount = Number(userState.completedCount) || 0;
  userState.questXp = Number(userState.questXp) || 0;
  if (!Array.isArray(userState.completedQuestIds)) userState.completedQuestIds = [];
  if (!Array.isArray(userState.questHistory)) userState.questHistory = [];

  return userState;
};

const randomInt = (min, max) => {
  const lower = Math.ceil(min);
  const upper = Math.floor(max);
  return lower + Math.floor(Math.random() * (upper - lower + 1));
};

const shuffle = (items) => {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
};

const pickQuestTarget = (template) => randomInt(template.minTarget, template.maxTarget);

const pickQuestRewardXp = (template) => randomInt(template.rewardXpMin, template.rewardXpMax);

const buildQuestFromTemplate = (template, cycleId, index) => {
  const target = pickQuestTarget(template);
  const rewardXp = pickQuestRewardXp(template);
  return {
    id: `${cycleId}-${index + 1}-${template.key}`,
    key: template.key,
    icon: template.icon,
    title: template.title,
    kind: template.kind,
    unit: template.unit,
    chatMode: template.chatMode || null,
    repeatWordCount: Number(template.repeatWordCount) || 0,
    voiceMode: template.voiceMode || (template.kind === "voice" ? "active" : null),
    requiredMembers: Number(template.requiredMembers) || 1,
    target,
    rewardXp,
    description: template.buildDescription(target),
    createdAt: cycleId,
  };
};

const collectOccupiedQuestKeys = (guildState, excludeUserId = null) => {
  const occupied = new Set();
  for (const [otherUserId, otherStateRaw] of Object.entries(guildState.users || {})) {
    if (excludeUserId && otherUserId === excludeUserId) continue;
    const otherState = ensureUserState(guildState, otherUserId);
    if (otherState.activeQuestData?.key) {
      occupied.add(otherState.activeQuestData.key);
    }
    for (const quest of otherState.availableQuests || []) {
      if (quest?.key) occupied.add(quest.key);
    }
  }
  return occupied;
};

const pickTemplateForUser = (guildState, userId, avoidKeys = new Set()) => {
  const occupied = collectOccupiedQuestKeys(guildState, userId);
  const preferred = ALL_QUEST_TEMPLATES.filter((template) => !avoidKeys.has(template.key) && !occupied.has(template.key));
  if (preferred.length) return preferred[Math.floor(Math.random() * preferred.length)];

  const fallback = ALL_QUEST_TEMPLATES.filter((template) => !avoidKeys.has(template.key));
  if (fallback.length) return fallback[Math.floor(Math.random() * fallback.length)];

  return ALL_QUEST_TEMPLATES[Math.floor(Math.random() * ALL_QUEST_TEMPLATES.length)] || null;
};

const refillUserAvailableQuests = (guildState, userId, now = Date.now(), targetCount = USER_QUEST_CHOICES_COUNT) => {
  const userState = ensureUserState(guildState, userId);
  const activeQuest = userState.activeQuestData || null;

  const avoidKeys = new Set((userState.availableQuests || []).map((quest) => quest.key));
  if (activeQuest?.key) avoidKeys.add(activeQuest.key);

  let guard = 0;
  while (userState.availableQuests.length < targetCount && guard < 30) {
    guard += 1;
    const template = pickTemplateForUser(guildState, userId, avoidKeys);
    if (!template) break;
    avoidKeys.add(template.key);
    const uniqueIndex = userState.availableQuests.length + 1 + Math.floor(Math.random() * 99);
    userState.availableQuests.push(buildQuestFromTemplate(template, now, uniqueIndex));
  }
};

const rerollUserAvailableQuests = (guildState, userId, now = Date.now()) => {
  const userState = ensureUserState(guildState, userId);
  userState.availableQuests = [];
  refillUserAvailableQuests(guildState, userId, now, USER_QUEST_CHOICES_COUNT);
};

const getQuestLevel = (questXp) => Math.max(1, Math.floor(Number(questXp || 0) / QUEST_LEVEL_XP_STEP) + 1);

const getQuestXpProgress = (questXp) => {
  const safeXp = Math.max(0, Number(questXp) || 0);
  const level = getQuestLevel(safeXp);
  const xpIntoLevel = safeXp - (level - 1) * QUEST_LEVEL_XP_STEP;
  const xpNeeded = QUEST_LEVEL_XP_STEP;
  return {
    level,
    questXp: safeXp,
    xpIntoLevel,
    xpNeeded,
    xpToNextLevel: Math.max(0, xpNeeded - xpIntoLevel),
  };
};

const generateQuestCycle = (now = Date.now()) => {
  const cycleId = now;
  const refreshAt = now + randomInt(MIN_REFRESH_MS, MAX_REFRESH_MS);

  return {
    refreshAt,
    cycleStartedAt: now,
  };
};

const resetGuildQuestCycle = (guildState, now = Date.now()) => {
  const nextCycle = generateQuestCycle(now);
  guildState.refreshAt = nextCycle.refreshAt;
  guildState.cycleStartedAt = nextCycle.cycleStartedAt;

  for (const [userId] of Object.entries(guildState.users)) {
    const safeUserState = ensureUserState(guildState, userId);
    safeUserState.activeQuestLastChatCountAt = null;
    rerollUserAvailableQuests(guildState, userId, now);
  }
};

const ensureCurrentCycle = (guildId, now = Date.now()) => {
  const guildState = ensureGuildState(guildId);

  if (!guildState.refreshAt || now >= guildState.refreshAt) {
    const nextCycle = generateQuestCycle(now);
    guildState.refreshAt = nextCycle.refreshAt;
    guildState.cycleStartedAt = nextCycle.cycleStartedAt;

    for (const [userId] of Object.entries(guildState.users || {})) {
      rerollUserAvailableQuests(guildState, userId, now);
    }

    saveStore();
  }

  return guildState;
};

const getActiveQuests = (guildId, now = Date.now(), userId = null) => {
  const guildState = ensureCurrentCycle(guildId, now);
  if (!userId) return [];
  const userState = ensureUserState(guildState, userId);
  refillUserAvailableQuests(guildState, userId, now, USER_QUEST_CHOICES_COUNT);
  return userState.availableQuests;
};

const getQuestById = (guildId, questId, now = Date.now(), userId = null) => {
  const guildState = ensureCurrentCycle(guildId, now);
  if (userId) {
    const userState = ensureUserState(guildState, userId);
    if (userState.activeQuestData?.id === questId) return userState.activeQuestData;
    const direct = userState.availableQuests.find((quest) => quest.id === questId) || null;
    if (direct) return direct;
  }

  for (const [scanUserId] of Object.entries(guildState.users || {})) {
    const scanState = ensureUserState(guildState, scanUserId);
    if (scanState.activeQuestData?.id === questId) return scanState.activeQuestData;
    const found = scanState.availableQuests.find((quest) => quest.id === questId);
    if (found) return found;
  }
  return null;
};

const trimQuestHistory = (history) => history.slice(0, QUEST_HISTORY_LIMIT);

const appendQuestHistory = (userState, entry) => {
  const currentHistory = Array.isArray(userState.questHistory) ? userState.questHistory : [];
  userState.questHistory = trimQuestHistory([entry, ...currentHistory]);
};

const getUserQuestState = (guildId, userId, now = Date.now()) => {
  const guildState = ensureCurrentCycle(guildId, now);
  const userState = ensureUserState(guildState, userId);
  refillUserAvailableQuests(guildState, userId, now, USER_QUEST_CHOICES_COUNT);
  const activeQuest = userState.activeQuestData && userState.activeQuestData.id === userState.activeQuestId
    ? userState.activeQuestData
    : (userState.activeQuestId
      ? userState.availableQuests.find((quest) => quest.id === userState.activeQuestId) || null
      : null);

  if (userState.activeQuestId && !activeQuest) {
    userState.activeQuestId = null;
    userState.activeQuestData = null;
    userState.activeQuestProgress = 0;
    userState.activeQuestLastProgressAt = null;
    userState.acceptedAt = null;
    saveStore();
  }

  return {
    guildState,
    userState,
    activeQuest,
  };
};

const acceptQuest = (guildId, userId, questId, now = Date.now()) => {
  const { guildState, userState } = getUserQuestState(guildId, userId, now);
  const quest = userState.availableQuests.find((entry) => entry.id === questId) || null;

  if (!quest) {
    return { ok: false, reason: "That quest is no longer available.", quest: null };
  }

  if (userState.activeQuestId) {
    return { ok: false, reason: "You already have an active quest. Finish it before accepting another one.", quest };
  }

  const cooldownRemainingMs = Math.max(0, Number(userState.questTrashCooldownUntil || 0) - now);
  if (cooldownRemainingMs > 0) {
    const cooldownSeconds = Math.ceil(cooldownRemainingMs / 1000);
    return {
      ok: false,
      reason: `You recently trashed a quest. Wait **${cooldownSeconds}s** before accepting a new one.`,
      quest,
      cooldownRemainingMs,
    };
  }

  userState.activeQuestId = quest.id;
  userState.activeQuestData = quest;
  userState.activeQuestProgress = 0;
  userState.activeQuestLastProgressAt = null;
  userState.activeQuestLastChatCountAt = null;
  userState.acceptedAt = now;
  userState.availableQuests = userState.availableQuests.filter((entry) => entry.id !== quest.id);
  refillUserAvailableQuests(guildState, userId, now, USER_QUEST_CHOICES_COUNT);
  saveStore();

  return { ok: true, reason: null, quest };
};

const getTrashCooldownRemainingMs = (guildId, userId, now = Date.now()) => {
  const { userState } = getUserQuestState(guildId, userId, now);
  return Math.max(0, Number(userState.questTrashCooldownUntil || 0) - now);
};

const trashActiveQuest = (guildId, userId, now = Date.now()) => {
  const { guildState, userState, activeQuest } = getUserQuestState(guildId, userId, now);

  if (!activeQuest) {
    return { ok: false, reason: "You do not have an active quest to trash.", quest: null };
  }

  userState.activeQuestId = null;
  userState.activeQuestData = null;
  userState.activeQuestProgress = 0;
  userState.activeQuestLastProgressAt = null;
  userState.activeQuestLastChatCountAt = null;
  userState.acceptedAt = null;
  userState.questTrashCooldownUntil = now + QUEST_TRASH_COOLDOWN_MS;
  userState.availableQuests = userState.availableQuests.filter((entry) => entry.id !== activeQuest.id);
  refillUserAvailableQuests(guildState, userId, now, USER_QUEST_CHOICES_COUNT);
  saveStore();

  return {
    ok: true,
    quest: activeQuest,
    cooldownMs: QUEST_TRASH_COOLDOWN_MS,
    cooldownUntil: userState.questTrashCooldownUntil,
  };
};

const clearActiveQuest = (guildId, userId, now = Date.now()) => {
  const { userState } = getUserQuestState(guildId, userId, now);
  userState.activeQuestId = null;
  userState.activeQuestData = null;
  userState.activeQuestProgress = 0;
  userState.activeQuestLastProgressAt = null;
  userState.activeQuestLastChatCountAt = null;
  userState.acceptedAt = null;
  saveStore();
};

const completeQuestIfReady = (guildId, userId, now = Date.now()) => {
  const { guildState, userState, activeQuest } = getUserQuestState(guildId, userId, now);

  if (!activeQuest) return { completed: false, quest: null };
  if (Number(userState.activeQuestProgress) < Number(activeQuest.target)) {
    return { completed: false, quest: activeQuest };
  }

  const rewardXp = Number(activeQuest.rewardXp) || 0;
  const previousQuestXp = Number(userState.questXp) || 0;
  const previousLevel = getQuestLevel(previousQuestXp);
  const newQuestXp = previousQuestXp + rewardXp;
  const newLevel = getQuestLevel(newQuestXp);

  userState.completedCount = Number(userState.completedCount) + 1;
  userState.completedQuestIds.push(activeQuest.id);
  userState.questXp = newQuestXp;
  appendQuestHistory(userState, {
    questId: activeQuest.id,
    key: activeQuest.key,
    title: activeQuest.title,
    kind: activeQuest.kind,
    target: activeQuest.target,
    rewardXp,
    acceptedAt: userState.acceptedAt,
    completedAt: now,
    levelBefore: previousLevel,
    levelAfter: newLevel,
  });
  userState.activeQuestId = null;
  userState.activeQuestData = null;
  userState.activeQuestProgress = 0;
  userState.activeQuestLastProgressAt = null;
  userState.activeQuestLastChatCountAt = null;
  userState.acceptedAt = null;
  userState.availableQuests = userState.availableQuests.filter((entry) => entry.id !== activeQuest.id);
  refillUserAvailableQuests(guildState, userId, now, USER_QUEST_CHOICES_COUNT);
  saveStore();

  return {
    completed: true,
    quest: activeQuest,
    guildState,
    rewardXp,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
    questXp: newQuestXp,
  };
};

const doesEchoChatMessageQualify = (messageContent, repeatWordCount = 3) => {
  const text = String(messageContent || "").trim().toLowerCase();
  if (!text || text.length < 12 || text.length > 180) return false;

  const tokens = text.match(/[a-z0-9']+/g) || [];
  if (tokens.length < 3 || tokens.length > 28) return false;

  const frequency = new Map();
  for (const token of tokens) {
    const count = Number(frequency.get(token) || 0) + 1;
    frequency.set(token, count);
  }

  const maxRepeat = Math.max(...frequency.values());
  return maxRepeat >= Math.max(3, Number(repeatWordCount) || 3);
};

const addQuestProgress = (guildId, userId, input = 1, now = Date.now()) => {
  const { userState, activeQuest } = getUserQuestState(guildId, userId, now);

  if (!activeQuest || activeQuest.kind !== "chat") {
    return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  let safeAmount = 1;
  let messageContent = "";

  if (typeof input === "number") {
    safeAmount = Number(input);
  } else if (input && typeof input === "object") {
    safeAmount = Number(input.amount || 1);
    messageContent = String(input.messageContent || "");
  }

  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  if (activeQuest.chatMode === "echo_phrase") {
    if (!doesEchoChatMessageQualify(messageContent, activeQuest.repeatWordCount)) {
      return {
        updated: false,
        completed: false,
        quest: activeQuest,
        progress: userState.activeQuestProgress,
        reason: "message_not_qualified",
      };
    }

    const cooldownMs = ECHO_CHAT_COOLDOWN_MS;
    if (userState.activeQuestLastChatCountAt && now - Number(userState.activeQuestLastChatCountAt) < cooldownMs) {
      return {
        updated: false,
        completed: false,
        quest: activeQuest,
        progress: userState.activeQuestProgress,
        reason: "cooldown_active",
      };
    }

    userState.activeQuestLastChatCountAt = now;
  }

  userState.activeQuestProgress = Number(userState.activeQuestProgress) + safeAmount;
  saveStore();

  const completion = completeQuestIfReady(guildId, userId, now);
  return {
    updated: true,
    completed: completion.completed,
    quest: activeQuest,
    progress: completion.completed ? 0 : userState.activeQuestProgress,
    rewardXp: completion.rewardXp || 0,
    previousLevel: completion.previousLevel || null,
    newLevel: completion.newLevel || null,
    leveledUp: Boolean(completion.leveledUp),
    questXp: completion.questXp || userState.questXp,
  };
};

const startVoiceQuestTimer = (guildId, userId, now = Date.now()) => {
  const { userState, activeQuest } = getUserQuestState(guildId, userId, now);
  if (!activeQuest || activeQuest.kind !== "voice") return { updated: false, quest: activeQuest };
  if (!userState.activeQuestLastProgressAt) {
    userState.activeQuestLastProgressAt = now;
    saveStore();
    return { updated: true, quest: activeQuest };
  }
  return { updated: false, quest: activeQuest };
};

const stopVoiceQuestTimer = (guildId, userId, now = Date.now()) => {
  const { userState, activeQuest } = getUserQuestState(guildId, userId, now);
  if (!activeQuest || activeQuest.kind !== "voice") return { updated: false, quest: activeQuest };

  if (!userState.activeQuestLastProgressAt) {
    return { updated: false, quest: activeQuest };
  }

  const elapsedMs = Math.max(0, now - Number(userState.activeQuestLastProgressAt));
  const elapsedMinutes = elapsedMs / 60000;
  userState.activeQuestProgress = Number(userState.activeQuestProgress) + elapsedMinutes;
  userState.activeQuestLastProgressAt = null;
  saveStore();

  const completion = completeQuestIfReady(guildId, userId, now);
  return {
    updated: true,
    completed: completion.completed,
    quest: activeQuest,
    progress: completion.completed ? 0 : userState.activeQuestProgress,
    rewardXp: completion.rewardXp || 0,
    previousLevel: completion.previousLevel || null,
    newLevel: completion.newLevel || null,
    leveledUp: Boolean(completion.leveledUp),
    questXp: completion.questXp || userState.questXp,
  };
};

const tickVoiceQuestProgress = (guildId, userId, now = Date.now()) => {
  const { userState, activeQuest } = getUserQuestState(guildId, userId, now);
  if (!activeQuest || activeQuest.kind !== "voice") return { updated: false, quest: activeQuest };

  if (!userState.activeQuestLastProgressAt) {
    userState.activeQuestLastProgressAt = now;
    saveStore();
    return { updated: true, quest: activeQuest };
  }

  const elapsedMs = Math.max(0, now - Number(userState.activeQuestLastProgressAt));
  if (elapsedMs <= 0) {
    return { updated: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  const elapsedMinutes = elapsedMs / 60000;
  userState.activeQuestProgress = Number(userState.activeQuestProgress) + elapsedMinutes;
  userState.activeQuestLastProgressAt = now;
  saveStore();

  const completion = completeQuestIfReady(guildId, userId, now);
  return {
    updated: true,
    completed: completion.completed,
    quest: activeQuest,
    progress: completion.completed ? 0 : userState.activeQuestProgress,
    rewardXp: completion.rewardXp || 0,
    previousLevel: completion.previousLevel || null,
    newLevel: completion.newLevel || null,
    leveledUp: Boolean(completion.leveledUp),
    questXp: completion.questXp || userState.questXp,
  };
};

const formatQuestProgress = (quest, progress) => {
  const current = quest.kind === "voice" ? Number(progress || 0).toFixed(1) : Math.floor(Number(progress || 0));
  const target = quest.kind === "voice" ? Number(quest.target).toFixed(1) : Math.floor(Number(quest.target));
  const label = quest.unit === "minutes" ? "minutes" : "messages";
  return `${current}/${target} ${label}`;
};

const formatQuestReward = (quest) => `${Number(quest.rewardXp || 0)} XP`;

const formatQuestLevel = (questXp) => {
  const xp = getQuestXpProgress(questXp);
  return `Level ${xp.level} • ${xp.questXp} XP`;
};

const formatRelativeDuration = (targetMs, now = Date.now()) => {
  const remainingMs = Math.max(0, Number(targetMs || 0) - now);
  if (remainingMs <= 0) return "now";

  const totalMinutes = Math.ceil(remainingMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
};

const buildQuestBoardPayload = (guildId, userId = null, now = Date.now()) => {
  const quests = userId ? getActiveQuests(guildId, now, userId) : [];
  const refreshAt = ensureGuildState(guildId).refreshAt;
  const userState = userId ? getUserQuestState(guildId, userId, now).userState : null;
  const profileXp = userState ? getQuestXpProgress(userState.questXp) : null;

  const embed = new EmbedBuilder()
    .setColor("#4EA1FF")
    .setTitle("Quest Board")
    .setDescription("Pick one quest to accept. Quests refresh every 2 to 3 hours.");

  if (userState) {
    const activeQuest = getUserQuestState(guildId, userId, now).activeQuest;

    embed.addFields({
      name: "Your Quest Profile",
      value: [
        `Level **${profileXp.level}**`,
        `XP: **${profileXp.questXp}**`,
        `Completed: **${Number(userState.completedCount || 0)}**`,
        activeQuest ? `Active: **${activeQuest.title}** (${formatQuestProgress(activeQuest, userState.activeQuestProgress)})` : "Active: **None**",
        getTrashCooldownRemainingMs(guildId, userId, now) > 0
          ? `Trash cooldown: **${Math.ceil(getTrashCooldownRemainingMs(guildId, userId, now) / 1000)}s**`
          : "Trash cooldown: **Ready**",
      ].join("\n"),
    });
  }

  for (const [index, quest] of quests.entries()) {
    embed.addFields({
      name: `${index + 1}. ${quest.icon} ${quest.title}`,
      value: `${quest.description}\nTarget: **${quest.target} ${quest.unit}**\nReward: **${formatQuestReward(quest)}**`,
    });
  }

  embed.setFooter({ text: `Next refresh in ${refreshAt ? formatRelativeDuration(refreshAt, now) : "soon"}` });

  const row = new ActionRowBuilder();
  for (const [index, quest] of quests.slice(0, 5).entries()) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`${QUEST_PANEL_BUTTON_PREFIX}${quest.id}`)
        .setLabel(`Accept ${index + 1}`)
        .setEmoji(quest.kind === "voice" ? "🎧" : "💬")
        .setStyle(quest.kind === "voice" ? ButtonStyle.Success : ButtonStyle.Primary)
    );
  }

  const controlsRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(QUEST_TRASH_BUTTON_ID)
      .setLabel("Trash Active Quest")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!userState?.activeQuestId)
  );

  const components = row.components.length ? [row, controlsRow] : [controlsRow];
  return { embeds: [embed], components };
};

const buildQuestStatsPayload = (guildId, userId, now = Date.now()) => {
  const { userState, activeQuest } = getUserQuestState(guildId, userId, now);
  const xp = getQuestXpProgress(userState.questXp);

  const embed = new EmbedBuilder()
    .setColor("#4EA1FF")
    .setTitle("Quest Stats")
    .setDescription("Your quest rewards, level, and active progress.")
    .addFields(
      { name: "Level", value: `**${xp.level}**`, inline: true },
      { name: "Quest XP", value: `**${xp.questXp}**`, inline: true },
      { name: "To Next Level", value: `**${xp.xpToNextLevel} XP**`, inline: true },
      { name: "Completed Quests", value: `**${Number(userState.completedCount || 0)}**`, inline: true },
      { name: "Quest History Entries", value: `**${Array.isArray(userState.questHistory) ? userState.questHistory.length : 0}**`, inline: true },
      { name: "Active Quest", value: activeQuest ? `${activeQuest.icon} **${activeQuest.title}**\n${formatQuestProgress(activeQuest, userState.activeQuestProgress)}` : "None", inline: false }
    );

  return { embeds: [embed] };
};

const buildQuestHistoryPayload = (guildId, userId, limit = 5, now = Date.now()) => {
  const { userState } = getUserQuestState(guildId, userId, now);
  const maxItems = Math.min(10, Math.max(1, Number(limit) || 5));
  const history = (userState.questHistory || []).slice(0, maxItems);

  const embed = new EmbedBuilder()
    .setColor("#4EA1FF")
    .setTitle("Quest History")
    .setDescription(history.length ? `Showing your last ${history.length} completed quest(s).` : "You have not completed any quests yet.");

  if (history.length) {
    embed.addFields(
      history.map((entry, index) => ({
        name: `${index + 1}. ${entry.title}`,
        value: [
          `Completed: <t:${Math.floor(Number(entry.completedAt || now) / 1000)}:R>`,
          `Reward: **${Number(entry.rewardXp || 0)} XP**`,
          `Level: **${Number(entry.levelBefore || 1)} → ${Number(entry.levelAfter || 1)}**`,
        ].join("\n"),
      }))
    );
  }

  return { embeds: [embed] };
};

const getQuestLeaderboard = (guildId, limit = 10, now = Date.now()) => {
  const guildState = ensureCurrentCycle(guildId, now);
  const users = guildState.users || {};

  return Object.entries(users)
    .map(([userId, userState]) => {
      const xp = getQuestXpProgress(userState.questXp);
      return {
        userId,
        questXp: xp.questXp,
        questLevel: xp.level,
        completedCount: Number(userState.completedCount || 0),
        activeQuestId: userState.activeQuestId || null,
      };
    })
    .filter((entry) => entry.questXp > 0 || entry.completedCount > 0)
    .sort((a, b) => b.questLevel - a.questLevel || b.questXp - a.questXp || b.completedCount - a.completedCount)
    .slice(0, Math.max(1, Math.min(25, Number(limit) || 10)));
};

const buildQuestLeaderboardPayload = async (guild, limit = 10, now = Date.now()) => {
  const rows = getQuestLeaderboard(guild.id, limit, now);
  const embed = new EmbedBuilder().setColor("#4EA1FF").setTitle(`Quest Leaderboard (Top ${rows.length})`);

  if (!rows.length) {
    embed.setDescription("No one has earned quest XP yet.");
    return { embeds: [embed] };
  }

  const lines = [];
  for (const [index, entry] of rows.entries()) {
    const member = guild.members.cache.get(entry.userId) || null;
    const name = member ? `${member.user.username}` : `<@${entry.userId}>`;
    lines.push(`${index + 1}. ${name} - Level **${entry.questLevel}** | **${entry.questXp} XP** | **${entry.completedCount} completed**`);
  }

  embed.setDescription(lines.join("\n"));
  return { embeds: [embed] };
};

const formatQuestSummary = (quest) => {
  const targetLabel = quest.unit === "minutes" ? `${quest.target} minutes` : `${quest.target} messages`;
  return `${quest.icon} **${quest.title}** - ${quest.description} (Target: **${targetLabel}**, Reward: **${formatQuestReward(quest)}**)`;
};

module.exports = {
  QUEST_PANEL_BUTTON_PREFIX,
  QUEST_TRASH_BUTTON_ID,
  buildQuestBoardPayload,
  buildQuestLeaderboardPayload,
  buildQuestHistoryPayload,
  buildQuestPanelPayload: buildQuestBoardPayload,
  buildQuestStatsPayload,
  acceptQuest,
  addQuestProgress,
  clearActiveQuest,
  completeQuestIfReady,
  ensureCurrentCycle,
  formatQuestLevel,
  formatQuestProgress,
  formatQuestSummary,
  formatQuestReward,
  getTrashCooldownRemainingMs,
  getQuestLeaderboard,
  getActiveQuests,
  getQuestById,
  getQuestLevel,
  getUserQuestState,
  loadStore,
  saveStore,
  startVoiceQuestTimer,
  trashActiveQuest,
  stopVoiceQuestTimer,
  tickVoiceQuestProgress,
};