const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  OverwriteType,
  PermissionsBitField,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const TICKET_CREATE_BUTTON_ID = "ticket_create_channel";
const TICKET_CLOSE_BUTTON_ID = "ticket_close_channel";
const TICKET_TYPE_SELECT_PREFIX = "ticket_type_select:";
const TICKET_SUBJECT_MODAL_PREFIX = "ticket_subject_modal:";
const TICKET_SUBJECT_INPUT_ID = "ticket_subject";
let registered = false;

const DEFAULT_TICKET_TYPES = [
  { label: "Partnership", value: "partnership", description: "Collaboration, promotion, or alliance requests" },
  { label: "Support", value: "support", description: "General help with server or bot issues" },
  { label: "Bug Report", value: "bug", description: "Report technical problems or glitches" },
  { label: "Other", value: "other", description: "Anything that does not fit other categories" },
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

  return [];
};

const getRuntimeConfig = () => {
  const config = loadConfig();

  return {
    panelChannelId: (process.env.TICKET_PANEL_CHANNEL_ID || config.ticketPanelChannelId || "").trim(),
    categoryId: (process.env.TICKET_CATEGORY_ID || config.ticketCategoryId || "").trim(),
    transcriptChannelId: (process.env.TICKET_TRANSCRIPT_CHANNEL_ID || config.ticketTranscriptChannelId || "").trim(),
    adminRoleIds: normalizeIds(process.env.TICKET_ADMIN_ROLE_IDS || config.ticketAdminRoleIds),
    supportRoleIds: normalizeIds(process.env.TICKET_SUPPORT_ROLE_IDS || config.ticketSupportRoleIds),
  };
};

const buildPanelEmbed = () =>
  new EmbedBuilder()
    .setTitle("🎫 Support Tickets")
    .setDescription(
      "Need help from staff? Click **Create Ticket** and I will open a private support channel for you.\n\n" +
        "This ticket system is separate from complaints and suggestions."
    )
    .setColor("#4EA1FF");

const buildPanelActionRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_CREATE_BUTTON_ID)
      .setLabel("Create Ticket")
      .setStyle(ButtonStyle.Primary)
  );

const buildCloseActionRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(TICKET_CLOSE_BUTTON_ID)
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

const getTicketName = (user) => {
  const base = String(user.username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "user";

  return `ticket-${base}-${user.id.slice(-4)}`;
};

const getAdminRolesFromGuild = (guild) => {
  return guild.roles.cache
    .filter((role) => role.permissions.has(PermissionsBitField.Flags.Administrator))
    .map((role) => role.id);
};

const findOpenTicketForUser = (guild, categoryId, userId) => {
  return guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildText) return false;
    if (channel.parentId !== categoryId) return false;
    const topic = String(channel.topic || "");
    return topic.includes(`ticket-owner:${userId}`) && topic.includes("ticket-status:open");
  });
};

const sanitizeTicketType = (rawType) => {
  const type = String(rawType || "").trim().toLowerCase();
  if (!type) return "other";
  return type.slice(0, 40);
};

const escapeTicks = (value) => String(value || "").replace(/`/g, "'");

const getTicketMetaFromTopic = (topic) => {
  const parts = String(topic || "")
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  const meta = {
    ownerId: null,
    status: "unknown",
    type: "other",
  };

  for (const part of parts) {
    const [keyRaw, ...rest] = part.split(":");
    const key = String(keyRaw || "").trim();
    const value = rest.join(":").trim();
    if (!key || !value) continue;

    if (key === "ticket-owner") meta.ownerId = value;
    if (key === "ticket-status") meta.status = value;
    if (key === "ticket-type") meta.type = value;
  }

  return meta;
};

const collectChannelMessages = async (channel, maxMessages = 500) => {
  const collected = [];
  let before;

  while (collected.length < maxMessages) {
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;

    const values = Array.from(batch.values());
    collected.push(...values);
    before = values[values.length - 1]?.id;
    if (!before) break;
  }

  return collected
    .slice(0, maxMessages)
    .sort((a, b) => Number(a.createdTimestamp) - Number(b.createdTimestamp));
};

const buildTranscriptText = ({ guild, channel, closedByTag, ticketMeta, messages }) => {
  const lines = [];
  lines.push("TICKET TRANSCRIPT");
  lines.push("=".repeat(60));
  lines.push(`Guild: ${guild?.name || "Unknown"} (${guild?.id || "n/a"})`);
  lines.push(`Channel: #${channel.name} (${channel.id})`);
  lines.push(`Type: ${ticketMeta.type || "other"}`);
  lines.push(`Owner ID: ${ticketMeta.ownerId || "unknown"}`);
  lines.push(`Closed By: ${closedByTag}`);
  lines.push(`Closed At (UTC): ${new Date().toISOString()}`);
  lines.push("");
  lines.push("MESSAGES");
  lines.push("-".repeat(60));

  for (const message of messages) {
    const authorTag = message.author?.tag || `${message.author?.username || "unknown"}`;
    const at = new Date(message.createdTimestamp).toISOString();
    const content = message.content ? message.content : "";

    lines.push(`[${at}] ${authorTag} (${message.author?.id || "n/a"})`);
    lines.push(content || "(no text content)");

    if (Array.isArray(message.embeds) && message.embeds.length > 0) {
      for (const embed of message.embeds) {
        const chunks = [];
        if (embed.title) chunks.push(`title=${embed.title}`);
        if (embed.description) chunks.push(`description=${embed.description}`);
        if (Array.isArray(embed.fields) && embed.fields.length > 0) {
          for (const field of embed.fields) {
            chunks.push(`field:${field.name}=${field.value}`);
          }
        }
        if (chunks.length > 0) lines.push(`[embed] ${chunks.join(" | ")}`);
      }
    }

    const attachments = Array.from(message.attachments?.values?.() || []);
    for (const attachment of attachments) {
      lines.push(`[attachment] ${attachment.url}`);
    }

    lines.push("");
  }

  return `${lines.join("\n")}\n`;
};

