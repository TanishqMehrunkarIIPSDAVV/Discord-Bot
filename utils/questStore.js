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
const QUEST_CATALOG_PATH = path.join(__dirname, "..", "data", "quest-catalog.json");
let questXpBoostResolver = () => 1;

const CATEGORY_ICON_MAP = {
  chat: "💬",
  community: "🤝",
  voice: "🎧",
  fun: "🎮",
  streak: "🔥",
};

const GOAL_KIND_MAP = {
  messages: "chat",
  helpful_replies: "chat",
  voice_minutes: "voice",
  reactions: "reaction",
  commands_used: "command",
  streak_days: "streak",
};

const GOAL_UNIT_MAP = {
  messages: "messages",
  helpful_replies: "messages",
  voice_minutes: "minutes",
  reactions: "reactions",
  commands_used: "commands",
  streak_days: "days",
};

const loadQuestCatalog = () => {
  try {
    const raw = fs.readFileSync(QUEST_CATALOG_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: Number(entry.id),
        key: `catalog-${Number(entry.id)}`,
        icon: CATEGORY_ICON_MAP[String(entry.category || "").toLowerCase()] || "🎯",
        title: String(entry.title || `Quest ${entry.id}`),
        description: String(entry.description || "Complete this quest objective."),
        category: String(entry.category || "misc").toLowerCase(),
        difficulty: String(entry.difficulty || "easy").toLowerCase(),
        goalType: String(entry.goalType || "messages").toLowerCase(),
        kind: GOAL_KIND_MAP[String(entry.goalType || "").toLowerCase()] || "chat",
        unit: GOAL_UNIT_MAP[String(entry.goalType || "").toLowerCase()] || "messages",
        target: Math.max(1, Number(entry.target) || 1),
        rewardXp: Math.max(0, Number(entry.rewardXp) || 0),
        rewardCoins: Math.max(0, Number(entry.rewardCoins) || 0),
        timeLimitHours: Math.max(1, Number(entry.timeLimitHours) || 24),
        isDaily: Boolean(entry.isDaily),
        isRepeatable: Boolean(entry.isRepeatable),
      }))
      .filter((entry) => Number.isFinite(entry.id));
  } catch {
    return [];
  }
};

const ALL_QUEST_TEMPLATES = loadQuestCatalog();
const QUEST_TEMPLATE_BY_KEY = new Map(ALL_QUEST_TEMPLATES.map((template) => [template.key, template]));

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
      questCoins: 0,
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
  userState.questCoins = Number(userState.questCoins) || 0;
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

