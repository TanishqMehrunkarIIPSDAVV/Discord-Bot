const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, PermissionFlagsBits } = require("discord.js");

const kick = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith("ct kick")) return;

    const prefix = "ct";
    const parts = message.content.slice(prefix.length).trim().split(/ +/g);
    parts.shift();
    const targetArg = parts.shift();
    const reason = parts.join(" ") || "No reason provided";

    // permission checks
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply("You don't have permission to kick members.");
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.KickMembers)) {
      return message.reply("I don't have permission to kick members. Give me the Kick Members permission.");
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(targetArg);
    if (!target) return message.reply("Please mention a user or provide their ID to kick.");

    if (target.id === message.member.id) return message.reply("You cannot kick yourself.");
    if (target.id === message.guild.ownerId) return message.reply("You cannot kick the server owner.");

    // role hierarchy checks
    if (message.member.roles.highest.position <= target.roles.highest.position && message.guild.ownerId !== message.member.id) {
      return message.reply("You cannot kick this user because they have an equal or higher role than you.");
    }
    if (message.guild.members.me.roles.highest.position <= target.roles.highest.position) {
      return message.reply("I cannot kick this user because their highest role is higher than mine.");
    }

    try {
      // try DMing the user (ignore failures)
      await target.send(`You have been kicked from **${message.guild.name}**.\nReason: ${reason}`).catch(() => null);
      message.channel.send(`${userMention(target.id)} has been kicked. Reason: ${reason}`);
      await target.kick({reason});
    } catch (err) {
      console.error("Kick error:", err);
      return message.reply("Failed to kick the user. Ensure my role is above theirs and I have Kick permission.");
    }
  });
};

module.exports = kick;