const path = require("node:path");
const fs = require("node:fs/promises");
const client = require(`${path.dirname(__dirname)}/index.js`);
const config = require("../config.json");
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

const MAX_HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS || 8);
const MAX_TRACKED_USERS = Number(process.env.AI_MAX_TRACKED_USERS || 500);
const ALLOWED_AI_CHANNEL_IDS = new Set([
    ...(process.env.AI_ALLOWED_CHANNEL_IDS || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ...(Array.isArray(config.aiReplyChannelIds) ? config.aiReplyChannelIds : [])
        .map((id) => String(id).trim())
        .filter(Boolean),
]);
const userConversationHistory = new Map();
const HISTORY_FILE_PATH = path.join(path.dirname(__dirname), "data", "ai-conversation-history.json");

let historyLoaded = false;
let historyLoadPromise = null;
let persistTimer = null;

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

function isAllowedAiChannel(message) {
    if (ALLOWED_AI_CHANNEL_IDS.size === 0) {
        return true;
    }

    const channelId = message.channelId;
    const parentId = message.channel?.parentId;
    return ALLOWED_AI_CHANNEL_IDS.has(channelId) || (parentId && ALLOWED_AI_CHANNEL_IDS.has(parentId));
}

function getConversationKey(message) {
    const scope = message.guild?.id || "dm";
    return `${scope}:${message.author.id}`;
}

function getHistory(key) {
    const existing = userConversationHistory.get(key);
    if (!existing) return [];
    return Array.isArray(existing) ? existing : [];
}

function setHistory(key, history) {
    // Keep memory bounded to prevent unbounded growth in long-running bots.
    const maxEntries = Math.max(2, MAX_HISTORY_TURNS * 2);
    const trimmed = history.slice(-maxEntries);
    userConversationHistory.set(key, trimmed);

    if (userConversationHistory.size > MAX_TRACKED_USERS) {
        const oldestKey = userConversationHistory.keys().next().value;
        if (oldestKey) {
            userConversationHistory.delete(oldestKey);
        }
    }

    scheduleHistoryPersist();
}

async function ensureHistoryLoaded() {
    if (historyLoaded) return;
    if (historyLoadPromise) {
        await historyLoadPromise;
        return;
    }

    historyLoadPromise = (async () => {
        try {
            const raw = await fs.readFile(HISTORY_FILE_PATH, "utf8");
            const parsed = JSON.parse(raw);

            if (parsed && typeof parsed === "object") {
                const keys = Object.keys(parsed).slice(-MAX_TRACKED_USERS);
                for (const key of keys) {
                    const value = parsed[key];
                    if (Array.isArray(value)) {
                        const maxEntries = Math.max(2, MAX_HISTORY_TURNS * 2);
                        userConversationHistory.set(key, value.slice(-maxEntries));
                    }
                }
            }
        } catch (error) {
            // Missing file is expected on first run; invalid JSON should not crash the bot.
            if (error && error.code !== "ENOENT") {
                console.warn("Failed to load AI conversation history:", error.message || error);
            }
        } finally {
            historyLoaded = true;
            historyLoadPromise = null;
        }
    })();

    await historyLoadPromise;
}

function scheduleHistoryPersist() {
    if (persistTimer) {
        clearTimeout(persistTimer);
    }

    // Small debounce to avoid excessive writes during active chat bursts.
    persistTimer = setTimeout(() => {
        persistTimer = null;
        persistHistoryToDisk().catch((error) => {
            console.warn("Failed to persist AI conversation history:", error.message || error);
        });
    }, 400);
}

async function persistHistoryToDisk() {
    try {
        const dir = path.dirname(HISTORY_FILE_PATH);
        await fs.mkdir(dir, { recursive: true });

        const serialized = Object.fromEntries(userConversationHistory.entries());
        const tempFile = `${HISTORY_FILE_PATH}.tmp`;

        await fs.writeFile(tempFile, JSON.stringify(serialized, null, 2), "utf8");
        await fs.rename(tempFile, HISTORY_FILE_PATH);
    } catch (error) {
        console.warn("Failed to save AI conversation history:", error.message || error);
    }
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

async function generateAiResponse({ prompt, authorTag, guildName, history = [] }) {
    const contextualMessage =
        `Server: ${guildName || "Unknown"}\n` +
        `User: ${authorTag}\n` +
        `Message: ${prompt}`;

    const payload = {
        model: AI_MODEL,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...history,
            { role: "user", content: contextualMessage },
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
        await ensureHistoryLoaded();

        if (message.author.bot) return;
        if (!client.user) return;

        const lower = message.content.toLowerCase().trim();
        if (lower === "ct help") return;
        if (!isAllowedAiChannel(message)) return;

        const mentionedBot = message.mentions.users.has(client.user.id);
        const repliedToBot = await isReplyToBot(message);

        if (!mentionedBot && !repliedToBot) return;

        const cleaned = sanitizePrompt(message.content, client.user.id);
        const prompt = cleaned || "Continue the conversation naturally.";
        const conversationKey = getConversationKey(message);
        const history = getHistory(conversationKey);
        const currentUserMessage =
            `Server: ${message.guild?.name || "Unknown"}\n` +
            `User: ${message.author.tag}\n` +
            `Message: ${prompt}`;

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
                history,
            });

            setHistory(conversationKey, [
                ...history,
                { role: "user", content: currentUserMessage },
                { role: "assistant", content: aiText },
            ]);

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
