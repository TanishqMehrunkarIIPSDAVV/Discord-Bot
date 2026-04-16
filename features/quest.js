const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  EmbedBuilder,
  Events,
  userMention,
} = require("discord.js");
const {
  QUEST_PANEL_BUTTON_PREFIX,
  QUEST_TRASH_BUTTON_ID,
  addQuestProgress,
  acceptQuest,
  buildQuestBoardPayload,
  buildQuestHistoryPayload,
  buildQuestLeaderboardPayload,
  buildQuestStatsPayload,
  ensureCurrentCycle,
  formatQuestProgress,
  getTrashCooldownRemainingMs,
  getUserQuestState,
  startVoiceQuestTimer,
  trashActiveQuest,
  stopVoiceQuestTimer,
  tickVoiceQuestProgress,
} = require("../utils/questStore");
const { isQuestBlockedChannel, QUEST_BLOCKED_MESSAGE } = require("../utils/questChannelBlock");

let registered = false;
let refreshTicker = null;

const isPrefixCommandMessage = (content) => {
  const lower = content.trim().toLowerCase();
  return lower === "ct" || lower.startsWith("ct ");
};

const isHelpfulReplyMessage = (message) => {
  if (!message || !message.guild || message.author?.bot) return false;
  const contentLength = String(message.content || "").trim().length;
  if (contentLength < 12) return false;
  if (message.reference?.messageId) return true;
  const mentionCount = Number(message.mentions?.users?.filter((user) => !user.bot).size || 0);
  return mentionCount > 0;
};

const sendQuestPanel = async (destination, guildId, userId = null, now = Date.now()) => {
  const payload = buildQuestBoardPayload(guildId, userId, now);
  return destination.send(payload);
};

const buildQuestCompletionText = (member, completion) => {
  const quest = completion.quest;
  const lines = [`🎉 ${userMention(member.id)} completed **${quest.title}**!`];

  if (Number(completion.rewardXp || 0) > 0) {
    lines.push(`Reward: **+${completion.rewardXp} XP**`);
  }

  if (Number(completion.rewardCoins || 0) > 0) {
    lines.push(`Coins: **+${completion.rewardCoins}**`);
  }

  if (completion.leveledUp && completion.newLevel) {
    lines.push(`Level up: **${completion.previousLevel} → ${completion.newLevel}**`);
  }

  return lines.join("\n");
};

const notifyQuestCompletion = async (member, completion) => {
  const message = buildQuestCompletionText(member, completion);
  await member.send(message).catch(() => {});
};

const handleQuestCompletion = async (member, completion, channel = null) => {
  if (!completion?.quest) return;

  const message = buildQuestCompletionText(member, completion);

  if (channel && channel.isTextBased()) {
    await channel.send({
      content: message,
      allowedMentions: { users: [member.id] },
    }).catch(() => {});
    return;
  }

  await notifyQuestCompletion(member, completion);
};

const parseQuestView = (content) => {
  const parts = content.trim().split(/\s+/g);
  if ((parts[0] || "").toLowerCase() !== "ct") return null;

  const command = (parts[1] || "").toLowerCase();
  if (command !== "quest" && command !== "quests") return null;

  const view = (parts[2] || "board").toLowerCase();
  const limit = Number(parts[3]);

  return {
    view: ["board", "stats", "history", "leaderboard", "trash"].includes(view) ? view : "board",
    limit: Number.isFinite(limit) ? limit : undefined,
  };
};

const countEligibleVoiceMembers = (voiceChannel) => {
  if (!voiceChannel) return 0;
  return voiceChannel.members.filter((member) => !member.user.bot).size;
};

const isVoiceQuestEligibleForMember = (member, quest) => {
  const voiceState = member?.voice;
  if (!voiceState?.channel) return false;

  const requiredMembers = Math.max(1, Number(quest?.requiredMembers) || 1);
  if (countEligibleVoiceMembers(voiceState.channel) < requiredMembers) return false;

  const isMuted = Boolean(voiceState.mute || voiceState.selfMute);
  const isDeafened = Boolean(voiceState.deaf || voiceState.selfDeaf);
  const mode = quest?.voiceMode || "active";

  if (mode === "muted") return isMuted && !isDeafened;
  if (mode === "deafened") return isDeafened;
  return !isMuted && !isDeafened;
};

