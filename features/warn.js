const fs = require("node:fs");
const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  PermissionFlagsBits,
  userMention,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");
const { createCase } = require("../utils/caseStore");

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

const resolveTargetMember = async (message, arg) => {
  if (!arg) return null;
  const cleaned = arg.replace(/[<@!>]/g, "");
  const mentioned = message.mentions.members.first();
  if (mentioned) return mentioned;

  const cached = message.guild.members.cache.get(cleaned);
  if (cached) return cached;

  return message.guild.members.fetch(cleaned).catch(() => null);
};

const normalizeUserId = (raw) => (raw || "").replace(/[<@!>]/g, "").trim();

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
    if (
      !lower.startsWith("ct warn") &&
      !lower.startsWith("ct clearwarn") &&
      !lower.startsWith("ct warninfo") &&
      !lower.startsWith("ct warnings")
    ) {
      return;
    }

    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply("You need Moderate Members permission to use warn commands.");
    }

    const parts = content.split(/\s+/g);
    const command = (parts[1] || "").toLowerCase();
    if (command !== "warn" && command !== "clearwarn" && command !== "warninfo" && command !== "warnings") return;

    try {
      const cfg = loadConfig();
      const guildWarns = ensureWarnStore(cfg, message.guild.id);

      if (command === "warnings") {
        const entries = Object.entries(guildWarns)
          .map(([userId, count]) => [userId, Number(count) || 0])
          .filter(([, count]) => count > 0)
          .sort((a, b) => b[1] - a[1]);

        if (!entries.length) {
          return message.reply("No users currently have warns in this server.");
        }

        const perPage = 10;
        const totalPages = Math.ceil(entries.length / perPage);
        let page = 0;

        const buildWarningsEmbed = (pageIndex) => {
          const start = pageIndex * perPage;
          const chunk = entries.slice(start, start + perPage);
          const lines = chunk.map(([userId, count], index) => {
            const serial = start + index + 1;
            return `${serial}. ${userMention(userId)} - **${count}** warn${count === 1 ? "" : "s"}`;
          });

          return new EmbedBuilder()
            .setColor("#5865F2")
            .setTitle(`Warn List (${entries.length})`)
            .setDescription(lines.join("\n"))
            .setFooter({ text: `Page ${pageIndex + 1}/${totalPages}` });
        };

        const buildWarningsRow = (pageIndex, disabled = false) =>
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("warnings_prev")
              .setLabel("⏮️ Previous")
              .setStyle(ButtonStyle.Secondary)
              .setDisabled(disabled || pageIndex === 0),
            new ButtonBuilder()
              .setCustomId("warnings_next")
              .setLabel("Next ⏭️")
              .setStyle(ButtonStyle.Primary)
              .setDisabled(disabled || pageIndex >= totalPages - 1),
            new ButtonBuilder()
              .setCustomId("warnings_close")
              .setLabel("❌ Close")
              .setStyle(ButtonStyle.Danger)
              .setDisabled(disabled)
          );

        const sent = await message.channel.send({
          embeds: [buildWarningsEmbed(page)],
          components: [buildWarningsRow(page)],
        });
        let closed = false;

        if (totalPages <= 1) {
          return;
        }

        const collector = sent.createMessageComponentCollector({ time: 120000 });

        collector.on("collect", async (interaction) => {
          if (interaction.user.id !== message.author.id) {
            return interaction.reply({ content: "Only you can use these buttons.", ephemeral: true });
          }

          if (interaction.customId === "warnings_close") {
            closed = true;
            collector.stop();
            return interaction.update({ components: [] });
          }

          if (interaction.customId === "warnings_prev" && page > 0) page -= 1;
          if (interaction.customId === "warnings_next" && page < totalPages - 1) page += 1;

          return interaction.update({
            embeds: [buildWarningsEmbed(page)],
            components: [buildWarningsRow(page)],
          });
        });

        collector.on("end", async () => {
          if (closed) return;
          try {
            await sent.edit({ components: [buildWarningsRow(page, true)] });
          } catch {}
        });

        return;
      }

      const targetArg = parts[2];
      const normalizedTargetId = normalizeUserId(targetArg);

      if (command === "warninfo") {
        if (!targetArg) {
          return message.reply("Please mention a user or provide their ID.");
        }

        const targetMember = await resolveTargetMember(message, targetArg);
        const targetId = targetMember?.id || normalizedTargetId;

        if (!targetId) {
          return message.reply("Please mention a valid user or provide their ID.");
        }

        const current = Number(guildWarns[targetId] || 0);
        return message.channel.send(
          `${userMention(targetId)} currently has **${current}** warn${current === 1 ? "" : "s"}.`
        );
      }

      const reason = parts.slice(3).join(" ").trim() || "No reason provided";
      const target = await resolveTargetMember(message, targetArg);
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

      if (command === "warn") {
        const current = Number(guildWarns[target.id] || 0);
        const next = current + 1;
        guildWarns[target.id] = next;
        saveConfig(cfg);

        createCase({
          guildId: message.guild.id,
          type: "warn",
          actorId: message.author.id,
          targetUserId: target.id,
          reason,
          details: { warnsAfter: next },
        });

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

        createCase({
          guildId: message.guild.id,
          type: "clearwarn",
          actorId: message.author.id,
          targetUserId: target.id,
          reason: "Warns cleared",
          details: { previousWarns: current },
        });

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