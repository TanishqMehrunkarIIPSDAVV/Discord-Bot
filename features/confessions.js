const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} = require("discord.js");

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
  const adminChannelId =
    process.env.CONFESSION_ADMIN_CHANNEL_ID || cfg.confessionAdminChannelId;

  // Send button message to input channel when bot starts
  client.on("clientReady", async () => {
    try {
      if (!inputChannelId) return;

      const channel = await client.channels
        .fetch(inputChannelId)
        .catch(() => null);
      if (!channel) {
        console.warn("confessions: input channel not found:", inputChannelId);
        return;
      }

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
      console.error("confessions ready error:", err);
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
      const handleConfessionMessage = async (msg) => {
        // Filter: must be from this user, in DM, and not a bot
        if (msg.author.id !== user.id || msg.author.bot || !msg.channel.isDMBased()) {
          return;
        }

        console.log("✅ MESSAGE RECEIVED in DM from", user.tag, "content:", msg.content.substring(0, 50));

        // Remove this listener
        client.removeListener("messageCreate", handleConfessionMessage);

        try {
          const content = (msg.content || "").trim();
          const attachments = msg.attachments?.map((a) => a.url) || [];

          console.log("📝 Content length:", content.length, "Attachments:", attachments.length);

          if (!content && attachments.length === 0) {
            console.log("❌ Empty message");
            await dmChannel.send("Your message was empty.").catch(console.error);
            return;
          }

          if (!outputChannelId) {
            console.error("❌ NO OUTPUT CHANNEL ID SET");
            await dmChannel.send("❌ System not configured").catch(console.error);
            return;
          }

          console.log("🔍 Fetching output channel:", outputChannelId);
          const outputChannel = await client.channels.fetch(outputChannelId).catch((err) => {
            console.error("❌ FAILED TO FETCH CHANNEL:", err.message);
            return null;
          });

          if (!outputChannel) {
            console.error("❌ CHANNEL NOT FOUND:", outputChannelId);
            await dmChannel.send("❌ Channel not found: " + outputChannelId).catch(console.error);
            return;
          }

          console.log("✅ Channel fetched successfully");

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
              value: attachments.join("\n"),
            });
          }

          console.log("📤 SENDING MESSAGE TO CHANNEL:", outputChannelId);
          const sentMsg = await outputChannel.send({ embeds: [embed] }).catch((err) => {
            console.error("❌ FAILED TO SEND MESSAGE:", err.message);
            throw err;
          });
          console.log("✅✅✅ MESSAGE SENT SUCCESSFULLY! ID:", sentMsg.id);

          // Send to admin channel
          if (adminChannelId) {
            try {
              console.log("📋 Sending to admin channel:", adminChannelId);
              const adminChannel = await client.channels.fetch(adminChannelId).catch(() => null);
              if (adminChannel) {
                const adminEmbed = new EmbedBuilder()
                  .setTitle("📋 Confession Report (Admin)")
                  .setColor("#FF6B6B")
                  .addFields(
                    { name: "User", value: `${user.tag} (${user.id})`, inline: false },
                    { name: "Content", value: content || "*No text*", inline: false }
                  )
                  .setTimestamp();

                await adminChannel.send({ embeds: [adminEmbed] }).catch(console.error);
                console.log("✅ Admin notification sent");
              }
            } catch (e) {
              console.error("❌ Admin notify error:", e.message);
            }
          }

          await dmChannel.send("✅ Your confession has been posted!").catch(console.error);
        } catch (err) {
          console.error("❌ PROCESSING ERROR:", err.message);
          await dmChannel.send("❌ Error: " + err.message).catch(console.error);
        }
      };

      // Register the listener
      console.log("🎧 Listening for DM from:", user.tag);
      client.on("messageCreate", handleConfessionMessage);

      // Auto cleanup after 5 minutes
      setTimeout(() => {
        client.removeListener("messageCreate", handleConfessionMessage);
        console.log("⏰ Timeout: stopped listening for DM from", user.tag);
      }, 5 * 60 * 1000);
    } catch (err) {
      console.error("confessions button error:", err);
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
