const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");

let registered = false;

const toUploadFile = async (attachment, index) => {
  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to download attachment: ${attachment.url}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const rawName = attachment.name || (() => {
    try {
      const pathname = new URL(attachment.url).pathname;
      const fromUrl = pathname.split("/").pop();
      return fromUrl ? decodeURIComponent(fromUrl) : "";
    } catch {
      return "";
    }
  })();

  let fileName = rawName || `attachment-${index + 1}`;
  if (!fileName.includes(".")) {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("image/gif")) fileName += ".gif";
    else if (contentType.includes("image/png")) fileName += ".png";
    else if (contentType.includes("image/jpeg")) fileName += ".jpg";
    else if (contentType.includes("video/mp4")) fileName += ".mp4";
  }

  return {
    attachment: Buffer.from(arrayBuffer),
    name: fileName,
  };
};

const getEmbedMediaUrls = (embeds) => {
  const urls = [];
  for (const embed of embeds || []) {
    // Pick one best media URL per embed to avoid preview-image + video duplicates.
    const imageUrl = embed?.image?.url;
    const videoUrl = embed?.video?.url;
    const pageUrl = embed?.url;

    const isGifUrl = (url) => typeof url === "string" && /\.gif(\?|$)/i.test(url);

    if (isGifUrl(imageUrl)) {
      urls.push(imageUrl);
      continue;
    }

    if (embed?.type === "gifv") {
      if (isGifUrl(pageUrl)) {
        urls.push(pageUrl);
      } else if (videoUrl) {
        urls.push(videoUrl);
      } else if (imageUrl) {
        urls.push(imageUrl);
      }
      continue;
    }

    if (videoUrl) {
      urls.push(videoUrl);
      continue;
    }

    if (imageUrl) {
      urls.push(imageUrl);
      continue;
    }

    if (embed?.thumbnail?.url) {
      urls.push(embed.thumbnail.url);
    }
  }
  return [...new Set(urls)];
};

