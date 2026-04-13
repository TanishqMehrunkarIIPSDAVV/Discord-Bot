const { SlashCommandBuilder, PermissionFlagsBits } = require("discord.js");
const { forceRefreshGuildQuestCycle } = require("../utils/questStore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("questadmin")
    .setDescription("Administrative quest controls")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName("refresh")
        .setDescription("Force-refresh quest cycle and reroll available quests for everyone")
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "This command can only be used in a server.", ephemeral: true });
    }

    try {
      const action = interaction.options.getSubcommand();

      if (action !== "refresh") {
        return interaction.reply({ content: "Unknown quest admin action.", ephemeral: true });
      }

      const result = forceRefreshGuildQuestCycle(interaction.guild.id, Date.now());
      const nextRefreshUnix = Math.floor(Number(result.refreshAt || Date.now()) / 1000);

      return interaction.reply({
        content: [
          "Quest cycle force-refreshed.",
          `Users affected: **${Number(result.usersAffected || 0)}**`,
          `Next auto refresh: <t:${nextRefreshUnix}:R>`,
        ].join("\n"),
        ephemeral: true,
      });
    } catch (error) {
      console.error("questadmin command error:", error);
      if (interaction.deferred || interaction.replied) {
        return interaction.followUp({
          content: "There was an error while force-refreshing quests.",
          ephemeral: true,
        }).catch(() => {});
      }
      return interaction.reply({
        content: "There was an error while force-refreshing quests.",
        ephemeral: true,
      }).catch(() => {});
    }
  },
};
