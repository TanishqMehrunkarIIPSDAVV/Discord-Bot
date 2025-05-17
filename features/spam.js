const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");

const messageTimestamps = new Map();
const messageContents = new Map();

const spam = () => {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;

        const now = Date.now();
        const userId = message.author.id;

        // Track timestamps
        if (!messageTimestamps.has(userId)) messageTimestamps.set(userId, []);
        const timestamps = messageTimestamps.get(userId);
        timestamps.push(now);

        // Track message contents
        if (!messageContents.has(userId)) messageContents.set(userId, []);
        const contents = messageContents.get(userId);
        contents.push(message.content);

        // Keep only last 10 seconds
        const filteredTimestamps = timestamps.filter(ts => now - ts < 10000);
        messageTimestamps.set(userId, filteredTimestamps);

        // Keep only last 6 messages
        if (contents.length > 6) contents.shift();
        messageContents.set(userId, contents);

        // Check for repeated content (e.g., 4+ identical messages in a row)
        const repeated = contents.length >= 4 && contents.slice(-4).every(c => c === contents[contents.length - 1]);

        // Check for too many messages in 10 seconds
        if (filteredTimestamps.length > 5 || repeated) {
            try {
                await message.member.timeout(60000, "Spamming detected");
                await message.channel.send(`${userMention(userId)} has been timed out for spamming.`);
            } catch (err) {
                console.error("Failed to timeout user:", err);
            }
            // Clear to avoid repeated timeouts
            messageTimestamps.set(userId, []);
            messageContents.set(userId, []);
        }
    });
};

module.exports = spam;