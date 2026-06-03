const { ChannelType, PermissionFlagsBits, SlashCommandBuilder, userMention } = require("discord.js");
const {
  addAllowedUserId,
  getAllowedUserIds,
  getProtectedVoiceChannelId,
  removeAllowedUserId,
  setProtectedVoiceChannelId,
} = require("../utils/privateVoiceAccessStore");

const resolveProtectedChannel = async (guild, channelId) => {
  if (!guild || !channelId) return null;

  const cached = guild.channels.cache.get(channelId);
  if (cached) return cached;

  return guild.channels.fetch(channelId).catch(() => null);
};

const syncChannelAccess = async (channel, allowedIds) => {
  if (!channel?.isVoiceBased?.()) return;
  const botId = channel.guild.members.me?.id;

  await channel.permissionOverwrites.edit(channel.guild.id, {
    ViewChannel: true,
    Connect: false,
  }).catch(() => {});

  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.id === channel.guild.id) continue;
    if (botId && overwrite.id === botId) continue;
    if (channel.guild.roles.cache.has(overwrite.id)) continue;
    if (allowedIds.has(overwrite.id)) continue;
    await channel.permissionOverwrites.delete(overwrite.id).catch(() => {});
  }

  if (botId) {
    await channel.permissionOverwrites.edit(botId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      ManageChannels: true,
      MoveMembers: true,
    }).catch(() => {});
  }

  for (const userId of allowedIds) {
    await channel.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      Connect: true,
    }).catch(() => {});
  }

  for (const member of channel.members.values()) {
    if (member.user?.bot) continue;
    if (allowedIds.has(member.id)) continue;
    await member.voice.setChannel(null).catch(() => {});
  }
};

const formatAllowedList = (allowedIds) => {
  if (!allowedIds.size) return "No allowed users configured yet.";
  return Array.from(allowedIds).map((userId) => userMention(userId)).join(", ");
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vcaccess")
    .setDescription("Manage the protected VC allow list")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("set-channel")
        .setDescription("Set the protected voice channel")
        .addChannelOption((option) =>
          option
            .setName("channel")
            .setDescription("Voice channel to protect")
            .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Allow a user to join the protected voice channel")
        .addUserOption((option) =>
          option.setName("user").setDescription("User to allow").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove a user from the protected voice channel allow list")
        .addUserOption((option) =>
          option.setName("user").setDescription("User to remove").setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("list")
        .setDescription("Show the protected VC and current allow list")
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Show whether the protected VC is configured")
    ),

  async execute(interaction) {
    try {
      const action = interaction.options.getSubcommand();

      if (action === "set-channel") {
        const channel = interaction.options.getChannel("channel", true);
        if (!channel.isVoiceBased?.()) {
          return interaction.reply({
            content: "Please choose a voice or stage channel.",
            flags: 64,
          });
        }

        const channelId = setProtectedVoiceChannelId(channel.id);
        const allowedIds = getAllowedUserIds();
        await syncChannelAccess(channel, allowedIds);

        return interaction.reply({
          content: `Protected VC set to ${channel.toString()} (${channelId}).`,
          flags: 64,
        });
      }

      const channelId = getProtectedVoiceChannelId();
      if (!channelId) {
        return interaction.reply({
          content: "Set the protected VC first with `/vcaccess set-channel`.",
          flags: 64,
        });
      }

      const channel = await resolveProtectedChannel(interaction.guild, channelId);
      const allowedIds = getAllowedUserIds();

      if (action === "add") {
        const user = interaction.options.getUser("user", true);
        addAllowedUserId(user.id);
        const nextAllowedIds = getAllowedUserIds();
        if (channel) {
          await syncChannelAccess(channel, nextAllowedIds);
        }

        return interaction.reply({
          content: `${userMention(user.id)} can now join the protected VC.`,
          flags: 64,
        });
      }

      if (action === "remove") {
        const user = interaction.options.getUser("user", true);
        removeAllowedUserId(user.id);
        const nextAllowedIds = getAllowedUserIds();
        if (channel) {
          await syncChannelAccess(channel, nextAllowedIds);
        }

        return interaction.reply({
          content: `${userMention(user.id)} was removed from the protected VC allow list.`,
          flags: 64,
        });
      }

      if (action === "list") {
        const allowedText = formatAllowedList(allowedIds);
        const channelText = channel ? channel.toString() : `<#${channelId}>`;

        return interaction.reply({
          content: `Protected VC: ${channelText}\nAllowed users: ${allowedText}`,
          flags: 64,
        });
      }

      if (action === "status") {
        return interaction.reply({
          content: `Protected VC is configured for <#${channelId}> with **${allowedIds.size}** allowed user(s).`,
          flags: 64,
        });
      }

      return interaction.reply({
        content: "Unknown action.",
        flags: 64,
      });
    } catch (err) {
      console.error("vcaccess command error:", err);
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: "There was an error while updating protected VC access.",
          flags: 64,
        }).catch(() => {});
      }
      return interaction.reply({
        content: "There was an error while updating protected VC access.",
        flags: 64,
      }).catch(() => {});
    }
  },
};