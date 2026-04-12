const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  getUserGradientRole,
  saveUserGradientRole,
} = require('../utils/gradientRoleStore');

const ROLE_POSITION = 60;

const buildGradientRoleName = (startColor, endColor) => `GRAD-${startColor}-${endColor}`;

/**
 * Validate hex color format
 */
const isValidHex = (hex) => {
  return /^#?[0-9A-Fa-f]{6}$/.test(hex);
};

/**
 * Normalize hex color (remove # if present, uppercase)
 */
const normalizeHex = (hex) => {
  return hex.replace(/^#/, '').toUpperCase();
};

/**
 * Convert hex string to decimal for Discord API
 */
const hexToDecimal = (hex) => {
  return parseInt(hex.replace(/^#/, ''), 16);
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('gradientrole')
    .setDescription('Create a gradient role with custom start and end colors')
    .addStringOption(option =>
      option
        .setName('start_color')
        .setDescription('Start color of gradient (hex format, e.g., #FF0000)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('end_color')
        .setDescription('End color of gradient (hex format, e.g., #0000FF)')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: 64 });

    const startColorInput = interaction.options.getString('start_color');
    const endColorInput = interaction.options.getString('end_color');

    // Validate hex colors
    if (!isValidHex(startColorInput)) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('Red')
            .setTitle('Invalid Start Color')
            .setDescription('Start color must be in hex format (e.g., #FF0000 or FF0000)'),
        ],
      });
    }

    if (!isValidHex(endColorInput)) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('Red')
            .setTitle('Invalid End Color')
            .setDescription('End color must be in hex format (e.g., #0000FF or 0000FF)'),
        ],
      });
    }

    // Normalize colors
    const startColor = normalizeHex(startColorInput);
    const endColor = normalizeHex(endColorInput);
    const roleName = buildGradientRoleName(startColor, endColor);

    // Check if same color
    if (startColor === endColor) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('Yellow')
            .setTitle('Same Colors')
            .setDescription('Start and end colors should be different for a visible gradient'),
        ],
      });
    }

    const guild = interaction.guild;
    const botMember = guild.members.me;

    // Check bot permissions
    if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('Red')
            .setTitle('Missing Permissions')
            .setDescription('I need the "Manage Roles" permission to create roles'),
        ],
      });
    }

    // Check bot hierarchy
    const botHighestRole = botMember.roles.highest;
    if (botHighestRole.position <= 0) {
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('Red')
            .setTitle('Role Hierarchy Issue')
            .setDescription('My highest role is too low to create new roles'),
        ],
      });
    }

    try {
      const existingGradientRole = guild.roles.cache.find(role => role.name === roleName);

      // Get user's previous gradient role and remove it
      const previousRole = getUserGradientRole(guild.id, interaction.user.id);
      if (previousRole) {
        try {
          const oldRole = guild.roles.cache.get(previousRole.roleId);
          if (oldRole) {
            // If user already has the exact target gradient role, keep it and finish early.
            if (existingGradientRole && oldRole.id === existingGradientRole.id) {
              if (!interaction.member.roles.cache.has(oldRole.id)) {
                await interaction.member.roles.add(oldRole);
              }

              saveUserGradientRole(guild.id, interaction.user.id, oldRole.id, startColor, endColor);

              const alreadyAssignedEmbed = new EmbedBuilder()
                .setColor(hexToDecimal(startColor))
                .setTitle('✅ Gradient Role Assigned')
                .addFields(
                  { name: 'Role Name', value: oldRole.name, inline: true },
                  { name: 'Role ID', value: oldRole.id, inline: true },
                  { name: 'Position', value: `${oldRole.position}`, inline: true },
                  { name: 'Start Color', value: `#${startColor}`, inline: true },
                  { name: 'End Color', value: `#${endColor}`, inline: true },
                  { name: 'Style', value: 'Gradient', inline: true }
                )
                .setDescription('An existing role with the same gradient already exists, so it was assigned to you.');

              return interaction.editReply({ embeds: [alreadyAssignedEmbed] });
            }

            // Remove role from user
            await interaction.member.roles.remove(oldRole).catch(() => {});
            
            // Delete old role if it has no members
            if (oldRole.name.startsWith('GRAD-') && oldRole.members.size === 0) {
              await oldRole.delete('Cleaning up old gradient role').catch(() => {});
            }
          }
        } catch (error) {
          console.error('Error removing previous gradient role:', error);
        }
      }

      // Fixed role position required by server policy
      const rolePosition = ROLE_POSITION;
      if (botHighestRole.position <= rolePosition) {
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setColor('Red')
              .setTitle('Role Hierarchy Issue')
              .setDescription(`I cannot place roles at position ${rolePosition}. Move my highest role above that position and try again.`),
          ],
        });
      }

      // Create role with gradient colors
      const startColorDecimal = hexToDecimal(startColor);
      const endColorDecimal = hexToDecimal(endColor);
      let targetRole = existingGradientRole;
      let actionLabel = 'Assigned Existing';

      if (!targetRole) {
        targetRole = await guild.roles.create({
          name: roleName,
          colors: {
            primaryColor: startColorDecimal,
            secondaryColor: endColorDecimal,
          },
          position: rolePosition,
          reason: `Gradient role created by ${interaction.user.tag}`,
        });
        actionLabel = 'Created and Assigned';
      }

      // Assign role to user
      await interaction.member.roles.add(targetRole);

      // Save mapping
      saveUserGradientRole(guild.id, interaction.user.id, targetRole.id, startColor, endColor);

      // Build response embed
      const responseEmbed = new EmbedBuilder()
        .setColor(startColorDecimal)
        .setTitle('✅ Gradient Role Ready')
        .addFields(
          { name: 'Action', value: actionLabel, inline: true },
          { name: 'Role Name', value: targetRole.name, inline: true },
          { name: 'Role ID', value: targetRole.id, inline: true },
          { name: 'Position', value: `${targetRole.position}`, inline: true },
          { name: 'Start Color', value: `#${startColor}`, inline: true },
          { name: 'End Color', value: `#${endColor}`, inline: true },
          { name: 'Style', value: 'Gradient', inline: true }
        )
        .setDescription(`Gradient colors: #${startColor} → #${endColor}`)
        .setFooter({ text: 'If you had a previous gradient role, it has been removed.' });

      return interaction.editReply({ embeds: [responseEmbed] });
    } catch (error) {
      console.error('Error creating gradient role:', error);
      return interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor('Red')
            .setTitle('Error Creating Role')
            .setDescription(`An error occurred: ${error.message}`),
        ],
      });
    }
  },
};
