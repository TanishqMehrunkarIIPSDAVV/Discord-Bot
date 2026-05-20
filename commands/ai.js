const { ApplicationIntegrationType, InteractionContextType, SlashCommandBuilder } = require("discord.js");
const aiReply = require("../utils/aiReplyCore");

const EPHEMERAL_FLAG = 64;

function buildReplyOptions(content, ephemeral = false) {
    const options = { content };
    if (ephemeral) {
        options.flags = EPHEMERAL_FLAG;
    }
    return options;
}

module.exports = {
    global: true,
    data: new SlashCommandBuilder()
        .setName("ai")
        .setDescription("Start an AI chat in a DM or server.")
        .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
        .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel)
        .setDMPermission(true)
        .addStringOption((option) =>
            option
                .setName("prompt")
                .setDescription("What you want the AI to reply to")
                .setRequired(true)
        ),
    async execute(interaction) {
        await aiReply.ensureHistoryLoaded();
        aiReply.activateDmSession(interaction.channelId);

        const runtimeConfig = aiReply.runtimeConfig;
        if (!runtimeConfig.apiKey) {
            aiReply.logAiEvent("error", "Missing AI API key for /ai command", {
                authorId: interaction.user.id,
                channelId: interaction.channelId,
                guildId: interaction.guildId || null,
            });

            return interaction.reply({
                ...buildReplyOptions(
                    "AI replies are not configured yet. Add OPENROUTER_API_KEY or OPENAI_API_KEY (or set AI_API_KEY + AI_API_URL).",
                    Boolean(interaction.guildId)
                ),
            });
        }

        if (!aiReply.isSpecialAiUser(interaction.user.id)) {
            aiReply.logAiEvent("warn", "/ai denied for unauthorized user", {
                authorId: interaction.user.id,
                channelId: interaction.channelId,
                guildId: interaction.guildId || null,
            });

            return interaction.reply({
                ...buildReplyOptions(
                    "You are not allowed to use this AI command yet.",
                    Boolean(interaction.guildId)
                ),
            });
        }

        const prompt = (interaction.options.getString("prompt", true) || "").trim();
        const conversationKey = aiReply.getConversationKeyForUser(interaction.guildId || "dm", interaction.user.id);
        const history = aiReply.getHistory(conversationKey);
        const currentUserMessage =
            `Server: ${interaction.guild?.name || "Unknown"}\n` +
            `User: ${interaction.user.tag}\n` +
            `Message: ${prompt}`;

        try {
            aiReply.logAiEvent("debug", "Executing /ai command", {
                authorId: interaction.user.id,
                channelId: interaction.channelId,
                guildId: interaction.guildId || null,
                historyTurns: history.length,
            });

            await interaction.deferReply(
                Boolean(interaction.guildId) ? { flags: EPHEMERAL_FLAG } : undefined
            ).catch(() => {});

            const aiText = await aiReply.generateAiResponse({
                prompt,
                authorTag: interaction.user.tag,
                guildName: interaction.guild?.name,
                history,
            });

            aiReply.setHistory(conversationKey, [
                ...history,
                { role: "user", content: currentUserMessage },
                { role: "assistant", content: aiText },
            ]);

            const chunks = aiReply.splitMessage(aiText, 1900);
            const firstChunk = chunks.shift() || "";
            let firstResponseMessage = null;

            if (interaction.deferred || interaction.replied) {
                await interaction.editReply({ content: firstChunk });
                firstResponseMessage = await interaction.fetchReply().catch(() => null);
            } else {
                await interaction.reply(buildReplyOptions(firstChunk, Boolean(interaction.guildId)));
                firstResponseMessage = await interaction.fetchReply().catch(() => null);
            }

            if (!interaction.guildId && firstResponseMessage?.id) {
                aiReply.registerDmBotMessage(interaction.channelId, firstResponseMessage.id);
            }

            for (const chunk of chunks) {
                const followUpMessage = await interaction.followUp(buildReplyOptions(chunk, Boolean(interaction.guildId))).catch(() => null);
                if (!interaction.guildId && followUpMessage?.id) {
                    aiReply.registerDmBotMessage(interaction.channelId, followUpMessage.id);
                }
            }
        } catch (error) {
            aiReply.logAiEvent("error", "/ai command failed", {
                authorId: interaction.user.id,
                channelId: interaction.channelId,
                guildId: interaction.guildId || null,
                error: error?.message || String(error),
            });

            const errorMessage = "I am having trouble replying right now. Please try again in a moment.";
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(buildReplyOptions(errorMessage, Boolean(interaction.guildId))).catch(() => {});
            } else {
                await interaction.reply(buildReplyOptions(errorMessage, Boolean(interaction.guildId))).catch(() => {});
            }
        }
    },
};