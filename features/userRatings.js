const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  userMention,
} = require("discord.js");
const {
  RATING_FIELDS,
  clearVoiceActivity,
  getPrompt,
  recordConversationMessage,
  recordVoiceConversation,
  submitPromptRating,
} = require("../utils/userRatingStore");

const PROMPT_BUTTON_PREFIX = "user_rating_prompt:";
const PROMPT_MODAL_PREFIX = "user_rating_modal:";

let registered = false;

const loadConfig = () => {
  try {
    delete require.cache[require.resolve("../config.json")];
    return require("../config.json");
  } catch {
    return {};
  }
};

const getNumberSetting = (envValue, configValue, fallback) => {
  const raw = envValue ?? configValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isEligibleVoiceMember = (member) => {
  if (!member || member.user?.bot) return false;

  const voice = member.voice;
  if (!voice?.channelId) return false;

  return !voice.selfMute && !voice.mute && !voice.selfDeaf && !voice.deaf && !voice.suppress;
};

const formatAverage = (value) => {
  if (!Number.isFinite(Number(value))) return "N/A";
  return `${Number(value).toFixed(1)}/5`;
};

const buildPromptContent = (prompt, guildName, authorId) => {
  const [firstUserId, secondUserId] = prompt.participants;
  return [
    `${userMention(firstUserId)} ${userMention(secondUserId)}`,
    `You have been chatting in **${guildName || "this server"}** for a while.`,
    `Please rate the other user privately on behavior, PFP, profile effect, deco, and overall vibe.`,
    `Tap the button below to submit your rating.`,
    `Last message from <@${authorId}> triggered the reminder.`,
  ].join("\n");
};

const buildPromptEmbed = () => {
  return new EmbedBuilder()
    .setColor("#4EA1FF")
    .setTitle("Peer rating reminder")
    .setDescription(
      "Rate the person you have been talking to. Each score is from 1 to 5. Your submission stays private."
    )
    .addFields(
      ...RATING_FIELDS.map((field) => ({
        name: field.label,
        value: "1-5",
        inline: true,
      }))
    );
};

const buildPromptRow = (promptId) => {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${PROMPT_BUTTON_PREFIX}${promptId}`)
      .setLabel("Rate conversation partner")
      .setStyle(ButtonStyle.Primary)
  );
};

const buildVoicePromptContent = ({ guildName, channelName, targetUserId }) => {
  return [
    `You have been in VC together in **${guildName || "this server"}**${channelName ? ` (${channelName})` : ""}.`,
    `Please rate <@${targetUserId}> privately on behavior, PFP, profile effect, deco, and overall vibe.`,
    `Tap the button below to submit your rating.`,
  ].join("\n");
};

const buildRatingModal = (promptId, targetUserId) => {
  const inputs = RATING_FIELDS.map((field) =>
    new TextInputBuilder()
      .setCustomId(field.key)
      .setLabel(`${field.label} (1-5)`)
      .setStyle(TextInputStyle.Short)
      .setMinLength(1)
      .setMaxLength(1)
      .setRequired(true)
      .setPlaceholder("1 to 5")
  );

  return new ModalBuilder()
    .setCustomId(`${PROMPT_MODAL_PREFIX}${promptId}:${targetUserId}`)
    .setTitle("Rate your conversation partner")
    .addComponents(...inputs.map((input) => new ActionRowBuilder().addComponents(input)));
};

const parseScore = (raw, label) => {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 5) {
    throw new Error(`${label} must be a whole number from 1 to 5.`);
  }
  return value;
};

const resolvePromptChannel = async (guild) => {
  const config = loadConfig();
  const configuredChannelId =
    process.env.USER_RATING_PROMPT_CHANNEL_ID || config.userRatingPromptChannelId;

  if (configuredChannelId) {
    const channel = await guild.channels.fetch(configuredChannelId).catch(() => null);
    if (channel && channel.isTextBased()) return channel;
  }

  if (guild.systemChannel && guild.systemChannel.isTextBased()) {
    return guild.systemChannel;
  }

  const firstTextChannel = guild.channels.cache.find(
    (channel) =>
      channel &&
      channel.type === ChannelType.GuildText &&
      channel.permissionsFor(guild.members.me)?.has("SendMessages")
  );

  return firstTextChannel || null;
};

const sendVoicePrompt = async (channel, guild, prompt) => {
  const targetUserIds = [...prompt.participants];
  const promptEmbed = buildPromptEmbed();
  promptEmbed.setDescription(
    `Rate the other person from your VC session. This stays private.\n\nVoice channel: **${channel.name || "Unknown"}**`
  );

  const promptMessages = [];

  for (const raterUserId of targetUserIds) {
    const targetUserId = targetUserIds.find((id) => id !== raterUserId);
    if (!targetUserId) continue;

    const sent = await channel.send({
      content: buildVoicePromptContent({
        guildName: guild.name,
        channelName: channel.name,
        targetUserId,
      }),
      embeds: [promptEmbed],
      components: [buildPromptRow(prompt.promptId)],
      allowedMentions: {
        users: [raterUserId, targetUserId],
        roles: [],
        parse: [],
      },
    }).catch(() => null);

    if (sent) {
      promptMessages.push(sent);
    }
  }

  return promptMessages;
};

const scanVoiceActivity = async () => {
  const config = loadConfig();
  const threshold = getNumberSetting(
    process.env.USER_RATING_VOICE_ACTIVITY_THRESHOLD,
    config.userRatingVoiceActivityThreshold,
    6
  );
  const intervalSeconds = getNumberSetting(
    process.env.USER_RATING_VOICE_SCAN_SECONDS,
    config.userRatingVoiceScanSeconds,
    60
  );
  const cooldownMs = getNumberSetting(
    process.env.USER_RATING_PROMPT_COOLDOWN_MINUTES,
    config.userRatingPromptCooldownMinutes,
    30
  ) * 60 * 1000;
  const expireMs = getNumberSetting(
    process.env.USER_RATING_PROMPT_EXPIRE_MINUTES,
    config.userRatingPromptExpireMinutes,
    240
  ) * 60 * 1000;

  for (const guild of client.guilds.cache.values()) {
    for (const channel of guild.channels.cache.values()) {
      if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
        continue;
      }

      const eligibleMembers = [...channel.members.values()].filter(isEligibleVoiceMember);
      if (eligibleMembers.length !== 2) {
        clearVoiceActivity({ guildId: guild.id, channelId: channel.id });
        continue;
      }

      const result = recordVoiceConversation({
        guildId: guild.id,
        channelId: channel.id,
        participantIds: eligibleMembers.map((member) => member.id),
        voiceActivityThreshold: threshold,
        voiceActivityIntervalMs: intervalSeconds * 1000,
        promptCooldownMs: cooldownMs,
        promptExpireMs: expireMs,
      });

      if (!result?.shouldPrompt || !result.prompt) {
        continue;
      }

      await sendVoicePrompt(channel, guild, result.prompt).catch((error) => {
        console.error("userRatings voice reminder error:", error);
      });
    }
  }
};

const userRatings = () => {
  if (registered) return;
  registered = true;

  let voiceScanTicker = null;

  client.on("clientReady", async () => {
    if (voiceScanTicker) {
      clearInterval(voiceScanTicker);
    }

    await scanVoiceActivity().catch((error) => {
      console.error("userRatings voice warmup error:", error);
    });

    voiceScanTicker = setInterval(() => {
      void scanVoiceActivity().catch((error) => {
        console.error("userRatings voice scan error:", error);
      });
    }, 60 * 1000);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild || !message.channel) return;

    const config = loadConfig();
    const threshold = getNumberSetting(
      process.env.USER_RATING_MESSAGE_THRESHOLD,
      config.userRatingMessageThreshold,
      8
    );
    const windowMs = getNumberSetting(
      process.env.USER_RATING_MESSAGE_WINDOW_MINUTES,
      config.userRatingMessageWindowMinutes,
      15
    ) * 60 * 1000;
    const cooldownMs = getNumberSetting(
      process.env.USER_RATING_PROMPT_COOLDOWN_MINUTES,
      config.userRatingPromptCooldownMinutes,
      30
    ) * 60 * 1000;
    const expireMs = getNumberSetting(
      process.env.USER_RATING_PROMPT_EXPIRE_MINUTES,
      config.userRatingPromptExpireMinutes,
      240
    ) * 60 * 1000;

    const result = recordConversationMessage({
      guildId: message.guild.id,
      channelId: message.channel.id,
      authorId: message.author.id,
      messageWindowSize: threshold,
      messageWindowMs: windowMs,
      promptCooldownMs: cooldownMs,
      promptExpireMs: expireMs,
    });

    if (!result?.shouldPrompt || !result.prompt) {
      return;
    }

    try {
      const prompt = result.prompt;
      const guildName = message.guild.name;
      const promptMessage = await message.channel.send({
        content: buildPromptContent(prompt, guildName, message.author.id),
        embeds: [buildPromptEmbed()],
        components: [buildPromptRow(prompt.promptId)],
        allowedMentions: {
          users: prompt.participants,
          roles: [],
          parse: [],
        },
      });

      setTimeout(() => {
        promptMessage.edit({ components: [] }).catch(() => {});
      }, Math.min(expireMs, 4 * 60 * 60 * 1000));
    } catch (error) {
      console.error("userRatings reminder error:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      if (!interaction.customId.startsWith(PROMPT_BUTTON_PREFIX)) return;

      const promptId = interaction.customId.slice(PROMPT_BUTTON_PREFIX.length);
      const prompt = getPrompt(promptId);

      if (!prompt) {
        return interaction.reply({
          content: "This rating prompt has expired or is no longer available.",
          flags: 64,
        }).catch(() => {});
      }

      if (!prompt.participants.includes(interaction.user.id)) {
        return interaction.reply({
          content: "Only the two people in this conversation can use this rating prompt.",
          flags: 64,
        }).catch(() => {});
      }

      const targetUserId = prompt.participants.find((id) => id !== interaction.user.id);
      if (!targetUserId) {
        return interaction.reply({
          content: "Could not determine the other person in this conversation.",
          flags: 64,
        }).catch(() => {});
      }

      const modal = buildRatingModal(promptId, targetUserId);
      return interaction.showModal(modal).catch(() => {});
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith(PROMPT_MODAL_PREFIX)) return;

      const payload = interaction.customId.slice(PROMPT_MODAL_PREFIX.length);
      const [promptId] = payload.split(":");
      const prompt = getPrompt(promptId);

      if (!prompt) {
        return interaction.reply({
          content: "This rating prompt has expired or was already completed.",
          flags: 64,
        }).catch(() => {});
      }

      const targetUserId = prompt.participants.find((id) => id !== interaction.user.id);
      if (!targetUserId || !prompt.participants.includes(interaction.user.id)) {
        return interaction.reply({
          content: "You cannot submit ratings for this prompt.",
          flags: 64,
        }).catch(() => {});
      }

      try {
        const scores = {
          behavior: parseScore(interaction.fields.getTextInputValue("behavior"), "Behavior"),
          pfp: parseScore(interaction.fields.getTextInputValue("pfp"), "PFP"),
          profileEffect: parseScore(
            interaction.fields.getTextInputValue("profileEffect"),
            "Profile Effect"
          ),
          deco: parseScore(interaction.fields.getTextInputValue("deco"), "Deco"),
          overall: parseScore(interaction.fields.getTextInputValue("overall"), "Overall"),
        };

        const result = submitPromptRating({
          promptId,
          raterUserId: interaction.user.id,
          scores,
        });

        if (!result.ok) {
          return interaction.reply({
            content: result.reason || "Could not save your rating.",
            flags: 64,
          }).catch(() => {});
        }

        const raterLabel = `${interaction.user.username} (${interaction.user.id})`;
        const targetUser = await client.users.fetch(result.targetUserId).catch(() => null);
        const targetLabel = targetUser
          ? `${targetUser.username} (${targetUser.id})`
          : `unknown (${result.targetUserId})`;

        console.log(
          `[UserRatings] Rating submitted | guild=${result.prompt?.guildId || interaction.guildId || "unknown"} | channel=${result.prompt?.channelId || "unknown"} | rater=${raterLabel} | target=${targetLabel} | scores=${JSON.stringify(scores)}`
        );

        return interaction.reply({
          content: `Your rating for <@${result.targetUserId}> was saved successfully.${result.complete ? " Both users have now rated each other." : ""}`,
          flags: 64,
        }).catch(() => {});
      } catch (error) {
        return interaction.reply({
          content: error.message || "Please enter scores as whole numbers from 1 to 5.",
          flags: 64,
        }).catch(() => {});
      }
    }
  });
};

module.exports = userRatings;
