const path = require("node:path");
const { AuditLogEvent } = require("discord.js");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { createCase } = require("../utils/caseStore");

let registered = false;
const recentDragKeys = new Map();

const isRecent = (timestamp, windowMs) => Date.now() - Number(timestamp || 0) <= windowMs;

const getAuditDestinationId = (entry) => {
  const extra = entry?.extra || {};
  if (extra?.channel?.id) return extra.channel.id;
  if (extra?.channelId) return extra.channelId;

  const changes = Array.isArray(entry?.changes) ? entry.changes : [];
  const channelChange = changes.find((c) => c?.key === "channel_id");
  if (channelChange?.new) return String(channelChange.new);
  return "";
};

const voiceDragCases = () => {
  if (registered) return;
  registered = true;

  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      if (!newState.guild) return;
      if (!oldState.channelId || !newState.channelId) return;
      if (oldState.channelId === newState.channelId) return;

      // Small wait to let Discord audit entry appear.
      await new Promise((resolve) => setTimeout(resolve, 1200));

      const logs = await newState.guild.fetchAuditLogs({
        type: AuditLogEvent.MemberMove,
        limit: 8,
      }).catch(() => null);

      if (!logs) return;

      const recentEntries = logs.entries.filter((entry) => isRecent(entry.createdTimestamp, 20000));

      const candidate =
        recentEntries.find((entry) => entry.target?.id === newState.id) ||
        recentEntries.find((entry) => {
          const destId = getAuditDestinationId(entry);
          return !!destId && destId === newState.channelId;
        }) ||
        recentEntries.first();

      if (!candidate?.executor) return;
      const executorId = candidate.executor.id;
      const botId = newState.guild.members.me?.id || client.user?.id;

      // Ignore bot-driven moves (e.g., ct move command already logs vc-move cases).
      if (!executorId || executorId === botId) return;

      const dedupeKey = `${newState.guild.id}:${newState.id}:${oldState.channelId}:${newState.channelId}:${executorId}`;
      if (isRecent(recentDragKeys.get(dedupeKey), 12000)) return;
      recentDragKeys.set(dedupeKey, Date.now());
      setTimeout(() => recentDragKeys.delete(dedupeKey), 15000);

      createCase({
        guildId: newState.guild.id,
        type: "vc-drag",
        actorId: executorId,
        targetUserId: newState.id,
        reason: `Dragged from ${oldState.channel?.name || oldState.channelId} to ${newState.channel?.name || newState.channelId}`,
        details: {
          fromChannelId: oldState.channelId,
          toChannelId: newState.channelId,
        },
      });
    } catch (err) {
      console.error("voiceDragCases error:", err);
    }
  });
};

module.exports = voiceDragCases;