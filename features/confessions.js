const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { EmbedBuilder, PermissionsBitField } = require("discord.js");

let registered = false;

const confessions = () => {
  if (registered) return;
  registered = true;

  const cfgPath = path.join(__dirname, "..", "config.json");
  let cfg = {};
  try {
    cfg = require(cfgPath);
  } catch {}

  const inputChannelId =
    process.env.CONFESSION_INPUT_CHANNEL_ID || cfg.confessionInputChannelId;
  const outputChannelId =
    process.env.CONFESSION_OUTPUT_CHANNEL_ID || cfg.confessionOutputChannelId;

  client.on("messageCreate", async (message) => {
    try {
      if (!message.guild) return;
      if (message.author?.bot) return;
      if (!inputChannelId || !outputChannelId) return;
      if (message.channelId !== inputChannelId) return;

      const outputChannel =
        message.guild.channels.cache.get(outputChannelId) ||
        (await client.channels.fetch(outputChannelId).catch(() => null));

      if (!outputChannel) {
        console.warn("confessions: output channel not found:", outputChannelId);
        return;
      }

      const me = message.guild.members.me;
      const perms = outputChannel.permissionsFor(me);
      if (
        !perms ||
        !perms.has([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks
        ])
      ) {
        console.warn("confessions: missing permissions to post in output channel");
        return;
      }

      const content = (message.content || "").trim();
      const attachments = message.attachments?.map((a) => a.url) || [];

      if (!content && attachments.length === 0) {
        await message.delete().catch(() => {});
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Anonymous Confession")
        .setColor("#F4C16D")
        .setTimestamp();

      if (content) {
        embed.setDescription(content.length > 4000 ? `${content.slice(0, 3997)}...` : content);
      }

      if (attachments.length > 0) {
        const filesList = attachments.join("\n");
        embed.addFields({
          name: `Attachments (${attachments.length})`,
          value: filesList.length > 1024 ? `${filesList.slice(0, 1021)}...` : filesList
        });
      }

      await outputChannel.send({ embeds: [embed] });
      await message.delete().catch(() => {});
    } catch (err) {
      console.error("confessions error:", err);
    }
  });
};

module.exports = confessions;
