const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  EmbedBuilder,
  PermissionsBitField,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ChannelType,
  AttachmentBuilder,
} = require("discord.js");

let registered = false;

const complaints = () => {
  if (registered) return;
  registered = true;

  const cfgPath = path.join(__dirname, "..", "config.json");
  let cfg = {};
  try {
    cfg = require(cfgPath);
  } catch {}

  const buttonChannelId =
    process.env.COMPLAINT_BUTTON_CHANNEL_ID || cfg.complaintButtonChannelId;
  const displayChannelId =
    process.env.COMPLAINT_DISPLAY_CHANNEL_ID || cfg.complaintDisplayChannelId;
  const adminChannelId =
    process.env.COMPLAINT_ADMIN_CHANNEL_ID || cfg.complaintAdminChannelId;

  // Send button message when bot starts
  client.on("ready", async () => {
    try {
      if (!buttonChannelId) {
        console.warn("complaints: button channel ID not configured");
        return;
      }

      const channel = await client.channels
        .fetch(buttonChannelId)
        .catch(() => null);
      if (!channel) {
        console.warn("complaints: button channel not found:", buttonChannelId);
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("📋 Complaint Box")
        .setDescription(
          "Click the button below to file a complaint. A private channel will be created where you can describe your complaint in detail."
        )
        .setColor("#FF6B6B");

      const button = new ButtonBuilder()
        .setCustomId("create_complaint_channel")
        .setLabel("File Complaint")
        .setStyle(ButtonStyle.Danger);

      const row = new ActionRowBuilder().addComponents(button);

      // Check if button message already exists
      const messages = await channel.messages
        .fetch({ limit: 10 })
        .catch(() => []);
      const complaintMessage = messages.find(
        (m) =>
          m.author.id === client.user.id &&
          m.components.some((c) =>
            c.components.some((btn) => btn.customId === "create_complaint_channel")
          )
      );

      if (!complaintMessage) {
        await channel.send({ embeds: [embed], components: [row] }).catch(() => {});
      }
    } catch (err) {
      console.error("complaints ready error:", err);
    }
  });

  // Handle complaint button click
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.customId !== "create_complaint_channel") return;

    try {
      const guild = interaction.guild;
      const user = interaction.user;

      await interaction.deferReply({ ephemeral: true });

      // Get admin role (or create channel visible to bot and user)
      const channel = await guild.channels.create({
        name: `complaint-${user.username}`,
        type: ChannelType.GuildText,
        topic: `Complaint ticket for ${user.tag}`,
        parent: "1473330861406421136",
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

      // Allow admins to see the channel
      const adminRole = guild.roles.cache.find((r) => r.permissions.has(PermissionsBitField.Flags.Administrator));
      if (adminRole) {
        await channel.permissionOverwrites.edit(adminRole, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        });
      }

      const instructionEmbed = new EmbedBuilder()
        .setTitle("✅ Complaint Ticket Created")
        .setDescription(
          `Your complaint channel has been created at ${channel}. Please describe your complaint in detail below.`
        )
        .setColor("#FF6B6B");

      await interaction.editReply({
        embeds: [instructionEmbed],
      });

      const welcomeEmbed = new EmbedBuilder()
        .setTitle("📋 Complaint Ticket")
        .setDescription(
          `Welcome to your complaint ticket, ${user.tag}.\n\nPlease describe your complaint in detail. Admins will review your complaint and get back to you.`
        )
        .setColor("#FF6B6B")
        .setTimestamp();

      await channel.send({ embeds: [welcomeEmbed] });

      // Post complaint to display channel
      const displayChannel = await client.channels
        .fetch(displayChannelId)
        .catch(() => null);

      if (displayChannel) {
        const complaintNotificationEmbed = new EmbedBuilder()
          .setTitle("🆕 New Complaint Filed")
          .setColor("#FF6B6B")
          .addFields(
            { name: "User", value: `${user.tag} (${user.id})`, inline: true },
            { name: "Ticket Channel", value: `${channel}`, inline: true },
            {
              name: "Status",
              value: "🔴 Open",
              inline: true,
            }
          )
          .setTimestamp();

        await displayChannel.send({ embeds: [complaintNotificationEmbed] }).catch(() => {});
      }

      // Store complaintant data in channel topic for later
      const solveButton = new ButtonBuilder()
        .setCustomId(`solve_complaint_${channel.id}_${user.id}`)
        .setLabel("✅ Mark as Resolved")
        .setStyle(ButtonStyle.Success);

      const solveRow = new ActionRowBuilder().addComponents(solveButton);

      // Add admin instructions
      const adminMsg = await channel.send({
        content: "**Admins:** Click the button below when the complaint is resolved.",
        components: [solveRow],
      });

      // Store metadata
      channel.data = {
        userId: user.id,
        createdAt: new Date(),
        firstMessageId: adminMsg.id,
      };
    } catch (err) {
      console.error("complaints button error:", err);
      await interaction
        .editReply({
          content: "Failed to create complaint channel. Please try again.",
        })
        .catch(() => {});
    }
  });

  // Handle solve complaint button click
  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith("solve_complaint_")) return;

    try {
      // Check if user has admin permissions
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await interaction.reply({
          content: "❌ Only admins can resolve complaints.",
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      // Extract channelId and userId from customId: solve_complaint_{channelId}_{userId}
      const parts = interaction.customId.split("_");
      const channelId = parts[2]; // Index 2 because: 0=solve, 1=complaint, 2=channelId, 3=userId
      const userId = parts[3];

      if (!channelId || !userId) {
        console.error("Invalid customId format:", interaction.customId);
        await interaction.editReply({
          content: "❌ Invalid complaint channel data.",
        });
        return;
      }

      const complaintChannel = await client.channels
        .fetch(channelId)
        .catch(() => null);

      if (!complaintChannel) {
        await interaction.editReply({
          content: "❌ Complaint channel not found.",
        });
        return;
      }

      // Fetch all messages from the channel
      const allMessages = await complaintChannel.messages.fetch({ limit: 100 });
      const sortedMessages = Array.from(allMessages.values())
        .reverse()
        .filter((m) => m.author.id !== client.user.id || m.content || m.embeds.length > 0);

      // Generate transcript
      let transcript = `COMPLAINT TRANSCRIPT\n`;
      transcript += `${"=".repeat(50)}\n\n`;
      transcript += `Ticket: ${complaintChannel.name}\n`;
      transcript += `User: ${complaintChannel.topic}\n`;
      transcript += `Created: ${complaintChannel.createdAt.toLocaleString()}\n`;
      transcript += `Resolved: ${new Date().toLocaleString()}\n\n`;
      transcript += `${"=".repeat(50)}\n\n`;

      for (const msg of sortedMessages) {
        const timestamp = msg.createdAt.toLocaleString();
        const author = msg.author.tag;
        let content = msg.content || "";

        // Add embed content if present
        if (msg.embeds.length > 0) {
          for (const embed of msg.embeds) {
            if (embed.title) content += `\n**${embed.title}**`;
            if (embed.description) content += `\n${embed.description}`;
            if (embed.fields.length > 0) {
              for (const field of embed.fields) {
                content += `\n${field.name}: ${field.value}`;
              }
            }
          }
        }

        transcript += `[${timestamp}] ${author}:\n${content}\n\n`;
      }

      // Create attachment
      const buffer = Buffer.from(transcript);
      const attachment = new AttachmentBuilder(buffer, {
        name: `complaint_${complaintChannel.name}_${Date.now()}.txt`,
      });

      // Send to user's DM
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        const dmEmbed = new EmbedBuilder()
          .setTitle("✅ Your Complaint Has Been Resolved")
          .setDescription(
            `Your complaint ticket \`${complaintChannel.name}\` has been marked as resolved. Below is the transcript of all messages.`
          )
          .setColor("#51CF66");

        await user.send({ embeds: [dmEmbed], files: [attachment] }).catch((err) => {
          console.error("Failed to send complaint transcript to user DM:", err);
        });
      }

      // Send to admin channel
      const adminChannel = await client.channels
        .fetch(adminChannelId)
        .catch(() => null);

      if (adminChannel) {
        const adminEmbed = new EmbedBuilder()
          .setTitle("✅ Complaint Resolved")
          .setDescription(`Complaint ticket \`${complaintChannel.name}\` has been resolved.`)
          .setColor("#51CF66")
          .addFields({
            name: "User",
            value: `<@${userId}>`,
            inline: true,
          })
          .setTimestamp();

        await adminChannel
          .send({ embeds: [adminEmbed], files: [attachment] })
          .catch(() => {});
      }

      // Update complaint display channel
      const displayChannel = await client.channels
        .fetch(displayChannelId)
        .catch(() => null);

      if (displayChannel) {
        const messages = await displayChannel.messages.fetch({ limit: 50 });
        const complaintMsg = messages.find(
          (m) =>
            m.embeds.length > 0 &&
            m.embeds[0]?.title === "🆕 New Complaint Filed" &&
            m.embeds[0]?.fields?.some((f) => f.value.includes(channelId))
        );

        if (complaintMsg) {
          const updatedEmbed = new EmbedBuilder(complaintMsg.embeds[0])
            .spliceFields(
              2,
              1,
              {
                name: "Status",
                value: "🟢 Resolved",
                inline: true,
              }
            )
            .setTimestamp();

          await complaintMsg.edit({ embeds: [updatedEmbed] }).catch(() => {});
        }
      }

      await interaction.editReply({
        content: `✅ Complaint marked as resolved. Transcript sent to user's DM and admin channel.`,
      });

      // Delete the channel after 5 seconds
      await new Promise((resolve) => setTimeout(resolve, 3000));
      await complaintChannel.delete().catch(() => {});
    } catch (err) {
      console.error("complaints solve error:", err);
      await interaction
        .editReply({
          content: "An error occurred while resolving the complaint.",
        })
        .catch(() => {});
    }
  });
};

module.exports = complaints;
