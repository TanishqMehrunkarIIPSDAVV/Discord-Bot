const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, PermissionFlagsBits } = require("discord.js");

const unban = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith("ct unban")) return;

    const prefix = "ct";
    const parts = message.content.slice(prefix.length).trim().split(/ +/g);
    parts.shift(); // remove command name
    const targetArg = parts.shift();
    const reason = parts.join(" ") || "No reason provided";

    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply("You don't have permission to unban members.");
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.BanMembers)) {
      return message.reply("I don't have permission to unban members. Grant me Ban Members.");
    }

    if (!targetArg) return message.reply("Please provide a user ID or mention to unban.");

    // Extract ID if mention-like
    const id = targetArg.replace(/[^0-9]/g, "");
    if (!id) return message.reply("Please provide a valid user ID to unban.");

    try {
      await message.guild.members.unban(id, reason);
      message.channel.send(`${userMention(id)} has been unbanned. Reason: ${reason}`);
    } catch (err) {
      console.error("Unban error:", err);
      return message.reply("Failed to unban the user. Ensure the ID is banned and I have Ban Members permission.");
    }
  });
};

module.exports = unban;
