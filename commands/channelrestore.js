const { PermissionFlagsBits, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const { getGuildChannelNames } = require("../utils/channelNameStore");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("channelrestore")
    .setDescription("Restore channel names from the last saved snapshot")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({ content: "This command can only be used in a server.", flags: 64 });
    }

    const guild = interaction.guild;
    const snapshot = getGuildChannelNames(guild.id);

    if (!snapshot || !snapshot.channels || typeof snapshot.channels !== "object") {
      return interaction.reply({
        content: "No saved channel snapshot was found for this server.",
        flags: 64,
      });
    }

    // Build a preview diff of channels that would be renamed
    const diffs = [];
    for (const [channelId, channelData] of Object.entries(snapshot.channels)) {
      const targetName = typeof channelData?.originalName === "string"
        ? channelData.originalName.trim()
        : (typeof channelData?.name === "string" ? channelData.name.trim() : "");

      if (!targetName) continue;

      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      const currentName = channel && typeof channel.name === "string" ? channel.name : null;

      if (!channel) {
        diffs.push({ channelId, currentName: null, targetName });
        continue;
      }

      if (currentName !== targetName) {
        diffs.push({ channelId, currentName, targetName });
      }
    }

    if (diffs.length === 0) {
      return interaction.reply({ content: "No channel names need to be changed — everything matches the saved snapshot.", flags: 64 });
    }

    // Prepare a preview file with the full list
    const previewLines = diffs.map(d => `${d.channelId} | ${d.currentName === null ? '<missing>' : d.currentName} => ${d.targetName}`);
    const previewText = previewLines.join("\n");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('confirm_restore').setLabel('Confirm').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cancel_restore').setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );

    const reply = await interaction.reply({
      content: `Found **${diffs.length}** channels that would be renamed. Review the preview and Confirm to apply changes.`,
      files: [{ attachment: Buffer.from(previewText, 'utf8'), name: 'channel-restore-preview.txt' }],
      components: [row],
      flags: 64,
      fetchReply: true,
    });

    const collector = reply.createMessageComponentCollector({ time: 120000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: 'Only the command invoker can confirm the restore.', flags: 64 });
      }

      if (i.customId === 'cancel_restore') {
        collector.stop('cancelled');
        try {
          const disabled = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_restore').setLabel('Confirm').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('cancel_restore').setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(true),
          );
          await i.update({ content: 'Restore cancelled by user.', components: [disabled] });
        } catch {}
        return;
      }

      if (i.customId === 'confirm_restore') {
        // Disable buttons immediately
        const disabled = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('confirm_restore').setLabel('Confirm').setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId('cancel_restore').setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(true),
        );
        await i.update({ content: 'Applying restore — this may take a moment.', components: [disabled] }).catch(() => {});
        collector.stop('confirmed');

        // Apply changes
        let restored = 0;
        let skipped = 0;
        let failed = 0;

        for (const d of diffs) {
          const { channelId, targetName } = d;
          const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
          if (!channel || typeof channel.setName !== 'function') {
            skipped += 1;
            continue;
          }

          try {
            if (channel.name === targetName) {
              skipped += 1;
              continue;
            }
            await channel.setName(targetName, 'Restoring saved channel names from snapshot');
            restored += 1;
          } catch (err) {
            failed += 1;
          }
        }

        try {
          await interaction.editReply({
            content: [
              `Restore complete: **${restored}** applied, **${skipped}** skipped, **${failed}** failed.`,
              'The snapshot is matched by channel ID, so renamed channels stay tied to the same channel.',
            ].join('\n'),
            components: [],
          });
        } catch {}
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'time') {
        try {
          const disabled = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('confirm_restore').setLabel('Confirm').setStyle(ButtonStyle.Success).setDisabled(true),
            new ButtonBuilder().setCustomId('cancel_restore').setLabel('Cancel').setStyle(ButtonStyle.Danger).setDisabled(true),
          );
          await interaction.editReply({ content: 'Restore timed out (no confirmation received).', components: [disabled] });
        } catch {}
      }
    });
  },
};