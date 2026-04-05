const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");

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

function buildValidReason(reason, fallback = "Spamming detected") {
    const normalized = normalizeMessageContent(reason)
        .replace(/[\u0000-\u001F\u007F]/g, "")
        .trim();

    if (!normalized) {
        return fallback;
    }

    // Discord timeout reason must be <= 512 chars.
    return normalized.slice(0, 512);
}

function buildHeuristicReason(heuristic) {
    if (!heuristic) {
        return "Spamming detected";
    }

    const parts = [];

    if (heuristic.repeated) {
        parts.push("repeated messages detected");
    }

    if (heuristic.tooManyInWindow) {
        parts.push(`${heuristic.recentCount} messages in 10 seconds`);
    }

    if (parts.length === 0) {
        return "Spamming detected";
    }

    return `Spamming detected: ${parts.join("; ")}`;
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
            const heuristicSpam = heuristic.spam;
            if (!heuristicSpam) {
                return;
            }

            const dynamicReason = buildHeuristicReason(heuristic);
            const timeoutReason = buildValidReason(dynamicReason, "Spamming detected");
            const channelReason = buildValidReason(dynamicReason, "Spamming detected");
            if (!message.member || message.member.communicationDisabledUntilTimestamp) {
                return;
            }

            await message.member.timeout(60000, timeoutReason);
            await message.channel.send(`${userMention(userId)} has been timed out for spamming. Reason: ${channelReason}`);
        } catch (err) {
            console.error(`Failed to timeout user ${message.author.tag} (${userId}):`, err.message || err);
        }

        // Clear to avoid repeated timeouts
        messageTimestamps.set(userId, []);
        messageContents.set(userId, []);
    });
};

module.exports = spam;