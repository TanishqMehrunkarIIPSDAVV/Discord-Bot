const fs = require("node:fs/promises");
const path = require("node:path");
const config = require("../config.json");

const HISTORY_FILE_PATH = path.join(__dirname, "..", "data", "chat-lore-history.json");
const MAX_SEGMENTS_PER_CHANNEL = Math.max(10, Number(process.env.LORE_MAX_SEGMENTS_PER_CHANNEL || 40));
const SEGMENT_TIMEOUT_MS = Math.max(60_000, Number(process.env.LORE_SEGMENT_TIMEOUT_MS || 15 * 60_000));
const MIN_MESSAGES_TO_STORE = Math.max(4, Number(process.env.LORE_MIN_MESSAGES_TO_STORE || 6));
const MAX_MESSAGES_PER_SEGMENT = Math.max(20, Number(process.env.LORE_MAX_MESSAGES_PER_SEGMENT || 60));
const MAX_MESSAGE_SNIPPET = Math.max(60, Number(process.env.LORE_MAX_MESSAGE_SNIPPET || 180));

const configuredChannelIds = [
    ...(process.env.LORE_ALLOWED_CHANNEL_IDS || "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ...(Array.isArray(config.chatLoreChannelIds) ? config.chatLoreChannelIds : [])
        .map((id) => String(id).trim())
        .filter(Boolean),
    ...(Array.isArray(config.loreChannelIds) ? config.loreChannelIds : [])
        .map((id) => String(id).trim())
        .filter(Boolean),
];

const ALLOWED_CHANNEL_IDS = new Set(configuredChannelIds);
const loreState = { guilds: {} };
const activeSegments = new Map();

let historyLoaded = false;
let historyLoadPromise = null;
let persistTimer = null;

const topicLabels = {
    joke: "jokes and banter",
    debate: "a back-and-forth debate",
    planning: "planning or coordination",
    study: "study or work grind",
    vc: "voice chat talk",
    support: "help or explanation",
    drama: "drama or tension",
};

function normalizeText(value) {
    return (value || "").toString().trim();
}

function truncate(text, limit = MAX_MESSAGE_SNIPPET) {
    const cleaned = normalizeText(text).replace(/\s+/g, " ");
    if (cleaned.length <= limit) return cleaned;
    return `${cleaned.slice(0, Math.max(0, limit - 1)).trim()}…`;
}

function formatDuration(startedAt, endedAt) {
    const deltaMs = Math.max(0, Number(endedAt) - Number(startedAt));
    const totalMinutes = Math.max(1, Math.round(deltaMs / 60000));
    if (totalMinutes < 60) {
        return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!minutes) {
        return `${hours} hour${hours === 1 ? "" : "s"}`;
    }

    return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function naturalJoin(parts) {
    const values = parts.filter(Boolean);
    if (values.length === 0) return "";
    if (values.length === 1) return values[0];
    if (values.length === 2) return `${values[0]} and ${values[1]}`;
    return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function getAllowedChannelSet() {
    return ALLOWED_CHANNEL_IDS;
}

function isAllowedLoreChannel(message) {
    if (!message?.guild) return false;
    if (getAllowedChannelSet().size === 0) return true;

    const channelId = message.channelId;
    const parentId = message.channel?.parentId;
    return getAllowedChannelSet().has(channelId) || (parentId && getAllowedChannelSet().has(parentId));
}

function getGuildState(guildId) {
    if (!loreState.guilds[guildId] || typeof loreState.guilds[guildId] !== "object") {
        loreState.guilds[guildId] = { channels: {} };
    }

    const guildState = loreState.guilds[guildId];
    if (!guildState.channels || typeof guildState.channels !== "object") {
        guildState.channels = {};
    }

    return guildState;
}

function getChannelHistory(guildId, channelId) {
    const guildState = getGuildState(guildId);
    if (!guildState.channels[channelId] || typeof guildState.channels[channelId] !== "object") {
        guildState.channels[channelId] = { summaries: [] };
    }

    const channelState = guildState.channels[channelId];
    if (!Array.isArray(channelState.summaries)) {
        channelState.summaries = [];
    }

    return channelState;
}

function getConversationKey(guildId, channelId) {
    return `${guildId}:${channelId}`;
}

function getMessageTags(content) {
    const lower = normalizeText(content).toLowerCase();
    const tags = new Set();

    if (/(lol|lmao|haha|hehe|rofl|joke|roast|banter|meme|mazak|hasa|hasta|hasna|bolna|hasta|lol|hehe)/.test(lower)) tags.add("joke");
    if (/(argue|argument|debate|fight|drama|why you|no you|cope|nuh uh|ladai|jhagda|jhagde|lara|jhagre|bolne)/.test(lower)) tags.add("debate");
    if (/(plan|planning|schedule|tomorrow|later|soon|meeting|agenda|organize|setup|milenge|kal|aaj|subah|raat|milte)/.test(lower)) tags.add("planning");
    if (/(study|homework|exam|assignment|project|work|grind|notes|revision|padhai|pdhna|test|revision|nots)/.test(lower)) tags.add("study");
    if (/(vc|voice|call|join|leave|muted|mute|deaf|deafen|mic|channel|voice.*chat|vc.*join|vc.*leave)/.test(lower)) tags.add("vc");
    if (/(sorry|help|how do i|can you|please|explain|question|why does|what if|samjhao|btao|bta|help|samjh|samjha)/.test(lower)) tags.add("support");
    if (/(complain|angry|mad|issue|problem|drama|toxic|wtf|hate|acha na|chodo|bakwas|annoying)/.test(lower)) tags.add("drama");

    return [...tags];
}

function getTopicFromMessages(messages) {
    const counts = new Map();

    for (const message of messages) {
        for (const tag of getMessageTags(message.content)) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        }
    }

    if (!counts.size) return null;

    let bestTag = null;
    let bestCount = 0;
    for (const [tag, count] of counts.entries()) {
        if (count > bestCount) {
            bestTag = tag;
            bestCount = count;
        }
    }

    return bestTag ? topicLabels[bestTag] || null : null;
}

function formatParticipants(participants) {
    const sorted = Object.values(participants || {}).sort((a, b) => b.count - a.count);
    const names = sorted.slice(0, 4).map((entry) => entry.tag || `User ${entry.id}`);
    if (!names.length) return "unknown users";
    if (names.length === 1) return names[0];
    if (names.length === 2) return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, 3).join(", ")}, and others`;
}

function summarizeMessage(message) {
    const snippet = truncate(message.content);
    return `${message.authorTag}: ${snippet || "[no text]"}`;
}

function buildNarrative(segment) {
    const messages = segment.messages || [];
    const participants = formatParticipants(segment.participants);
    const duration = formatDuration(segment.startedAt, segment.lastAt || segment.startedAt);
    const openingTopic = getTopicFromMessages(messages.slice(0, Math.min(3, messages.length)));
    const closingTopic = getTopicFromMessages(messages.slice(-Math.min(3, messages.length)));
    const dominantTags = Object.entries(segment.tags || {})
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
        .filter(Boolean);

    const middleNotes = [];
    if (dominantTags.includes("debate")) middleNotes.push("it turned into a back-and-forth debate");
    if (dominantTags.includes("joke")) middleNotes.push("it kept drifting into jokes and banter");
    if (dominantTags.includes("planning")) middleNotes.push("there was a practical planning phase");
    if (dominantTags.includes("study")) middleNotes.push("the focus leaned toward study or work grind");
    if (dominantTags.includes("vc")) middleNotes.push("voice-chat talk kept coming back");
    if (dominantTags.includes("drama")) middleNotes.push("some tension or drama showed up");
    if (dominantTags.includes("support")) middleNotes.push("people were trying to explain or solve something");

    const parts = [`This chat between ${participants} lasted ${duration}.`];
    if (openingTopic) parts.push(`It opened around ${openingTopic}.`);
    if (middleNotes.length) {
        parts.push(`In the middle, ${naturalJoin(middleNotes)}.`);
    }
    if (closingTopic && closingTopic !== openingTopic) {
        parts.push(`By the end, it had shifted toward ${closingTopic}.`);
    }

    return parts.join(" ");
}

function buildEvidence(segment) {
    const messages = segment.messages || [];
    if (!messages.length) return [];

    const picks = [];
    const first = messages[0];
    const middle = messages[Math.floor(messages.length / 2)];
    const last = messages[messages.length - 1];

    for (const message of [first, middle, last]) {
        if (!message) continue;
        const item = summarizeMessage(message);
        if (!picks.includes(item)) {
            picks.push(item);
        }
    }

    return picks.slice(0, 3);
}

function scoreSegment(segment) {
    const participantCount = Object.keys(segment.participants || {}).length;
    const messageCount = segment.messages?.length || 0;
    const turnCount = segment.turnCount || 0;
    const replyCount = segment.replyCount || 0;
    const mentionCount = segment.mentionCount || 0;
    const tagCount = Object.entries(segment.tags || {}).length;

    let score = 0;
    if (participantCount >= 2) score += 2;
    if (messageCount >= 6) score += 1;
    if (messageCount >= 10) score += 1;
    if (turnCount >= 4) score += 1;
    if (replyCount >= 2) score += 1;
    if (mentionCount >= 2) score += 1;
    if (tagCount >= 2) score += 1;

    return score;
}

function isInterestingSegment(segment) {
    const participantCount = Object.keys(segment.participants || {}).length;
    const messageCount = segment.messages?.length || 0;
    return participantCount >= 2 && messageCount >= MIN_MESSAGES_TO_STORE && scoreSegment(segment) >= 4;
}

function snapshotSegment(segment) {
    const participantIds = Object.keys(segment.participants || {});
    return {
        id: `${segment.guildId}:${segment.channelId}:${segment.startedAt}`,
        guildId: segment.guildId,
        channelId: segment.channelId,
        channelName: segment.channelName || null,
        startedAt: segment.startedAt,
        lastAt: segment.lastAt || segment.startedAt,
        participantIds,
        participants: Object.values(segment.participants || {}),
        messageCount: segment.messages?.length || 0,
        tags: Object.entries(segment.tags || {})
            .sort((a, b) => b[1] - a[1])
            .map(([tag]) => tag),
        summary: buildNarrative(segment),
        evidence: buildEvidence(segment),
        score: scoreSegment(segment),
    };
}

function createActiveSegment(message) {
    return {
        guildId: message.guild.id,
        channelId: message.channelId,
        channelName: message.channel?.name || message.channel?.parent?.name || message.channelId,
        startedAt: Date.now(),
        lastAt: Date.now(),
        messages: [],
        participants: {},
        tags: {},
        turnCount: 0,
        replyCount: 0,
        mentionCount: 0,
        lastAuthorId: null,
    };
}

function appendMessageToSegment(segment, message) {
    const messageRecord = {
        authorId: message.author.id,
        authorTag: message.author.tag,
        content: truncate(message.content, MAX_MESSAGE_SNIPPET),
        createdAt: Date.now(),
    };

    if (segment.lastAuthorId && segment.lastAuthorId !== message.author.id) {
        segment.turnCount += 1;
    }

    segment.messages.push(messageRecord);
    segment.lastAuthorId = message.author.id;
    segment.lastAt = Date.now();
    segment.participants[message.author.id] = {
        id: message.author.id,
        tag: message.author.tag,
        count: (segment.participants[message.author.id]?.count || 0) + 1,
    };

    const tags = getMessageTags(message.content);
    for (const tag of tags) {
        segment.tags[tag] = (segment.tags[tag] || 0) + 1;
    }

    if (message.reference?.messageId) {
        segment.replyCount += 1;
    }

    if (message.mentions?.users?.size) {
        segment.mentionCount += message.mentions.users.size;
    }
}

function pruneChannelSummaries(channelState) {
    if (!Array.isArray(channelState.summaries)) {
        channelState.summaries = [];
    }

    if (channelState.summaries.length > MAX_SEGMENTS_PER_CHANNEL) {
        channelState.summaries = channelState.summaries
            .sort((a, b) => Number(b.lastAt || 0) - Number(a.lastAt || 0))
            .slice(0, MAX_SEGMENTS_PER_CHANNEL)
            .sort((a, b) => Number(a.startedAt || 0) - Number(b.startedAt || 0));
    }
}

function finalizeActiveSegment(key, reason = "timeout") {
    const segment = activeSegments.get(key);
    if (!segment) return null;

    activeSegments.delete(key);

    if (!isInterestingSegment(segment)) {
        return null;
    }

    const snapshot = snapshotSegment(segment);
    const channelState = getChannelHistory(segment.guildId, segment.channelId);
    channelState.summaries.push({
        ...snapshot,
        finalizedReason: reason,
    });
    pruneChannelSummaries(channelState);
    schedulePersist();
    return snapshot;
}

function cleanupExpiredSegments() {
    const now = Date.now();
    for (const [key, segment] of activeSegments.entries()) {
        if (now - segment.lastAt >= SEGMENT_TIMEOUT_MS) {
            finalizeActiveSegment(key, "timeout");
        }
    }
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
            if (parsed && typeof parsed === "object" && parsed.guilds && typeof parsed.guilds === "object") {
                for (const [guildId, guildState] of Object.entries(parsed.guilds)) {
                    if (!guildState || typeof guildState !== "object") continue;
                    const channels = guildState.channels && typeof guildState.channels === "object" ? guildState.channels : {};
                    loreState.guilds[guildId] = { channels: {} };
                    for (const [channelId, channelState] of Object.entries(channels)) {
                        loreState.guilds[guildId].channels[channelId] = {
                            summaries: Array.isArray(channelState.summaries) ? channelState.summaries : [],
                        };
                        pruneChannelSummaries(loreState.guilds[guildId].channels[channelId]);
                    }
                }
            }
        } catch (error) {
            if (error && error.code !== "ENOENT") {
                console.warn("Failed to load chat lore history:", error.message || error);
            }
        } finally {
            historyLoaded = true;
            historyLoadPromise = null;
        }
    })();

    await historyLoadPromise;
}

function schedulePersist() {
    if (persistTimer) {
        clearTimeout(persistTimer);
    }

    persistTimer = setTimeout(() => {
        persistTimer = null;
        persistHistoryToDisk().catch((error) => {
            console.warn("Failed to persist chat lore history:", error.message || error);
        });
    }, 500);
}

async function persistHistoryToDisk() {
    const dir = path.dirname(HISTORY_FILE_PATH);
    await fs.mkdir(dir, { recursive: true });
    const tempFile = `${HISTORY_FILE_PATH}.tmp`;
    const serialized = JSON.stringify(loreState, null, 2);
    await fs.writeFile(tempFile, serialized, "utf8");
    await fs.rename(tempFile, HISTORY_FILE_PATH);
}

function upsertActiveSegment(message) {
    const key = getConversationKey(message.guild.id, message.channelId);
    const now = Date.now();
    let segment = activeSegments.get(key);

    if (segment && now - segment.lastAt >= SEGMENT_TIMEOUT_MS) {
        finalizeActiveSegment(key, "timeout");
        segment = null;
    }

    if (!segment) {
        segment = createActiveSegment(message);
        activeSegments.set(key, segment);
    }

    appendMessageToSegment(segment, message);

    if (segment.messages.length >= MAX_MESSAGES_PER_SEGMENT) {
        finalizeActiveSegment(key, "segment-limit");
    }
}

function recordLoreMessage(message) {
    if (!message?.guild || message.author?.bot || !message.content?.trim()) return false;
    if (!isAllowedLoreChannel(message)) return false;

    upsertActiveSegment(message);
    schedulePersist();
    return true;
}

function getAllStoredSegments(guildId) {
    const guildState = getGuildState(guildId);
    const segments = [];

    for (const [channelId, channelState] of Object.entries(guildState.channels || {})) {
        for (const summary of channelState.summaries || []) {
            segments.push({ ...summary, channelId });
        }
    }

    return segments;
}

function snapshotActiveSegmentsForGuild(guildId) {
    const segments = [];
    for (const segment of activeSegments.values()) {
        if (segment.guildId !== guildId) continue;
        if (!isInterestingSegment(segment)) continue;
        segments.push(snapshotSegment(segment));
    }
    return segments;
}

function segmentMatchesScope(segment, userIds, channelId) {
    if (channelId && segment.channelId !== channelId) return false;
    if (!userIds || userIds.length === 0) return true;

    const ids = new Set(segment.participantIds || []);
    return userIds.every((userId) => ids.has(userId));
}

function relevanceScore(segment, userIds, channelId) {
    let score = Number(segment.score || 0);
    if (channelId && segment.channelId === channelId) score += 3;
    if (userIds && userIds.length) {
        const ids = new Set(segment.participantIds || []);
        for (const userId of userIds) {
            if (ids.has(userId)) score += 2;
        }
    }
    score += Math.min(3, Number(segment.messageCount || 0) / 4);
    score += Math.min(2, Number(segment.participantIds?.length || 0) / 2);
    const ageDays = Math.max(0, (Date.now() - Number(segment.lastAt || 0)) / 86400000);
    score += Math.max(0, 7 - ageDays);
    return score;
}

function queryLoreHistory({ guildId, userIds = [], channelId = null, limit = 3 }) {
    cleanupExpiredSegments();

    const stored = getAllStoredSegments(guildId);
    const active = snapshotActiveSegmentsForGuild(guildId);
    const allSegments = [...stored, ...active];
    const filtered = allSegments.filter((segment) => segmentMatchesScope(segment, userIds, channelId));

    return filtered
        .sort((a, b) => {
            const scoreDiff = relevanceScore(b, userIds, channelId) - relevanceScore(a, userIds, channelId);
            if (scoreDiff !== 0) return scoreDiff;
            return Number(b.lastAt || 0) - Number(a.lastAt || 0);
        })
        .slice(0, Math.max(1, Math.min(10, Number(limit) || 3)));
}

function buildScopeLabel({ userMentions = [], channelMentionText = null }) {
    const parts = [];
    if (userMentions.length) parts.push(userMentions.join(" and "));
    if (channelMentionText) parts.push(channelMentionText);
    return parts.length ? parts.join(" in ") : "the tracked chat history";
}

module.exports = {
    ensureHistoryLoaded,
    recordLoreMessage,
    queryLoreHistory,
    buildScopeLabel,
    isAllowedLoreChannel,
};