const processVoiceQuestState = async (oldState, newState, now = Date.now()) => {
  const guild = newState.guild || oldState.guild;
  if (!guild) return;

  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  const guildId = guild.id;
  const userId = member.id;
  const { activeQuest } = getUserQuestState(guildId, userId, now);
  if (!activeQuest || activeQuest.kind !== "voice") return;

  const wasInVoice = Boolean(oldState.channelId);
  const isInVoice = Boolean(newState.channelId);

  const oldMemberView = {
    voice: {
      channel: oldState.channel,
      mute: oldState.mute,
      selfMute: oldState.selfMute,
      deaf: oldState.deaf,
      selfDeaf: oldState.selfDeaf,
    },
  };

  const wasEligible = isVoiceQuestEligibleForMember(oldMemberView, activeQuest);
  const isEligible = isVoiceQuestEligibleForMember(member, activeQuest);

  if (wasInVoice && !isInVoice) {
    const progressResult = stopVoiceQuestTimer(guildId, userId, now);
    if (progressResult?.completed) {
      await handleQuestCompletion(member, progressResult, newState.channel || oldState.channel || null);
    }
    return;
  }

  if (isInVoice && !isEligible) {
    const progressResult = stopVoiceQuestTimer(guildId, userId, now);
    if (progressResult?.completed) {
      await handleQuestCompletion(member, progressResult, newState.channel || oldState.channel || null);
    }
    return;
  }

  if (isInVoice && isEligible) {
    const progressResult = tickVoiceQuestProgress(guildId, userId, now);
    if (progressResult?.completed) {
      await handleQuestCompletion(member, progressResult, newState.channel || oldState.channel || null);
      return;
    }

    if (!wasInVoice || !wasEligible) {
      startVoiceQuestTimer(guildId, userId, now);
    }
  }
};

const refreshQuestCycles = async () => {
  for (const guild of client.guilds.cache.values()) {
    ensureCurrentCycle(guild.id);
  }
};

