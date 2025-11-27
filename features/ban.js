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

    // Get target (mention OR ID)
    const target = message.mentions.members.first();
    const targetId = target ? target.id : targetArg;

    if (!targetId) return message.reply("Please mention a user or provide a user ID.");

    // Cannot ban yourself or server owner
    if (targetId === message.member.id) return message.reply("You cannot ban yourself.");
    if (targetId === message.guild.ownerId) return message.reply("You cannot ban the server owner.");

    // If user is in server, check role hierarchy
    let memberInGuild = message.guild.members.cache.get(targetId);

    if (memberInGuild) {
      if (
        message.member.roles.highest.position <= memberInGuild.roles.highest.position &&
        message.guild.ownerId !== message.member.id
      ) {
        return message.reply("You cannot ban this user because they have an equal or higher role than you.");
      }
      if (
        message.guild.members.me.roles.highest.position <= memberInGuild.roles.highest.position
      ) {
        return message.reply("I cannot ban this user because their highest role is higher than mine.");
      }
    }

    try {
      // DM only if user is in server
      if (memberInGuild) {
        await memberInGuild.send(
          `You have been banned from **${message.guild.name}**.\nReason: ${reason}`
        ).catch(() => null);
      }

      // Ban user by ID directly
      await message.guild.members.ban(targetId, { reason });

      message.channel.send(`${userMention(targetId)} has been banned. Reason: ${reason}`);
    } catch (err) {
      console.error("Ban error:", err);
      return message.reply("Failed to ban the user. Make sure the ID is correct and I have permission.");
    }
  });
};

module.exports = ban;
