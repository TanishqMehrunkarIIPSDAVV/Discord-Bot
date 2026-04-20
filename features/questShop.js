const path = require("node:path");
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  Events,
  PermissionFlagsBits,
  userMention,
} = require("discord.js");
const config = require("../config.json");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  getQuestCoins,
  spendQuestCoins,
  addQuestCoins,
  transferQuestCoins,
  setQuestXpBoostResolver,
} = require("../utils/questStore");
const {
  SHOP_BUY_BUTTON_PREFIX,
  SHOP_GIFT_ACCEPT_PREFIX,
  SHOP_GIFT_DECLINE_PREFIX,
  parsePerkId,
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
  createPendingGift,
  getPendingGift,
  resolvePendingGift,
  getQuestXpBoostMultiplier,
  buildShopPanelPayload,
  buildGiftPromptPayload,
  createOrUpdateAutoRole,
} = require("../utils/questShopStore");

const PREFIX = "ct";
const SHOP_TICK_MS = 60_000;
const GAMBLE_COOLDOWN_MS = 30_000;
const GAMBLE_WIN_CHANCE = 0.45;
const DEFAULT_SHOP_CHANNEL_ID = String(config.questShopChannelId || "").trim();
const DEFAULT_PREMIUM_ROLE_1_ID = String(config.questShopPremiumRole1Id || "").trim();
const DEFAULT_PREMIUM_ROLE_2_ID = String(config.questShopPremiumRole2Id || "").trim();
const DEFAULT_NICKNAME_ROLE_ID = String(config.questShopNicknameRoleId || "").trim();
const DEFAULT_ATTACHMENT_ROLE_ID = String(config.questShopAttachmentRoleId || "").trim();
const DEFAULT_CUSTOM_ROLE_ANCHOR_ROLE_ID = String(config.questShopCustomRoleAnchorRoleId || "858924540788211723").trim();
const SHOP_ACTION_SELF_PREFIX = "qshop_self:";
const SHOP_ACTION_GIFT_PICK_PREFIX = "qshop_gpick:";
const SHOP_GIFT_USER_SELECT_PREFIX = "qshop_gsel:";
const SHOP_CUSTOM_ROLE_SELF_MODAL_PREFIX = "qshop_crole_self:";
const SHOP_CUSTOM_ROLE_GIFT_MODAL_PREFIX = "qshop_crole_gift:";
const SHOP_CUSTOM_ROLE_NAME_INPUT_ID = "qshop_custom_role_name";

let registered = false;
let tickHandle = null;
const gambleCooldowns = new Map();

const isAdminMember = (member) => {
  const perms = member?.permissions;
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.Administrator) || perms.has(PermissionFlagsBits.ManageGuild);
};

const formatExpiry = (timestampMs) => `<t:${Math.floor(Number(timestampMs) / 1000)}:R>`;

const parseMentionUserId = (message, rawArg) => {
  const mention = message.mentions.users.first();
  if (mention) return mention.id;
  const cleaned = String(rawArg || "").replace(/[<@!>]/g, "").trim();
  if (!/^\d{17,20}$/.test(cleaned)) return null;
  return cleaned;
};

