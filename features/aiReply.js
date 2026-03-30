const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { Events } = require("discord.js");
const { withDiscordNetworkRetry } = require("../utils/discordNetworkRetry");

const API_URL = process.env.AI_API_URL || "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "openai/gpt-4o-mini";
const AI_API_KEY = (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY ||
    ""
).trim();

const SYSTEM_PROMPT =
    "You are a helpful Discord server assistant. Reply in a friendly, concise way. " +
    "Do not mention internal policies. Avoid hateful, sexual, or violent output.";

function sanitizePrompt(content, botId) {
    if (!content) return "";
    return content
        .replace(new RegExp(`<@!?${botId}>`, "g"), "")
        .trim();
}

function splitMessage(text, limit = 1900) {
    if (!text || text.length <= limit) return [text || ""];

    const parts = [];
    let current = text;

    while (current.length > limit) {
        let sliceAt = current.lastIndexOf("\n", limit);
        if (sliceAt < 200) {
            sliceAt = current.lastIndexOf(" ", limit);
        }
        if (sliceAt < 1) {
            sliceAt = limit;
        }

        parts.push(current.slice(0, sliceAt).trim());
        current = current.slice(sliceAt).trim();
    }

    if (current.length) parts.push(current);
    return parts;
}

async function isReplyToBot(message) {
    const ref = message.reference?.messageId;
    if (!ref) return false;

    try {
        const referenced =
            message.channel.messages.cache.get(ref) ||
            (await message.channel.messages.fetch(ref).catch(() => null));
        return referenced?.author?.id === client.user?.id;
    } catch {
        return false;
    }
}

async function generateAiResponse({ prompt, authorTag, guildName }) {
    const payload = {
        model: AI_MODEL,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content:
                    `Server: ${guildName || "Unknown"}\n` +
                    `User: ${authorTag}\n` +
                    `Message: ${prompt}`,
            },
        ],
        temperature: 0.7,
    };

    const response = await withDiscordNetworkRetry(
        async () => {
            return fetch(API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${AI_API_KEY}`,
                },
                body: JSON.stringify(payload),
            });
        },
        {
            retries: 2,
            baseDelayMs: 1200,
            label: "ai-reply-request",
        }
    );

    if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(`AI request failed (${response.status}): ${bodyText.slice(0, 300)}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || "I could not generate a reply right now.";
}

const aiReply = () => {
    client.on(Events.MessageCreate, async (message) => {
        if (message.author.bot) return;
        if (!client.user) return;

        const lower = message.content.toLowerCase().trim();
        if (lower === "ct help") return;

        const mentionedBot = message.mentions.users.has(client.user.id);
        const repliedToBot = await isReplyToBot(message);

        if (!mentionedBot && !repliedToBot) return;

        const cleaned = sanitizePrompt(message.content, client.user.id);
        const prompt = cleaned || "Continue the conversation naturally.";

        if (!AI_API_KEY) {
            await message.reply(
                "AI replies are not configured yet. Add OPENROUTER_API_KEY (or OPENAI_API_KEY) in environment variables."
            );
            return;
        }

        try {
            await message.channel.sendTyping().catch(() => {});
            const aiText = await generateAiResponse({
                prompt,
                authorTag: message.author.tag,
                guildName: message.guild?.name,
            });

            const chunks = splitMessage(aiText, 1900);
            for (let i = 0; i < chunks.length; i += 1) {
                if (i === 0) {
                    await message.reply(chunks[i]);
                } else {
                    await message.channel.send(chunks[i]);
                }
            }
        } catch (error) {
            console.error("AI reply failed:", error);
            await message.reply("I am having trouble replying right now. Please try again in a moment.");
        }
    });
};

module.exports = aiReply;
