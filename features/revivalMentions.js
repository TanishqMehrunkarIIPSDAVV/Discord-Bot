const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const config = require("../config.json");
const { PermissionFlagsBits } = require("discord.js");

const CHAT_REVIVAL_NAME = "chat revival";
const VC_REVIVAL_NAME = "vc revival";
const CHAT_TRIGGER_REGEX = /^chat\s+revival$/i;
const VC_TRIGGER_REGEX = /^vc\s+revival$/i;

const CHAT_REVIVAL_ROLE_ID = String(
  process.env.CHAT_REVIVAL_ROLE_ID || config.chatRevivalRoleId || ""
).trim();
const VC_REVIVAL_ROLE_ID = String(
  process.env.VC_REVIVAL_ROLE_ID || config.vcRevivalRoleId || ""
).trim();

let rolesHydrated = false;

function isTargetRole(role, expectedId, expectedName) {
  if (!role) return false;
  if (expectedId && role.id === expectedId) return true;
  return role.name.toLowerCase() === expectedName;
}

function getTriggerRequests(content) {
  return {
    wantsChat: CHAT_TRIGGER_REGEX.test(content),
    wantsVc: VC_TRIGGER_REGEX.test(content),
  };
}

async function resolveTargetRoles(guild) {
  const roles = [...guild.roles.cache.values()];
  const chatRole = roles.find((role) =>
    isTargetRole(role, CHAT_REVIVAL_ROLE_ID, CHAT_REVIVAL_NAME)
  );
  const vcRole = roles.find((role) =>
    isTargetRole(role, VC_REVIVAL_ROLE_ID, VC_REVIVAL_NAME)
  );
  return { chatRole, vcRole };
}

async function enforceNonMentionable(guild, roles) {
  if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return;
  }

  if (roles.chatRole?.mentionable) {
    await roles.chatRole
      .setMentionable(false, "Enforce controlled Chat Revival mentions")
      .catch(() => {});
  }
  if (roles.vcRole?.mentionable) {
    await roles.vcRole
      .setMentionable(false, "Enforce controlled VC Revival mentions")
      .catch(() => {});
  }
}

async function sendAuthorizedProxyPing(message, roles, shouldPingChat, shouldPingVc) {
  const mentionIds = [];
  if (shouldPingChat && roles.chatRole) mentionIds.push(roles.chatRole.id);
  if (shouldPingVc && roles.vcRole) mentionIds.push(roles.vcRole.id);
  if (!mentionIds.length) return;

  await message.channel
    .send({
      content: mentionIds.map((id) => `<@&${id}>`).join(" "),
      allowedMentions: { roles: mentionIds, users: [], parse: [] },
    })
    .catch(() => {});
}

async function sendWarning(message, reasons) {
  if (!reasons.length) return;

  const warning = await message.channel
    .send({
      content: `<@${message.author.id}> ${reasons.join(" and ")}.`,
      allowedMentions: { users: [message.author.id], roles: [], parse: [] },
    })
    .catch(() => null);

  if (warning) {
    setTimeout(() => {
      warning.delete().catch(() => {});
    }, 7000);
  }
}

function revivalMentions() {
  client.on("clientReady", async () => {
    for (const guild of client.guilds.cache.values()) {
      const roles = await resolveTargetRoles(guild);
      await enforceNonMentionable(guild, roles);
    }
    rolesHydrated = true;
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild || !message.member) return;

    if (!rolesHydrated) {
      const roles = await resolveTargetRoles(message.guild);
      await enforceNonMentionable(message.guild, roles);
      rolesHydrated = true;
    }

    const { wantsChat, wantsVc } = getTriggerRequests(message.content || "");
    const mentionedRoles = message.mentions?.roles ? [...message.mentions.roles.values()] : [];
    const mentionsChatRevival = mentionedRoles.some((role) =>
      isTargetRole(role, CHAT_REVIVAL_ROLE_ID, CHAT_REVIVAL_NAME)
    );
    const mentionsVcRevival = mentionedRoles.some((role) =>
      isTargetRole(role, VC_REVIVAL_ROLE_ID, VC_REVIVAL_NAME)
    );

    const requestChat = wantsChat || mentionsChatRevival;
    const requestVc = wantsVc || mentionsVcRevival;
    if (!requestChat && !requestVc) return;

    const roles = await resolveTargetRoles(message.guild);

    const hasManageMessages = message.member.permissions.has(
      PermissionFlagsBits.ManageMessages
    );
    const hasMuteMembers = message.member.permissions.has(PermissionFlagsBits.MuteMembers);

    const canPingChat = requestChat && hasManageMessages;
    const canPingVc = requestVc && hasMuteMembers;

    const botCanDelete = message.guild.members.me
      ?.permissionsIn(message.channel)
      .has(PermissionFlagsBits.ManageMessages);

    if ((mentionsChatRevival || mentionsVcRevival) && botCanDelete) {
      await message.delete().catch(() => {});
    }

    await sendAuthorizedProxyPing(message, roles, canPingChat, canPingVc);

    const reasons = [];
    if (requestChat && !hasManageMessages) {
      reasons.push("you need Manage Messages to trigger Chat Revival");
    }
    if (requestVc && !hasMuteMembers) {
      reasons.push("you need Mute Members to trigger VC Revival");
    }

    await sendWarning(message, reasons);
  });
}

module.exports = revivalMentions;