const parseChannelId = (message, rawArg) => {
  const mention = message.mentions.channels.first();
  if (mention) return mention.id;
  const cleaned = String(rawArg || "").replace(/[<#>]/g, "").trim();
  if (!/^\d{17,20}$/.test(cleaned)) return null;
  return cleaned;
};

const parseRoleId = (message, rawArg) => {
  const mention = message.mentions.roles.first();
  if (mention) return mention.id;
  const cleaned = String(rawArg || "").replace(/[<@&>]/g, "").trim();
  if (!/^\d{17,20}$/.test(cleaned)) return null;
  return cleaned;
};

const getCustomRoleName = (member, requestedName = "") => {
  const requested = String(requestedName || "").replace(/\s+/g, " ").trim();
  if (requested) {
    return requested.slice(0, 100);
  }

  const base = member?.displayName || member?.user?.username || "Member";
  const normalized = base.replace(/[^a-zA-Z0-9 _\-]/g, "").trim();
  return `Custom | ${normalized.slice(0, 32) || "Member"}`;
};

const buildCustomRoleNameModal = (customId, title) => {
  const input = new TextInputBuilder()
    .setCustomId(SHOP_CUSTOM_ROLE_NAME_INPUT_ID)
    .setLabel("Role Name")
    .setPlaceholder("Enter your custom role name")
    .setStyle(TextInputStyle.Short)
    .setMinLength(2)
    .setMaxLength(100)
    .setRequired(true);

  const row = new ActionRowBuilder().addComponents(input);
  return new ModalBuilder().setCustomId(customId).setTitle(title).addComponents(row);
};

const removePerkEffect = async (guild, entry) => {
  const member = await guild.members.fetch(entry.userId).catch(() => null);
  if (!member) return;

  if (entry.meta?.roleId) {
    await member.roles.remove(entry.meta.roleId).catch(() => null);
  }

  if (entry.meta?.customRoleId) {
    const role = guild.roles.cache.get(entry.meta.customRoleId) || await guild.roles.fetch(entry.meta.customRoleId).catch(() => null);
    if (role) {
      await member.roles.remove(role.id).catch(() => null);
      await role.delete("Quest shop custom role expired").catch(() => null);
    }
  }
};

const resolveConfiguredRole = async (guild, configuredRoleId) => {
  const roleId = String(configuredRoleId || "").trim();
  if (!roleId) return null;
  return guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
};

const resolveShopAutoRole = async (guild, key) => {
  const configuredRoleId = key === "nickname" ? DEFAULT_NICKNAME_ROLE_ID : DEFAULT_ATTACHMENT_ROLE_ID;
  const configuredRole = await resolveConfiguredRole(guild, configuredRoleId);
  if (configuredRole) {
    setAutoRoleId(guild.id, key, configuredRole.id);
    return configuredRole;
  }

  return createOrUpdateAutoRole(guild, key);
};

const positionCustomRoleRelativeToAnchor = async (guild, role) => {
  if (!role || !DEFAULT_CUSTOM_ROLE_ANCHOR_ROLE_ID) return;

  const anchorRole = await resolveConfiguredRole(guild, DEFAULT_CUSTOM_ROLE_ANCHOR_ROLE_ID);
  if (!anchorRole) return;

  // Place custom role directly below the configured anchor role in hierarchy.
  const desiredPosition = Math.max(1, Number(anchorRole.position) - 1);
  await role.setPosition(desiredPosition, "Position custom role under configured anchor role").catch(() => null);
};

const applyPerkEffect = async (guild, targetUserId, perkId, options = {}) => {
  const { customRoleName = "" } = options;
  const perk = getPerkConfig(guild.id, perkId);
  if (!perk) {
    return { ok: false, reason: "Unknown perk." };
  }

  if (!perk.enabled) {
    return { ok: false, reason: "That perk is disabled right now." };
  }

  const weeklyCheck = canUsePerkThisWeek(guild.id, perkId, targetUserId);
  if (!weeklyCheck.ok) {
    return { ok: false, reason: weeklyCheck.reason };
  }

  if (hasActivePerk(guild.id, targetUserId, perkId)) {
    return { ok: false, reason: "This user already has that perk active." };
  }

  const member = await guild.members.fetch(targetUserId).catch(() => null);
  if (!member || member.user.bot) {
    return { ok: false, reason: "Target user is unavailable." };
  }

  const meta = {};

  if (perk.type === "role_auto") {
    const role = await resolveShopAutoRole(guild, perk.autoRoleKey);
    if (!role) return { ok: false, reason: "Could not create or resolve the perk role." };
    await member.roles.add(role.id, "Quest shop perk purchase").catch(() => null);
    meta.roleId = role.id;
  }

  if (perk.type === "role_configured") {
    const cfg = getShopConfig(guild.id);
    const fallbackRoleId = perk.configuredRoleSlot === 1 ? DEFAULT_PREMIUM_ROLE_1_ID : DEFAULT_PREMIUM_ROLE_2_ID;
    const roleId = String(cfg.premiumRoleIds?.[String(perk.configuredRoleSlot)] || fallbackRoleId || "").trim();
    if (!roleId) {
      return { ok: false, reason: `Premium role ${perk.configuredRoleSlot} is not configured yet.` };
    }

    const role = guild.roles.cache.get(roleId) || await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      return { ok: false, reason: `Configured premium role ${perk.configuredRoleSlot} was not found.` };
    }

    await member.roles.add(role.id, "Quest shop perk purchase").catch(() => null);
    meta.roleId = role.id;
  }

  if (perk.type === "custom_role") {
    const resolvedName = getCustomRoleName(member, customRoleName);
    const role = await guild.roles.create({
      name: resolvedName,
      reason: "Quest shop custom role purchase",
      mentionable: false,
      hoist: true,
    });

    await positionCustomRoleRelativeToAnchor(guild, role);

    await member.roles.add(role.id, "Quest shop custom role purchase").catch(() => null);
    meta.customRoleId = role.id;
  }

  const entry = createActivePerkEntry(guild.id, targetUserId, perkId, meta);
  if (!entry) {
    if (meta.customRoleId) {
      const role = guild.roles.cache.get(meta.customRoleId) || await guild.roles.fetch(meta.customRoleId).catch(() => null);
      if (role) await role.delete("Rollback failed perk purchase").catch(() => null);
    }
    return { ok: false, reason: "Could not activate perk entry." };
  }

  return {
    ok: true,
    perk,
    expiresAt: entry.expiresAt,
  };
};

const processExpiredPerks = async () => {
  for (const guild of client.guilds.cache.values()) {
    const expired = getExpiredActiveEntries(guild.id);
    for (const entry of expired) {
      await removePerkEffect(guild, entry);
      removeActivePerkEntry(guild.id, entry.id);
    }
  }
};

const postOrRefreshShopPanel = async (guild, channelId = null) => {
  const config = getShopConfig(guild.id);
  const resolvedChannelId = channelId || config.shopChannelId || DEFAULT_SHOP_CHANNEL_ID;
  if (!resolvedChannelId) {
    return { ok: false, reason: "Shop channel is not configured." };
  }

  const channel = guild.channels.cache.get(resolvedChannelId) || await guild.channels.fetch(resolvedChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { ok: false, reason: "Configured shop channel is invalid or not text-based." };
  }

  const payload = buildShopPanelPayload(guild.id);
  if (config.shopMessageId) {
    const previous = await channel.messages.fetch(config.shopMessageId).catch(() => null);
    if (previous) {
      await previous.edit(payload).catch(() => null);
      return { ok: true, channelId: channel.id, messageId: previous.id, updated: true };
    }
  }

  const sent = await channel.send(payload);
  setShopChannel(guild.id, channel.id);
  setShopMessageId(guild.id, sent.id);
  return { ok: true, channelId: channel.id, messageId: sent.id, updated: false };
};

const trySpendForPerk = (guildId, userId, perk) => {
  return spendQuestCoins(guildId, userId, perk.price);
};

const buyPerkForUser = async (guild, buyerId, targetUserId, perkId, options = {}) => {
  const perk = getPerkConfig(guild.id, perkId);
  if (!perk) return { ok: false, reason: "Unknown perk ID." };
  if (!perk.enabled) return { ok: false, reason: "That perk is disabled." };

  const spendResult = trySpendForPerk(guild.id, buyerId, perk);
  if (!spendResult.ok) {
    return { ok: false, reason: `Not enough coins. You need ${perk.price}.` };
  }

  const applyResult = await applyPerkEffect(guild, targetUserId, perkId, options);
  if (!applyResult.ok) {
    addQuestCoins(guild.id, buyerId, perk.price);
    return { ok: false, reason: applyResult.reason };
  }

  return {
    ok: true,
    perk: applyResult.perk,
    expiresAt: applyResult.expiresAt,
    buyerBalance: spendResult.balance,
  };
};

const handleShopConfigCommand = async (message, args) => {
  if (!isAdminMember(message.member)) {
    await message.reply("You need Administrator or Manage Server to configure the shop.").catch(() => {});
    return;
  }

  const action = String(args[0] || "").toLowerCase();

  if (!action || action === "help") {
    await message.channel.send([
      "Shop admin commands:",
      "ct shop setchannel <#channel|channelId>",
      "ct shop post",
      "ct shop setprice <perkId> <coins>",
      "ct shop setduration <perkId> <hours>",
      "ct shop setlimit <perkId> <count|none>",
      "ct shop setpremiumroles <roleId1> <roleId2>",
      "ct shop enable <perkId>",
      "ct shop disable <perkId>",
      "ct shop list",
      "Buying is embed-only from the shop panel buttons.",
    ].join("\n")).catch(() => {});
    return;
  }

  if (action === "setchannel") {
    const channelId = parseChannelId(message, args[1]);
    if (!channelId) {
      await message.reply("Provide a valid channel mention or ID.").catch(() => {});
      return;
    }

    const channel = message.guild.channels.cache.get(channelId) || await message.guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      await message.reply("That channel is not usable for shop panel.").catch(() => {});
      return;
    }

    setShopChannel(message.guild.id, channelId);
    await message.reply(`Shop channel set to <#${channelId}>.`).catch(() => {});
    return;
  }

  if (action === "post") {
    const result = await postOrRefreshShopPanel(message.guild);
    if (!result.ok) {
      await message.reply(result.reason).catch(() => {});
      return;
    }

    await message.reply(result.updated ? "Shop panel updated." : "Shop panel posted.").catch(() => {});
    return;
  }

  if (action === "setprice") {
    const perkId = parsePerkId(args[1]);
    const price = Math.floor(Number(args[2]));
    if (!perkId || !Number.isFinite(price) || price < 0) {
      await message.reply("Usage: ct shop setprice <perkId> <coins>").catch(() => {});
      return;
    }

    const updated = updatePerkConfig(message.guild.id, perkId, { price });
    await message.reply(`Updated ${updated.name} price to ${updated.price} coins.`).catch(() => {});
    return;
  }

  if (action === "setduration") {
    const perkId = parsePerkId(args[1]);
    const durationHours = Number(args[2]);
    if (!perkId || !Number.isFinite(durationHours) || durationHours <= 0) {
      await message.reply("Usage: ct shop setduration <perkId> <hours>").catch(() => {});
      return;
    }

    const updated = updatePerkConfig(message.guild.id, perkId, { durationHours });
    await message.reply(`Updated ${updated.name} duration to ${updated.durationHours} hours.`).catch(() => {});
    return;
  }

  if (action === "setlimit") {
    const perkId = parsePerkId(args[1]);
    const raw = String(args[2] || "").toLowerCase();
    if (!perkId || !raw) {
      await message.reply("Usage: ct shop setlimit <perkId> <count|none>").catch(() => {});
      return;
    }

    const weeklyLimit = raw === "none" ? null : Math.floor(Number(raw));
    if (raw !== "none" && (!Number.isFinite(weeklyLimit) || weeklyLimit <= 0)) {
      await message.reply("Limit must be a positive number or 'none'.").catch(() => {});
      return;
    }

    const updated = updatePerkConfig(message.guild.id, perkId, { weeklyLimit });
    await message.reply(
      updated.weeklyLimit
        ? `Updated ${updated.name} weekly user limit to ${updated.weeklyLimit}.`
        : `Removed weekly user limit for ${updated.name}.`
    ).catch(() => {});
    return;
  }

  if (action === "setpremiumroles") {
    const role1 = parseRoleId(message, args[1]);
    const role2 = parseRoleId(message, args[2]);
    if (!role1 || !role2) {
      await message.reply("Usage: ct shop setpremiumroles <roleId1> <roleId2>").catch(() => {});
      return;
    }

    setPremiumRoleIds(message.guild.id, role1, role2);
    await message.reply("Premium role slots updated.").catch(() => {});
    return;
  }

  if (action === "enable" || action === "disable") {
    const perkId = parsePerkId(args[1]);
    if (!perkId) {
      await message.reply("Usage: ct shop enable|disable <perkId>").catch(() => {});
      return;
    }

    const updated = updatePerkConfig(message.guild.id, perkId, { enabled: action === "enable" });
    await message.reply(`${updated.name} is now ${updated.enabled ? "enabled" : "disabled"}.`).catch(() => {});
    return;
  }

  if (action === "list") {
    const perks = getAllPerksForGuild(message.guild.id);
    const lines = perks.map((perk) => {
      const limitText = perk.weeklyLimit ? `${perk.weeklyLimit}/week` : "none";
      return `${perk.id}: ${perk.name} | price=${perk.price} | duration=${perk.durationHours}h | weekly=${limitText} | ${perk.enabled ? "enabled" : "disabled"}`;
    });

    await message.channel.send(lines.join("\n")).catch(() => {});
    return;
  }

  await message.reply("Unknown shop action. Use ct shop help").catch(() => {});
};

