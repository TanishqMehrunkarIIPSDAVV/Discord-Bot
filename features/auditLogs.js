const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  EmbedBuilder,
  PermissionsBitField,
  ChannelType,
  userMention,
} = require("discord.js");

let registered = false;

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

  // Message edits
  client.on("messageUpdate", async (oldMsg, newMsg) => {
    try {
      if (!newMsg.guild) return;
      if (newMsg.author?.bot) return;
      if (newMsg.channelId === logChannelId) return;
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
      if (first.channelId === logChannelId) return;
      const embed = new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("🧹 Messages Bulk Deleted")
        .addFields(
          { name: "Channel", value: first.channel ? `${first.channel}` : "Unknown", inline: true },
          { name: "Count", value: `${messages.size}`, inline: true }
        );
      await sendLog(first.guild, embed, "message");
    } catch (err) {
      console.error("auditLogs messageDeleteBulk error:", err);
    }
  });

  // Member join/leave
  client.on("guildMemberAdd", async (member) => {
    try {
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
      const changes = [];
      if (oldMember.nickname !== newMember.nickname) {
        changes.push({
          name: "Nickname",
          value: `${oldMember.nickname || "None"} → ${newMember.nickname || "None"}`,
        });
      }
      const oldRoles = new Set(oldMember.roles.cache.keys());
      const newRoles = new Set(newMember.roles.cache.keys());
      const added = [...newRoles].filter((r) => !oldRoles.has(r));
      const removed = [...oldRoles].filter((r) => !newRoles.has(r));
      if (added.length) {
        changes.push({ name: "Roles Added", value: added.map((id) => `<@&${id}>`).join(" ") });
      }
      if (removed.length) {
        changes.push({ name: "Roles Removed", value: removed.map((id) => `<@&${id}>`).join(" ") });
      }
      if (!changes.length) return;
      const embed = new EmbedBuilder()
        .setColor("#3B82F6")
        .setTitle("🛠️ Member Updated")
        .addFields(
          { name: "User", value: `${newMember.user.tag} (${userMention(newMember.id)})` },
          ...changes.map((c) => ({
            name: c.name,
            value: c.value.length > 1024 ? `${c.value.slice(0, 1021)}...` : c.value,
          })),
        );
      await sendLog(newMember.guild, embed, "member");
    } catch (err) {
      console.error("auditLogs guildMemberUpdate error:", err);
    }
  });

  // Bans / Unbans
  client.on("guildBanAdd", async (ban) => {
    try {
      const embed = new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("🔨 User Banned")
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "User", value: `${ban.user.tag} (${userMention(ban.user.id)})`, inline: true },
          { name: "Reason", value: ban.reason || "Not provided", inline: true }
        );
      await sendLog(ban.guild, embed, "mod");
    } catch (err) {
      console.error("auditLogs guildBanAdd error:", err);
    }
  });

  client.on("guildBanRemove", async (ban) => {
    try {
      const embed = new EmbedBuilder()
        .setColor("#22C55E")
        .setTitle("♻️ User Unbanned")
        .setThumbnail(ban.user.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: "User", value: `${ban.user.tag} (${userMention(ban.user.id)})`, inline: true }
        );
      await sendLog(ban.guild, embed, "mod");
    } catch (err) {
      console.error("auditLogs guildBanRemove error:", err);
    }
  });

  // Channels
  client.on("channelCreate", async (channel) => {
    try {
      if (!channel.guild) return;
      if (channel.id === logChannelId) return;
      const embed = new EmbedBuilder()
        .setColor("#22C55E")
        .setTitle("📁 Channel Created")
        .addFields(
          { name: "Channel", value: `${channel}` },
          { name: "Type", value: `${ChannelType[channel.type] || channel.type}` }
        );
      await sendLog(channel.guild, embed, "channel");
    } catch (err) {
      console.error("auditLogs channelCreate error:", err);
    }
  });

  client.on("channelDelete", async (channel) => {
    try {
      if (!channel.guild) return;
      if (channel.id === logChannelId) return;
      const embed = new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("🗑️ Channel Deleted")
        .addFields(
          { name: "Channel", value: `${channel.name}` },
          { name: "Type", value: `${ChannelType[channel.type] || channel.type}` }
        );
      await sendLog(channel.guild, embed, "channel");
    } catch (err) {
      console.error("auditLogs channelDelete error:", err);
    }
  });

  client.on("channelUpdate", async (oldChannel, newChannel) => {
    try {
      if (!newChannel.guild) return;
      if (newChannel.id === logChannelId) return;
      const changes = [];
      if (oldChannel.name !== newChannel.name) changes.push(`Name: ${oldChannel.name} → ${newChannel.name}`);
      if ("rateLimitPerUser" in newChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`Slowmode: ${oldChannel.rateLimitPerUser || 0}s → ${newChannel.rateLimitPerUser || 0}s`);
      }
      if (!changes.length) return;
      const embed = new EmbedBuilder()
        .setColor("#3B82F6")
        .setTitle("🛠️ Channel Updated")
        .addFields(
          { name: "Channel", value: `${newChannel}` },
          { name: "Changes", value: changes.join("\n").slice(0, 1024) }
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
      const embed = new EmbedBuilder().setColor("#8B5CF6");
      if (!oldState.channelId && newState.channelId) {
        embed.setTitle("🎙️ Joined Voice")
          .addFields({ name: "User", value: `${userTag} (${userMention(userId)})` }, { name: "Channel", value: `${newState.channel}` });
      } else if (oldState.channelId && !newState.channelId) {
        embed.setTitle("📤 Left Voice")
          .addFields({ name: "User", value: `${userTag} (${userMention(userId)})` }, { name: "Channel", value: `${oldState.channel}` });
      } else if (oldState.channelId !== newState.channelId) {
        embed.setTitle("🔀 Moved Voice")
          .addFields(
            { name: "User", value: `${userTag} (${userMention(userId)})` },
            { name: "From", value: `${oldState.channel}` },
            { name: "To", value: `${newState.channel}` },
          );
      } else {
        return;
      }
      await sendLog(guild, embed, "voice");
    } catch (err) {
      console.error("auditLogs voiceStateUpdate error:", err);
    }
  });
};

module.exports = auditLogs;
