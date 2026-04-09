const {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");

const SUGGESTION_BUTTON_ID = "suggestion_open_modal";

const buildSuggestionPanelPayload = () => {
  const embed = new EmbedBuilder()
    .setTitle("💡 Suggestion Box")
    .setDescription(
      "Have an idea for the server? Click the button below and submit your suggestion."
    )
    .setColor("#4EA1FF");

  const button = new ButtonBuilder()
    .setCustomId(SUGGESTION_BUTTON_ID)
    .setLabel("Submit Suggestion")
    .setStyle(ButtonStyle.Primary);

  const row = new ActionRowBuilder().addComponents(button);
  return { embeds: [embed], components: [row] };
};

const ensureSuggestionPanelMessage = async (channel, botUserId) => {
  const payload = buildSuggestionPanelPayload();

  const messages = await channel.messages.fetch({ limit: 25 }).catch(() => null);
  const existing = messages
    ? messages.find(
        (message) =>
          message.author.id === botUserId &&
          message.components.some((row) =>
            row.components.some((component) => component.customId === SUGGESTION_BUTTON_ID)
          )
      )
    : null;

  if (existing) {
    await existing.edit(payload).catch(() => {});
    return { message: existing, created: false };
  }

  const sent = await channel.send(payload);
  return { message: sent, created: true };
};

module.exports = {
  SUGGESTION_BUTTON_ID,
  buildSuggestionPanelPayload,
  ensureSuggestionPanelMessage,
};
