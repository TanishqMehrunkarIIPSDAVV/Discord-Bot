const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, PermissionFlagsBits } = require("discord.js");

const unmute = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith("ct unmute")) return;

    const prefix = "ct";
    const parts = message.content.slice(prefix.length).trim().split(/ +/g);
    parts.shift(); // remove command name
    const targetArg = parts.shift();
    const reason = parts.join(" ") || "No reason provided";

    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply("You don't have permission to unmute members.");
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply("I don't have permission to unmute members. Grant me Moderate Members.");
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(targetArg);
    if (!target) return message.reply("Please mention a user or provide their ID to unmute.");

    if (target.id === message.guild.ownerId) return message.reply("You cannot unmute the server owner.");

    // hierarchy checks
    if (
      message.member.roles.highest.position <= target.roles.highest.position &&
      message.guild.ownerId !== message.member.id
    ) {
      return message.reply("You cannot unmute this user because they have an equal or higher role than you.");
    }
    if (message.guild.members.me.roles.highest.position <= target.roles.highest.position) {
      return message.reply("I cannot unmute this user because their highest role is higher than mine.");
    }

    try {
      await target.timeout(null, reason); // clears timeout
      message.channel.send(`${userMention(target.id)} has been unmuted. Reason: ${reason}`);
    } catch (err) {
      console.error("Unmute error:", err);
      return message.reply("Failed to unmute the user. Ensure I have Moderate Members permission and my role is high enough.");
    }
  });
};

module.exports = unmute;
