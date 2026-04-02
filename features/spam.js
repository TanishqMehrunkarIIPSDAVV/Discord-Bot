const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");

const AI_API_URL = process.env.AI_API_URL || "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "openai/gpt-4o-mini";
const AI_API_KEY = (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY ||
    ""
).trim();
const AI_SPAM_CHECK_ENABLED = String(process.env.AI_SPAM_CHECK_ENABLED || "true").toLowerCase() !== "false";
const AI_SPAM_MAX_CHARS = Number(process.env.AI_SPAM_MAX_CHARS || 1200);
const AI_SPAM_MIN_CONFIDENCE = Number(process.env.AI_SPAM_MIN_CONFIDENCE || 0.85);
const AI_SPAM_MIN_RECENT_COUNT = Number(process.env.AI_SPAM_MIN_RECENT_COUNT || 3);

const messageTimestamps = new Map();
const messageContents = new Map();

// User IDs to exclude from spam detection (moderators, trusted users, etc.)
const EXCLUDED_USER_IDS = [
    // Add user IDs here to exclude them from spam timeout
    // Example: "123456789012345678",
    "936125585711845437"
];

function normalizeMessageContent(value) {
    if (!value) return "";
    return String(value)
        .replace(/\r?\n+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function truncateForAi(value, limit = AI_SPAM_MAX_CHARS) {
    const content = normalizeMessageContent(value);
    if (content.length <= limit) return content;
    return `${content.slice(0, Math.max(0, limit - 3)).trim()}...`;
}

function parseAiVerdict(rawContent) {
    if (!rawContent) return null;

    const cleaned = String(rawContent)
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "");

    const jsonStart = cleaned.indexOf("{");
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart === -1 || jsonEnd === -1 || jsonEnd <= jsonStart) return null;

    try {
        const parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
        if (typeof parsed?.spam !== "boolean") return null;
        return {
            spam: parsed.spam,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : null,
            reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
        };
    } catch {
        return null;
    }
}

async function classifySpamWithAi(message, context) {
    if (!AI_SPAM_CHECK_ENABLED || !AI_API_KEY) {
        return null;
    }

    const content = normalizeMessageContent(message.content);
    if (!content) {
        return null;
    }

    const payload = {
        model: AI_MODEL,
        messages: [
            {
                role: "system",
                content:
                    "You are a Discord moderation assistant. Decide whether a message is spam. " +
                    "Return only valid JSON with keys spam (boolean), confidence (number from 0 to 1), and reason (short string). " +
                    "Mark spam=true for repeated messages, copy-paste floods, unsolicited promotion, excessive repeated characters, link dumping, or low-value spam. " +
                    "Mark spam=false for normal chat, questions, short replies, and legitimate messages. Do not add markdown. " +
                    "If the message is borderline, prefer spam=false unless the content is clearly repetitive, promotional, or low-value.",
            },
            {
                role: "user",
                content:
                    `Message: ${truncateForAi(content, 600)}\n` +
                    `Recent message count in 10s: ${context.recentCount}\n` +
                    `Recent messages: ${truncateForAi(context.recentMessages.join(" | "), 700)}\n` +
                    `Reply with JSON only.`,
            },
        ],
        temperature: 0,
    };

    const response = await fetch(AI_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`AI spam request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    return parseAiVerdict(data?.choices?.[0]?.message?.content);
}

function detectSpamHeuristically(contents, filteredTimestamps) {
    const repeated = contents.length >= 4 && contents.slice(-4).every(c => c === contents[contents.length - 1]);
    const tooManyInWindow = filteredTimestamps.length > 5;
    return {
        spam: repeated || tooManyInWindow,
        repeated,
        tooManyInWindow,
        recentCount: filteredTimestamps.length,
        recentMessages: contents.slice(-6),
    };
}

function shouldTimeoutFromAiVerdict(aiVerdict, heuristic) {
    if (!aiVerdict?.spam) return false;

    const confidence = typeof aiVerdict.confidence === "number" ? aiVerdict.confidence : 0;
    return (
        confidence >= AI_SPAM_MIN_CONFIDENCE &&
        heuristic.recentCount >= AI_SPAM_MIN_RECENT_COUNT
    );
}

const spam = () => {
    client.on("messageCreate", async (message) => {
        if(message.channel.id === "1439573831831392428" ||
            message.channel.id === "1439536650123476992" ||
            message.channel.id === "941243940915515392" ||
            message.channel.id === "941244061162033152"
        ) return;
        if (message.author.bot && message.author.id !== client.user?.id) return;
        
        // Skip spam detection for excluded users
        if (EXCLUDED_USER_IDS.includes(message.author.id)) return;

        const content = normalizeMessageContent(message.content);
        if (!content) return;

        const now = Date.now();
        const userId = message.author.id;

        // Track timestamps
        if (!messageTimestamps.has(userId)) messageTimestamps.set(userId, []);
        const timestamps = messageTimestamps.get(userId);
        timestamps.push(now);

        // Track message contents
        if (!messageContents.has(userId)) messageContents.set(userId, []);
        const contents = messageContents.get(userId);
        contents.push(content);

        // Keep only last 10 seconds
        const filteredTimestamps = timestamps.filter(ts => now - ts < 10000);
        messageTimestamps.set(userId, filteredTimestamps);

        // Keep only last 6 messages
        if (contents.length > 6) contents.shift();
        messageContents.set(userId, contents);

        const heuristic = detectSpamHeuristically(contents, filteredTimestamps);

        try {
            const aiVerdict = await classifySpamWithAi(message, {
                recentCount: heuristic.recentCount,
                recentMessages: heuristic.recentMessages,
            }).catch((err) => {
                console.warn("AI spam check failed, falling back to heuristic:", err.message || err);
                return null;
            });

            const heuristicSpam = heuristic.spam;
            const aiSpamWithEvidence = shouldTimeoutFromAiVerdict(aiVerdict, heuristic);
            const shouldTimeout = heuristicSpam || aiSpamWithEvidence;

            if (!shouldTimeout) {
                return;
            }

            const reason = aiVerdict?.reason || "Spamming detected";
            if (!message.member || message.member.communicationDisabledUntilTimestamp) {
                return;
            }

            await message.member.timeout(60000, reason);
            await message.channel.send(`${userMention(userId)} has been timed out for spamming.`);
        } catch (err) {
            console.error("Failed to timeout user:", err);
        }

        // Clear to avoid repeated timeouts
        messageTimestamps.set(userId, []);
        messageContents.set(userId, []);
    });
};

module.exports = spam;