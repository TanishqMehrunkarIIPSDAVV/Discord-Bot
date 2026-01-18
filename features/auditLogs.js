const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  userMention,
  AuditLogEvent,
} = require("discord.js");

let registered = false;
// Track last-seen member state to avoid logging stale/duplicate member updates
const memberState = new Map();
// Track newly joined members to ignore auto-role assignments
const recentJoins = new Map();

const auditLogs = () => {
  if (registered) return;
  registered = true;

  const cfgPath = path.join(__dirname, "..", "config.json");
  let cfg = {};
  try { cfg = require(cfgPath); } catch {}

  // Allow per-type channels; fall back to shared audit/message log
  const logIds = {
    message: process.env.MESSAGE_LOG_CHANNEL_ID || cfg.messageLogChannelId,
    member: process.env.MEMBER_LOG_CHANNEL_ID || cfg.memberLogChannelId,
    channel: process.env.CHANNEL_LOG_CHANNEL_ID || cfg.channelLogChannelId,
    voice: process.env.VOICE_LOG_CHANNEL_ID || cfg.voiceLogChannelId,
    mod: process.env.MOD_LOG_CHANNEL_ID || cfg.modLogChannelId,
  };

  // Shared fallback if a specific type is missing
  const sharedFallback = process.env.MESSAGE_AUDIT_LOG_CHANNEL_ID || cfg.messageLogChannelId;

  const fetchLogChannel = async (guild, kind) => {
    const id = logIds[kind] || sharedFallback;
    if (!id) return null;
    const channel =
      guild.channels.cache.get(id) ||
      await client.channels.fetch(id).catch(() => null);
    if (!channel) return null;
    const me = guild.members.me;
    if (!me) return null;
    const perms = channel.permissionsFor(me);
    if (!perms || !perms.has([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.SendMessages,
      PermissionsBitField.Flags.EmbedLinks,
    ])) return null;
    return channel;
  };

  const sendLog = async (guild, embed, kind) => {
    const channel = await fetchLogChannel(guild, kind);
    if (!channel) return;
    try {
      await channel.send({ embeds: [embed.setTimestamp()] });
    } catch (err) {
      console.error("auditLogs sendLog error:", err);
    }
  };

  const getExecutor = async (guild, actionType) => {
    try {
      // Add a small delay to allow audit log to be written
      await new Promise(resolve => setTimeout(resolve, 1000));
      const auditLogs = await guild.fetchAuditLogs({ limit: 5, type: actionType });
      
      // Find the most recent entry (within last 5 seconds)
      for (const entry of auditLogs.entries.values()) {
        if (entry.executor && Date.now() - entry.createdTimestamp < 5000) {
          return entry.executor;
        }
      }
    } catch (err) {
      console.error("getExecutor error:", err.message);
    }
    return null;
  };

  // Message edits
  client.on("messageUpdate", async (oldMsg, newMsg) => {
    try {
      if (!newMsg.guild) return;
      if (newMsg.author?.bot) return;
      const logChan = await fetchLogChannel(newMsg.guild, "message");
      if (logChan && newMsg.channelId === logChan.id) return;
      const before = oldMsg?.content || "*No content cached*";
      const after = newMsg?.content || "*No content*";
      if (before === after) return;
      const embed = new EmbedBuilder()
        .setColor("#F59E0B")
        .setTitle("✏️ Message Edited")
        .addFields(
          { name: "Author", value: newMsg.author ? `${newMsg.author.tag} (${userMention(newMsg.author.id)})` : "Unknown", inline: true },
          { name: "Channel", value: newMsg.channel ? `${newMsg.channel}` : "Unknown", inline: true },
          { name: "Message ID", value: newMsg.id || "Unknown", inline: true },
          { name: "Before", value: before.length > 1024 ? `${before.slice(0, 1021)}...` : before },
          { name: "After", value: after.length > 1024 ? `${after.slice(0, 1021)}...` : after },
        );
      await sendLog(newMsg.guild, embed, "message");
    } catch (err) {
      console.error("auditLogs messageUpdate error:", err);
    }
  });

  // Bulk deletes
  client.on("messageDeleteBulk", async (messages) => {
    try {
      const first = messages.first();
      if (!first?.guild) return;
      const logChan = await fetchLogChannel(first.guild, "message");
      if (logChan && first.channelId === logChan.id) return;
      const executor = await getExecutor(first.guild, AuditLogEvent.MessageBulkDelete);
      const embed = new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("🧹 Messages Bulk Deleted")
        .addFields(
          { name: "Channel", value: first.channel ? `${first.channel}` : "Unknown", inline: true },
          { name: "Count", value: `${messages.size}`, inline: true },
          { name: "Deleted By", value: executor ? `${executor.tag} (${userMention(executor.id)})` : "Unknown", inline: true }
        );
      await sendLog(first.guild, embed, "message");
    } catch (err) {
      console.error("auditLogs messageDeleteBulk error:", err);
    }
  });

  // Member join/leave
  client.on("guildMemberAdd", async (member) => {
    try {
      // Initialize member state with current roles (at join time)
      memberState.set(member.id, {
        nickname: member.nickname ?? null,
        roles: new Set(member.roles.cache.keys())
      });
      
      // Mark this member as recently joined (ignore role updates for 10 seconds)
      recentJoins.set(member.id, Date.now());
      setTimeout(() => {
        recentJoins.delete(member.id);
      }, 10000);
      
      const embed = new EmbedBuilder()
        .setColor("#22C55E")
        .setTitle("✅ Member Joined")
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "User", value: `${member.user.tag} (${userMention(member.id)})`, inline: true },
          { name: "Account Age", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: "Member Count", value: `${member.guild.memberCount}`, inline: true }
        );
      await sendLog(member.guild, embed, "member");
    } catch (err) {
      console.error("auditLogs guildMemberAdd error:", err);
    }
  });

  client.on("guildMemberRemove", async (member) => {
    try {
      const embed = new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("❌ Member Left")
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "User", value: `${member.user.tag} (${userMention(member.id)})`, inline: true },
          { name: "Was Bot", value: member.user.bot ? "Yes" : "No", inline: true },
          { name: "Member Count", value: `${Math.max(member.guild.memberCount, 1)}`, inline: true }
        );
      await sendLog(member.guild, embed, "member");
    } catch (err) {
      console.error("auditLogs guildMemberRemove error:", err);
    }
  });

  // Member updates: nick/roles/timeouts
  client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
      // Ignore updates for recently joined members (auto-role assignments)
      const joinTime = recentJoins.get(newMember.id);
      if (joinTime && Date.now() - joinTime < 10000) {
        // Update state silently without logging
        memberState.set(newMember.id, {
          nickname: newMember.nickname ?? null,
          roles: new Set(newMember.roles.cache.keys())
        });
        return;
      }
      
      const prev = memberState.get(newMember.id) || {
        nickname: oldMember?.nickname ?? newMember.nickname ?? null,
        roles: new Set(oldMember?.roles?.cache?.keys?.() || newMember.roles.cache.keys())
      };

      const changes = [];

      if (prev.nickname !== newMember.nickname) {
        changes.push({
          name: "Nickname",
          value: `${prev.nickname || "None"} → ${newMember.nickname || "None"}`,
        });
      }

      const prevRoles = prev.roles;
      const currRoles = new Set(newMember.roles.cache.keys());
      const added = [...currRoles].filter((r) => !prevRoles.has(r));
      const removed = [...prevRoles].filter((r) => !currRoles.has(r));

      if (added.length) {
        changes.push({ name: "Roles Added", value: added.map((id) => `<@&${id}>`).join(" ") });
      }
      if (removed.length) {
        changes.push({ name: "Roles Removed", value: removed.map((id) => `<@&${id}>`).join(" ") });
      }

      if (!changes.length) {
        memberState.set(newMember.id, { nickname: newMember.nickname ?? null, roles: currRoles });
        return;
      }

      const executor = await getExecutor(newMember.guild, AuditLogEvent.MemberUpdate);
      const embed = new EmbedBuilder()
        .setColor("#3B82F6")
        .setTitle("🛠️ Member Updated")
        .addFields(
          { name: "User", value: `${newMember.user.tag} (${userMention(newMember.id)})` },
          ...changes.map((c) => ({
            name: c.name,
            value: c.value.length > 1024 ? `${c.value.slice(0, 1021)}...` : c.value,
          })),
          { name: "Updated By", value: executor ? `${executor.tag} (${userMention(executor.id)})` : "Unknown" }
        );
      await sendLog(newMember.guild, embed, "member");

      // Update snapshot after logging
      memberState.set(newMember.id, { nickname: newMember.nickname ?? null, roles: currRoles });
    } catch (err) {
      console.error("auditLogs guildMemberUpdate error:", err);
    }
  });

  // Bans / Unbans
  client.on("guildBanAdd", async (ban) => {
    try {
      const executor = await getExecutor(ban.guild, AuditLogEvent.MemberBanAdd);
      const embed = new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("🔨 User Banned")
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "User", value: `${ban.user.tag} (${userMention(ban.user.id)})`, inline: true },
          { name: "Reason", value: ban.reason || "Not provided", inline: true },
          { name: "Banned By", value: executor ? `${executor.tag} (${userMention(executor.id)})` : "Unknown", inline: true }
        );
      await sendLog(ban.guild, embed, "mod");
    } catch (err) {
      console.error("auditLogs guildBanAdd error:", err);
    }
  });

  client.on("guildBanRemove", async (ban) => {
    try {
      const executor = await getExecutor(ban.guild, AuditLogEvent.MemberBanRemove);
      const embed = new EmbedBuilder()
        .setColor("#22C55E")
        .setTitle("♻️ User Unbanned")
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "User", value: `${ban.user.tag} (${userMention(ban.user.id)})`, inline: true },
          { name: "Unbanned By", value: executor ? `${executor.tag} (${userMention(executor.id)})` : "Unknown", inline: true }
        );
      await sendLog(ban.guild, embed, "mod");
    } catch (err) {
      console.error("auditLogs guildBanRemove error:", err);
    }
  });

  // Helper to skip logging log channels
  const isLogChannel = (channelId) => Object.values(logIds).includes(channelId) || channelId === sharedFallback;

  // Channels
  client.on("channelCreate", async (channel) => {
    try {
      if (!channel.guild) return;
      if (isLogChannel(channel.id)) return;
      const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelCreate);
      const embed = new EmbedBuilder()
        .setColor("#22C55E")
        .setTitle("📁 Channel Created")
        .addFields(
          { name: "Channel", value: `${channel}` },
          { name: "Type", value: `${ChannelType[channel.type] || channel.type}` },
          { name: "Created By", value: executor ? `${executor.tag} (${userMention(executor.id)})` : "Unknown" }
        );
      await sendLog(channel.guild, embed, "channel");
    } catch (err) {
      console.error("auditLogs channelCreate error:", err);
    }
  });

  client.on("channelDelete", async (channel) => {
    try {
      if (!channel.guild) return;
      if (isLogChannel(channel.id)) return;
      const executor = await getExecutor(channel.guild, AuditLogEvent.ChannelDelete);
      const embed = new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("🗑️ Channel Deleted")
        .addFields(
          { name: "Channel", value: `${channel.name}` },
          { name: "Type", value: `${ChannelType[channel.type] || channel.type}` },
          { name: "Deleted By", value: executor ? `${executor.tag} (${userMention(executor.id)})` : "Unknown" }
        );
      await sendLog(channel.guild, embed, "channel");
    } catch (err) {
      console.error("auditLogs channelDelete error:", err);
    }
  });

  client.on("channelUpdate", async (oldChannel, newChannel) => {
    try {
      if (!newChannel.guild) return;
      if (isLogChannel(newChannel.id)) return;
      const changes = [];
      if (oldChannel.name !== newChannel.name) changes.push(`Name: ${oldChannel.name} → ${newChannel.name}`);
      if ("rateLimitPerUser" in newChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`Slowmode: ${oldChannel.rateLimitPerUser || 0}s → ${newChannel.rateLimitPerUser || 0}s`);
      }
      if (!changes.length) return;
      const executor = await getExecutor(newChannel.guild, AuditLogEvent.ChannelUpdate);
      const embed = new EmbedBuilder()
        .setColor("#3B82F6")
        .setTitle("🛠️ Channel Updated")
        .addFields(
          { name: "Channel", value: `${newChannel}` },
          { name: "Changes", value: changes.join("\n").slice(0, 1024) },
          { name: "Updated By", value: executor ? `${executor.tag} (${userMention(executor.id)})` : "Unknown" }
        );
      await sendLog(newChannel.guild, embed, "channel");
    } catch (err) {
      console.error("auditLogs channelUpdate error:", err);
    }
  });

  // Voice joins/moves/leaves
  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      const guild = newState.guild || oldState.guild;
      if (!guild) return;
      const userId = newState.id || oldState.id;
      const userTag = (newState.member || oldState.member)?.user?.tag || userId;
      const logChan = await fetchLogChannel(guild, "voice");
      if (!logChan) return;

      let message = "";
      if (!oldState.channelId && newState.channelId) {
        message = `${userMention(userId)} has joined ${newState.channel.name}`;
      } else if (oldState.channelId && !newState.channelId) {
        message = `${userMention(userId)} has left ${oldState.channel.name}`;
      } else if (oldState.channelId !== newState.channelId) {
        message = `${userMention(userId)} has moved from ${oldState.channel.name} to ${newState.channel.name}`;
      } else {
        return;
      }

      try {
        await logChan.send(message);
      } catch (err) {
        console.error("auditLogs voiceStateUpdate send error:", err);
      }
    } catch (err) {
      console.error("auditLogs voiceStateUpdate error:", err);
    }
  });
};

module.exports = auditLogs;
