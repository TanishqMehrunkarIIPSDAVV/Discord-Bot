const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { EmbedBuilder, userMention, PermissionsBitField } = require("discord.js");

const messageLogs = () => {
  const cfgPath = path.join(__dirname, "..", "config.json");
  let cfg = {};
  try { cfg = require(cfgPath); } catch {}
  const logChannelId = process.env.MESSAGE_LOG_CHANNEL_ID || cfg.messageLogChannelId;

  client.on("messageDelete", async (message) => {
    try {
      // Try to resolve partials, but handle 10008 (Unknown Message) quietly
      if (message.partial) {
        try {
          await message.fetch();
        } catch (e) {
          if (e.code === 10008) {
            // This is normal for deleted messages – they no longer exist in the API.
            // If you don't even want this, you can remove this line entirely.
            // console.debug("messageLogs: can't fetch deleted partial message (10008)");
          } else {
            console.error("messageLogs: unexpected error while fetching partial message:", e);
          }
          // IMPORTANT: don't return here – still log whatever data we have
        }
      }

      if (!message.guild) return;
      if (message.author?.bot) return;

      if (!logChannelId) {
        console.warn("messageLogs: no log channel configured (MESSAGE_LOG_CHANNEL_ID or config.json.messageLogChannelId)");
        return;
      }

      const logChannel =
        message.guild.channels.cache.get(logChannelId) ||
        await client.channels.fetch(logChannelId).catch(() => null);

      if (!logChannel) {
        console.warn("messageLogs: log channel not found:", logChannelId);
        return;
      }

      const me = message.guild.members.me;
      if (!me) {
        console.warn("messageLogs: bot member not found in guild");
        return;
      }

      const perms = logChannel.permissionsFor(me);
      if (
        !perms ||
        !perms.has([
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.EmbedLinks
        ])
      ) {
        console.warn("messageLogs: missing permissions to post logs in channel");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("🗑️ Message Deleted")
        .setColor("#ED4245")
        .addFields(
          {
            name: "Author",
            value: message.author
              ? `${message.author.tag} (${userMention(message.author.id)})`
              : "*Unknown (partial / not cached)*",
            inline: true
          },
          {
            name: "Channel",
            value: message.channel
              ? `${message.channel} (${message.channel.id})`
              : "*Unknown channel*",
            inline: true
          },
          { name: "Message ID", value: message.id ?? "*Unknown*", inline: true }
        )
        .setTimestamp();

      const content = (message.content || "").trim();
      if (content) {
        embed.addFields({
          name: "Content",
          value: content.length > 1024 ? `${content.slice(0, 1021)}...` : content
        });
      } else {
        embed.addFields({
          name: "Content",
          value: "*No text content / not cached*"
        });
      }

      if (message.attachments && message.attachments.size > 0) {
        const urls = message.attachments.map((a) => a.url).join("\n");
        embed.addFields({
          name: "Attachments",
          value: urls.length > 1024 ? `${urls.slice(0, 1021)}...` : urls
        });
      }

      await logChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error("messageLogs error:", err);
    }
  });
};

module.exports = messageLogs;