const handleShopBuyOrGiftCommand = async (message, args) => {
  await handleShopConfigCommand(message, args);
};

const handleCoinCommands = async (message, parts) => {
  const sub = String(parts[2] || "").toLowerCase();

  if (!sub || sub === "balance") {
    const balance = getQuestCoins(message.guild.id, message.author.id);
    await message.reply(`You have **${balance}** quest coins.`).catch(() => {});
    return;
  }

  if (sub === "gift") {
    const targetUserId = parseMentionUserId(message, parts[3]);
    const amount = Math.floor(Number(parts[4]));
    if (!targetUserId || !Number.isFinite(amount) || amount <= 0) {
      await message.reply("Usage: ct coin gift @user <amount>").catch(() => {});
      return;
    }

    if (targetUserId === message.author.id) {
      await message.reply("You cannot gift coins to yourself.").catch(() => {});
      return;
    }

    const result = transferQuestCoins(message.guild.id, message.author.id, targetUserId, amount);
    if (!result.ok) {
      await message.reply(result.reason || "Coin transfer failed.").catch(() => {});
      return;
    }

    await message.reply(
      `Transferred **${amount}** coins to ${userMention(targetUserId)}. Your balance: **${result.fromBalance}**`
    ).catch(() => {});
    return;
  }

  await message.reply("Usage: ct coin [balance] or ct coin gift @user <amount>").catch(() => {});
};

