const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");

const messageTimestamps = new Map();

const spam = () => {
    client.on("messageCreate", async (message) =>
    {
        if (message.author.bot) return;

        const now = Date.now();
        const userId = message.author.id;

        if (!messageTimestamps.has(userId)) {
            messageTimestamps.set(userId, []);
        }

        // Add current timestamp
        const timestamps = messageTimestamps.get(userId);
        timestamps.push(now);

        // Keep only timestamps from the last 10 seconds
        const filtered = timestamps.filter(ts => now - ts < 10000);
        messageTimestamps.set(userId, filtered);

        if (filtered.length > 5) {
            // Timeout user for 60 seconds (60000 ms)
            try {
                await message.member.timeout(60000, "Spamming detected");
                await message.channel.send(`${userMention(userId)} has been timed out for spamming.`);
            } catch (err) {
                console.error("Failed to timeout user:", err);
            }
            // Clear timestamps to avoid repeated timeouts
            messageTimestamps.set(userId, []);
        }
    });
};

module.exports = spam;