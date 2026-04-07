const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { buildUserInfoEmbed, buildRoleInfoEmbed } = require("../utils/infoEmbeds");

const resolveUserTarget = async (message, rawArg) => {
  const arg = (rawArg || "").replace(/[<@!>]/g, "").trim();
  if (!arg) {
    return { member: message.member, user: message.author };
  }

  const mentionedMember = message.mentions.members.first();
  if (mentionedMember) return { member: mentionedMember, user: mentionedMember.user };

  const cachedMember = message.guild.members.cache.get(arg);
  if (cachedMember) return { member: cachedMember, user: cachedMember.user };

  const fetchedMember = await message.guild.members.fetch(arg).catch(() => null);
  if (fetchedMember) return { member: fetchedMember, user: fetchedMember.user };

  const fetchedUser = await client.users.fetch(arg).catch(() => null);
  if (fetchedUser) return { member: null, user: fetchedUser };

  return null;
};

const resolveRole = async (message, rawArg) => {
  const arg = (rawArg || "").replace(/[<@&>]/g, "").trim();
  if (!arg) return null;

  const mentionedRole = message.mentions.roles.first();
  if (mentionedRole) return mentionedRole;

  const cachedRole = message.guild.roles.cache.get(arg);
  if (cachedRole) return cachedRole;

  return message.guild.roles.fetch(arg).catch(() => null);
};

const info = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    if (!lower.startsWith("ct userinfo") && !lower.startsWith("ct roleinfo")) return;

    const parts = content.split(/\s+/g);
    const command = (parts[1] || "").toLowerCase();

    if (command === "userinfo") {
      const target = await resolveUserTarget(message, parts[2]);
      if (!target) {
        return message.reply("I could not find that user. Mention them or provide their user ID.");
      }

      const embed = buildUserInfoEmbed({
        guild: message.guild,
        member: target.member,
        user: target.user,
        requestedBy: message.author,
      });

      return message.channel.send({ embeds: [embed] });
    }

    if (command === "roleinfo") {
      const targetRole = await resolveRole(message, parts[2]);
      if (!targetRole) {
        return message.reply("I could not find that role. Mention it or provide the role ID.");
      }

      const embed = buildRoleInfoEmbed({
        role: targetRole,
        requestedBy: message.author,
      });

      return message.channel.send({ embeds: [embed] });
    }
  });
};

module.exports = info;