const handleGamble = async (message, amountArg) => {
  const now = Date.now();
  const key = `${message.guild.id}:${message.author.id}`;
  const cooldownUntil = Number(gambleCooldowns.get(key) || 0);
  if (now < cooldownUntil) {
    const remaining = Math.ceil((cooldownUntil - now) / 1000);
    await message.reply(`Gamble cooldown active. Try again in ${remaining}s.`).catch(() => {});
    return;
  }

  const currentBalance = getQuestCoins(message.guild.id, message.author.id);
  if (currentBalance <= 0) {
    await message.reply("You do not have any quest coins to gamble.").catch(() => {});
    return;
  }

  const normalized = String(amountArg || "").trim().toLowerCase();
  const amount = normalized === "all" ? currentBalance : Math.floor(Number(normalized));
  if (!Number.isFinite(amount) || amount <= 0) {
    await message.reply("Usage: ct gamble <amount|all>").catch(() => {});
    return;
  }

  if (amount > currentBalance) {
    await message.reply(`You only have ${currentBalance} coins.`).catch(() => {});
    return;
  }

  const spend = spendQuestCoins(message.guild.id, message.author.id, amount);
  if (!spend.ok) {
    await message.reply(spend.reason || "Could not place gamble.").catch(() => {});
    return;
  }

  const win = Math.random() < GAMBLE_WIN_CHANCE;
  let finalBalance = spend.balance;

  if (win) {
    const winnings = amount * 2;
    const add = addQuestCoins(message.guild.id, message.author.id, winnings);
    finalBalance = add.balance;
    await message.reply(
      `🎉 You won! Bet: **${amount}** -> Payout: **${winnings}**. New balance: **${finalBalance}**`
    ).catch(() => {});
  } else {
    await message.reply(`💀 You lost **${amount}** coins. New balance: **${finalBalance}**`).catch(() => {});
  }

  gambleCooldowns.set(key, now + GAMBLE_COOLDOWN_MS);
};

