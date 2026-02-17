const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  EmbedBuilder,
  PermissionsBitField,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
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
          "Click the button below to write an anonymous confession. A private channel will be created where only you can write your message."
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
      const guild = interaction.guild;
      const user = interaction.user;

      // Defer reply
      await interaction.deferReply({ ephemeral: true });

      // Create a private channel
      const channel = await guild.channels.create({
        name: `confession-${user.username}`,
        type: ChannelType.GuildText,
        topic: `Confession channel for ${user.tag}`,
        permissionOverwrites: [
          {
            id: guild.id,
            deny: [PermissionsBitField.Flags.ViewChannel],
          },
          {
            id: user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
            ],
          },
          {
            id: client.user.id,
            allow: [
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory,
              PermissionsBitField.Flags.ManageChannels,
            ],
          },
        ],
      });

      // Send instructions
      const instructionEmbed = new EmbedBuilder()
        .setTitle("✅ Confession Channel Created")
        .setDescription(
          `Your private confession channel is ready! Type your anonymous confession in ${channel} below. Once you send it, the channel will be automatically deleted.`
        )
        .setColor("#F4C16D");

      await interaction.editReply({
        embeds: [instructionEmbed],
      });

      // Send welcome message in the private channel
      const welcomeEmbed = new EmbedBuilder()
        .setTitle("📝 Welcome to Your Confession Channel")
        .setDescription(
          "Write your confession below. Your message will be posted anonymously to the confessions channel, and this channel will then be deleted."
        )
        .setColor("#F4C16D");

      await channel.send({ embeds: [welcomeEmbed] });

      // Create message collector
      const filter = (msg) => msg.author.id === user.id;
      const collector = channel.createMessageCollector({ filter, time: 5 * 60 * 1000 });

      collector.on("collect", async (message) => {
        try {
          // Stop collector from collecting more messages
          collector.stop("message_received");

          const outputChannel = await client.channels
            .fetch(outputChannelId)
            .catch(() => null);

          if (!outputChannel) {
            console.warn("confessions: output channel not found:", outputChannelId);
            await channel
              .send(
                "❌ Error: Could not post your confession. Please try again later."
              )
              .catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await channel.delete().catch(() => {});
            return;
          }

          const me = guild.members.me;
          const perms = outputChannel.permissionsFor(me);
          if (
            !perms ||
            !perms.has([
              PermissionsBitField.Flags.ViewChannel,
              PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.EmbedLinks,
            ])
          ) {
            console.warn("confessions: missing permissions in output channel");
            await channel
              .send(
                "❌ Error: Bot missing permissions. Please try again later."
              )
              .catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await channel.delete().catch(() => {});
            return;
          }

          const content = (message.content || "").trim();
          const attachments = message.attachments?.map((a) => a.url) || [];

          if (!content && attachments.length === 0) {
            await channel
              .send("Your message was empty. Channel will be deleted.")
              .catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await channel.delete().catch(() => {});
            return;
          }

          const embed = new EmbedBuilder()
            .setTitle("Anonymous Confession")
            .setColor("#F4C16D")
            .setTimestamp();

          if (content) {
            embed.setDescription(
              content.length > 4000 ? `${content.slice(0, 3997)}...` : content
            );
          }

          if (attachments.length > 0) {
            const filesList = attachments.join("\n");
            embed.addFields({
              name: `Attachments (${attachments.length})`,
              value:
                filesList.length > 1024
                  ? `${filesList.slice(0, 1021)}...`
                  : filesList,
            });
          }

          await outputChannel.send({ embeds: [embed] });

          // Send to admin channel with user details for moderation
          if (adminChannelId) {
            const adminChannel = await client.channels
              .fetch(adminChannelId)
              .catch(() => null);

            if (adminChannel) {
              const adminEmbed = new EmbedBuilder()
                .setTitle("📋 Confession Report (Admin)")
                .setColor("#FF6B6B")
                .addFields(
                  {
                    name: "User",
                    value: `${user.tag} (${user.id})`,
                    inline: false,
                  },
                  {
                    name: "Confession Content",
                    value:
                      content.length > 0
                        ? content.length > 1024
                          ? `${content.slice(0, 1021)}...`
                          : content
                        : "*No text content*",
                    inline: false,
                  }
                )
                .setTimestamp();

              if (attachments.length > 0) {
                const filesText = attachments.join("\n");
                adminEmbed.addFields({
                  name: `Attachments (${attachments.length})`,
                  value: filesText.length > 1024 ? `${filesText.slice(0, 1021)}...` : filesText,
                  inline: false,
                });
              }

              await adminChannel.send({ embeds: [adminEmbed] }).catch(() => {});
            }
          }

          await channel
            .send(
              "✅ Your confession has been posted successfully! This channel will now be deleted."
            )
            .catch(() => {});

          await new Promise((resolve) => setTimeout(resolve, 1500));
          await channel.delete().catch(() => {});
        } catch (err) {
          console.error("confessions collector error:", err);
          await channel
            .send("An error occurred. Channel will be deleted.")
            .catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 1000));
          await channel.delete().catch(() => {});
        }
      });

      collector.on("end", async (_, reason) => {
        try {
          if (reason === "message_received") return;

          const channelExists = await guild.channels
            .fetch(channel.id)
            .catch(() => null);
          if (channelExists) {
            const timeoutEmbed = new EmbedBuilder()
              .setTitle("⏰ Session Expired")
              .setDescription("You did not write a confession in time. This channel will be deleted.")
              .setColor("#F4C16D");

            await channel.send({ embeds: [timeoutEmbed] }).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 2000));
            await channel.delete().catch(() => {});
          }
        } catch (err) {
          console.error("confessions timeout error:", err);
        }
      });
    } catch (err) {
      console.error("confessions button error:", err);
      await interaction
        .editReply({
          content:
            "Failed to create confession channel. Please try again.",
        })
        .catch(() => {});
    }
  });
};

module.exports = confessions;