const sendTicketTranscript = async ({ guild, channel, closedByUser, runtimeConfig }) => {
  const ticketMeta = getTicketMetaFromTopic(channel.topic);
  const messages = await collectChannelMessages(channel);
  const transcriptText = buildTranscriptText({
    guild,
    channel,
    closedByTag: `${closedByUser.tag} (${closedByUser.id})`,
    ticketMeta,
    messages,
  });
  const transcriptBuffer = Buffer.from(transcriptText, "utf8");

  if (runtimeConfig.transcriptChannelId) {
    const transcriptChannel = await client.channels.fetch(runtimeConfig.transcriptChannelId).catch(() => null);
    if (!transcriptChannel || !transcriptChannel.isTextBased()) {
      console.warn("tickets: transcript channel not found or not text-based:", runtimeConfig.transcriptChannelId);
    } else {
      const channelAttachment = new AttachmentBuilder(transcriptBuffer, {
        name: `ticket-${channel.name}-${Date.now()}.txt`,
      });

      const logEmbed = new EmbedBuilder()
        .setColor("#51CF66")
        .setTitle("Ticket Closed")
        .addFields(
          { name: "Channel", value: `#${escapeTicks(channel.name)} (${channel.id})`, inline: false },
          { name: "Ticket Type", value: escapeTicks(ticketMeta.type || "other"), inline: true },
          { name: "Owner", value: ticketMeta.ownerId ? `<@${ticketMeta.ownerId}> (${ticketMeta.ownerId})` : "Unknown", inline: true },
          { name: "Closed By", value: `${closedByUser} (${closedByUser.id})`, inline: false },
          { name: "Messages", value: String(messages.length), inline: true }
        )
        .setTimestamp();

      await transcriptChannel.send({ embeds: [logEmbed], files: [channelAttachment] }).catch((error) => {
        console.error("tickets transcript send error:", error);
      });
    }
  }

  if (ticketMeta.ownerId) {
    const ticketOwner = await client.users.fetch(ticketMeta.ownerId).catch(() => null);
    if (ticketOwner) {
      const dmAttachment = new AttachmentBuilder(transcriptBuffer, {
        name: `ticket-${channel.name}-${Date.now()}.txt`,
      });

      const dmEmbed = new EmbedBuilder()
        .setColor("#4EA1FF")
        .setTitle("Your Ticket Was Closed")
        .setDescription("Here is the transcript from your support ticket.")
        .addFields(
          { name: "Server", value: escapeTicks(guild?.name || "Unknown"), inline: true },
          { name: "Ticket Type", value: escapeTicks(ticketMeta.type || "other"), inline: true },
          { name: "Closed By", value: `${closedByUser.tag} (${closedByUser.id})`, inline: false }
        )
        .setTimestamp();

      await ticketOwner.send({ embeds: [dmEmbed], files: [dmAttachment] }).catch((error) => {
        console.warn("tickets transcript dm failed:", error?.message || error);
      });
    }
  }
};

const buildTicketTypeSelectRow = (requesterId) => {
  const customId = `${TICKET_TYPE_SELECT_PREFIX}${requesterId}`;
  const select = new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder("Choose ticket type")
    .addOptions(DEFAULT_TICKET_TYPES);

  return new ActionRowBuilder().addComponents(select);
};