const handleButtonShopBuy = async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({ content: "Shop works only in servers.", flags: 64 }).catch(() => {});
    return;
  }

  const perkId = parsePerkId(interaction.customId.slice(SHOP_BUY_BUTTON_PREFIX.length));
  if (!perkId) {
    await interaction.reply({ content: "Unknown perk.", flags: 64 }).catch(() => {});
    return;
  }

  const perk = getPerkConfig(interaction.guild.id, perkId);
  if (!perk || !perk.enabled) {
    await interaction.reply({ content: "That perk is currently unavailable.", flags: 64 }).catch(() => {});
    return;
  }

  const balance = getQuestCoins(interaction.guild.id, interaction.user.id);
  const weeklyStats = getPerkWeeklyStats(interaction.guild.id, perkId);
  const weeklyLine = weeklyStats?.hasLimit
    ? `Weekly slots left: **${weeklyStats.remaining}/${weeklyStats.limit}**`
    : "Weekly slots left: **Unlimited**";
  const warningLines = [];

  if (balance < perk.price) {
    warningLines.push("🔴 Warning: Your balance is below the perk cost.");
  }

  if (weeklyStats?.hasLimit && Number(weeklyStats.remaining) <= 0) {
    warningLines.push("🔴 Warning: Weekly slots for this perk are currently full.");
  }

  const warningText = warningLines.length ? `\n\n${warningLines.join("\n")}` : "";

  const embed = new EmbedBuilder()
    .setColor("#F5A524")
    .setTitle(`Buy ${perk.name}`)
    .setDescription([
      `Cost: **${perk.price}** coins`,
      `Duration: **${Math.max(1, Number(perk.durationHours))}h**`,
      `Your balance: **${balance}** coins`,
      weeklyLine,
      "Choose whether to buy for yourself or gift to another user.",
    ].join("\n") + warningText);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${SHOP_ACTION_SELF_PREFIX}${perkId}`)
      .setLabel("Buy For Me")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${SHOP_ACTION_GIFT_PICK_PREFIX}${perkId}`)
      .setLabel("Buy For Someone")
      .setStyle(ButtonStyle.Primary)
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 }).catch(() => {});
};

