const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, PermissionFlagsBits } = require("discord.js");

const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord limit ~28 days

const parseMinutes = (raw) => {
  if (!raw) return 10;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.min(n, (MAX_TIMEOUT_MS / 60000) | 0);
  return 10;
};

const mute = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.content.toLowerCase().startsWith("ct mute")) return;

    const prefix = "ct";
    const parts = message.content.slice(prefix.length).trim().split(/ +/g);
    parts.shift(); // remove command name
    const targetArg = parts.shift();
    const minutesRaw = parts.shift();
    const reason = parts.join(" ") || "No reason provided";

    // permission checks
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply("You don't have permission to time out members.");
    }
    if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply("I don't have permission to time out members. Grant me Moderate Members.");
    }

    const target = message.mentions.members.first() || message.guild.members.cache.get(targetArg);
    if (!target) return message.reply("Please mention a user or provide their ID to mute.");

    // self/owner checks
    if (target.id === message.member.id) return message.reply("You cannot mute yourself.");
    if (target.id === message.guild.ownerId) return message.reply("You cannot mute the server owner.");

    // role hierarchy checks
    if (
      message.member.roles.highest.position <= target.roles.highest.position &&
      message.guild.ownerId !== message.member.id
    ) {
      return message.reply("You cannot mute this user because they have an equal or higher role than you.");
    }
    if (message.guild.members.me.roles.highest.position <= target.roles.highest.position) {
      return message.reply("I cannot mute this user because their highest role is higher than mine.");
    }

    const minutes = parseMinutes(minutesRaw);
    const durationMs = Math.min(minutes * 60 * 1000, MAX_TIMEOUT_MS);

    try {
      await target.send(
        `You have been muted in **${message.guild.name}** for ${minutes} minute(s).\nReason: ${reason}`
      ).catch(() => null);

      await target.timeout(durationMs, reason);
      message.channel.send(`${userMention(target.id)} has been muted for ${minutes} minute(s). Reason: ${reason}`);
    } catch (err) {
      console.error("Mute error:", err);
      return message.reply("Failed to mute the user. Ensure I have Moderate Members permission and my role is high enough.");
    }
  });
};

module.exports = mute;
