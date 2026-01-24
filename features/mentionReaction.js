const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);

const TARGET_USER_ID_1 = "779206329813696522";
const TARGET_USER_ID_2 = "1462895979052269890";

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
        if (repliedMessage.author.id === TARGET_USER_ID_1 || repliedMessage.author.id === TARGET_USER_ID_2) return;
      } catch (err) {
        console.error("Failed to fetch replied message:", err);
      }
    }

    // React only if the user is directly mentioned (not via role)
    if (message.mentions.users.has(TARGET_USER_ID_1)) {
      try {
        await message.react("🍭");
      } catch (error) {
        console.error("Error reacting to mention:", error);
      }
    }
    else if (message.mentions.users.has(TARGET_USER_ID_2)) {
      try {
        await message.react("<:Bella_wink:1443660540667760660>");
      } catch (error) {
        console.error("Error reacting to mention:", error);
      }
    }
  });
};

module.exports = mentionReaction;