const handleButtonSelfBuy = async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({ content: "Shop works only in servers.", flags: 64 }).catch(() => {});
    return;
  }

  const perkId = parsePerkId(interaction.customId.slice(SHOP_ACTION_SELF_PREFIX.length));
  if (!perkId) {
    await interaction.reply({ content: "Unknown perk.", flags: 64 }).catch(() => {});
    return;
  }

  const perk = getPerkConfig(interaction.guild.id, perkId);
  if (!perk || !perk.enabled) {
    await interaction.reply({ content: "That perk is currently unavailable.", flags: 64 }).catch(() => {});
    return;
  }

  if (perk.id === "custom_role") {
    const modal = buildCustomRoleNameModal(
      `${SHOP_CUSTOM_ROLE_SELF_MODAL_PREFIX}${perkId}`,
      "Choose Custom Role Name"
    );
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  const result = await buyPerkForUser(interaction.guild, interaction.user.id, interaction.user.id, perkId);
  if (!result.ok) {
    await interaction.reply({ content: result.reason, flags: 64 }).catch(() => {});
    return;
  }

  await interaction.reply({
    content: `Purchased **${result.perk.name}**. Expires ${formatExpiry(result.expiresAt)}. Balance: **${result.buyerBalance}** coins.`,
    flags: 64,
  }).catch(() => {});
};

const handleButtonGiftPick = async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({ content: "Shop works only in servers.", flags: 64 }).catch(() => {});
    return;
  }

  const perkId = parsePerkId(interaction.customId.slice(SHOP_ACTION_GIFT_PICK_PREFIX.length));
  if (!perkId) {
    await interaction.reply({ content: "Unknown perk.", flags: 64 }).catch(() => {});
    return;
  }

  const perk = getPerkConfig(interaction.guild.id, perkId);
  if (!perk || !perk.enabled) {
    await interaction.reply({ content: "That perk is currently unavailable.", flags: 64 }).catch(() => {});
    return;
  }

  const balance = getQuestCoins(interaction.guild.id, interaction.user.id);
  if (balance < perk.price) {
    await interaction.reply({
      content: `You need ${perk.price} coins to gift this perk. Current balance: ${balance}.`,
      flags: 64,
    }).catch(() => {});
    return;
  }

  const embed = new EmbedBuilder()
    .setColor("#10B981")
    .setTitle(`Gift ${perk.name}`)
    .setDescription("Pick the user who should receive this perk gift.");

  const row = new ActionRowBuilder().addComponents(
    new UserSelectMenuBuilder()
      .setCustomId(`${SHOP_GIFT_USER_SELECT_PREFIX}${perkId}`)
      .setPlaceholder("Select a user")
      .setMinValues(1)
      .setMaxValues(1)
  );

  await interaction.reply({ embeds: [embed], components: [row], flags: 64 }).catch(() => {});
};

const handleGiftUserSelect = async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({ content: "Shop works only in servers.", flags: 64 }).catch(() => {});
    return;
  }

  const perkId = parsePerkId(interaction.customId.slice(SHOP_GIFT_USER_SELECT_PREFIX.length));
  if (!perkId) {
    await interaction.reply({ content: "Unknown perk.", flags: 64 }).catch(() => {});
    return;
  }

  const targetUserId = interaction.values?.[0];
  if (!targetUserId) {
    await interaction.reply({ content: "Please select a user.", flags: 64 }).catch(() => {});
    return;
  }

  if (targetUserId === interaction.user.id) {
    await interaction.reply({ content: "Use Buy For Me for self purchase.", flags: 64 }).catch(() => {});
    return;
  }

  const targetMember = await interaction.guild.members.fetch(targetUserId).catch(() => null);
  if (!targetMember || targetMember.user.bot) {
    await interaction.reply({ content: "Target user is not valid for gifting.", flags: 64 }).catch(() => {});
    return;
  }

  const perk = getPerkConfig(interaction.guild.id, perkId);
  if (!perk || !perk.enabled) {
    await interaction.reply({ content: "That perk is unavailable now.", flags: 64 }).catch(() => {});
    return;
  }

  const balance = getQuestCoins(interaction.guild.id, interaction.user.id);
  if (balance < perk.price) {
    await interaction.reply({
      content: `You need ${perk.price} coins to gift this perk. Current balance: ${balance}.`,
      flags: 64,
    }).catch(() => {});
    return;
  }

  const gift = createPendingGift(interaction.guild.id, interaction.user.id, targetUserId, perkId);
  const promptPayload = buildGiftPromptPayload(gift, interaction.guild.id);
  if (!promptPayload) {
    await interaction.reply({ content: "Could not create gift prompt.", flags: 64 }).catch(() => {});
    return;
  }

  await interaction.channel.send({
    content: `${userMention(targetUserId)} you received a perk gift offer!`,
    ...promptPayload,
  }).catch(() => {});

  await interaction.reply({
    content: `Gift request sent to ${userMention(targetUserId)}. Coins will be deducted only if accepted.`,
    flags: 64,
  }).catch(() => {});
};

