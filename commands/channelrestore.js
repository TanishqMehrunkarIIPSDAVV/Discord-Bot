const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { getGuildChannelNames } = require("../utils/channelNameStore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("channelrestore")
    .setDescription("Restore channel names from the last saved snapshot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "This command can only be used in a server.", flags: 64 });
    }

    const guild = interaction.guild;
    const snapshot = getGuildChannelNames(guild.id);

    if (!snapshot || !snapshot.channels || typeof snapshot.channels !== "object") {
      return interaction.reply({
        content: "No saved channel snapshot was found for this server.",
        flags: 64,
      });
    }

    await interaction.deferReply({ flags: 64 });

    let restored = 0;
    let skipped = 0;
    let failed = 0;

    for (const [channelId, channelData] of Object.entries(snapshot.channels)) {
      const targetName = typeof channelData?.name === "string" ? channelData.name.trim() : "";
      if (!targetName) {
        skipped += 1;
        continue;
      }

      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (!channel || typeof channel.setName !== "function") {
        skipped += 1;
        continue;
      }

      if (channel.name === targetName) {
        skipped += 1;
        continue;
      }

      try {
        await channel.setName(targetName, "Restoring saved channel names from snapshot");
        restored += 1;
      } catch (error) {
        failed += 1;
      }
    }

    return interaction.editReply({
      content: [
        `Restored **${restored}** channel names for **${guild.name}**.`,
        `Skipped **${skipped}** channels and failed on **${failed}**.`,
        "The snapshot is matched by channel ID, so renamed channels stay tied to the same channel.",
      ].join("\n"),
    });
  },
};