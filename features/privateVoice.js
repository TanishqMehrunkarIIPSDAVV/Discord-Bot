const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} = require("discord.js");

let registered = false;

const parseBool = (value, fallback) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return fallback;
};

const privateVoice = () => {
  if (registered) return;
  registered = true;

  const cfgPath = path.join(__dirname, "..", "config.json");
  let cfg = {};
  try {
    cfg = require(cfgPath);
  } catch {}

  const triggerChannelId =
    process.env.PRIVATE_VC_TRIGGER_CHANNEL_ID || cfg.privateVcTriggerChannelId;
  const defaultUserLimit = Number(
    process.env.PRIVATE_VC_DEFAULT_LIMIT || cfg.privateVcDefaultLimit || 5
  );
  const autoDelete = parseBool(
    process.env.PRIVATE_VC_AUTO_DELETE ?? cfg.privateVcAutoDelete,
    true
  );

  const ownerToChannel = new Map();
  const channelToOwner = new Map();
  const pendingAction = new Map();

  const getOwnedChannel = async (ownerId) => {
    const channelId = ownerToChannel.get(ownerId);
    if (!channelId) return null;

    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel) {
      ownerToChannel.delete(ownerId);
      channelToOwner.delete(channelId);
      return null;
    }

    return channel;
  };

  const buildControlPanel = () => {
    const embed = new EmbedBuilder()
      .setTitle("Private Voice Controls")
      .setDescription(
        "Use the buttons below to manage your private voice channel."
      );

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("pv_limit")
        .setLabel("User Limit")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pv_rename")
        .setLabel("Rename")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pv_lock")
        .setLabel("Lock")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId("pv_unlock")
        .setLabel("Unlock")
        .setStyle(ButtonStyle.Success)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("pv_mute")
        .setLabel("Mute/Unmute")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pv_deafen")
        .setLabel("Deafen/Undeafen")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("pv_disconnect")
        .setLabel("Disconnect")
        .setStyle(ButtonStyle.Secondary)
    );

    return { embed, components: [row1, row2] };
  };

  const sendControlPanel = async (channel) => {
    if (!channel || typeof channel.send !== "function" || !channel.messages) return;

    const messages = await channel.messages
      .fetch({ limit: 10 })
      .catch(() => []);

    const existing = messages.find(
      (m) =>
        m.author.id === client.user.id &&
        m.embeds.length > 0 &&
        m.embeds[0].title === "Private Voice Controls"
    );

    if (!existing) {
      const panel = buildControlPanel();
      await channel.send({ embeds: [panel.embed], components: panel.components }).catch(() => {});
    }
  };

  const createPrivateChannel = async (state) => {
    if (!state.guild || !state.member || !state.channel) return null;

    const existing = await getOwnedChannel(state.id);
    if (existing) {
      await sendControlPanel(existing);
      return existing;
    }

    const parentId = state.channel.parentId || null;
    const guild = state.guild;

    const channel = await guild.channels.create({
      name: `${state.member.user.username}-vc`,
      type: ChannelType.GuildVoice,
      parent: parentId,
      userLimit: Number.isFinite(defaultUserLimit) ? defaultUserLimit : 0,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: ["ViewChannel", "Connect"],
        },
        {
          id: state.id,
          allow: [
            "ViewChannel",
            "Connect",
            "Speak",
            "Stream",
            "UseVAD",
            "PrioritySpeaker",
            "MuteMembers",
            "DeafenMembers",
            "MoveMembers",
          ],
        },
        {
          id: client.user.id,
          allow: [
            "ViewChannel",
            "Connect",
            "Speak",
            "ManageChannels",
            "MuteMembers",
            "DeafenMembers",
            "MoveMembers",
          ],
        },
      ],
    });

    ownerToChannel.set(state.id, channel.id);
    channelToOwner.set(channel.id, state.id);

    await sendControlPanel(channel);
    return channel;
  };

  const deletePrivateChannelIfEmpty = async (channelId) => {
    if (!autoDelete) return;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildVoice) return;

    if (channel.members.size > 0) return;

    await channel.delete().catch(() => {});
    const ownerId = channelToOwner.get(channelId);
    if (ownerId) ownerToChannel.delete(ownerId);
    channelToOwner.delete(channelId);
  };

  client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
      if (newState.channelId === triggerChannelId) {
        const created = await createPrivateChannel(newState);
        if (created) {
          await newState.setChannel(created).catch(() => {});
        }
      }

      if (oldState.channelId && channelToOwner.has(oldState.channelId)) {
        await deletePrivateChannelIfEmpty(oldState.channelId);
      }
    } catch (err) {
      // Silent error handling
    }
  });

  client.on("channelDelete", (channel) => {
    if (!channel || !channelToOwner.has(channel.id)) return;
    const ownerId = channelToOwner.get(channel.id);
    if (ownerId) ownerToChannel.delete(ownerId);
    channelToOwner.delete(channel.id);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton()) {
        if (
          ![
            "pv_limit",
            "pv_rename",
            "pv_lock",
            "pv_unlock",
            "pv_mute",
            "pv_deafen",
            "pv_disconnect",
          ].includes(interaction.customId)
        ) {
          return;
        }

        const ownedChannel = await getOwnedChannel(interaction.user.id);
        if (!ownedChannel) {
          await interaction.reply({
            content: "You do not have an active private voice channel.",
            ephemeral: true,
          });
          return;
        }

        if (interaction.channelId !== ownedChannel.id) {
          await interaction.reply({
            content: "Use the controls in your private voice channel chat.",
            ephemeral: true,
          });
          return;
        }

        if (!interaction.member?.voice?.channelId || interaction.member.voice.channelId !== ownedChannel.id) {
          await interaction.reply({
            content: "Join your private voice channel first.",
            ephemeral: true,
          });
          return;
        }

        if (interaction.customId === "pv_lock") {
          await ownedChannel.permissionOverwrites.edit(ownedChannel.guild.id, {
            ViewChannel: false,
            Connect: false,
          });
          await interaction.reply({ content: "Channel locked.", ephemeral: true });
          return;
        }

        if (interaction.customId === "pv_unlock") {
          await ownedChannel.permissionOverwrites.edit(ownedChannel.guild.id, {
            ViewChannel: true,
            Connect: true,
          });
          await interaction.reply({ content: "Channel unlocked.", ephemeral: true });
          return;
        }

        if (interaction.customId === "pv_limit") {
          const modal = new ModalBuilder()
            .setCustomId("pv_limit_modal")
            .setTitle("Set User Limit");

          const input = new TextInputBuilder()
            .setCustomId("pv_limit_value")
            .setLabel("Enter a number (0 for no limit)")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
          return;
        }

        if (interaction.customId === "pv_rename") {
          const modal = new ModalBuilder()
            .setCustomId("pv_rename_modal")
            .setTitle("Rename Channel");

          const input = new TextInputBuilder()
            .setCustomId("pv_rename_value")
            .setLabel("New channel name")
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(input));
          await interaction.showModal(modal);
          return;
        }

        if (["pv_mute", "pv_deafen", "pv_disconnect"].includes(interaction.customId)) {
          pendingAction.set(interaction.user.id, {
            action: interaction.customId,
            channelId: ownedChannel.id,
          });

          const select = new UserSelectMenuBuilder()
            .setCustomId(`pv_user_select_${interaction.customId}`)
            .setPlaceholder("Select a user")
            .setMinValues(1)
            .setMaxValues(1);

          await interaction.reply({
            content: "Select a user from your channel:",
            components: [new ActionRowBuilder().addComponents(select)],
            ephemeral: true,
          });
        }
      }

      if (interaction.isModalSubmit()) {
        if (!interaction.customId.startsWith("pv_")) return;

        const ownedChannel = await getOwnedChannel(interaction.user.id);
        if (!ownedChannel) {
          await interaction.reply({
            content: "You do not have an active private voice channel.",
            ephemeral: true,
          });
          return;
        }

        if (interaction.customId === "pv_limit_modal") {
          const raw = interaction.fields.getTextInputValue("pv_limit_value");
          const limit = Number.parseInt(raw, 10);
          if (!Number.isFinite(limit) || limit < 0 || limit > 99) {
            await interaction.reply({
              content: "Please enter a number between 0 and 99.",
              ephemeral: true,
            });
            return;
          }
          await ownedChannel.setUserLimit(limit).catch(() => {});
          await interaction.reply({ content: "User limit updated.", ephemeral: true });
          return;
        }

        if (interaction.customId === "pv_rename_modal") {
          const raw = interaction.fields.getTextInputValue("pv_rename_value");
          const name = raw.trim().slice(0, 96);
          if (!name) {
            await interaction.reply({ content: "Name cannot be empty.", ephemeral: true });
            return;
          }
          await ownedChannel.setName(name).catch(() => {});
          await interaction.reply({ content: "Channel renamed.", ephemeral: true });
        }
      }

      if (interaction.isUserSelectMenu()) {
        if (!interaction.customId.startsWith("pv_user_select_")) return;

        const pending = pendingAction.get(interaction.user.id);
        if (!pending) {
          await interaction.reply({ content: "No pending action.", ephemeral: true });
          return;
        }

        const channel = await client.channels.fetch(pending.channelId).catch(() => null);
        if (!channel) {
          pendingAction.delete(interaction.user.id);
          await interaction.reply({ content: "Channel not found.", ephemeral: true });
          return;
        }

        const targetId = interaction.values[0];
        const member = channel.members.get(targetId);
        if (!member) {
          pendingAction.delete(interaction.user.id);
          await interaction.reply({ content: "User is not in your channel.", ephemeral: true });
          return;
        }

        if (pending.action === "pv_mute") {
          const next = !member.voice.serverMute;
          await member.voice.setMute(next).catch(() => {});
          await interaction.reply({
            content: next ? "User muted." : "User unmuted.",
            ephemeral: true,
          });
        } else if (pending.action === "pv_deafen") {
          const next = !member.voice.serverDeaf;
          await member.voice.setDeaf(next).catch(() => {});
          await interaction.reply({
            content: next ? "User deafened." : "User undeafened.",
            ephemeral: true,
          });
        } else if (pending.action === "pv_disconnect") {
          await member.voice.setChannel(null).catch(() => {});
          await interaction.reply({ content: "User disconnected.", ephemeral: true });
        }

        pendingAction.delete(interaction.user.id);
      }
    } catch (err) {
      // Silent error handling
    }
  });
};

module.exports = privateVoice;
