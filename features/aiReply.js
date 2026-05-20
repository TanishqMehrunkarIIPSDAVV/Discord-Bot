const { Events } = require("discord.js");
const {
    runtimeConfig,
    logAiEvent,
    sanitizePrompt,
    splitMessage,
    isAllowedAiChannel,
    getConversationKey,
    activateDmSession,
    isActiveDmSession,
    registerDmBotMessage,
    isReplyToTrackedDmBotMessage,
    getHistory,
    setHistory,
    ensureHistoryLoaded,
    generateAiResponse,
} = require("../utils/aiReplyCore");

module.exports = (client) => {
    logAiEvent("info", "AI reply listener initialized", {
        provider: runtimeConfig.provider,
        model: runtimeConfig.model,
        hasApiKey: Boolean(runtimeConfig.apiKey),
        debug: /^(1|true|yes|on)$/i.test((process.env.AI_REPLY_DEBUG || "").trim()),
    });

    client.on(Events.MessageCreate, async (message) => {
        await ensureHistoryLoaded();

        if (message.author.bot) return;
        if (!client.user) return;

        const lower = String(message.content || "").toLowerCase().trim();
        if (lower === "ct help") return;
        if (!isAllowedAiChannel(message)) return;

        const isDmMessage = Boolean(message.channel?.isDMBased?.());
        const mentionedBot = message.mentions.users.has(client.user.id);
        const activeDmSession = isDmMessage && isActiveDmSession(message.channelId);
        const replyMessageId = message.reference?.messageId || null;
        let repliedToBot = Boolean(replyMessageId) && isReplyToTrackedDmBotMessage(message.channelId, replyMessageId);

        if (!repliedToBot && replyMessageId) {
            repliedToBot = await (async () => {
                try {
                    const referenced =
                        message.channel.messages.cache.get(replyMessageId) ||
                        (await message.channel.messages.fetch(replyMessageId).catch(() => null));
                    return referenced?.author?.id === client.user?.id;
                } catch {
                    return false;
                }
            })();
        }

        logAiEvent("debug", "Evaluated AI trigger", {
            messageId: message.id,
            authorId: message.author.id,
            isDmMessage,
            activeDmSession,
            mentionedBot,
            repliedToBot,
            contentPreview: String(message.content || "").slice(0, 120),
        });

        if (isDmMessage) {
            if (!activeDmSession || !repliedToBot) {
                return;
            }
        } else if (!mentionedBot && !repliedToBot) {
            return;
        }

        const cleaned = sanitizePrompt(message.content, client.user.id);
        const prompt = cleaned || "Continue the conversation naturally.";
        const conversationKey = getConversationKey(message);
        const history = getHistory(conversationKey);
        const currentUserMessage =
            `Server: ${message.guild?.name || "Unknown"}\n` +
            `User: ${message.author.tag}\n` +
            `Message: ${prompt}`;

        if (!runtimeConfig.apiKey) {
            logAiEvent("error", "Missing AI API key; cannot send reply", {
                provider: runtimeConfig.provider,
                apiUrl: runtimeConfig.apiUrl,
                authorId: message.author.id,
                messageId: message.id,
            });
            await message.reply(
                "AI replies are not configured yet. Add OPENROUTER_API_KEY or OPENAI_API_KEY (or set AI_API_KEY + AI_API_URL)."
            );
            return;
        }

        try {
            logAiEvent("debug", "Sending AI request", {
                authorId: message.author.id,
                messageId: message.id,
                conversationKey,
                historyTurns: history.length,
            });

            await message.channel.sendTyping().catch(() => {});
            const aiText = await generateAiResponse({
                prompt,
                authorTag: message.author.tag,
                guildName: message.guild?.name,
                history,
            });

            logAiEvent("debug", "AI response received", {
                authorId: message.author.id,
                messageId: message.id,
                responseLength: aiText.length,
            });

            setHistory(conversationKey, [
                ...history,
                { role: "user", content: currentUserMessage },
                { role: "assistant", content: aiText },
            ]);

            const chunks = splitMessage(aiText, 1900);
            for (let i = 0; i < chunks.length; i += 1) {
                let sentMessage = null;
                if (i === 0) {
                    sentMessage = await message.reply(chunks[i]);
                } else {
                    sentMessage = await message.channel.send(chunks[i]);
                }

                if (message.channel?.isDMBased?.() && sentMessage?.id) {
                    registerDmBotMessage(message.channelId, sentMessage.id);
                }
            }

            if (message.channel?.isDMBased?.()) {
                activateDmSession(message.channelId);
            }
        } catch (error) {
            logAiEvent("error", "AI reply failed", {
                authorId: message.author.id,
                messageId: message.id,
                error: error?.message || String(error),
            });
            await message.reply("I am having trouble replying right now. Please try again in a moment.");
        }
    });
};