const handleSelfCustomRoleModalSubmit = async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({ content: "Shop works only in servers.", flags: 64 }).catch(() => {});
    return;
  }

  const perkId = parsePerkId(interaction.customId.slice(SHOP_CUSTOM_ROLE_SELF_MODAL_PREFIX.length));
  if (!perkId) {
    await interaction.reply({ content: "Unknown perk.", flags: 64 }).catch(() => {});
    return;
  }

  const customRoleName = interaction.fields.getTextInputValue(SHOP_CUSTOM_ROLE_NAME_INPUT_ID).trim();
  if (!customRoleName || customRoleName.length < 2) {
    await interaction.reply({ content: "Role name must be at least 2 characters.", flags: 64 }).catch(() => {});
    return;
  }

  const result = await buyPerkForUser(
    interaction.guild,
    interaction.user.id,
    interaction.user.id,
    perkId,
    { customRoleName }
  );
  if (!result.ok) {
    await interaction.reply({ content: result.reason, flags: 64 }).catch(() => {});
    return;
  }

  await interaction.reply({
    content: `Purchased **${result.perk.name}** as **${customRoleName}**. Expires ${formatExpiry(result.expiresAt)}. Balance: **${result.buyerBalance}** coins.`,
    flags: 64,
  }).catch(() => {});
};

const finalizeGiftAcceptance = async (interaction, gift, customRoleName = "") => {
  const perk = getPerkConfig(interaction.guild.id, gift.perkId);
  if (!perk || !perk.enabled) {
    resolvePendingGift(interaction.guild.id, gift.id, "expired");
    await interaction.reply({ content: "This perk is unavailable now.", flags: 64 }).catch(() => {});
    return;
  }

  const spend = spendQuestCoins(interaction.guild.id, gift.fromUserId, perk.price);
  if (!spend.ok) {
    resolvePendingGift(interaction.guild.id, gift.id, "failed");
    await interaction.reply({ content: "Sender no longer has enough coins.", flags: 64 }).catch(() => {});
    return;
  }

  const apply = await applyPerkEffect(interaction.guild, gift.toUserId, gift.perkId, { customRoleName });
  if (!apply.ok) {
    addQuestCoins(interaction.guild.id, gift.fromUserId, perk.price);
    resolvePendingGift(interaction.guild.id, gift.id, "failed");
    await interaction.reply({ content: `Could not apply perk: ${apply.reason}`, flags: 64 }).catch(() => {});
    return;
  }

  resolvePendingGift(interaction.guild.id, gift.id, "accepted");

  await interaction.reply({
    content: `Gift accepted: **${apply.perk.name}** is active until ${formatExpiry(apply.expiresAt)}.`,
    flags: 64,
  }).catch(() => {});

  const sender = await interaction.guild.members.fetch(gift.fromUserId).catch(() => null);
  if (sender) {
    await sender.send(
      `${interaction.user.tag} accepted your gift. You spent ${perk.price} coins. Remaining balance: ${spend.balance}.`
    ).catch(() => {});
  }
};

const handleGiftCustomRoleModalSubmit = async (interaction) => {
  if (!interaction.guild) {
    await interaction.reply({ content: "Gift actions work only in servers.", flags: 64 }).catch(() => {});
    return;
  }

  const giftId = interaction.customId.slice(SHOP_CUSTOM_ROLE_GIFT_MODAL_PREFIX.length);
  const gift = getPendingGift(interaction.guild.id, giftId);
  if (!gift) {
    await interaction.reply({ content: "Gift is no longer available.", flags: 64 }).catch(() => {});
    return;
  }

  if (gift.toUserId !== interaction.user.id) {
    await interaction.reply({ content: "Only the recipient can submit this gift name.", flags: 64 }).catch(() => {});
    return;
  }

  const customRoleName = interaction.fields.getTextInputValue(SHOP_CUSTOM_ROLE_NAME_INPUT_ID).trim();
  if (!customRoleName || customRoleName.length < 2) {
    await interaction.reply({ content: "Role name must be at least 2 characters.", flags: 64 }).catch(() => {});
    return;
  }

  await finalizeGiftAcceptance(interaction, gift, customRoleName);
};