const toUploadFileFromUrl = async (url, index) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download embed media: ${url}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = (response.headers.get("content-type") || "").toLowerCase();
  let ext = "bin";

  try {
    const pathname = new URL(url).pathname;
    const last = pathname.split("/").pop() || "";
    const dot = last.lastIndexOf(".");
    if (dot > -1 && dot < last.length - 1) {
      ext = last.slice(dot + 1).toLowerCase();
    }
  } catch {}

  if (ext === "bin") {
    if (contentType.includes("image/gif")) ext = "gif";
    else if (contentType.includes("image/png")) ext = "png";
    else if (contentType.includes("image/jpeg")) ext = "jpg";
    else if (contentType.includes("image/webp")) ext = "webp";
    else if (contentType.includes("video/mp4")) ext = "mp4";
    else if (contentType.includes("video/webm")) ext = "webm";
    else if (contentType.includes("video/quicktime")) ext = "mov";
  }

  return {
    attachment: Buffer.from(arrayBuffer),
    name: `embed-media-${index + 1}.${ext}`,
  };
};

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
  const adminChannelId =
    process.env.CONFESSION_ADMIN_CHANNEL_ID || cfg.confessionAdminChannelId;

  // Send button message to input channel when bot starts
  client.on("clientReady", async () => {
    try {
      if (!inputChannelId) return;

      const channel = await client.channels
        .fetch(inputChannelId)
        .catch(() => null);
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setTitle("📝 Share Your Confession")
        .setDescription(
          "Click the button below to write an anonymous confession. I will DM you a form to submit your confession privately."
        )
        .setColor("#F4C16D");

      const button = new ButtonBuilder()
        .setCustomId("create_confession_channel")
        .setLabel("Write Confession")
        .setStyle(ButtonStyle.Primary);

      const row = new ActionRowBuilder().addComponents(button);

      // Check if button message already exists
      const messages = await channel.messages
        .fetch({ limit: 10 })
        .catch(() => []);
      const confessionMessage = messages.find(
        (m) =>
          m.author.id === client.user.id &&
          m.components.some((c) =>
            c.components.some((btn) => btn.customId === "create_confession_channel")
          )
      );

      if (!confessionMessage) {
        await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
      }
    } catch (err) {
      // Silent error handling
    }
  });

  // Handle button click
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== "create_confession_channel") return;

    try {
      const user = interaction.user;

      // Defer reply
      await interaction.deferReply({ ephemeral: true });

      // Send DM to user
      const dmChannel = await user.createDM().catch(() => null);
      if (!dmChannel) {
        await interaction.editReply({
          content: "❌ I couldn't open a DM with you. Please check your privacy settings:\n\n" +
                   "**How to enable DMs from this bot:**\n" +
                   "1. Open your Discord User Settings\n" +
                   "2. Go to **Privacy & Safety**\n" +
                   "3. Enable **Allow direct messages from server members**\n" +
                   "4. Then try again!",
        });
        return;
      }

      // Send welcome message in DM
      const welcomeEmbed = new EmbedBuilder()
        .setTitle("📝 Write Your Confession")
        .setDescription(
          "Send your confession below. Your message will be posted anonymously to the confessions channel. You have 5 minutes to submit."
        )
        .setColor("#F4C16D");

      await dmChannel.send({ embeds: [welcomeEmbed] });

      // Notify user in guild
      const successEmbed = new EmbedBuilder()
        .setTitle("✅ Check Your DMs")
        .setDescription("I've sent you a DM to write your confession. Please check your messages!")
        .setColor("#F4C16D");

      await interaction.editReply({
        embeds: [successEmbed],
      });

      // Listen for confession message using direct messageCreate event
      let timeoutId;
      let messageProcessed = false;

      const handleConfessionMessage = async (msg) => {
        // Filter: must be from this user, in DM, and not a bot
        if (msg.author.id !== user.id || msg.author.bot || !msg.channel.isDMBased()) {
          return;
        }

        // Prevent processing multiple messages
        if (messageProcessed) return;
        messageProcessed = true;

        // Stop listening immediately after first message
        client.removeListener("messageCreate", handleConfessionMessage);
        if (timeoutId) clearTimeout(timeoutId);

        try {
          const content = (msg.content || "").trim();
          const attachments = [...(msg.attachments?.values() || [])];
          const embedMediaUrls = attachments.length > 0 ? [] : getEmbedMediaUrls(msg.embeds || []);

          const attachmentFiles = await Promise.all(
            attachments.slice(0, 10).map((a, i) => toUploadFile(a, i))
          );

          const remainingSlots = Math.max(0, 10 - attachmentFiles.length);
          const embedMediaFiles = await Promise.all(
            embedMediaUrls.slice(0, remainingSlots).map((url, i) => toUploadFileFromUrl(url, i))
          );
          const incomingEmbeds = (msg.embeds || []).slice(0, 9);

          if (!content && attachments.length === 0 && incomingEmbeds.length === 0) {
            await dmChannel.send("❌ Your message was empty.").catch(() => {});
            return;
          }

          if (!outputChannelId) {
            await dmChannel.send("❌ System not configured.").catch(() => {});
            return;
          }

          const outputChannel = await client.channels.fetch(outputChannelId).catch(() => null);

          if (!outputChannel) {
            await dmChannel.send("❌ Could not post your confession. Please contact an admin.").catch(() => {});
            return;
          }

          const embed = new EmbedBuilder()
            .setTitle("Anonymous Confession")
            .setColor("#F4C16D")
            .setTimestamp();

          if (content) {
            embed.setDescription(content.length > 4000 ? content.slice(0, 3997) + "..." : content);
          }

          if (attachments.length > 0) {
            embed.addFields({
              name: `Attachments (${attachments.length})`,
              value: "Included below as files.",
            });
          }

          await outputChannel.send({
            embeds: [embed],
            files: [...attachmentFiles, ...embedMediaFiles],
          }).catch(() => {
            throw new Error("Failed to send confession");
          });

          // Send to admin channel
          if (adminChannelId) {
            const adminChannel = await client.channels.fetch(adminChannelId).catch(() => null);
            if (adminChannel) {
              const adminEmbed = new EmbedBuilder()
                .setTitle("📋 Confession Report (Admin)")
                .setColor("#FF6B6B")
                .addFields(
                  { name: "User", value: `${user.tag} (${user.id})`, inline: false },
                  { name: "Content", value: content.length > 1024 ? content.slice(0, 1021) + "..." : content || "*No text*", inline: false },
                  { name: "Embeds", value: String(incomingEmbeds.length), inline: true }
                )
                .setTimestamp();

              if (attachments.length > 0) {
                adminEmbed.addFields({
                  name: `Attachments (${attachments.length})`,
                  value: attachments.map((a) => a.url).join("\n"),
                });
              }

              await adminChannel.send({ embeds: [adminEmbed] }).catch(() => {});
            }
          }

          await dmChannel.send("✅ Your confession has been posted successfully!").catch(() => {});
        } catch (err) {
          await dmChannel.send("❌ An error occurred while posting your confession.").catch(() => {});
        }
      };

      // Register the listener
      client.on("messageCreate", handleConfessionMessage);

      // Auto cleanup after 5 minutes
      timeoutId = setTimeout(() => {
        if (messageProcessed) return;
        client.removeListener("messageCreate", handleConfessionMessage);
        dmChannel.send("⏰ Session expired. You took too long to submit your confession.").catch(() => {});
      }, 5 * 60 * 1000);
    } catch (err) {
      await interaction
        .editReply({
          content:
            "Failed to start confession process. Please try again.",
        })
        .catch(() => {});
    }
  });
};

module.exports = confessions;
