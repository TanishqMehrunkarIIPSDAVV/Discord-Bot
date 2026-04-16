const { SlashCommandBuilder, EmbedBuilder, userMention } = require("discord.js");
const { getLeaderboard, getCurrentMilestone } = require("../utils/vcPointsStore");

const formatPoints = (value) => Number(value || 0).toFixed(2);
const formatHours = (value) => Number(value || 0).toFixed(2);

module.exports = {
  data: new SlashCommandBuilder()
    .setName("vcleaderboard")
    .setDescription("Show the VC points leaderboard")
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many users to show (1-25)")
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),
  async execute(interaction) {
    const limit = interaction.options.getInteger("limit") || 10;
    const rows = getLeaderboard(interaction.guild.id, limit);

    if (!rows.length) {
      return interaction.reply({
        content: "No VC points have been recorded in this server yet.",
        flags: 64,
      });
    }

    const description = rows
      .map((row, index) => {
        const rank = index + 1;
        const milestone = getCurrentMilestone(row.points);
        const roleLabel = milestone ? milestone.name : "No milestone yet";
        return `${rank}. ${userMention(row.userId)} - **${formatPoints(row.points)}** points (**${formatHours(
          row.trackedMinutes / 60
        )}h**) | **Role:** ${roleLabel}`;
      })
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor("#2B8AF7")
      .setTitle(`VC Points Leaderboard (Top ${rows.length})`)
      .setDescription(description);

    return interaction.reply({ embeds: [embed] });
  },
};

