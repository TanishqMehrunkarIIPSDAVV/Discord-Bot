const path=require("node:path");
const client=require(`${path.dirname(__dirname)}/index.js`);
const { ActivityType } = require("discord.js");
const MIN_ACTIVITY_REFRESH_MS = 60_000;
const MAX_ACTIVITY_REFRESH_MS = 120_000;
let activityRefreshTimer = null;
const MODERATORS = [
    { name: "Navya", id: "1358018305537085570" },
    { name: "Bella", id: "1462895979052269890" },
    { name: "Aditya", id: "508215254497624084" },
    { name: "Deep", id: "308232106562158593" },
    { name: "Dizzi", id: "936125585711845437" },
    { name: "Rave", id: "1217740773173235774" },
    { name: "Jay", id: "403132421765070848" },
    { name: "Sunny", id: "518458685471588386" },
    { name: "Rex", id: "443974289851678731" },
    { name: "Tanishq", id: "779206329813696522" },
    { name: "Oggy", id: "841202744298962944" },
    { name: "Hardik", id: "1156853369533648956"},
    { name: "Anushka", id: "798404080086941717"}
];

function randomModName() {
    if (!MODERATORS.length) return "Mod";
    const index = Math.floor(Math.random() * MODERATORS.length);
    return MODERATORS[index].name;
}

const activities = [
    { text: () => `${randomModName()} is guarding the tapri gate 🛡️`, type: ActivityType.Watching },
    { text: () => `${randomModName()} is carrying the mod queue today ⚡`, type: ActivityType.Playing },
    { text: () => `${randomModName()} is checking reports with chai ☕`, type: ActivityType.Listening },
    { text: () => `${randomModName()} is on meme patrol duty 👀`, type: ActivityType.Watching },
    { text: () => `${randomModName()} is cleaning the chat timeline 🧹`, type: ActivityType.Playing },
    { text: () => `${randomModName()} is handling pings like a pro 🎯`, type: ActivityType.Competing },
    { text: () => `${randomModName()} is reviewing mod tickets 📋`, type: ActivityType.Listening },
    { text: () => `${randomModName()} is running the tapri shift 🚀`, type: ActivityType.Playing },
    { text: () => `${randomModName()} is spotting rule breaks fast 🔍`, type: ActivityType.Watching },
    { text: () => `${randomModName()} is calming chaos with style 😎`, type: ActivityType.Listening },
    { text: () => `${randomModName()} is keeping the vibes wholesome ✨`, type: ActivityType.Playing },
    { text: () => `${randomModName()} is defending peace in chat 🤝`, type: ActivityType.Watching },
    { text: () => `${randomModName()} is listening for trouble pings 🎧`, type: ActivityType.Listening },
    { text: () => `${randomModName()} is in full moderator mode 🔥`, type: ActivityType.Playing },
    { text: () => `${randomModName()} is watching over Chai Tapri.exe 🌟`, type: ActivityType.Watching },
    { text: () => `${randomModName()} is building a safer community 🛠️`, type: ActivityType.Competing },
    { text: () => `${randomModName()} is checking mod logs right now 📚`, type: ActivityType.Listening },
    { text: () => `${randomModName()} is carrying team discipline 🎮`, type: ActivityType.Playing },
    { text: () => `${randomModName()} is patrolling channels nonstop 📈`, type: ActivityType.Watching },
    { text: () => `${randomModName()} is serving mod energy all day ☕`, type: ActivityType.Playing },
];

let activityIndex = 0;

function randomRefreshDelay() {
    return MIN_ACTIVITY_REFRESH_MS + Math.floor(Math.random() * (MAX_ACTIVITY_REFRESH_MS - MIN_ACTIVITY_REFRESH_MS + 1));
}

function pickNextActivity() {
    if (!activities.length) {
        return { text: "Serving fresh vibes ☕", type: ActivityType.Watching };
    }

    const activity = activities[activityIndex % activities.length];
    activityIndex = (activityIndex + 1) % activities.length;
    return {
        text: typeof activity.text === "function" ? activity.text() : activity.text,
        type: activity.type,
    };
}

function applyActivity(activity) {
    client.user.setActivity(activity.text, { type: activity.type });
    console.log(`[Presence] Activity updated: ${activity.text}`);
}

function scheduleNextActivityUpdate() {
    if (activityRefreshTimer) {
        clearTimeout(activityRefreshTimer);
    }

    activityRefreshTimer = setTimeout(() => {
        applyActivity(pickNextActivity());
        scheduleNextActivityUpdate();
    }, randomRefreshDelay());
}

const onReady=()=>
{
    client.once("clientReady", async () =>
    {
        applyActivity(pickNextActivity());
        scheduleNextActivityUpdate();
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