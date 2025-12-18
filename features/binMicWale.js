const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");

const binMicWale = () => {
    client.on("messageCreate", async (message) => {
        if (message.content.toLowerCase().startsWith("ct vc")) {
            const userVC = message.member.voice.channel;
            if (!userVC) {
                return message.reply("You are not in a voice channel!");
            }
            // Ping all users in the same VC except the message author
            const mentions = userVC.members
                .filter(member => member.id !== message.member.id)
                .map(member => userMention(member.id))
                .join(" ");
            if (mentions.length === 0) {
                return message.reply("No one else is in your voice channel.");
            }
            message.channel.send(mentions);
        }
    });
};

module.exports = binMicWale;