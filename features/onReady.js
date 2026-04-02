const path=require("node:path");
const client=require(`${path.dirname(__dirname)}/index.js`);
const { ActivityType } = require("discord.js");

const AI_API_URL = process.env.AI_API_URL || "https://openrouter.ai/api/v1/chat/completions";
const AI_MODEL = process.env.AI_MODEL || "openai/gpt-4o-mini";
const AI_API_KEY = (
    process.env.OPENROUTER_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.AI_API_KEY ||
    ""
).trim();

const ACTIVITY_REFRESH_MS = Number(process.env.AI_ACTIVITY_REFRESH_MS || 300000);
const MAX_ACTIVITY_NAME_LENGTH = 120;
const ACTIVITY_EMOJIS = ["✨", "🎧", "🎮", "🚀", "☕", "🎵", "🛠️", "🌟"];
let activityRefreshTimer = null;
let lastKnownGoodActivity = null;

const fallbackActivities = [
    "Serving chai and chaotic vibes ☕",
    "Keeping the tapri running ✨",
    "Debugging the universe 🛠️",
    "Listening for pings 🎧",
    "Watching over the server 👀",
    "Powering your commands ⚡",
];

function sanitizeActivityName(value) {
    if (!value) return "Serving fresh vibes";
    return String(value)
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim()
        .slice(0, MAX_ACTIVITY_NAME_LENGTH);
}

function hasEmoji(value) {
    if (!value) return false;
    return /\p{Extended_Pictographic}/u.test(value);
}

function randomEmoji() {
    const index = Math.floor(Math.random() * ACTIVITY_EMOJIS.length);
    return ACTIVITY_EMOJIS[index] || "✨";
}

function ensureEmoji(value) {
    const activity = sanitizeActivityName(value);
    if (hasEmoji(activity)) return activity;

    // Keep total length bounded when appending an emoji.
    const truncated = activity.slice(0, Math.max(0, MAX_ACTIVITY_NAME_LENGTH - 3)).trim();
    return `${truncated} ${randomEmoji()}`.trim();
}

function ensureNonEmptyActivity(value) {
    const activity = ensureEmoji(value);
    return activity || randomFallbackActivity();
}

function randomFallbackActivity() {
    const index = Math.floor(Math.random() * fallbackActivities.length);
    return fallbackActivities[index] || "Serving fresh vibes";
}

function randomActivityType() {
    const types = [ActivityType.Playing, ActivityType.Watching, ActivityType.Listening];
    return types[Math.floor(Math.random() * types.length)] || ActivityType.Watching;
}

async function generateAiActivity() {
    if (!AI_API_KEY) {
        return randomFallbackActivity();
    }

    const prompt =
        "Generate exactly one short Discord bot activity line (max 60 chars). " +
        "Keep it friendly and SFW, no hashtags, no quotes. Include at least one emoji. " +
        "Only return the activity text and nothing else.";

    const payload = {
        model: AI_MODEL,
        messages: [
            {
                role: "system",
                content:
                    "You write short, creative Discord bot status lines that are always safe and non-violent.",
            },
            {
                role: "user",
                content: `${prompt} Make it different from common defaults.`,
            },
        ],
        temperature: 1,
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
        throw new Error(`AI activity request failed (${response.status}): ${body.slice(0, 200)}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    return ensureEmoji(content);
}

async function setFreshActivity() {
    const type = randomActivityType();

    try {
        const aiActivity = ensureNonEmptyActivity(await generateAiActivity());
        lastKnownGoodActivity = aiActivity;
        client.user.setActivity(aiActivity, { type });
        console.log(`[Presence] Activity updated: ${aiActivity}`);
    } catch (error) {
        const fallback = ensureNonEmptyActivity(lastKnownGoodActivity || randomFallbackActivity());
        lastKnownGoodActivity = fallback;
        client.user.setActivity(fallback, { type: ActivityType.Watching });
        console.warn("[Presence] AI activity failed, using fallback:", error.message || error);
    }
}

const onReady=()=>
{
    client.once("clientReady", async () =>
    {
        const startupFallback = ensureNonEmptyActivity(lastKnownGoodActivity || randomFallbackActivity());
        lastKnownGoodActivity = startupFallback;
        client.user.setActivity(startupFallback, { type: ActivityType.Watching });

        await setFreshActivity();
        if (activityRefreshTimer) {
            clearInterval(activityRefreshTimer);
        }
        activityRefreshTimer = setInterval(setFreshActivity, ACTIVITY_REFRESH_MS);
        console.log('Ready!');
        
        // Initialize scheduled removals with slight delay to ensure full client readiness
        setTimeout(() => {
            try {
                const removemeCommand = require('../commands/removeme');
                if (removemeCommand.initializeTimers) {
                    removemeCommand.initializeTimers(client);
                    console.log('[RemoveMe] Scheduled removals initialized');
                } else {
                    console.log('[RemoveMe] initializeTimers function not found');
                }
            } catch (err) {
                console.error('[RemoveMe] Error initializing scheduled removals:', err);
            }
        }, 1000);
    });
}
module.exports=onReady;