const createTicketForUser = async ({ interaction, runtimeConfig, ticketType, ticketSubject }) => {
  if (!interaction.guild) return;

  const category = interaction.guild.channels.cache.get(runtimeConfig.categoryId);
  if (!category || category.type !== ChannelType.GuildCategory) {
    await interaction.editReply({
      content: "Configured ticket category is invalid. Ask an admin to verify ticketCategoryId.",
    }).catch(() => {});
    return;
  }

  const existing = findOpenTicketForUser(interaction.guild, runtimeConfig.categoryId, interaction.user.id);
  if (existing) {
    await interaction.editReply({
      content: `You already have an open ticket: ${existing}`,
    }).catch(() => {});
    return;
  }

  const accessRoleIds = [
    ...new Set([
      ...runtimeConfig.adminRoleIds,
      ...runtimeConfig.supportRoleIds,
      ...getAdminRolesFromGuild(interaction.guild),
    ]),
  ];

  const permissionOverwrites = [
    {
      id: interaction.guild.id,
      type: OverwriteType.Role,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: interaction.user.id,
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

  for (const roleId of accessRoleIds) {
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

  const safeType = sanitizeTicketType(ticketType);
  const ticketChannel = await interaction.guild.channels
    .create({
      name: `${getTicketName(interaction.user)}-${safeType.slice(0, 12)}`,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: `ticket-owner:${interaction.user.id} | ticket-status:open | ticket-type:${safeType}`,
      permissionOverwrites,
      reason: `Support ticket (${safeType}) opened by ${interaction.user.tag} (${interaction.user.id})`,
    })
    .catch((error) => {
      console.error("tickets create channel error:", error);
      return null;
    });

  if (!ticketChannel) {
    await interaction.editReply({
      content: "Failed to create your ticket. Please try again or contact staff.",
    }).catch(() => {});
    return;
  }

  const ticketEmbed = new EmbedBuilder()
    .setColor("#4EA1FF")
    .setTitle("Support Ticket Opened")
    .setDescription(
      `${interaction.user}, welcome to your private support ticket.\n\n` +
        "Describe your issue clearly and a staff member will help you."
    )
    .addFields(
      {
        name: "Ticket Type",
        value: safeType,
        inline: true,
      },
      {
        name: "Subject",
        value: ticketSubject || "Not provided",
      },
      {
        name: "Note",
        value: "This is a separate support-ticket system and does not affect complaints or suggestions.",
      }
    )
    .setTimestamp();

  await ticketChannel
    .send({
      content: `${interaction.user}`,
      embeds: [ticketEmbed],
      components: [buildCloseActionRow()],
      allowedMentions: { users: [interaction.user.id] },
    })
    .catch(() => {});

  await interaction.editReply({
    content: `Your support ticket is ready: ${ticketChannel}`,
  }).catch(() => {});
};

const ensureTicketPanelMessage = async (panelChannel) => {
  const messages = await panelChannel.messages.fetch({ limit: 20 }).catch(() => null);
  if (!messages) return;

  const existingPanel = messages.find(
    (message) =>
      message.author.id === client.user.id &&
      message.components.some((row) =>
        row.components.some((component) => component.customId === TICKET_CREATE_BUTTON_ID)
      )
  );

  if (existingPanel) return;

  await panelChannel.send({
    embeds: [buildPanelEmbed()],
    components: [buildPanelActionRow()],
  });
};

const tickets = () => {
  if (registered) return;
  registered = true;

  client.on("clientReady", async () => {
    try {
      const runtimeConfig = getRuntimeConfig();
      if (!runtimeConfig.panelChannelId) {
        console.warn("tickets: panel channel ID not configured");
        return;
      }

      const panelChannel = await client.channels.fetch(runtimeConfig.panelChannelId).catch(() => null);
      if (!panelChannel || panelChannel.type !== ChannelType.GuildText) {
        console.warn("tickets: panel channel not found or invalid:", runtimeConfig.panelChannelId);
        return;
      }

      await ensureTicketPanelMessage(panelChannel);
    } catch (error) {
      console.error("tickets ready error:", error);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isButton()) return;

    if (interaction.customId === TICKET_CREATE_BUTTON_ID) {
      const runtimeConfig = getRuntimeConfig();
      if (!interaction.guild) {
        await interaction.reply({ content: "Tickets are only available in servers.", ephemeral: true }).catch(() => {});
        return;
      }

      if (!runtimeConfig.categoryId) {
        await interaction.reply({
          content: "Ticket category is not configured yet. Ask an admin to set ticketCategoryId.",
          ephemeral: true,
        }).catch(() => {});
        return;
      }

      await interaction.reply({
        content: "Select the type of ticket you want to open:",
        components: [buildTicketTypeSelectRow(interaction.user.id)],
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    if (interaction.customId === TICKET_CLOSE_BUTTON_ID) {
      if (!interaction.guild || !interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
        await interaction.reply({ content: "This action can only be used inside a server text channel.", ephemeral: true }).catch(() => {});
        return;
      }

      const runtimeConfig = getRuntimeConfig();
      const accessRoleIds = new Set([
        ...runtimeConfig.adminRoleIds,
        ...runtimeConfig.supportRoleIds,
        ...getAdminRolesFromGuild(interaction.guild),
      ]);

      const isTicketOwner = String(interaction.channel.topic || "").includes(`ticket-owner:${interaction.user.id}`);
      const hasStaffRole = interaction.member.roles?.cache?.some((role) => accessRoleIds.has(role.id));
      const isAdmin = interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

      if (!isTicketOwner && !hasStaffRole && !isAdmin) {
        await interaction.reply({ content: "Only ticket owner or staff can close this ticket.", ephemeral: true }).catch(() => {});
        return;
      }

      await interaction.reply({ content: "Closing ticket in 5 seconds...", ephemeral: true }).catch(() => {});

      await interaction.channel
        .setTopic(String(interaction.channel.topic || "").replace("ticket-status:open", "ticket-status:closed"))
        .catch(() => {});

      await sendTicketTranscript({
        guild: interaction.guild,
        channel: interaction.channel,
        closedByUser: interaction.user,
        runtimeConfig,
      });

      setTimeout(() => {
        interaction.channel
          .delete(`Ticket closed by ${interaction.user.tag} (${interaction.user.id})`)
          .catch(() => {});
      }, 5000);
    }
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isStringSelectMenu()) return;
    if (!interaction.customId.startsWith(TICKET_TYPE_SELECT_PREFIX)) return;

    const requestedByUserId = interaction.customId.slice(TICKET_TYPE_SELECT_PREFIX.length);
    if (interaction.user.id !== requestedByUserId) {
      await interaction.reply({ content: "This selection is not for you.", ephemeral: true }).catch(() => {});
      return;
    }

    const selectedType = sanitizeTicketType(interaction.values?.[0] || "other");
    const subjectInput = new TextInputBuilder()
      .setCustomId(TICKET_SUBJECT_INPUT_ID)
      .setLabel("Subject")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(300)
      .setPlaceholder("Tell staff what you need help with.");

    const modal = new ModalBuilder()
      .setCustomId(`${TICKET_SUBJECT_MODAL_PREFIX}${interaction.user.id}:${selectedType}`)
      .setTitle(`Create ${selectedType} Ticket`)
      .addComponents(new ActionRowBuilder().addComponents(subjectInput));

    await interaction.showModal(modal).catch(() => {});
  });

  client.on("interactionCreate", async (interaction) => {
    if (!interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith(TICKET_SUBJECT_MODAL_PREFIX)) return;

    const modalPayload = interaction.customId.slice(TICKET_SUBJECT_MODAL_PREFIX.length);
    const divider = modalPayload.indexOf(":");
    if (divider < 1) {
      await interaction.reply({ content: "Invalid ticket submission payload.", ephemeral: true }).catch(() => {});
      return;
    }

    const requestedByUserId = modalPayload.slice(0, divider);
    const ticketTypeFromPayload = sanitizeTicketType(modalPayload.slice(divider + 1));

    if (interaction.user.id !== requestedByUserId) {
      await interaction.reply({ content: "This ticket form is not for you.", ephemeral: true }).catch(() => {});
      return;
    }

    const runtimeConfig = getRuntimeConfig();
    if (!interaction.guild) {
      await interaction.reply({ content: "Tickets are only available in servers.", ephemeral: true }).catch(() => {});
      return;
    }

    if (!runtimeConfig.categoryId) {
      await interaction.reply({
        content: "Ticket category is not configured yet. Ask an admin to set ticketCategoryId.",
        ephemeral: true,
      }).catch(() => {});
      return;
    }

    const ticketSubject = interaction.fields.getTextInputValue(TICKET_SUBJECT_INPUT_ID).trim();

    await interaction.deferReply({ ephemeral: true });
    await createTicketForUser({
      interaction,
      runtimeConfig,
      ticketType: ticketTypeFromPayload,
      ticketSubject,
    });
  });
};

module.exports = tickets;
