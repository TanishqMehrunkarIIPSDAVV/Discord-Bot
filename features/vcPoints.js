const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, EmbedBuilder } = require("discord.js");
const {
  startSession,
  stopSession,
  dropSession,
  pauseSession,
  resumeSession,
  loadStore,
  saveStore,
  getUserStats,
  getLeaderboard,
  listActiveSessions,
  getCurrentMilestone,
  getNextMilestone,
  MILESTONES,
} = require("../utils/vcPointsStore");

const PREFIX = "ct";
const MILESTONE_ANNOUNCE_CHANNEL_ID = "1439523872331534366";
const LIVE_MILESTONE_SYNC_INTERVAL_MS = 30000;

let liveMilestoneTicker = null;
let isLiveMilestoneSyncRunning = false;

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
  const currentMilestone = getCurrentMilestone(stats.points);
  const nextMilestone = getNextMilestone(stats.points);
  
  let milestoneText = "";
  if (currentMilestone) {
    milestoneText = `\n🏅 **${currentMilestone.name}**`;
  }
  
  let progressText = "";
  if (nextMilestone) {
    const pointsNeeded = nextMilestone.points - stats.points;
    progressText = `\n🎯 Next: **${nextMilestone.name}** (${pointsNeeded.toFixed(2)} points away)`;
  }
  
  return message.channel.send(
    `${userMention(targetUserId)} has **${formatPoints(stats.points)}** VC points (tracked time: **${formatHours(
      stats.trackedHours
    )} hours**)${milestoneText}${progressText}`
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
    const milestone = getCurrentMilestone(entry.points);
    const roleLabel = milestone ? milestone.name : "No milestone yet";
    return `${rank}. ${userMention(entry.userId)} - **${formatPoints(entry.points)}** points (**${formatHours(
      entry.trackedMinutes / 60
    )}h**) | **Role:** ${roleLabel}`;
  });

  const embed = new EmbedBuilder()
    .setColor("#2B8AF7")
    .setTitle(`VC Points Leaderboard (Top ${rows.length})`)
    .setDescription(lines.join("\n"));

  return message.channel.send({ embeds: [embed] });
};

const getMilestoneRoleIds = () => MILESTONES.map((milestone) => milestone.roleId);

const announceMilestone = async (guild, userId, milestone, points) => {
  const channel = await guild.channels.fetch(MILESTONE_ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send(
    `🎉 ${userMention(userId)} has reached **${milestone.name}** at **${formatPoints(points)}** VC points!`
  );
};

const syncMilestoneRoleForUser = async (guild, userId, options = {}) => {
  const { announce = false, markAnnounced = false } = options;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || member.user.bot) return;

  const stats = getUserStats(guild.id, userId);
  const currentMilestone = getCurrentMilestone(stats.points);
  const roleIds = getMilestoneRoleIds();
  const targetRoleId = currentMilestone?.roleId || null;

  const rolesToRemove = roleIds.filter((roleId) => member.roles.cache.has(roleId) && roleId !== targetRoleId);
  if (rolesToRemove.length) {
    await member.roles.remove(rolesToRemove).catch(() => null);
  }

  if (targetRoleId && !member.roles.cache.has(targetRoleId)) {
    await member.roles.add(targetRoleId).catch(() => null);
  }

  const store = loadStore();
  const entry = store.guilds?.[guild.id]?.users?.[userId];
  if (!entry) return;

  const lastAnnouncedMilestonePoints = Number(entry.lastAnnouncedMilestonePoints || 0);

  if (announce && currentMilestone) {
    if (currentMilestone.points > lastAnnouncedMilestonePoints) {
      await announceMilestone(guild, userId, currentMilestone, stats.points);
      entry.lastAnnouncedMilestonePoints = currentMilestone.points;
      saveStore();
    }
  }

  if (markAnnounced) {
    const targetAnnouncedPoints = currentMilestone?.points || 0;
    if (lastAnnouncedMilestonePoints !== targetAnnouncedPoints) {
      entry.lastAnnouncedMilestonePoints = targetAnnouncedPoints;
      saveStore();
    }
  }
};

const syncAllMilestonesForGuild = async (guild) => {
  const store = loadStore();
  const users = store.guilds?.[guild.id]?.users || {};
  const userIds = Object.keys(users);

  for (const userId of userIds) {
    await syncMilestoneRoleForUser(guild, userId, { markAnnounced: true });
  }
};

const syncMilestonesForActiveSessions = async () => {
  if (isLiveMilestoneSyncRunning) return;
  isLiveMilestoneSyncRunning = true;

  try {
    const activeSessions = listActiveSessions();
    for (const session of activeSessions) {
      const guild = client.guilds.cache.get(session.guildId);
      if (!guild) continue;
      await syncMilestoneRoleForUser(guild, session.userId, { announce: true });
    }
  } finally {
    isLiveMilestoneSyncRunning = false;
  }
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

      const isInactive = state.mute || state.selfMute || state.deaf || state.selfDeaf;
      if (isInactive) {
        pauseSession(guild.id, userId);
      }
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

    // Handle joining voice channel
    if (!wasInVoice && isInVoice) {
      startSession(guildId, userId);

      const isInactive = newState.mute || newState.selfMute || newState.deaf || newState.selfDeaf;
      if (isInactive) {
        pauseSession(guildId, userId);
      }
      return;
    }

    // Handle leaving voice channel
    if (wasInVoice && !isInVoice) {
      const guild = newState.guild || oldState.guild;
      stopSession(guildId, userId);
      if (guild) {
        await syncMilestoneRoleForUser(guild, userId, { announce: true });
      }
      return;
    }

    // Handle mute/deafen state changes while in voice
    if (isInVoice) {
      const wasMuted = oldState.mute || oldState.selfMute;
      const isMuted = newState.mute || newState.selfMute;
      
      const wasDeafened = oldState.deaf || oldState.selfDeaf;
      const isDeafened = newState.deaf || newState.selfDeaf;

      const wasInactive = wasMuted || wasDeafened;
      const isInactive = isMuted || isDeafened;

      // Transitioned from active to inactive (muted/deafened)
      if (!wasInactive && isInactive) {
        pauseSession(guildId, userId);
      }

      // Transitioned from inactive to active (unmuted/undeafened)
      if (wasInactive && !isInactive) {
        resumeSession(guildId, userId);
      }
    }
  });

  client.on("messageCreate", handlePrefixCommands);

  client.once("clientReady", async () => {
    // Rebuild in-memory sessions from current voice states when the bot comes online.
    await reconcileSessionsOnReady();

    // Backfill milestone roles from persisted VC points.
    for (const guild of client.guilds.cache.values()) {
      await syncAllMilestonesForGuild(guild);
    }

    // Process live session milestones periodically so users can rank up without leaving VC.
    await syncMilestonesForActiveSessions();
    if (liveMilestoneTicker) {
      clearInterval(liveMilestoneTicker);
    }
    liveMilestoneTicker = setInterval(() => {
      void syncMilestonesForActiveSessions();
    }, LIVE_MILESTONE_SYNC_INTERVAL_MS);
  });
};

module.exports = vcPoints;
