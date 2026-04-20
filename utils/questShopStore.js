const fs = require("node:fs");
const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const DATA_PATH = path.join(__dirname, "..", "data", "quest-shop.json");
const SHOP_BUY_BUTTON_PREFIX = "qshop_buy:";
const SHOP_GIFT_ACCEPT_PREFIX = "qshop_gift_accept:";
const SHOP_GIFT_DECLINE_PREFIX = "qshop_gift_decline:";

const CUSTOM_ROLE_WEEKLY_LIMIT = 3;
const CUSTOM_ROLE_DURATION_HOURS = 7 * 24;
const NICKNAME_WEEKLY_LIMIT = 5;
const DEFAULT_GIFT_EXPIRES_MS = 10 * 60 * 1000;

const PERK_DEFINITIONS = [
  {
    id: "nickname_permission",
    name: "Nickname Permission",
    description: "Temporarily lets you change your nickname anytime.",
    price: 250,
    durationHours: 24,
    weeklyLimit: NICKNAME_WEEKLY_LIMIT,
    type: "role_auto",
    autoRoleKey: "nickname",
  },
  {
    id: "custom_role",
    name: "Custom Display Role",
    description: "Creates a personal display role for a temporary time.",
    price: 700,
    durationHours: CUSTOM_ROLE_DURATION_HOURS,
    weeklyLimit: CUSTOM_ROLE_WEEKLY_LIMIT,
    type: "custom_role",
    customRolePrefix: "Custom",
  },
  {
    id: "attachment_gif",
    name: "Attachment + GIF Access",
    description: "Unlock attachment and GIF-friendly permissions temporarily.",
    price: 800,
    durationHours: 24 * 7,
    weeklyLimit: null,
    type: "role_auto",
    autoRoleKey: "attachment",
  },
  {
    id: "xp_boost",
    name: "Quest XP Boost",
    description: "Gives 1.5x quest XP rewards for the duration.",
    price: 300,
    durationHours: 24,
    weeklyLimit: null,
    type: "xp_boost",
    multiplier: 1.5,
  },
  {
    id: "premium_role_1",
    name: "Premium Role 1",
    description: "Temporary access to premium role slot 1.",
    price: 1000,
    durationHours: 7 * 24,
    weeklyLimit: null,
    type: "role_configured",
    configuredRoleSlot: 1,
  },
  {
    id: "premium_role_2",
    name: "Premium Role 2",
    description: "Temporary access to premium role slot 2.",
    price: 800,
    durationHours: 24 * 7,
    weeklyLimit: null,
    type: "role_configured",
    configuredRoleSlot: 2,
  },
];

const PERK_MAP = new Map(PERK_DEFINITIONS.map((perk) => [perk.id, perk]));

let cache = null;

const startOfUtcWeekMs = (nowMs = Date.now()) => {
  const now = new Date(nowMs);
  const weekday = now.getUTCDay();
  const daysFromMonday = (weekday + 6) % 7;
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysFromMonday, 0, 0, 0, 0);
};

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
  const store = loadStore();
  store.updatedAt = Date.now();
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
};

const ensureGuildShop = (guildId, nowMs = Date.now()) => {
  const store = loadStore();
  if (!store.guilds[guildId] || typeof store.guilds[guildId] !== "object") {
    store.guilds[guildId] = {
      shopChannelId: null,
      shopMessageId: null,
      perks: {},
      premiumRoleIds: { 1: null, 2: null },
      autoRoleIds: { nickname: null, attachment: null },
      weekly: {
        weekStartAt: startOfUtcWeekMs(nowMs),
        counters: {},
      },
      active: [],
      pendingGifts: {},
    };
  }

  const guild = store.guilds[guildId];
  if (!guild.perks || typeof guild.perks !== "object") guild.perks = {};
  if (!guild.premiumRoleIds || typeof guild.premiumRoleIds !== "object") guild.premiumRoleIds = { 1: null, 2: null };
  if (!guild.autoRoleIds || typeof guild.autoRoleIds !== "object") guild.autoRoleIds = { nickname: null, attachment: null };
  if (!guild.weekly || typeof guild.weekly !== "object") {
    guild.weekly = { weekStartAt: startOfUtcWeekMs(nowMs), counters: {} };
  }
  if (!guild.weekly.counters || typeof guild.weekly.counters !== "object") guild.weekly.counters = {};
  if (!Array.isArray(guild.active)) guild.active = [];
  if (!guild.pendingGifts || typeof guild.pendingGifts !== "object") guild.pendingGifts = {};

  for (const def of PERK_DEFINITIONS) {
    if (!guild.perks[def.id] || typeof guild.perks[def.id] !== "object") {
      guild.perks[def.id] = {
        enabled: true,
        price: def.price,
        durationHours: def.durationHours,
        weeklyLimit: def.weeklyLimit,
      };
    }
  }

  return guild;
};

