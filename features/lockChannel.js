const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { PermissionFlagsBits } = require("discord.js");
const config = require("../config.json");

const PREFIX = "ct";

function getConfiguredRoleIds() {
    if (!Array.isArray(config.lockRoleIds)) return [];
    return [...new Set(config.lockRoleIds.filter((roleId) => typeof roleId === "string" && roleId.trim()))];
}

const lockChannel = () => {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;
        if (!message.guild || !message.channel) return;

        const content = message.content.trim();
        const lowerContent = content.toLowerCase();
        if (!lowerContent.startsWith(`${PREFIX} lock`) && !lowerContent.startsWith(`${PREFIX} unlock`)) return;

        if (!message.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply("You need Manage Channels permission to use this command.");
        }

        if (!message.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
            return message.reply("I need Manage Channels permission to update this channel.");
        }

        const isLock = lowerContent.startsWith(`${PREFIX} lock`);
        const targetRoleIds = getConfiguredRoleIds();

        if (targetRoleIds.length === 0) {
            return message.reply("No lock role IDs are configured in config.json.");
        }

        try {
            for (const roleId of targetRoleIds) {
                const role = message.guild.roles.cache.get(roleId);
                if (!role) continue;

                await message.channel.permissionOverwrites.edit(role, {
                    SendMessages: isLock ? false : null,
                });
            }

            return message.reply(
                isLock
                    ? `🔒 ${message.channel} has been locked for the configured roles.`
                    : `🔓 ${message.channel} has been unlocked for the configured roles.`
            );
        } catch (error) {
            console.error("Channel lock error:", error);
            return message.reply("I could not update the channel permissions.");
        }
    });
};

module.exports = lockChannel;