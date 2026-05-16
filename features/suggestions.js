const path = require("node:path");
const {
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ChannelType,
} = require("discord.js");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  SUGGESTION_BUTTON_ID,
  ensureSuggestionPanelMessage,
} = require("../utils/suggestionBox");

const SUGGESTION_MODAL_ID = "suggestion_submit_modal";
const SUGGESTION_TITLE_INPUT_ID = "suggestion_title";
const SUGGESTION_TEXT_INPUT_ID = "suggestion_text";

let registered = false;

const loadConfig = () => {
  try {
    delete require.cache[require.resolve("../config.json")];
    return require("../config.json");
  } catch {
    return {};
  }
};

const suggestions = () => {
  if (registered) return;
  registered = true;

  client.on("clientReady", async () => {
    try {
      const config = loadConfig();
      const buttonChannelId =
        process.env.SUGGESTION_BUTTON_CHANNEL_ID || config.suggestionButtonChannelId;

      if (!buttonChannelId) return;

      // Resolve channel within the guilds the bot is in
      let buttonChannel = null;
      for (const guild of client.guilds.cache.values()) {
        buttonChannel = guild.channels.cache.get(buttonChannelId) || null;
        if (!buttonChannel) {
          try {
            buttonChannel = await guild.channels.fetch(buttonChannelId);
          } catch {
            buttonChannel = null;
          }
        }
        if (buttonChannel && buttonChannel.type === ChannelType.GuildText) {
          await ensureSuggestionPanelMessage(buttonChannel, client.user.id);
          break;
        }
        buttonChannel = null;
      }
    } catch (error) {
      console.error("suggestions ready error:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== SUGGESTION_BUTTON_ID) return;

    try {
      const titleInput = new TextInputBuilder()
        .setCustomId(SUGGESTION_TITLE_INPUT_ID)
        .setLabel("Suggestion Title")
        .setStyle(TextInputStyle.Short)
        .setMinLength(5)
        .setMaxLength(100)
        .setRequired(true)
        .setPlaceholder("Example: Add weekend movie nights");

      const textInput = new TextInputBuilder()
        .setCustomId(SUGGESTION_TEXT_INPUT_ID)
        .setLabel("Suggestion Details")
        .setStyle(TextInputStyle.Paragraph)
        .setMinLength(10)
        .setMaxLength(1000)
        .setRequired(true)
        .setPlaceholder("Explain your suggestion and how it helps the server.");

      const modal = new ModalBuilder()
        .setCustomId(SUGGESTION_MODAL_ID)
        .setTitle("Submit Suggestion")
        .addComponents(
          new ActionRowBuilder().addComponents(titleInput),
          new ActionRowBuilder().addComponents(textInput)
        );

      await interaction.showModal(modal);
    } catch (error) {
      console.error("suggestions button error:", error);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: "Failed to open suggestion form. Please try again.",
          flags: 64,
        }).catch(() => {});
      }
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (interaction.customId !== SUGGESTION_MODAL_ID) return;

    try {
      await interaction.deferReply({ flags: 64 });

      const config = loadConfig();
      const postChannelId =
        process.env.SUGGESTION_POST_CHANNEL_ID || config.suggestionPostChannelId;

      if (!postChannelId) {
        return interaction.editReply({
          content:
            "Suggestion system is not configured yet. Ask an admin to set suggestionButtonChannelId and suggestionPostChannelId in config.json.",
        });
      }

      // Ensure the post channel belongs to the same guild where the interaction occurred
      const originGuild = interaction.guild;
      if (!originGuild) {
        return interaction.editReply({ content: "Suggestions must be submitted from a server." });
      }

      let postChannel = originGuild.channels.cache.get(postChannelId) || null;
      if (!postChannel) {
        try {
          postChannel = await originGuild.channels.fetch(postChannelId);
        } catch {
          postChannel = null;
        }
      }
      if (!postChannel || postChannel.type !== ChannelType.GuildText) {
        return interaction.editReply({
          content:
            "Suggestion post channel is invalid. Ask an admin to verify suggestionPostChannelId in config.json.",
        });
      }

      const suggestionTitle = interaction.fields
        .getTextInputValue(SUGGESTION_TITLE_INPUT_ID)
        .trim();
      const suggestionText = interaction.fields
        .getTextInputValue(SUGGESTION_TEXT_INPUT_ID)
        .trim();

      const suggestionEmbed = new EmbedBuilder()
        .setTitle("💡 New Suggestion")
        .setColor("#4EA1FF")
        .addFields(
          { name: "Title", value: suggestionTitle },
          { name: "Suggestion", value: suggestionText },
          {
            name: "Submitted By",
            value: `${interaction.user} (${interaction.user.id})`,
          },
          { name: "Status", value: "Pending Review" }
        )
        .setFooter({ text: `Suggestion ID: ${interaction.id}` })
        .setTimestamp();

      const sent = await postChannel.send({ embeds: [suggestionEmbed] });
      await sent.react("👍").catch(() => {});
      await sent.react("👎").catch(() => {});

      return interaction.editReply({
        content: `Your suggestion was submitted successfully in ${postChannel}.`,
      });
    } catch (error) {
      console.error("suggestions modal error:", error);
      return interaction
        .editReply({
          content:
            "Failed to submit your suggestion. Please try again, or contact an admin if this keeps happening.",
        })
        .catch(() => {});
    }
  });
};

module.exports = suggestions;

