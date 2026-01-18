const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);

const TARGET_USER_ID = "779206329813696522";

const mentionReaction = () => {
  client.on("messageCreate", async (message) => {
    // Ignore bots
    if (message.author.bot) return;

    // If message is a reply, fetch the original message
    if (message.reference?.messageId) {
      try {
        const repliedMessage = await message.channel.messages.fetch(
          message.reference.messageId
        );

        // Ignore replies to the target user
        if (repliedMessage.author.id === TARGET_USER_ID) return;
      } catch (err) {
        console.error("Failed to fetch replied message:", err);
      }
    }

    // React only if the bot is mentioned
    if (message.mentions.has(TARGET_USER_ID)) {
      try {
        await message.react("🍭");
      } catch (error) {
        console.error("Error reacting to mention:", error);
      }
    }
  });
};

module.exports = mentionReaction;
