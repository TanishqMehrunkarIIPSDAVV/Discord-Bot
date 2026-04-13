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
  StringSelectMenuBuilder,
  OverwriteType,
} = require("discord.js");

let registered = false;

const COMPLAINT_CREATE_BUTTON_ID = "create_complaint_channel";
const COMPLAINT_TYPE_SELECT_PREFIX = "complaint_type_select:";

const COMPLAINT_TYPES = [
  {
    value: "vc",
    label: "Voice Chat",
    description: "Voice channel behavior or moderation issues",
  },
  {
    value: "chat",
    label: "Normal Chat",
    description: "Text channel behavior, spam, or harassment",
  },
  {
    value: "dm",
    label: "DM Issues",
    description: "Direct message related issues",
  },
  {
    value: "admin",
    label: "Admin Level Issues",
    description: "Critical issues requiring admin-only handling",
  },
];

const loadConfig = () => {
  try {
    delete require.cache[require.resolve("../config.json")];
    return require("../config.json");
  } catch {
    return {};
  }
};

const normalizeIds = (value) => {
  if (Array.isArray(value)) {
    return value.map((id) => String(id).trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  if (value === undefined || value === null) {
    return [];
  }

  return [String(value).trim()].filter(Boolean);
};

const uniqueIds = (...lists) => [...new Set(lists.flat().filter(Boolean))];

const getRuntimeConfig = () => {
  const cfg = loadConfig();

  return {
    buttonChannelId:
      (process.env.COMPLAINT_BUTTON_CHANNEL_ID || cfg.complaintButtonChannelId || "").trim(),
    displayChannelId:
      (process.env.COMPLAINT_DISPLAY_CHANNEL_ID || cfg.complaintDisplayChannelId || "").trim(),
    adminChannelId:
      (process.env.COMPLAINT_ADMIN_CHANNEL_ID || cfg.complaintAdminChannelId || "").trim(),
    categoryId:
      (process.env.COMPLAINT_CATEGORY_ID || cfg.complaintCategoryId || "1473330861406421136").trim(),
    vcModRoleIds: normalizeIds(
      process.env.COMPLAINT_VC_MOD_ROLE_IDS || cfg.complaintVcModRoleIds || cfg.complaintVcModRoleId
    ),
    chatModRoleIds: normalizeIds(
      process.env.COMPLAINT_CHAT_MOD_ROLE_IDS || cfg.complaintChatModRoleIds || cfg.complaintChatModRoleId
    ),
    headModRoleIds: normalizeIds(
      process.env.COMPLAINT_HEAD_MOD_ROLE_IDS || cfg.complaintHeadModRoleIds || cfg.complaintHeadModRoleId
    ),
    adminRoleIds: normalizeIds(
      process.env.COMPLAINT_ADMIN_ROLE_IDS || cfg.complaintAdminRoleIds || cfg.complaintAdminRoleId
    ),
  };
};

const getComplaintTypeLabel = (typeValue) => {
  const found = COMPLAINT_TYPES.find((type) => type.value === String(typeValue || "").trim());
  return found ? found.label : "Unknown";
};

const getAdminRolesFromGuild = (guild) => {
  return guild.roles.cache
    .filter((role) => role.permissions.has(PermissionsBitField.Flags.Administrator))
    .map((role) => role.id);
};

const getAllowedRoleIdsForType = (type, runtimeConfig, guild) => {
  const typeKey = String(type || "").trim().toLowerCase();
  const autoAdminRoleIds = guild ? getAdminRolesFromGuild(guild) : [];
  const configuredAdminRoleIds = uniqueIds(runtimeConfig.adminRoleIds, autoAdminRoleIds);

  if (typeKey === "vc") {
    return uniqueIds(runtimeConfig.vcModRoleIds, runtimeConfig.headModRoleIds, configuredAdminRoleIds);
  }

  if (typeKey === "chat") {
    return uniqueIds(runtimeConfig.chatModRoleIds, runtimeConfig.headModRoleIds, configuredAdminRoleIds);
  }

  if (typeKey === "dm") {
    return uniqueIds(runtimeConfig.headModRoleIds, configuredAdminRoleIds);
  }

  if (typeKey === "admin") {
    return configuredAdminRoleIds;
  }

  return configuredAdminRoleIds;
};

const buildComplaintTypeSelectRow = (requesterId) => {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${COMPLAINT_TYPE_SELECT_PREFIX}${requesterId}`)
      .setPlaceholder("Select complaint type")
      .addOptions(COMPLAINT_TYPES)
  );
};

const getComplaintMetaFromTopic = (topic) => {
  const parts = String(topic || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  const meta = {
    ownerId: null,
    type: "admin",
  };

  for (const part of parts) {
    const [keyRaw, ...rest] = part.split(":");
    const key = String(keyRaw || "").trim();
    const value = rest.join(":").trim();
    if (!key || !value) continue;

    if (key === "complaint-owner") meta.ownerId = value;
    if (key === "complaint-type") meta.type = value;
  }

  return meta;
};

const roleMentionsFromIds = (guild, roleIds) => {
  const mentions = roleIds
    .map((roleId) => guild.roles.cache.get(roleId))
    .filter(Boolean)
    .map((role) => `<@&${role.id}>`);

  return mentions.length > 0 ? mentions.join(" ") : "Configured staff roles";
};

const complaints = () => {
  if (registered) return;
  registered = true;

  // Send button message when bot starts
  client.on("clientReady", async () => {
    try {
      const runtimeConfig = getRuntimeConfig();
      const { buttonChannelId } = runtimeConfig;

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
        .setCustomId(COMPLAINT_CREATE_BUTTON_ID)
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
            c.components.some((btn) => btn.customId === COMPLAINT_CREATE_BUTTON_ID)
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
    if (interaction.isButton() && interaction.customId === COMPLAINT_CREATE_BUTTON_ID) {
      await interaction.reply({
        ephemeral: true,
        content: "Choose the type of complaint you want to file:",
        components: [buildComplaintTypeSelectRow(interaction.user.id)],
      }).catch(() => {});
      return;
    }

    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith(COMPLAINT_TYPE_SELECT_PREFIX)) return;

    try {
      const guild = interaction.guild;
      const user = interaction.user;
      const runtimeConfig = getRuntimeConfig();
      const requestedById = interaction.customId.replace(COMPLAINT_TYPE_SELECT_PREFIX, "");

      if (requestedById !== user.id) {
        await interaction.reply({
          ephemeral: true,
          content: "This complaint menu is not for you.",
        }).catch(() => {});
        return;
      }

      const selectedType = interaction.values?.[0];
      const selectedTypeLabel = getComplaintTypeLabel(selectedType);
      const allowedRoleIds = getAllowedRoleIdsForType(selectedType, runtimeConfig, guild);

      if (!runtimeConfig.categoryId) {
        await interaction.reply({
          ephemeral: true,
          content: "Complaint category is not configured. Ask an admin to set complaintCategoryId.",
        }).catch(() => {});
        return;
      }

      const category = guild.channels.cache.get(runtimeConfig.categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.reply({
          ephemeral: true,
          content: "Configured complaint category is invalid. Ask an admin to verify complaintCategoryId.",
        }).catch(() => {});
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const permissionOverwrites = [
        {
          id: guild.id,
          type: OverwriteType.Role,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
        {
          id: user.id,
          type: OverwriteType.Member,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles,
            PermissionsBitField.Flags.EmbedLinks,
          ],
        },
        {
          id: client.user.id,
          type: OverwriteType.Member,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageMessages,
          ],
        },
      ];

      for (const roleId of allowedRoleIds) {
        permissionOverwrites.push({
          id: roleId,
          type: OverwriteType.Role,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
          ],
        });
      }

      const channel = await guild.channels.create({
        name: `complaint-${selectedType}-${user.username}`,
        type: ChannelType.GuildText,
        topic: `complaint-owner:${user.id} | complaint-type:${selectedType} | user-tag:${user.tag}`,
        parent: category.id,
        permissionOverwrites,
        reason: `Complaint (${selectedType}) opened by ${user.tag} (${user.id})`,
      });

      const instructionEmbed = new EmbedBuilder()
        .setTitle("✅ Complaint Ticket Created")
        .setDescription(
          `Your complaint channel has been created at ${channel}.\nType selected: **${selectedTypeLabel}**\n\nPlease describe your complaint in detail below.`
        )
        .setColor("#FF6B6B");

      await interaction.editReply({
        embeds: [instructionEmbed],
      });

      const welcomeEmbed = new EmbedBuilder()
        .setTitle("📋 Complaint Ticket")
        .setDescription(
          `Welcome to your complaint ticket, ${user.tag}.\n\nComplaint type: **${selectedTypeLabel}**\nPlease describe your complaint in detail. The assigned staff team will review it and get back to you.`
        )
        .setColor("#FF6B6B")
        .setTimestamp();

      await channel.send({ embeds: [welcomeEmbed] });

      await channel.send({
        content: `Assigned staff: ${roleMentionsFromIds(guild, allowedRoleIds)}`,
      }).catch(() => {});

      // Post complaint to display channel
      const displayChannel = await client.channels
        .fetch(runtimeConfig.displayChannelId)
        .catch(() => null);

      if (displayChannel) {
        const complaintNotificationEmbed = new EmbedBuilder()
          .setTitle("🆕 New Complaint Filed")
          .setColor("#FF6B6B")
          .addFields(
            { name: "User", value: `${user.tag} (${user.id})`, inline: true },
            { name: "Type", value: selectedTypeLabel, inline: true },
            { name: "Ticket Channel", value: `${channel}`, inline: true },
            {
              name: "Status",
              value: "🔴 Open",
              inline: true,
            },
            {
              name: "Assigned Staff",
              value: roleMentionsFromIds(guild, allowedRoleIds),
              inline: false,
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
        content: "**Assigned staff:** Click the button below when the complaint is resolved.",
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
      const runtimeConfig = getRuntimeConfig();

      await interaction.deferReply({ ephemeral: true });

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

      const complaintMeta = getComplaintMetaFromTopic(complaintChannel.topic);
      const allowedRoleIds = getAllowedRoleIdsForType(complaintMeta.type, runtimeConfig, interaction.guild);

      const isAdminPermission = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);
      const hasAllowedRole = allowedRoleIds.some((roleId) => interaction.member.roles.cache.has(roleId));

      if (!isAdminPermission && !hasAllowedRole) {
        await interaction.editReply({
          content: "❌ You are not allowed to resolve this complaint.",
        });
        return;
      }

      // Fetch all messages from the channel
      const allMessages = await complaintChannel.messages.fetch({ limit: 100 });
      const sortedMessages = Array.from(allMessages.values())
        .reverse()
        .filter((m) => m.author.id !== client.user.id || m.content || m.embeds.length > 0);

      const resolver = interaction.user;
      const resolverLabel = resolver ? `${resolver.tag} (${resolver.id})` : "Unknown";
      const createdAt = complaintChannel.createdAt
        ? complaintChannel.createdAt
        : new Date();
      const resolvedAt = new Date();
      const createdUnix = Math.floor(createdAt.getTime() / 1000);
      const resolvedUnix = Math.floor(resolvedAt.getTime() / 1000);

      // Generate transcript for file (UTC for clarity)
      let transcript = `COMPLAINT TRANSCRIPT\n`;
      transcript += `${"=".repeat(50)}\n\n`;
      transcript += `Ticket: ${complaintChannel.name}\n`;
      transcript += `User: ${complaintChannel.topic}\n`;
      transcript += `Created (UTC): ${createdAt.toISOString()}\n`;
      transcript += `Resolved (UTC): ${resolvedAt.toISOString()}\n`;
      transcript += `Resolved By: ${resolverLabel}\n\n`;
      transcript += `${"=".repeat(50)}\n\n`;

      // Generate transcript for DM (Discord renders in viewer timezone)
      let renderedTranscript = `COMPLAINT TRANSCRIPT\n`;
      renderedTranscript += `${"=".repeat(50)}\n\n`;
      renderedTranscript += `Ticket: ${complaintChannel.name}\n`;
      renderedTranscript += `User: ${complaintChannel.topic}\n`;
      renderedTranscript += `Created: <t:${createdUnix}:F>\n`;
      renderedTranscript += `Resolved: <t:${resolvedUnix}:F>\n`;
      renderedTranscript += `Resolved By: ${resolverLabel}\n\n`;
      renderedTranscript += `${"=".repeat(50)}\n\n`;

      for (const msg of sortedMessages) {
        const timestampUnix = Math.floor(msg.createdTimestamp / 1000);
        const timestamp = `<t:${timestampUnix}:f>`;
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

        transcript += `[${new Date(msg.createdTimestamp).toISOString()}] ${author}:\n${content}\n\n`;
        renderedTranscript += `[${timestamp}] ${author}:\n${content}\n\n`;
      }

      // Create attachment
      const buffer = Buffer.from(transcript);
      const attachment = new AttachmentBuilder(buffer, {
        name: `complaint_${complaintChannel.name}_${Date.now()}.txt`,
      });

      const sendChunkedMessages = async (channel, text) => {
        const maxLength = 1900;
        let start = 0;
        while (start < text.length) {
          const chunk = text.slice(start, start + maxLength);
          await channel.send(chunk).catch(() => {});
          start += maxLength;
        }
      };

      // Send to user's DM
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) {
        const dmEmbed = new EmbedBuilder()
          .setTitle("✅ Your Complaint Has Been Resolved")
          .setDescription(
            `Your complaint ticket \`${complaintChannel.name}\` has been marked as resolved. The transcript below is shown in your local Discord time.`
          )
          .setColor("#51CF66")
          .addFields({
            name: "Resolved By",
            value: `${resolver.tag} (${resolver.id})`,
            inline: true,
          });

        const dmChannel = await user.createDM().catch(() => null);
        if (dmChannel) {
          await dmChannel.send({ embeds: [dmEmbed] }).catch(() => {});
          await sendChunkedMessages(dmChannel, renderedTranscript);
          await dmChannel.send({ files: [attachment] }).catch(() => {});
        }
      }

      // Send to admin channel
      const adminChannel = await client.channels
        .fetch(runtimeConfig.adminChannelId)
        .catch(() => null);

      if (adminChannel) {
        const adminEmbed = new EmbedBuilder()
          .setTitle("✅ Complaint Resolved")
          .setDescription(`Complaint ticket \`${complaintChannel.name}\` has been resolved. The transcript below is shown in local Discord time.`)
          .setColor("#51CF66")
          .addFields(
            {
              name: "User",
              value: `<@${userId}>`,
              inline: true,
            },
            {
              name: "Resolved By",
              value: `${resolver.tag} (${resolver.id})`,
              inline: true,
            }
          )
          .setTimestamp();

        await adminChannel.send({ embeds: [adminEmbed] }).catch(() => {});
        await sendChunkedMessages(adminChannel, renderedTranscript);
        await adminChannel.send({ files: [attachment] }).catch(() => {});
      }

      // Update complaint display channel
      const displayChannel = await client.channels
        .fetch(runtimeConfig.displayChannelId)
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