const rotateWeeklyWindowIfNeeded = (guild, nowMs = Date.now()) => {
  const currentWeek = startOfUtcWeekMs(nowMs);
  const storedWeek = Number(guild.weekly?.weekStartAt || 0);
  if (storedWeek !== currentWeek) {
    guild.weekly.weekStartAt = currentWeek;
    guild.weekly.counters = {};
  }
};

const getPerkConfig = (guildId, perkId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const def = PERK_MAP.get(perkId);
  if (!def) return null;

  const config = guild.perks[perkId] || {};
  return {
    ...def,
    enabled: Boolean(config.enabled ?? true),
    price: Math.max(0, Math.floor(Number(config.price ?? def.price))),
    durationHours:
      def.id === "custom_role"
        ? CUSTOM_ROLE_DURATION_HOURS
        : Math.max(1, Number(config.durationHours ?? def.durationHours)),
    weeklyLimit:
      config.weeklyLimit === null || config.weeklyLimit === "none"
        ? null
        : Number.isFinite(Number(config.weeklyLimit))
          ? Math.max(1, Math.floor(Number(config.weeklyLimit)))
          : def.weeklyLimit,
  };
};

const getAllPerksForGuild = (guildId, nowMs = Date.now()) => {
  ensureGuildShop(guildId, nowMs);
  return PERK_DEFINITIONS.map((def) => getPerkConfig(guildId, def.id, nowMs)).filter(Boolean);
};

const getShopConfig = (guildId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  rotateWeeklyWindowIfNeeded(guild, nowMs);

  return {
    shopChannelId: guild.shopChannelId || null,
    shopMessageId: guild.shopMessageId || null,
    premiumRoleIds: { ...guild.premiumRoleIds },
    autoRoleIds: { ...guild.autoRoleIds },
    weekStartAt: guild.weekly.weekStartAt,
    perks: getAllPerksForGuild(guildId, nowMs),
  };
};

const setShopChannel = (guildId, channelId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  guild.shopChannelId = channelId || null;
  saveStore();
  return getShopConfig(guildId, nowMs);
};

const setShopMessageId = (guildId, messageId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  guild.shopMessageId = messageId || null;
  saveStore();
};

const updatePerkConfig = (guildId, perkId, patch, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const existing = guild.perks[perkId];
  if (!existing) return null;

  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    existing.enabled = Boolean(patch.enabled);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "price")) {
    existing.price = Math.max(0, Math.floor(Number(patch.price) || 0));
  }
  if (Object.prototype.hasOwnProperty.call(patch, "durationHours")) {
    if (perkId !== "custom_role") {
      existing.durationHours = Math.max(1, Number(patch.durationHours) || 1);
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "weeklyLimit")) {
    if (patch.weeklyLimit === null || String(patch.weeklyLimit).toLowerCase() === "none") {
      existing.weeklyLimit = null;
    } else {
      const parsed = Math.floor(Number(patch.weeklyLimit));
      existing.weeklyLimit = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
  }

  saveStore();
  return getPerkConfig(guildId, perkId, nowMs);
};

const setPremiumRoleIds = (guildId, role1Id, role2Id, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  guild.premiumRoleIds = { 1: role1Id || null, 2: role2Id || null };
  saveStore();
  return { ...guild.premiumRoleIds };
};

const setAutoRoleId = (guildId, key, roleId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  if (!["nickname", "attachment"].includes(key)) return null;
  guild.autoRoleIds[key] = roleId || null;
  saveStore();
  return guild.autoRoleIds[key];
};

const getPerkWeeklyUsers = (guild, perkId) => {
  rotateWeeklyWindowIfNeeded(guild);
  if (!guild.weekly.counters[perkId] || !Array.isArray(guild.weekly.counters[perkId])) {
    guild.weekly.counters[perkId] = [];
  }
  return guild.weekly.counters[perkId];
};

const canUsePerkThisWeek = (guildId, perkId, userId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const perk = getPerkConfig(guildId, perkId, nowMs);
  if (!perk) return { ok: false, reason: "Unknown perk." };
  if (!perk.enabled) return { ok: false, reason: "That perk is currently disabled." };

  const weeklyLimit = perk.weeklyLimit;
  if (!weeklyLimit) return { ok: true };

  const users = getPerkWeeklyUsers(guild, perkId);
  if (users.includes(userId)) return { ok: true };
  if (users.length >= weeklyLimit) {
    return { ok: false, reason: `Weekly limit reached for ${perk.name}.` };
  }

  return { ok: true };
};

