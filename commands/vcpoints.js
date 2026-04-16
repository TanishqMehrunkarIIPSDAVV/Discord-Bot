const { SlashCommandBuilder, userMention } = require("discord.js");
const { getUserStats, getCurrentMilestone, getNextMilestone } = require("../utils/vcPointsStore");

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

    return interaction.reply({
      content: `${userMention(target.id)} has **${formatPoints(stats.points)}** VC points (tracked time: **${formatHours(
        stats.trackedHours
      )} hours**)${milestoneText}${progressText}`,
      flags: 0,
    });
  },
};

