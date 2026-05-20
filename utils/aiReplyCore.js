const path = require("node:path");
const fs = require("node:fs/promises");
const config = require("../config.json");
const { withDiscordNetworkRetry } = require("./discordNetworkRetry");

const OPENROUTER_API_KEY = (process.env.OPENROUTER_API_KEY || "").trim();
const OPENAI_API_KEY = (process.env.OPENAI_API_KEY || "").trim();
const GENERIC_AI_API_KEY = (process.env.AI_API_KEY || "").trim();
const AI_API_URL = (process.env.AI_API_URL || "").trim();
const AI_PROVIDER = (process.env.AI_PROVIDER || "").trim().toLowerCase();
const USER_DEFINED_MODEL = (process.env.AI_MODEL || "").trim();

function detectProviderFromUrl(url) {
    if (!url) return null;
    const lower = url.toLowerCase();
    if (lower.includes("openrouter.ai")) return "openrouter";
    if (lower.includes("api.openai.com")) return "openai";
    return null;
}

function detectProviderFromApiKey(apiKey) {
    if (!apiKey) return null;
    const key = apiKey.trim().toLowerCase();

    if (key.startsWith("sk-or-v1")) return "openrouter";
    if (key.startsWith("sk-")) return "openai";

    return null;
}

function resolveAiRuntimeConfig() {
    const providerFromUrl = detectProviderFromUrl(AI_API_URL);
    const keyProviderHints = [
        detectProviderFromApiKey(OPENROUTER_API_KEY),
        detectProviderFromApiKey(OPENAI_API_KEY),
        detectProviderFromApiKey(GENERIC_AI_API_KEY),
    ].filter(Boolean);
    const providerFromKey = keyProviderHints[0] || null;
    const provider = AI_PROVIDER || providerFromUrl || providerFromKey;

    const preferOpenRouter = provider === "openrouter" || (!provider && OPENROUTER_API_KEY);

    if (preferOpenRouter) {
        return {
            provider: "openrouter",
            apiUrl: AI_API_URL || "https://openrouter.ai/api/v1/chat/completions",
            apiKey: OPENROUTER_API_KEY || GENERIC_AI_API_KEY || OPENAI_API_KEY,
            model: USER_DEFINED_MODEL || "openai/gpt-4o-mini",
        };
    }

    return {
        provider: "openai",
        apiUrl: AI_API_URL || "https://api.openai.com/v1/chat/completions",
        apiKey: OPENAI_API_KEY || GENERIC_AI_API_KEY || OPENROUTER_API_KEY,
        model: USER_DEFINED_MODEL || "gpt-4o-mini",
    };
}

const runtimeConfig = resolveAiRuntimeConfig();

const SYSTEM_PROMPT =
    "You are a helpful Discord server assistant. Reply in a friendly, concise way. " +
    "Do not mention internal policies. Avoid hateful, sexual, or violent output.";

const MAX_HISTORY_TURNS = Number(process.env.AI_HISTORY_TURNS || 8);
const MAX_TRACKED_USERS = Number(process.env.AI_MAX_TRACKED_USERS || 500);
const AI_REPLY_DEBUG = /^(1|true|yes|on)$/i.test((process.env.AI_REPLY_DEBUG || "").trim());

const SPECIAL_AI_USER_ID = (process.env.SPECIAL_AI_USER_ID || "").trim();

const SPECIAL_AI_USER_IDS = new Set([
    SPECIAL_AI_USER_ID,
    ...(process.env.SPECIAL_AI_USER_IDS || "").split(",").map((id) => id.trim()).filter(Boolean),
].filter(Boolean));

const ALLOWED_AI_CHANNEL_IDS = new Set([
    ...(process.env.AI_ALLOWED_CHANNEL_IDS || "").split(",").map((id) => id.trim()).filter(Boolean),
    ...(Array.isArray(config.aiReplyChannelIds) ? config.aiReplyChannelIds : []).map((id) => String(id).trim()).filter(Boolean),
]);

const userConversationHistory = new Map();
const activeDmSessions = new Map();
const HISTORY_FILE_PATH = path.join(path.dirname(__dirname), "data", "ai-conversation-history.json");
const ACTIVE_DM_SESSION_TTL_MS = Number(process.env.AI_DM_SESSION_TTL_MS || 2 * 60 * 60 * 1000);
const MAX_DM_SESSION_MESSAGE_IDS = Math.max(3, Number(process.env.AI_DM_SESSION_MESSAGE_IDS || 10));

let historyLoaded = false;
let historyLoadPromise = null;
let persistTimer = null;

function logAiEvent(level, message, details = null) {
    const normalizedLevel = String(level || "info").toLowerCase();
    if (normalizedLevel === "debug" && !AI_REPLY_DEBUG) {
        return;
    }

    const prefix = normalizedLevel === "error"
        ? "[AI Reply]"
        : normalizedLevel === "warn"
            ? "[AI Reply WARN]"
            : normalizedLevel === "debug"
                ? "[AI Reply DEBUG]"
                : "[AI Reply INFO]";

    if (details && Object.keys(details).length > 0) {
        console.log(prefix, message, details);
        return;
    }

    console.log(prefix, message);
}

function sanitizePrompt(content, botId) {
    if (!content) return "";
    return String(content)
        .replace(new RegExp(`<@!?${botId}>`, "g"), "")
        .trim();
}

