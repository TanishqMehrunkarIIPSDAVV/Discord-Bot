const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, PermissionFlagsBits } = require("discord.js");

const ban = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith("op ban")) return;

    const prefix = "op";
    const parts = message.content.slice(prefix.length).trim().split(/ +/g);
    parts.shift();
    const targetArg = parts.shift();
    const reason = parts.join(" ") || "No reason provided";

    // permission checks
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply("You don't have permission to ban members.");
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply("I don't have permission to ban members. Give me the Ban Members permission.");
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(targetArg);
    if (!target) return message.reply("Please mention a user or provide their ID to ban.");

    if (target.id === message.member.id) return message.reply("You cannot ban yourself.");
    if (target.id === message.guild.ownerId) return message.reply("You cannot ban the server owner.");

    // role hierarchy checks
    if (message.member.roles.highest.position <= target.roles.highest.position && message.guild.ownerId !== message.member.id) {
      return message.reply("You cannot ban this user because they have an equal or higher role than you.");
    }
    if (message.guild.members.me.roles.highest.position <= target.roles.highest.position) {
      return message.reply("I cannot ban this user because their highest role is higher than mine.");
    }

    try {
      // try DMing the user (ignore failures)
      await target.send(`You have been banned from **${message.guild.name}**.\nReason: ${reason}`).catch(() => null);
      message.channel.send(`${userMention(target.id)} has been banned. Reason: ${reason}`);
      await target.ban({reason});
    } catch (err) {
      console.error("Ban error:", err);
      return message.reply("Failed to ban the user. Ensure my role is above theirs and I have Ban permission.");
    }
  });
};

module.exports = ban;