const getPerkWeeklyStats = (guildId, perkId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const perk = getPerkConfig(guildId, perkId, nowMs);
  if (!perk) return null;

  if (!perk.weeklyLimit) {
    return {
      hasLimit: false,
      limit: null,
      used: 0,
      remaining: null,
      weekStartAt: Number(guild.weekly?.weekStartAt || 0),
    };
  }

  const users = getPerkWeeklyUsers(guild, perkId);
  const used = users.length;
  return {
    hasLimit: true,
    limit: Number(perk.weeklyLimit),
    used,
    remaining: Math.max(0, Number(perk.weeklyLimit) - used),
    weekStartAt: Number(guild.weekly?.weekStartAt || 0),
  };
};

const markPerkWeeklyUser = (guildId, perkId, userId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const users = getPerkWeeklyUsers(guild, perkId);
  if (!users.includes(userId)) {
    users.push(userId);
    saveStore();
  }
};

const getActivePerksForUser = (guildId, userId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  return guild.active
    .filter((entry) => entry.userId === userId && Number(entry.expiresAt) > nowMs)
    .map((entry) => ({ ...entry }));
};

const hasActivePerk = (guildId, userId, perkId, nowMs = Date.now()) => {
  const active = getActivePerksForUser(guildId, userId, nowMs);
  return active.some((entry) => entry.perkId === perkId);
};

const createActivePerkEntry = (guildId, userId, perkId, meta = {}, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const perk = getPerkConfig(guildId, perkId, nowMs);
  if (!perk) return null;

  const entry = {
    id: `perk_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    userId,
    perkId,
    grantedAt: nowMs,
    expiresAt: nowMs + Math.max(1, Number(perk.durationHours)) * 60 * 60 * 1000,
    meta: meta && typeof meta === "object" ? meta : {},
  };

  guild.active.push(entry);
  markPerkWeeklyUser(guildId, perkId, userId, nowMs);
  saveStore();
  return entry;
};

const removeActivePerkEntry = (guildId, entryId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const idx = guild.active.findIndex((entry) => entry.id === entryId);
  if (idx === -1) return null;
  const [removed] = guild.active.splice(idx, 1);
  saveStore();
  return removed;
};

const getExpiredActiveEntries = (guildId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  return guild.active.filter((entry) => Number(entry.expiresAt) <= nowMs).map((entry) => ({ ...entry }));
};

const cleanupPendingGifts = (guildId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  let changed = false;
  for (const [giftId, gift] of Object.entries(guild.pendingGifts)) {
    if (Number(gift.expiresAt) <= nowMs || gift.status !== "pending") {
      delete guild.pendingGifts[giftId];
      changed = true;
    }
  }
  if (changed) saveStore();
};

const createPendingGift = (guildId, fromUserId, toUserId, perkId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  cleanupPendingGifts(guildId, nowMs);

  const giftId = `gift_${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  guild.pendingGifts[giftId] = {
    id: giftId,
    fromUserId,
    toUserId,
    perkId,
    createdAt: nowMs,
    expiresAt: nowMs + DEFAULT_GIFT_EXPIRES_MS,
    status: "pending",
  };

  saveStore();
  return { ...guild.pendingGifts[giftId] };
};

const getPendingGift = (guildId, giftId, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const gift = guild.pendingGifts[giftId];
  if (!gift) return null;
  if (gift.status !== "pending") return null;
  if (Number(gift.expiresAt) <= nowMs) {
    delete guild.pendingGifts[giftId];
    saveStore();
    return null;
  }
  return { ...gift };
};

const resolvePendingGift = (guildId, giftId, action, nowMs = Date.now()) => {
  const guild = ensureGuildShop(guildId, nowMs);
  const gift = guild.pendingGifts[giftId];
  if (!gift) return null;

  gift.status = action;
  gift.resolvedAt = nowMs;
  const snapshot = { ...gift };
  delete guild.pendingGifts[giftId];
  saveStore();
  return snapshot;
};

const getQuestXpBoostMultiplier = (guildId, userId, nowMs = Date.now()) => {
  const active = getActivePerksForUser(guildId, userId, nowMs);
  let maxMultiplier = 1;

  for (const entry of active) {
    const perk = getPerkConfig(guildId, entry.perkId, nowMs);
    if (perk?.type === "xp_boost") {
      maxMultiplier = Math.max(maxMultiplier, Number(perk.multiplier || 1.5));
    }
  }

  return maxMultiplier;
};

const formatDurationLabel = (hours) => {
  const safe = Math.max(1, Number(hours) || 1);
  if (safe % 24 === 0) {
    const days = safe / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }

  return `${safe} hour${safe === 1 ? "" : "s"}`;
};

const buildShopPanelPayload = (guildId, nowMs = Date.now()) => {
  const config = getShopConfig(guildId, nowMs);
  const perkLines = [];

  for (const perk of config.perks) {
    const limitText = perk.weeklyLimit ? ` • weekly cap: ${perk.weeklyLimit}` : " • weekly cap: none";
    const status = perk.enabled ? "✅" : "⛔";
    perkLines.push(
      `${status} **${perk.name}** (ID: \`${perk.id}\`)\n${perk.description}\nCost: **${perk.price}** coins • Duration: **${formatDurationLabel(perk.durationHours)}**${limitText}`
    );
  }

  const embed = new EmbedBuilder()
    .setColor("#F5A524")
    .setTitle("Quest Coin Shop")
    .setDescription(perkLines.join("\n\n"))
    .setFooter({ text: "Use buttons to buy for yourself or gift to another user." });

  const components = [];
  for (let i = 0; i < config.perks.length; i += 5) {
    const row = new ActionRowBuilder();
    for (const perk of config.perks.slice(i, i + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`${SHOP_BUY_BUTTON_PREFIX}${perk.id}`)
          .setLabel(perk.name.slice(0, 80))
          .setStyle(ButtonStyle.Primary)
          .setDisabled(!perk.enabled)
      );
    }
    components.push(row);
  }

  return { embeds: [embed], components };
};

const buildGiftPromptPayload = (gift, guildId, nowMs = Date.now()) => {
  const perk = getPerkConfig(guildId, gift.perkId, nowMs);
  if (!perk) return null;

  const embed = new EmbedBuilder()
    .setColor("#10B981")
    .setTitle("Perk Gift Offer")
    .setDescription(`<@${gift.toUserId}>, <@${gift.fromUserId}> wants to buy **${perk.name}** for you.`)
    .addFields(
      { name: "Perk", value: perk.name, inline: true },
      { name: "Duration", value: formatDurationLabel(perk.durationHours), inline: true },
      { name: "Cost to sender", value: `${perk.price} coins`, inline: true }
    )
    .setFooter({ text: "Accept to consume sender coins, or decline." });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SHOP_GIFT_ACCEPT_PREFIX}${gift.id}`)
      .setLabel("Accept Gift")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${SHOP_GIFT_DECLINE_PREFIX}${gift.id}`)
      .setLabel("Decline")
      .setStyle(ButtonStyle.Danger)
  );

  return { embeds: [embed], components: [row] };
};