function isSpecialAiUser(userId) {
    return SPECIAL_AI_USER_IDS.has(userId);
}

function canBypassAiChannels(userId) {
    return Boolean(SPECIAL_AI_USER_ID) && userId === SPECIAL_AI_USER_ID;
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
    if (canBypassAiChannels(message.author.id)) {
        return true;
    }

    if (message.channel?.isDMBased?.()) {
        return true;
    }

    if (ALLOWED_AI_CHANNEL_IDS.size === 0) {
        return true;
    }

    const channelId = message.channelId;
    const parentId = message.channel?.parentId;
    return ALLOWED_AI_CHANNEL_IDS.has(channelId) || (parentId && ALLOWED_AI_CHANNEL_IDS.has(parentId));
}

function getConversationKeyForUser(guildId, userId) {
    const scope = guildId || "dm";
    return `${scope}:${userId}`;
}

function getConversationKey(message) {
    return getConversationKeyForUser(message.guild?.id || "dm", message.author.id);
}

function getDmSessionKey(channelId) {
    return `${channelId || "dm"}`;
}

function activateDmSession(channelId, ttlMs = ACTIVE_DM_SESSION_TTL_MS) {
    if (!channelId) return null;

    const expiresAt = Date.now() + Math.max(60_000, Number(ttlMs) || ACTIVE_DM_SESSION_TTL_MS);
    const key = getDmSessionKey(channelId);
    const existing = activeDmSessions.get(key);
    const messageIds = Array.isArray(existing?.messageIds)
        ? existing.messageIds.filter(Boolean).slice(-MAX_DM_SESSION_MESSAGE_IDS)
        : [];

    activeDmSessions.set(key, { expiresAt, messageIds });
    return expiresAt;
}

function isActiveDmSession(channelId) {
    const key = getDmSessionKey(channelId);
    const session = activeDmSessions.get(key);
    const expiresAt = typeof session === "number" ? session : session?.expiresAt;
    if (!expiresAt) return false;

    if (Date.now() > expiresAt) {
        activeDmSessions.delete(key);
        return false;
    }

    return true;
}

function registerDmBotMessage(channelId, messageId, ttlMs = ACTIVE_DM_SESSION_TTL_MS) {
    if (!channelId || !messageId) return null;

    const key = getDmSessionKey(channelId);
    const expiresAt = Date.now() + Math.max(60_000, Number(ttlMs) || ACTIVE_DM_SESSION_TTL_MS);
    const existing = activeDmSessions.get(key);
    const currentMessageIds = Array.isArray(existing?.messageIds)
        ? existing.messageIds.filter(Boolean)
        : [];

    currentMessageIds.push(String(messageId));

    activeDmSessions.set(key, {
        expiresAt: Math.max(expiresAt, typeof existing === "object" && existing?.expiresAt ? existing.expiresAt : 0),
        messageIds: currentMessageIds.slice(-MAX_DM_SESSION_MESSAGE_IDS),
    });

    return activeDmSessions.get(key);
}

function isReplyToTrackedDmBotMessage(channelId, messageId) {
    if (!channelId || !messageId) return false;

    const key = getDmSessionKey(channelId);
    const session = activeDmSessions.get(key);
    const expiresAt = typeof session === "number" ? session : session?.expiresAt;

    if (!expiresAt) return false;

    if (Date.now() > expiresAt) {
        activeDmSessions.delete(key);
        return false;
    }

    const messageIds = Array.isArray(session?.messageIds) ? session.messageIds : [];
    return messageIds.includes(String(messageId));
}

function getHistory(key) {
    const existing = userConversationHistory.get(key);
    if (!existing) return [];
    return Array.isArray(existing) ? existing : [];
}

function setHistory(key, history) {
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

async function generateAiResponse({ prompt, authorTag, guildName, history = [] }) {
    const contextualMessage =
        `Server: ${guildName || "Unknown"}\n` +
        `User: ${authorTag}\n` +
        `Message: ${prompt}`;

    const payload = {
        model: runtimeConfig.model,
        messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...history,
            { role: "user", content: contextualMessage },
        ],
        temperature: 0.7,
    };

    const response = await withDiscordNetworkRetry(
        async () => {
            return fetch(runtimeConfig.apiUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${runtimeConfig.apiKey}`,
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
        const shortBody = bodyText.slice(0, 300);

        if (response.status === 401) {
            throw new Error(
                `AI auth failed (401) for ${runtimeConfig.provider}. ` +
                    "Check that AI_API_URL matches your API key provider and that the key is valid. " +
                    `Response: ${shortBody}`
            );
        }

        throw new Error(`AI request failed (${response.status}): ${bodyText.slice(0, 300)}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content?.trim() || "I could not generate a reply right now.";
}

module.exports = {
    runtimeConfig,
    logAiEvent,
    sanitizePrompt,
    splitMessage,
    isSpecialAiUser,
    isAllowedAiChannel,
    getConversationKeyForUser,
    getConversationKey,
    getDmSessionKey,
    activateDmSession,
    isActiveDmSession,
    registerDmBotMessage,
    isReplyToTrackedDmBotMessage,
    getHistory,
    setHistory,
    ensureHistoryLoaded,
    generateAiResponse,
};