const quest = () => {
  if (registered) return;
  registered = true;

  client.once(Events.ClientReady, async () => {
    await refreshQuestCycles();

    if (refreshTicker) clearInterval(refreshTicker);
    refreshTicker = setInterval(() => {
      void (async () => {
        try {
          for (const guild of client.guilds.cache.values()) {
            const guildState = ensureCurrentCycle(guild.id);
            for (const [userId, userState] of Object.entries(guildState.users || {})) {
              if (!userState.activeQuestId || !userState.activeQuestLastProgressAt) continue;
              const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
              if (!member || member.user.bot) continue;

              const { activeQuest } = getUserQuestState(guild.id, member.id);
              if (!activeQuest || activeQuest.kind !== "voice") {
                stopVoiceQuestTimer(guild.id, member.id);
                continue;
              }

              if (!isVoiceQuestEligibleForMember(member, activeQuest)) {
                stopVoiceQuestTimer(guild.id, member.id);
                continue;
              }

              const progressResult = tickVoiceQuestProgress(guild.id, member.id);
              if (progressResult?.completed) {
                await handleQuestCompletion(member, progressResult, member.voice.channel || null);
              }
            }
          }
        } catch (error) {
          console.error("quest refresh tick error:", error);
        }
      })();
    }, 60_000);
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const questView = parseQuestView(content);

    if (questView) {
      if (isQuestBlockedChannel(message.channel)) {
        await message.reply({ content: QUEST_BLOCKED_MESSAGE, allowedMentions: { repliedUser: false } }).catch(() => {});
        return;
      }

      try {
        let payload;
        if (questView.view === "stats") {
          payload = buildQuestStatsPayload(message.guild.id, message.author.id);
        } else if (questView.view === "history") {
          payload = buildQuestHistoryPayload(message.guild.id, message.author.id, questView.limit);
        } else if (questView.view === "leaderboard") {
          payload = await buildQuestLeaderboardPayload(message.guild, questView.limit);
        } else if (questView.view === "trash") {
          const result = trashActiveQuest(message.guild.id, message.author.id);
          if (!result.ok) {
            payload = { content: result.reason, allowedMentions: { repliedUser: false } };
          } else {
            const cooldownSeconds = Math.ceil(Number(result.cooldownMs || 0) / 1000);
            payload = {
              content: `🗑️ Trashed **${result.quest.title}**. You can accept a new quest in **${cooldownSeconds}s**.`,
              allowedMentions: { repliedUser: false },
            };
          }
        } else {
          payload = buildQuestBoardPayload(message.guild.id, message.author.id);
        }
        await message.channel.send(payload);
      } catch (error) {
        console.error("quest panel error:", error);
        await message.reply("I couldn't open the quest board right now.").catch(() => {});
      }
      return;
    }

    const progressResult = addQuestProgress(message.guild.id, message.author.id, {
      amount: 1,
      messageContent: content,
      eventType: "message",
      isHelpfulReply: isHelpfulReplyMessage(message),
    });
    if (progressResult?.completed) {
      await handleQuestCompletion(message.member, progressResult, message.channel);
      return;
    }

    if (isPrefixCommandMessage(content)) {
      const commandProgress = addQuestProgress(message.guild.id, message.author.id, {
        amount: 1,
        eventType: "command",
      });
      if (commandProgress?.completed) {
        await handleQuestCompletion(message.member, commandProgress, message.channel);
      }
    }
  });

  client.on("messageReactionAdd", async (reaction, user) => {
    try {
      if (user?.bot) return;

      if (reaction.partial) {
        await reaction.fetch().catch(() => null);
      }

      const guild = reaction.message?.guild;
      if (!guild) return;

      const member = guild.members.cache.get(user.id) || await guild.members.fetch(user.id).catch(() => null);
      if (!member || member.user.bot) return;

      const progressResult = addQuestProgress(guild.id, user.id, {
        amount: 1,
        eventType: "reaction",
      });

      if (progressResult?.completed) {
        await handleQuestCompletion(member, progressResult, reaction.message.channel);
      }
    } catch (error) {
      console.error("quest reaction update error:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand() && interaction.guild && !interaction.user.bot) {
      const progressResult = addQuestProgress(interaction.guild.id, interaction.user.id, {
        amount: 1,
        eventType: "command",
      });

      if (progressResult?.completed) {
        const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (member) {
          await handleQuestCompletion(member, progressResult, interaction.channel);
        }
      }
    }

    if (interaction.isButton()) {
      if (interaction.customId === QUEST_TRASH_BUTTON_ID) {
        if (!interaction.guild) {
          return interaction.reply({ content: "Quests only work in servers.", flags: 64 }).catch(() => {});
        }

        if (isQuestBlockedChannel(interaction.channel)) {
          return interaction.reply({ content: QUEST_BLOCKED_MESSAGE, flags: 64 }).catch(() => {});
        }

        const result = trashActiveQuest(interaction.guild.id, interaction.user.id);
        if (!result.ok) {
          return interaction.reply({ content: result.reason || "No active quest to trash.", flags: 64 }).catch(() => {});
        }

        const cooldownSeconds = Math.ceil(Number(result.cooldownMs || 0) / 1000);
        return interaction.reply({
          content: `🗑️ You trashed **${result.quest.title}**. Accepting a new quest unlocks in **${cooldownSeconds}s**.`,
          flags: 64,
        }).catch(() => {});
      }

      if (!interaction.customId.startsWith(QUEST_PANEL_BUTTON_PREFIX)) return;

      if (!interaction.guild) {
        return interaction.reply({ content: "Quests only work in servers.", flags: 64 }).catch(() => {});
      }

      if (isQuestBlockedChannel(interaction.channel)) {
        return interaction.reply({ content: QUEST_BLOCKED_MESSAGE, flags: 64 }).catch(() => {});
      }

      const questId = interaction.customId.slice(QUEST_PANEL_BUTTON_PREFIX.length);
      const result = acceptQuest(interaction.guild.id, interaction.user.id, questId);

      if (!result.ok) {
        return interaction.reply({ content: result.reason || "That quest is unavailable.", flags: 64 }).catch(() => {});
      }

      const activeQuest = result.quest;
      const isInActiveVoice = activeQuest.kind === "voice" && isVoiceQuestEligibleForMember(interaction.member, activeQuest);

      const progressResult = activeQuest.kind === "voice" && isInActiveVoice
        ? startVoiceQuestTimer(interaction.guild.id, interaction.user.id)
        : null;

      const confirmation = new EmbedBuilder()
        .setColor("#2ECC71")
        .setTitle("Quest Accepted")
        .setDescription(`${activeQuest.icon} **${activeQuest.title}** is now active for you.`)
        .addFields({
          name: "Goal",
          value: `${activeQuest.description}\nProgress: **${formatQuestProgress(activeQuest, 0)}**`,
        });

      if (activeQuest.kind === "voice" && progressResult?.updated) {
        confirmation.setFooter({ text: "Your VC timer started because you were already in voice chat." });
      }

      return interaction.reply({ embeds: [confirmation], flags: 64 }).catch(() => {});
    }
  });

  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      await processVoiceQuestState(oldState, newState);
    } catch (error) {
      console.error("quest voice update error:", error);
    }
  });
};

quest.sendQuestPanel = sendQuestPanel;

module.exports = quest;