const buildQuestFromTemplate = (template, cycleId, index) => {
  const baseId = Number.isFinite(Number(template.id)) ? Number(template.id) : index + 1;
  return {
    id: `${cycleId}-${baseId}-${template.key}`,
    key: template.key,
    icon: template.icon,
    title: template.title,
    kind: template.kind,
    goalType: template.goalType,
    category: template.category,
    difficulty: template.difficulty,
    unit: template.unit,
    chatMode: null,
    repeatWordCount: 0,
    voiceMode: "active",
    requiredMembers: 1,
    target: Number(template.target) || 1,
    rewardXp: Number(template.rewardXp) || 0,
    rewardCoins: Number(template.rewardCoins) || 0,
    timeLimitHours: Number(template.timeLimitHours) || 24,
    isDaily: Boolean(template.isDaily),
    isRepeatable: Boolean(template.isRepeatable),
    description: template.description,
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

const pickTemplateForUser = (guildState, userId, avoidKeys = new Set(), disallowedKeys = new Set()) => {
  const occupied = collectOccupiedQuestKeys(guildState, userId);
  const preferred = ALL_QUEST_TEMPLATES.filter(
    (template) => !avoidKeys.has(template.key) && !occupied.has(template.key) && !disallowedKeys.has(template.key)
  );
  if (preferred.length) return preferred[Math.floor(Math.random() * preferred.length)];

  const fallback = ALL_QUEST_TEMPLATES.filter((template) => !avoidKeys.has(template.key) && !disallowedKeys.has(template.key));
  if (fallback.length) return fallback[Math.floor(Math.random() * fallback.length)];

  return ALL_QUEST_TEMPLATES[Math.floor(Math.random() * ALL_QUEST_TEMPLATES.length)] || null;
};

const refillUserAvailableQuests = (guildState, userId, now = Date.now(), targetCount = USER_QUEST_CHOICES_COUNT) => {
  const userState = ensureUserState(guildState, userId);
  const activeQuest = userState.activeQuestData || null;

  const avoidKeys = new Set((userState.availableQuests || []).map((quest) => quest.key));
  if (activeQuest?.key) avoidKeys.add(activeQuest.key);

  const disallowedKeys = new Set();
  for (const historyEntry of userState.questHistory || []) {
    const key = historyEntry?.key;
    if (!key) continue;
    const sourceTemplate = QUEST_TEMPLATE_BY_KEY.get(key);
    if (sourceTemplate && !sourceTemplate.isRepeatable) {
      disallowedKeys.add(key);
    }
  }

  let guard = 0;
  while (userState.availableQuests.length < targetCount && guard < 30) {
    guard += 1;
    const template = pickTemplateForUser(guildState, userId, avoidKeys, disallowedKeys);
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

const forceRefreshGuildQuestCycle = (guildId, now = Date.now()) => {
  const guildState = ensureGuildState(guildId);
  resetGuildQuestCycle(guildState, now);
  saveStore();

  return {
    refreshAt: guildState.refreshAt,
    cycleStartedAt: guildState.cycleStartedAt,
    usersAffected: Object.keys(guildState.users || {}).length,
  };
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

const isQuestExpired = (quest, acceptedAt, now = Date.now()) => {
  if (!quest) return false;
  const startedAt = Number(acceptedAt) || 0;
  if (!startedAt) return false;
  const timeLimitHours = Math.max(1, Number(quest.timeLimitHours) || 24);
  return now >= startedAt + timeLimitHours * 60 * 60 * 1000;
};

const clearExpiredActiveQuest = (guildState, userState, userId, now = Date.now()) => {
  const activeQuest = userState.activeQuestData;
  if (!userState.activeQuestId || !activeQuest) return false;
  if (!isQuestExpired(activeQuest, userState.acceptedAt, now)) return false;

  userState.activeQuestId = null;
  userState.activeQuestData = null;
  userState.activeQuestProgress = 0;
  userState.activeQuestLastProgressAt = null;
  userState.activeQuestLastChatCountAt = null;
  userState.acceptedAt = null;
  userState.availableQuests = userState.availableQuests.filter((entry) => entry.id !== activeQuest.id);
  refillUserAvailableQuests(guildState, userId, now, USER_QUEST_CHOICES_COUNT);
  saveStore();
  return true;
};

const getUserQuestState = (guildId, userId, now = Date.now()) => {
  const guildState = ensureCurrentCycle(guildId, now);
  const userState = ensureUserState(guildState, userId);
  clearExpiredActiveQuest(guildState, userState, userId, now);
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

  const rewardXpBase = Number(activeQuest.rewardXp) || 0;
  const boostMultiplier = Math.max(1, Number(questXpBoostResolver(guildId, userId)) || 1);
  const rewardXp = Math.round(rewardXpBase * boostMultiplier);
  const rewardCoins = Number(activeQuest.rewardCoins) || 0;
  const previousQuestXp = Number(userState.questXp) || 0;
  const previousLevel = getQuestLevel(previousQuestXp);
  const newQuestXp = previousQuestXp + rewardXp;
  const newLevel = getQuestLevel(newQuestXp);

  userState.completedCount = Number(userState.completedCount) + 1;
  userState.completedQuestIds.push(activeQuest.id);
  userState.questXp = newQuestXp;
  userState.questCoins = Number(userState.questCoins || 0) + rewardCoins;
  appendQuestHistory(userState, {
    questId: activeQuest.id,
    key: activeQuest.key,
    title: activeQuest.title,
    kind: activeQuest.kind,
    goalType: activeQuest.goalType,
    target: activeQuest.target,
    rewardXp,
    rewardCoins,
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
    rewardCoins,
    previousLevel,
    newLevel,
    leveledUp: newLevel > previousLevel,
    questXp: newQuestXp,
    questCoins: userState.questCoins,
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

const getUtcDayKey = (timestampMs) => {
  const date = new Date(Number(timestampMs) || Date.now());
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
};

const addQuestProgress = (guildId, userId, input = 1, now = Date.now()) => {
  const { userState, activeQuest } = getUserQuestState(guildId, userId, now);

  if (!activeQuest) {
    return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  let safeAmount = 1;
  let messageContent = "";
  let eventType = "message";
  let isHelpfulReply = false;

  if (typeof input === "number") {
    safeAmount = Number(input);
  } else if (input && typeof input === "object") {
    safeAmount = Number(input.amount || 1);
    messageContent = String(input.messageContent || "");
    eventType = String(input.eventType || "message").toLowerCase();
    isHelpfulReply = Boolean(input.isHelpfulReply);
  }

  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  const goalType = String(activeQuest.goalType || "messages");

  if (goalType === "messages" && eventType !== "message") {
    return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  if (goalType === "reactions" && eventType !== "reaction") {
    return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  if (goalType === "commands_used" && eventType !== "command") {
    return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
  }

  if (goalType === "helpful_replies") {
    if (eventType !== "message" || !isHelpfulReply) {
      return { updated: false, completed: false, quest: activeQuest, progress: userState.activeQuestProgress };
    }
  }

  if (goalType === "streak_days") {
    const currentDay = getUtcDayKey(now);
    const lastDay = userState.activeQuestLastProgressAt ? getUtcDayKey(userState.activeQuestLastProgressAt) : null;
    if (lastDay === currentDay) {
      return {
        updated: false,
        completed: false,
        quest: activeQuest,
        progress: userState.activeQuestProgress,
        reason: "streak_already_counted_today",
      };
    }

    userState.activeQuestLastProgressAt = now;
    userState.activeQuestProgress = Number(userState.activeQuestProgress) + 1;
    saveStore();

    const completion = completeQuestIfReady(guildId, userId, now);
    return {
      updated: true,
      completed: completion.completed,
      quest: activeQuest,
      progress: completion.completed ? 0 : userState.activeQuestProgress,
      rewardXp: completion.rewardXp || 0,
      rewardCoins: completion.rewardCoins || 0,
      previousLevel: completion.previousLevel || null,
      newLevel: completion.newLevel || null,
      leveledUp: Boolean(completion.leveledUp),
      questXp: completion.questXp || userState.questXp,
      questCoins: completion.questCoins || userState.questCoins,
    };
  }

  if (goalType !== "messages" && goalType !== "helpful_replies") {
    userState.activeQuestProgress = Number(userState.activeQuestProgress) + safeAmount;
    saveStore();

    const completion = completeQuestIfReady(guildId, userId, now);
    return {
      updated: true,
      completed: completion.completed,
      quest: activeQuest,
      progress: completion.completed ? 0 : userState.activeQuestProgress,
      rewardXp: completion.rewardXp || 0,
      rewardCoins: completion.rewardCoins || 0,
      previousLevel: completion.previousLevel || null,
      newLevel: completion.newLevel || null,
      leveledUp: Boolean(completion.leveledUp),
      questXp: completion.questXp || userState.questXp,
      questCoins: completion.questCoins || userState.questCoins,
    };
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
    rewardCoins: completion.rewardCoins || 0,
    previousLevel: completion.previousLevel || null,
    newLevel: completion.newLevel || null,
    leveledUp: Boolean(completion.leveledUp),
    questXp: completion.questXp || userState.questXp,
    questCoins: completion.questCoins || userState.questCoins,
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
    rewardCoins: completion.rewardCoins || 0,
    previousLevel: completion.previousLevel || null,
    newLevel: completion.newLevel || null,
    leveledUp: Boolean(completion.leveledUp),
    questXp: completion.questXp || userState.questXp,
    questCoins: completion.questCoins || userState.questCoins,
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
    rewardCoins: completion.rewardCoins || 0,
    previousLevel: completion.previousLevel || null,
    newLevel: completion.newLevel || null,
    leveledUp: Boolean(completion.leveledUp),
    questXp: completion.questXp || userState.questXp,
    questCoins: completion.questCoins || userState.questCoins,
  };
};

const formatQuestProgress = (quest, progress) => {
  const current = quest.kind === "voice" ? Number(progress || 0).toFixed(1) : Math.floor(Number(progress || 0));
  const target = quest.kind === "voice" ? Number(quest.target).toFixed(1) : Math.floor(Number(quest.target));
  const label = String(quest.unit || "messages");
  return `${current}/${target} ${label}`;
};

const formatQuestReward = (quest) => {
  const xp = Number(quest.rewardXp || 0);
  const coins = Number(quest.rewardCoins || 0);
  return `+${xp} XP • +${coins} coins`;
};

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
        `Coins: **${Number(userState.questCoins || 0)}**`,
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
      value: `${quest.description}\nType: **${quest.goalType}** • Difficulty: **${quest.difficulty}**\nTarget: **${quest.target} ${quest.unit}**\nReward: **${formatQuestReward(quest)}**`,
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
      { name: "Coins", value: `**${Number(userState.questCoins || 0)}**`, inline: true },
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
          `Reward: **+${Number(entry.rewardXp || 0)} XP • +${Number(entry.rewardCoins || 0)} coins**`,
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
  const targetLabel = `${quest.target} ${quest.unit}`;
  return `${quest.icon} **${quest.title}** - ${quest.description} (Target: **${targetLabel}**, Reward: **${formatQuestReward(quest)}**)`;
};

const setQuestXpBoostResolver = (resolver) => {
  if (typeof resolver === "function") {
    questXpBoostResolver = resolver;
    return;
  }

  questXpBoostResolver = () => 1;
};

const getQuestCoins = (guildId, userId, now = Date.now()) => {
  const { userState } = getUserQuestState(guildId, userId, now);
  return Math.max(0, Number(userState.questCoins || 0));
};

const addQuestCoins = (guildId, userId, amount, now = Date.now()) => {
  const safeAmount = Math.floor(Number(amount));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return { ok: false, reason: "Invalid amount.", balance: getQuestCoins(guildId, userId, now) };
  }

  const { userState } = getUserQuestState(guildId, userId, now);
  userState.questCoins = Math.max(0, Number(userState.questCoins || 0)) + safeAmount;
  saveStore();

  return { ok: true, balance: Number(userState.questCoins || 0) };
};

const spendQuestCoins = (guildId, userId, amount, now = Date.now()) => {
  const safeAmount = Math.floor(Number(amount));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return { ok: false, reason: "Invalid amount.", balance: getQuestCoins(guildId, userId, now) };
  }

  const { userState } = getUserQuestState(guildId, userId, now);
  const current = Math.max(0, Number(userState.questCoins || 0));
  if (current < safeAmount) {
    return { ok: false, reason: "Not enough quest coins.", balance: current };
  }

  userState.questCoins = current - safeAmount;
  saveStore();
  return { ok: true, balance: Number(userState.questCoins || 0) };
};

const transferQuestCoins = (guildId, fromUserId, toUserId, amount, now = Date.now()) => {
  if (!fromUserId || !toUserId || fromUserId === toUserId) {
    return { ok: false, reason: "Invalid sender/receiver." };
  }

  const safeAmount = Math.floor(Number(amount));
  if (!Number.isFinite(safeAmount) || safeAmount <= 0) {
    return { ok: false, reason: "Invalid amount." };
  }

  const spendResult = spendQuestCoins(guildId, fromUserId, safeAmount, now);
  if (!spendResult.ok) {
    return { ok: false, reason: spendResult.reason, fromBalance: spendResult.balance };
  }

  const addResult = addQuestCoins(guildId, toUserId, safeAmount, now);
  return {
    ok: true,
    amount: safeAmount,
    fromBalance: spendResult.balance,
    toBalance: addResult.balance,
  };
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
  forceRefreshGuildQuestCycle,
  getUserQuestState,
  loadStore,
  saveStore,
  startVoiceQuestTimer,
  trashActiveQuest,
  stopVoiceQuestTimer,
  tickVoiceQuestProgress,
  setQuestXpBoostResolver,
  getQuestCoins,
  addQuestCoins,
  spendQuestCoins,
  transferQuestCoins,
};