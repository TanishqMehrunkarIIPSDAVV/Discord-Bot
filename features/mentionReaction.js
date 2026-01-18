const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);

const mentionReaction = () => {
    client.on("messageCreate", async (message) => {
        // Ignore messages from bots
        if (message.author.bot) return;

        // Check if the message mentions the bot
        if (message.mentions.has("779206329813696522")) {
            try {
                // React with an emoji (you can change this emoji)
                await message.react('🍭');
            } catch (error) {
                console.error('Error reacting to mention:', error);
            }
        }
    });
};

module.exports = mentionReaction;
