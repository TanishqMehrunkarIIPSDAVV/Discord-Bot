const fs = require("node:fs");
const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { PermissionFlagsBits, userMention } = require("discord.js");

const configPath = path.join(__dirname, "..", "config.json");

const loadConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch (err) {
    console.error("warn: failed to read config.json", err);
    return {};
  }
};

const saveConfig = (nextConfig) => {
  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
};

const resolveTargetMember = (message, arg) => {
  if (!arg) return null;
  return message.mentions.members.first() || message.guild.members.cache.get(arg.replace(/[<@!>]/g, "")) || null;
};

const ensureWarnStore = (cfg, guildId) => {
  if (!cfg.warnCounts || typeof cfg.warnCounts !== "object") cfg.warnCounts = {};
  if (!cfg.warnCounts[guildId] || typeof cfg.warnCounts[guildId] !== "object") cfg.warnCounts[guildId] = {};
  return cfg.warnCounts[guildId];
};

const warn = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    if (!lower.startsWith("ct warn") && !lower.startsWith("ct clearwarn")) return;

    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply("You need Moderate Members permission to use warn commands.");
    }

    const parts = content.split(/\s+/g);
    const command = (parts[1] || "").toLowerCase();
    if (command !== "warn" && command !== "clearwarn") return;
    const targetArg = parts[2];
    const reason = parts.slice(3).join(" ").trim() || "No reason provided";

    const target = resolveTargetMember(message, targetArg);
    if (!target) {
      return message.reply("Please mention a valid user or provide their ID.");
    }

    if (target.user.bot) {
      return message.reply("You cannot warn bot users.");
    }

    if (target.id === message.member.id) {
      return message.reply("You cannot warn yourself.");
    }

    if (target.roles.highest.position >= message.member.roles.highest.position) {
      return message.reply(
        `You cannot warn this user because their role is higher than or equal to your highest role.`
      );
    }

    try {
      const cfg = loadConfig();
      const guildWarns = ensureWarnStore(cfg, message.guild.id);

      if (command === "warn") {
        const current = Number(guildWarns[target.id] || 0);
        const next = current + 1;
        guildWarns[target.id] = next;
        saveConfig(cfg);

        await target
          .send(`You were warned in **${message.guild.name}**.\nReason: ${reason}\nTotal warns: ${next}`)
          .catch(() => null);

        return message.channel.send(
          `${userMention(target.id)} has been warned. They now have **${next}** warn${next === 1 ? "" : "s"}.`
        );
      }

      if (command === "clearwarn") {
        const current = Number(guildWarns[target.id] || 0);
        delete guildWarns[target.id];
        saveConfig(cfg);

        return message.channel.send(
          `${userMention(target.id)} had their warns cleared. Previous warns: **${current}**. Current warns: **0**.`
        );
      }
    } catch (err) {
      console.error("warn command error:", err);
      return message.reply("There was an error while updating warns.");
    }
  });
};

module.exports = warn;