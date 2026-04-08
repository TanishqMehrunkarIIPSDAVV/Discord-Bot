const { SlashCommandBuilder, userMention } = require("discord.js");
const { getUserStats } = require("../utils/vcPointsStore");

const formatPoints = (value) => Number(value || 0).toFixed(2);
const formatHours = (value) => Number(value || 0).toFixed(2);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vcpoints")
    .setDescription("Show VC points and tracked voice time for a user")
    .addUserOption((option) => option.setName("user").setDescription("User to inspect").setRequired(false)),
  async execute(interaction) {
    const target = interaction.options.getUser("user") || interaction.user;
    const stats = getUserStats(interaction.guild.id, target.id);

    return interaction.reply({
      content: `${userMention(target.id)} has **${formatPoints(stats.points)}** VC points (tracked time: **${formatHours(
        stats.trackedHours
      )} hours**).`,
      ephemeral: false,
    });
  },
};
