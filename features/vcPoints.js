const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, EmbedBuilder } = require("discord.js");
const {
  startSession,
  stopSession,
  dropSession,
  getUserStats,
  getLeaderboard,
  listActiveSessions,
} = require("../utils/vcPointsStore");

const PREFIX = "ct";

const formatPoints = (value) => Number(value || 0).toFixed(2);
const formatHours = (value) => Number(value || 0).toFixed(2);

const resolveUserIdFromArg = async (message, rawArg) => {
  const firstMention = message.mentions.users.first();
  if (firstMention) return firstMention.id;

  const cleaned = (rawArg || "").replace(/[<@!>]/g, "").trim();
  if (!cleaned) return message.author.id;

  if (!/^\d{17,20}$/.test(cleaned)) return null;

  const fromCache = message.guild.members.cache.get(cleaned);
  if (fromCache) return fromCache.id;

  const fetched = await message.guild.members.fetch(cleaned).catch(() => null);
  return fetched?.id || null;
};

const sendUserPoints = async (message, targetUserId) => {
  const stats = getUserStats(message.guild.id, targetUserId);
  return message.channel.send(
    `${userMention(targetUserId)} has **${formatPoints(stats.points)}** VC points (tracked time: **${formatHours(
      stats.trackedHours
    )} hours**).`
  );
};

const sendLeaderboard = async (message, limitArg) => {
  const requestedLimit = Number(limitArg);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(25, Math.max(1, Math.floor(requestedLimit)))
    : 10;

  const rows = getLeaderboard(message.guild.id, limit);
  if (!rows.length) {
    return message.channel.send("No VC points have been recorded in this server yet.");
  }

  const lines = rows.map((entry, index) => {
    const rank = index + 1;
    return `${rank}. ${userMention(entry.userId)} - **${formatPoints(entry.points)}** points (**${formatHours(
      entry.trackedMinutes / 60
    )}h**)`;
  });

  const embed = new EmbedBuilder()
    .setColor("#2B8AF7")
    .setTitle(`VC Points Leaderboard (Top ${rows.length})`)
    .setDescription(lines.join("\n"));

  return message.channel.send({ embeds: [embed] });
};

const handlePrefixCommands = async (message) => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const lower = content.toLowerCase();
  if (!lower.startsWith(`${PREFIX} vcpoints`) && !lower.startsWith(`${PREFIX} vcleaderboard`)) {
    return;
  }

  const parts = content.split(/\s+/g);
  const command = (parts[1] || "").toLowerCase();

  if (command === "vcpoints") {
    const targetUserId = await resolveUserIdFromArg(message, parts[2]);
    if (!targetUserId) {
      return message.reply("Please mention a valid user or provide a valid user ID.");
    }

    return sendUserPoints(message, targetUserId);
  }

  if (command === "vcleaderboard") {
    return sendLeaderboard(message, parts[2]);
  }
};

const reconcileSessionsOnReady = async () => {
  const liveSessions = new Set();

  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      const userId = state.id;
      const isInVoice = Boolean(state.channelId);
      const isBot = state.member?.user?.bot;
      if (!isInVoice || isBot) continue;

      const key = `${guild.id}:${userId}`;
      liveSessions.add(key);
      startSession(guild.id, userId);
    }
  }

  const stale = listActiveSessions();
  for (const entry of stale) {
    const key = `${entry.guildId}:${entry.userId}`;
    if (!liveSessions.has(key)) {
      dropSession(entry.guildId, entry.userId);
    }
  }
};

const vcPoints = () => {
  client.on("voiceStateUpdate", async (oldState, newState) => {
    const user = newState.member?.user || oldState.member?.user;
    if (!user || user.bot) return;

    const guildId = newState.guild?.id || oldState.guild?.id;
    const userId = newState.id || oldState.id;
    if (!guildId || !userId) return;

    const wasInVoice = Boolean(oldState.channelId);
    const isInVoice = Boolean(newState.channelId);

    if (!wasInVoice && isInVoice) {
      startSession(guildId, userId);
      return;
    }

    if (wasInVoice && !isInVoice) {
      stopSession(guildId, userId);
    }
  });

  client.on("messageCreate", handlePrefixCommands);

  client.once("clientReady", async () => {
    // Rebuild in-memory sessions from current voice states when the bot comes online.
    await reconcileSessionsOnReady();
  });
};

module.exports = vcPoints;