const handleGiftButtonAction = async (interaction, action) => {
  if (!interaction.guild) {
    await interaction.reply({ content: "Gift actions work only in servers.", flags: 64 }).catch(() => {});
    return;
  }

  const prefix = action === "accept" ? SHOP_GIFT_ACCEPT_PREFIX : SHOP_GIFT_DECLINE_PREFIX;
  const giftId = interaction.customId.slice(prefix.length);
  const gift = getPendingGift(interaction.guild.id, giftId);
  if (!gift) {
    await interaction.reply({ content: "Gift is no longer available.", flags: 64 }).catch(() => {});
    return;
  }

  if (gift.toUserId !== interaction.user.id) {
    await interaction.reply({ content: "Only the recipient can respond to this gift.", flags: 64 }).catch(() => {});
    return;
  }

  if (action === "decline") {
    resolvePendingGift(interaction.guild.id, gift.id, "declined");
    await interaction.reply({ content: "Gift declined.", flags: 64 }).catch(() => {});
    return;
  }

  const perk = getPerkConfig(interaction.guild.id, gift.perkId);
  if (perk?.id === "custom_role") {
    const modal = buildCustomRoleNameModal(
      `${SHOP_CUSTOM_ROLE_GIFT_MODAL_PREFIX}${gift.id}`,
      "Choose Gifted Role Name"
    );
    await interaction.showModal(modal).catch(() => {});
    return;
  }

  await finalizeGiftAcceptance(interaction, gift, "");
};

const questShop = () => {
  if (registered) return;
  registered = true;

  setQuestXpBoostResolver((guildId, userId) => getQuestXpBoostMultiplier(guildId, userId));

  client.on(Events.MessageCreate, async (message) => {
    if (!message.guild || message.author.bot) return;

    const parts = message.content.trim().split(/\s+/g);
    if ((parts[0] || "").toLowerCase() !== PREFIX) return;

    const command = (parts[1] || "").toLowerCase();

    if (command === "shop") {
      await handleShopBuyOrGiftCommand(message, parts.slice(2));
      return;
    }

    if (command === "coin" || command === "coins") {
      await handleCoinCommands(message, parts);
      return;
    }

    if (command === "gamble") {
      await handleGamble(message, parts[2]);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId.startsWith(SHOP_BUY_BUTTON_PREFIX)) {
        await handleButtonShopBuy(interaction);
        return;
      }

      if (interaction.customId.startsWith(SHOP_ACTION_SELF_PREFIX)) {
        await handleButtonSelfBuy(interaction);
        return;
      }

      if (interaction.customId.startsWith(SHOP_ACTION_GIFT_PICK_PREFIX)) {
        await handleButtonGiftPick(interaction);
        return;
      }

      if (interaction.customId.startsWith(SHOP_GIFT_ACCEPT_PREFIX)) {
        await handleGiftButtonAction(interaction, "accept");
        return;
      }

      if (interaction.customId.startsWith(SHOP_GIFT_DECLINE_PREFIX)) {
        await handleGiftButtonAction(interaction, "decline");
      }
      return;
    }

    if (interaction.isUserSelectMenu() && interaction.customId.startsWith(SHOP_GIFT_USER_SELECT_PREFIX)) {
      await handleGiftUserSelect(interaction);
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith(SHOP_CUSTOM_ROLE_SELF_MODAL_PREFIX)) {
        await handleSelfCustomRoleModalSubmit(interaction);
        return;
      }

      if (interaction.customId.startsWith(SHOP_CUSTOM_ROLE_GIFT_MODAL_PREFIX)) {
        await handleGiftCustomRoleModalSubmit(interaction);
      }
    }
  });

  client.once(Events.ClientReady, async () => {
    if (tickHandle) clearInterval(tickHandle);

    if (DEFAULT_PREMIUM_ROLE_1_ID || DEFAULT_PREMIUM_ROLE_2_ID) {
      const guildIds = client.guilds.cache.map((g) => g.id);
      for (const guildId of guildIds) {
        const cfg = getShopConfig(guildId);
        const role1 = String(cfg.premiumRoleIds?.["1"] || DEFAULT_PREMIUM_ROLE_1_ID || "").trim();
        const role2 = String(cfg.premiumRoleIds?.["2"] || DEFAULT_PREMIUM_ROLE_2_ID || "").trim();
        if (role1 || role2) {
          setPremiumRoleIds(guildId, role1 || null, role2 || null);
        }
      }
    }

    await processExpiredPerks();

    for (const guild of client.guilds.cache.values()) {
      const cfg = getShopConfig(guild.id);
      if (cfg.shopChannelId || DEFAULT_SHOP_CHANNEL_ID) {
        await postOrRefreshShopPanel(guild).catch(() => null);
      }
    }

    tickHandle = setInterval(() => {
      void processExpiredPerks();
    }, SHOP_TICK_MS);
  });
};

module.exports = questShop;