const parsePerkId = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return PERK_MAP.has(normalized) ? normalized : null;
};

const createOrUpdateAutoRole = async (guild, key) => {
  const guildData = ensureGuildShop(guild.id);
  const roleId = guildData.autoRoleIds[key];
  const existing = roleId ? guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null) : null;
  if (existing) return existing;

  if (key === "nickname") {
    const role = await guild.roles.create({
      name: "Quest Shop - Nickname",
      permissions: [PermissionFlagsBits.ChangeNickname],
      reason: "Auto-created quest shop perk role",
      mentionable: false,
      hoist: false,
    });
    setAutoRoleId(guild.id, "nickname", role.id);
    return role;
  }

  if (key === "attachment") {
    const role = await guild.roles.create({
      name: "Quest Shop - Media",
      permissions: [
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.UseExternalStickers,
      ],
      reason: "Auto-created quest shop perk role",
      mentionable: false,
      hoist: false,
    });
    setAutoRoleId(guild.id, "attachment", role.id);
    return role;
  }

  return null;
};

module.exports = {
  SHOP_BUY_BUTTON_PREFIX,
  SHOP_GIFT_ACCEPT_PREFIX,
  SHOP_GIFT_DECLINE_PREFIX,
  PERK_DEFINITIONS,
  parsePerkId,
  loadStore,
  saveStore,
  getShopConfig,
  setShopChannel,
  setShopMessageId,
  updatePerkConfig,
  setPremiumRoleIds,
  setAutoRoleId,
  getPerkConfig,
  getAllPerksForGuild,
  canUsePerkThisWeek,
  getPerkWeeklyStats,
  hasActivePerk,
  createActivePerkEntry,
  removeActivePerkEntry,
  getExpiredActiveEntries,
  getActivePerksForUser,
  createPendingGift,
  getPendingGift,
  resolvePendingGift,
  getQuestXpBoostMultiplier,
  buildShopPanelPayload,
  buildGiftPromptPayload,
  createOrUpdateAutoRole,
};
