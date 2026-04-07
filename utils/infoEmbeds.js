const { EmbedBuilder } = require("discord.js");

const formatTimestamp = (value) => {
  if (!value) return "Unknown";
  const time = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(time) || time <= 0) return "Unknown";
  return `<t:${Math.floor(time / 1000)}:F>`;
};

const buildUserInfoEmbed = ({ guild, member, user, requestedBy }) => {
  const avatar = user.displayAvatarURL({ size: 256 });
  const joinedCount = member ? member.roles.cache.filter((role) => role.id !== guild.id).size : 0;

  const embed = new EmbedBuilder()
    .setColor(member?.displayHexColor && member.displayHexColor !== "#000000" ? member.displayHexColor : "#5865F2")
    .setTitle(`User Info • ${user.username}`)
    .setThumbnail(avatar)
    .addFields(
      { name: "Username", value: user.tag || user.username, inline: true },
      { name: "ID", value: user.id, inline: true },
      { name: "Mention", value: `<@${user.id}>`, inline: true },
      { name: "Account Created", value: formatTimestamp(user.createdTimestamp), inline: true },
      {
        name: "Joined Server",
        value: member ? formatTimestamp(member.joinedTimestamp) : "Not in this server",
        inline: true,
      },
      {
        name: "Highest Role",
        value: member ? member.roles.highest.toString() : "Unknown",
        inline: true,
      },
      { name: "Role Count", value: member ? String(joinedCount) : "0", inline: true },
      {
        name: "Boosting",
        value: member?.premiumSinceTimestamp ? `Since ${formatTimestamp(member.premiumSinceTimestamp)}` : "No",
        inline: true,
      },
      { name: "Bot", value: user.bot ? "Yes" : "No", inline: true },
    );

  if (requestedBy) {
    embed.setFooter({ text: `Requested by ${requestedBy.tag || requestedBy.username}` });
  }

  return embed;
};

const buildRoleInfoEmbed = ({ role, requestedBy }) => {
  const permissions = role.permissions?.toArray?.() || [];
  const permissionText = permissions.length
    ? permissions.slice(0, 12).join(", ") + (permissions.length > 12 ? `, +${permissions.length - 12} more` : "")
    : "None";

  const embed = new EmbedBuilder()
    .setColor(role.color || 0x5865f2)
    .setTitle(`Role Info • ${role.name}`)
    .addFields(
      { name: "Role Name", value: role.name, inline: true },
      { name: "ID", value: role.id, inline: true },
      { name: "Mention", value: role.toString(), inline: true },
      { name: "Members", value: String(role.members?.size ?? 0), inline: true },
      { name: "Position", value: String(role.position), inline: true },
      { name: "Color", value: role.hexColor || "Default", inline: true },
      { name: "Hoisted", value: role.hoist ? "Yes" : "No", inline: true },
      { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
      { name: "Permissions", value: permissionText },
      { name: "Created", value: formatTimestamp(role.createdTimestamp), inline: true },
    );

  if (requestedBy) {
    embed.setFooter({ text: `Requested by ${requestedBy.tag || requestedBy.username}` });
  }

  return embed;
};

module.exports = {
  buildUserInfoEmbed,
  buildRoleInfoEmbed,
};