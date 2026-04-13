const { SlashCommandBuilder } = require("discord.js");
const {
  buildQuestBoardPayload,
  buildQuestHistoryPayload,
  buildQuestLeaderboardPayload,
  buildQuestStatsPayload,
  trashActiveQuest,
} = require("../utils/questStore");
const { isQuestBlockedChannel, QUEST_BLOCKED_MESSAGE } = require("../utils/questChannelBlock");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("quest")
    .setDescription("Show the active quest board, stats, history, or leaderboard")
    .addStringOption((option) =>
      option
        .setName("view")
        .setDescription("Which quest view to show")
        .addChoices(
          { name: "board", value: "board" },
          { name: "stats", value: "stats" },
          { name: "history", value: "history" },
          { name: "leaderboard", value: "leaderboard" },
          { name: "trash", value: "trash" }
        )
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("limit")
        .setDescription("How many history/leaderboard entries to show")
        .setMinValue(1)
        .setMaxValue(25)
        .setRequired(false)
    ),
  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "Quests only work in servers.", ephemeral: true });
    }

    if (isQuestBlockedChannel(interaction.channel)) {
      return interaction.reply({ content: QUEST_BLOCKED_MESSAGE, ephemeral: true });
    }

    const view = (interaction.options.getString("view") || "board").toLowerCase();
    const limit = interaction.options.getInteger("limit") || 10;

    let payload;
    if (view === "stats") {
      payload = buildQuestStatsPayload(interaction.guild.id, interaction.user.id);
    } else if (view === "history") {
      payload = buildQuestHistoryPayload(interaction.guild.id, interaction.user.id, limit);
    } else if (view === "leaderboard") {
      payload = await buildQuestLeaderboardPayload(interaction.guild, limit);
    } else if (view === "trash") {
      const result = trashActiveQuest(interaction.guild.id, interaction.user.id);
      if (!result.ok) {
        payload = { content: result.reason || "No active quest to trash.", ephemeral: true };
      } else {
        const cooldownSeconds = Math.ceil(Number(result.cooldownMs || 0) / 1000);
        payload = {
          content: `🗑️ You trashed **${result.quest.title}**. You can accept a new quest in **${cooldownSeconds}s**.`,
          ephemeral: true,
        };
      }
    } else {
      payload = buildQuestBoardPayload(interaction.guild.id, interaction.user.id);
    }

    return interaction.reply(payload);
  },
};