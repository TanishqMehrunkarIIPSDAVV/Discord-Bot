const { PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { saveGuildChannelNames } = require("../utils/channelNameStore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("channelbackup")
    .setDescription("Save all channel names in this server by channel ID")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "This command can only be used in a server.", flags: 64 });
    }

    const guild = interaction.guild;

    try {
      const channels = await guild.channels.fetch();
      const result = saveGuildChannelNames(guild, channels);

      return interaction.reply({
        content: [
          `Saved **${result.saved}** channel names for **${guild.name}**.`,
          "The snapshot is stored by channel ID, including voice channels.",
        ].join("\n"),
        flags: 64,
      });
    } catch (error) {
      console.error("channelbackup command error:", error);
      return interaction.reply({
        content: "I couldn't save the channel names right now.",
        flags: 64,
      }).catch(() => {});
    }
  },
};