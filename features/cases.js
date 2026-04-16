const path = require("node:path");
const {
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  userMention,
} = require("discord.js");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { getGuildCases, getCaseById } = require("../utils/caseStore");

const CASES_PER_PAGE = 8;

const normalizeId = (value) => (value || "").replace(/[<@!>]/g, "").trim();
const normalizeType = (value) => (value || "").trim().toLowerCase();

const formatTs = (value) => {
  const time = Number(value || 0);
  if (!Number.isFinite(time) || time <= 0) return "Unknown";
  return `<t:${Math.floor(time / 1000)}:F>`;
};

const buildCaseDetails = (entry) => {
  const detailEntries = Object.entries(entry.details || {});
  if (!detailEntries.length) return "None";
  const lines = detailEntries.slice(0, 10).map(([key, val]) => `• **${key}**: ${String(val)}`);
  if (detailEntries.length > 10) lines.push(`• ...and ${detailEntries.length - 10} more`);
  const text = lines.join("\n");
  return text.length > 1024 ? `${text.slice(0, 1021)}...` : text;
};

const buildCaseEmbed = (entry) =>
  new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle(`Case #${entry.id}`)
    .addFields(
      { name: "Type", value: entry.type, inline: true },
      { name: "Target", value: entry.targetUserId ? userMention(entry.targetUserId) : "Unknown", inline: true },
      { name: "Moderator", value: entry.actorId ? userMention(entry.actorId) : "System", inline: true },
      { name: "Reason", value: entry.reason || "No reason provided" },
      { name: "Created", value: formatTs(entry.createdAt), inline: true },
      { name: "Details", value: buildCaseDetails(entry) }
    );

const buildCasesEmbed = (items, page, totalPages, header) => {
  const start = page * CASES_PER_PAGE;
  const chunk = items.slice(start, start + CASES_PER_PAGE);
  const lines = chunk.map((entry, index) => {
    const serial = start + index + 1;
    const target = entry.targetUserId ? userMention(entry.targetUserId) : "Unknown";
    return `${serial}. **#${entry.id}** • ${entry.type} • ${target} • <t:${Math.floor(Number(entry.createdAt) / 1000)}:R>`;
  });

  return new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle(header)
    .setDescription(lines.join("\n") || "No cases found.")
    .setFooter({ text: `Page ${page + 1}/${totalPages}` });
};

const buildRow = (page, totalPages, disabled = false) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("cases_prev")
      .setLabel("⏮️ Previous")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabled || page <= 0),
    new ButtonBuilder()
      .setCustomId("cases_next")
      .setLabel("Next ⏭️")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabled || page >= totalPages - 1),
    new ButtonBuilder()
      .setCustomId("cases_close")
      .setLabel("❌ Close")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );

const cases = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const lower = message.content.toLowerCase().trim();
    if (!lower.startsWith("ct case") && !lower.startsWith("ct cases")) return;

    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply("You need Administrator permission to use case commands.");
    }

    const parts = message.content.trim().split(/\s+/g);
    const command = (parts[1] || "").toLowerCase();

    if (command === "case") {
      const arg = parts[2];
      if (!arg) {
        const latest = getGuildCases(message.guild.id).sort((a, b) => Number(b.id) - Number(a.id))[0];
        if (!latest) return message.reply("No cases found.");
        return message.channel.send({ embeds: [buildCaseEmbed(latest)] });
      }

      const numericId = Number(arg);
      if (Number.isFinite(numericId) && String(numericId) === arg) {
        const entry = getCaseById(message.guild.id, numericId);
        if (entry) {
          return message.channel.send({ embeds: [buildCaseEmbed(entry)] });
        }
      }

      const targetId = normalizeId(arg);
      if (!targetId) {
        return message.reply("Please provide a valid case ID or user mention/ID.");
      }

      const latest = getGuildCases(message.guild.id)
        .filter((entry) => entry.targetUserId === targetId)
        .sort((a, b) => Number(b.id) - Number(a.id))[0];

      if (!latest) {
        return message.reply(`No case found for ${userMention(targetId)}.`);
      }

      return message.channel.send({ embeds: [buildCaseEmbed(latest)] });
    }

    if (command === "cases") {
      const args = parts.slice(2);
      let targetId = "";
      let typeFilter = "";
      let moderatorId = "";

      for (const rawArg of args) {
        const lowerArg = rawArg.toLowerCase();
        if (lowerArg.startsWith("type:")) {
          typeFilter = normalizeType(rawArg.slice(5));
          continue;
        }

        if (lowerArg.startsWith("moderator:") || lowerArg.startsWith("mod:")) {
          const value = rawArg.includes(":") ? rawArg.slice(rawArg.indexOf(":") + 1) : "";
          moderatorId = normalizeId(value);
          continue;
        }

        if (!targetId) {
          targetId = normalizeId(rawArg);
        }
      }

      const allCases = getGuildCases(message.guild.id).sort((a, b) => Number(b.id) - Number(a.id));

      const filtered = allCases.filter((entry) => {
        if (targetId && entry.targetUserId !== targetId) return false;
        if (typeFilter && normalizeType(entry.type) !== typeFilter) return false;
        if (moderatorId && entry.actorId !== moderatorId) return false;
        return true;
      });

      if (!filtered.length) {
        const filters = [];
        if (targetId) filters.push(`target ${userMention(targetId)}`);
        if (typeFilter) filters.push(`type **${typeFilter}**`);
        if (moderatorId) filters.push(`moderator ${userMention(moderatorId)}`);
        return message.reply(filters.length ? `No cases found for ${filters.join(", ")}.` : "No cases found.");
      }

      let page = 0;
      const totalPages = Math.ceil(filtered.length / CASES_PER_PAGE);
      const headerParts = [];
      if (targetId) headerParts.push(`Target: ${userMention(targetId)}`);
      if (typeFilter) headerParts.push(`Type: ${typeFilter}`);
      if (moderatorId) headerParts.push(`Moderator: ${userMention(moderatorId)}`);
      const header = headerParts.length
        ? `Cases (${filtered.length}) • ${headerParts.join(" • ")}`
        : `All Cases (${filtered.length})`;

      const sent = await message.channel.send({
        embeds: [buildCasesEmbed(filtered, page, totalPages, header)],
        components: [buildRow(page, totalPages)],
      });
      let closed = false;

      if (totalPages <= 1) return;

      const collector = sent.createMessageComponentCollector({ time: 120000 });
      collector.on("collect", async (interaction) => {
        if (interaction.user.id !== message.author.id) {
          return interaction.reply({ content: "Only you can use these buttons.", flags: 64 });
        }

        if (interaction.customId === "cases_close") {
          closed = true;
          collector.stop();
          return interaction.update({ components: [] });
        }

        if (interaction.customId === "cases_prev" && page > 0) page -= 1;
        if (interaction.customId === "cases_next" && page < totalPages - 1) page += 1;

        return interaction.update({
          embeds: [buildCasesEmbed(filtered, page, totalPages, header)],
          components: [buildRow(page, totalPages)],
        });
      });

      collector.on("end", async () => {
        if (closed) return;
        try {
          await sent.edit({ components: [buildRow(page, totalPages, true)] });
        } catch {}
      });
    }
  });
};

module.exports = cases;
