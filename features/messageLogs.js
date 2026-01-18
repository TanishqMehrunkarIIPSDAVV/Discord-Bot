const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { EmbedBuilder, userMention, PermissionsBitField } = require("discord.js");

let registered = false;

const messageLogs = () => {
  // Prevent multiple registrations if this module is imported more than once
  if (registered) return;
  registered = true;
  const cfgPath = path.join(__dirname, "..", "config.json");
  let cfg = {};
  try { cfg = require(cfgPath); } catch {}
  // Prefer dedicated message-log channel; fall back to shared log channel if provided
  const logChannelId =
    process.env.MESSAGE_LOG_CHANNEL_ID ||
    process.env.MESSAGE_AUDIT_LOG_CHANNEL_ID ||
    cfg.messageLogChannelId;

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

      // Avoid logging deletions that happen inside the log channel itself (prevents recursion/spam)
      if (message.channelId === logChannelId) return;

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

      const createdTs = message.createdAt ? Math.floor(new Date(message.createdAt).getTime() / 1000) : null;
      const deletedTs = Math.floor(Date.now() / 1000);

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
          { name: "Message ID", value: message.id ?? "*Unknown*", inline: true },
          {
            name: "Created At",
            value: createdTs ? `<t:${createdTs}:F>` : "*Unknown*",
            inline: true
          },
          { name: "Deleted At", value: `<t:${deletedTs}:F>`, inline: true }
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
        const lines = message.attachments.map((a) => {
          const sizeLabel = typeof a.size === "number" ? `${(a.size / 1024).toFixed(1)} KB` : "size unknown";
          const name = a.name || "attachment";
          return `${name} (${sizeLabel}) → ${a.url}`;
        });
        const joined = lines.join("\n");
        embed.addFields({
          name: `Attachments (${message.attachments.size})`,
          value: joined.length > 1024 ? `${joined.slice(0, 1021)}...` : joined
        });
      }

      // Log to console for quick inspection
      const consolePayload = {
        guild: message.guild?.name,
        channel: message.channel?.name || message.channelId,
        authorTag: message.author?.tag,
        authorId: message.author?.id,
        messageId: message.id,
        createdAt: message.createdAt?.toISOString?.(),
        deletedAt: new Date(deletedTs * 1000).toISOString(),
        content: content ? (content.length > 200 ? `${content.slice(0, 197)}...` : content) : null,
        attachments: message.attachments?.map((a) => a.url) || []
      };
      console.log("[messageDelete]", consolePayload);

      await logChannel.send({ embeds: [embed] });
    } catch (err) {
      console.error("messageLogs error:", err);
    }
  });
};

module.exports = messageLogs;