const { EmbedBuilder, SlashCommandBuilder } = require("discord.js");
const { RATING_FIELDS, getRatingSummary } = require("../utils/userRatingStore");

const formatAverage = (value) => {
  if (!Number.isFinite(Number(value))) return "No ratings yet";
  return `${Number(value).toFixed(1)}/5`;
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ratings")
    .setDescription("Show the rating profile for yourself or another user.")
    .addUserOption((option) =>
      option.setName("user").setDescription("The user whose ratings you want to see")
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "This command only works in servers.", flags: 64 });
    }

    const targetUser = interaction.options.getUser("user") || interaction.user;
    const summary = getRatingSummary(interaction.guild.id, targetUser.id);

    if (!summary.count) {
      return interaction.reply({
        content: `${targetUser} does not have any recorded ratings yet.`,
        flags: 64,
      });
    }

    const averageOverall = summary.averages.overall || 0;
    const embed = new EmbedBuilder()
      .setColor(averageOverall >= 4 ? "#2ECC71" : averageOverall >= 3 ? "#F1C40F" : "#E74C3C")
      .setTitle(`Ratings for ${targetUser.username}`)
      .setDescription(`Received ratings in ${interaction.guild.name}`)
      .addFields(
        {
          name: "Total ratings",
          value: String(summary.count),
          inline: true,
        },
        ...RATING_FIELDS.map((field) => ({
          name: field.label,
          value: formatAverage(summary.averages[field.key]),
          inline: true,
        }))
      )
      .setFooter({ text: "Ratings are collected from conversation prompts triggered by message activity." });

    return interaction.reply({ embeds: [embed], flags: 64 });
  },
};
