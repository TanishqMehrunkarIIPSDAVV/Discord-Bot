const fs = require("node:fs");
const path = require("node:path");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, channelMention } = require("discord.js");

const configPath = path.join(__dirname, "..", "config.json");

const loadConfig = () => {
    try {
        return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch {
        return {};
    }
};

const pickFirstString = (cfg, keys) => {
    for (const key of keys) {
        const value = cfg[key];
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
    }
    return "";
};

const fmtChannel = (channelId, fallback) => (channelId ? channelMention(channelId) : fallback);

const formatAiChannels = (cfg) => {
    if (!Array.isArray(cfg.aiReplyChannelIds) || cfg.aiReplyChannelIds.length === 0) {
        return "configured AI channels";
    }

    const list = cfg.aiReplyChannelIds
        .filter((id) => typeof id === "string" && id.trim())
        .map((id) => channelMention(id));

    return list.length ? list.join(", ") : "configured AI channels";
};

const getHelpPages = () => {
    const cfg = loadConfig();

    const complaintWriteChannel = fmtChannel(cfg.complaintButtonChannelId, "configured complaint channel");
    const complaintFeedChannel = fmtChannel(cfg.complaintDisplayChannelId, "configured complaint feed channel");
    const complaintAdminChannel = fmtChannel(cfg.complaintAdminChannelId, "configured complaint admin channel");
    const confessionInputChannel = fmtChannel(cfg.confessionInputChannelId, "configured confession input channel");
    const confessionOutputChannel = fmtChannel(cfg.confessionOutputChannelId, "configured confession output channel");
    const confessionAdminChannel = fmtChannel(cfg.confessionAdminChannelId, "configured confession admin channel");
    const privateVcTriggerChannel = fmtChannel(cfg.privateVcTriggerChannelId, "configured private VC trigger");
    const messageLogChannel = fmtChannel(cfg.messageLogChannelId, "configured message log channel");
    const memberLogChannel = fmtChannel(cfg.memberLogChannelId, "configured member log channel");
    const channelLogChannel = fmtChannel(cfg.channelLogChannelId, "configured channel log channel");
    const voiceLogChannel = fmtChannel(cfg.voiceLogChannelId, "configured voice log channel");
    const modLogChannel = fmtChannel(cfg.modLogChannelId, "configured mod log channel");
    const verifyChannelId = pickFirstString(cfg, ["verifyChannelId", "verificationChannelId", "verificationFlowChannelId"]);
    const verifyChannel = fmtChannel(verifyChannelId, "configured verify channel");
    const aiReplyChannels = formatAiChannels(cfg);

    return [
        new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Help • Slash Commands (1/3)")
        .setThumbnail("attachment://thumbnail.jpg")
        .setDescription(
            `👋 **Quick Start**\n` +
            `Use \`/help\` or \`ct help\` to open this panel anytime.\n\n` +
            `🧭 **Core**\n` +
            `• </help:> or ct help: Open help menu\n` +
            `• </ping:> Check bot latency\n` +
            `• </avatar:> Show avatar\n` +
            `• </user:> Show user info\n` +
            `• </server:> Show server info\n` +
            `• </prune:> Delete 1-99 messages\n\n` +
            `🎭 **Fun / Utility**\n` +
            `• </die:> Cringe reaction GIF\n` +
            `• </options-info:> Echo input\n` +
            `• </plead:> Plead to a user\n` +
            `• </punch:> Punch a user\n` +
            `• </slap:> Slap a user\n` +
            `• </test:> Testing command\n\n` +
            `🔊 **Voice & Moderation**\n` +
            `• </removeme:> Schedule VC removal\n` +
            `• </vcguard:> Enable/disable VC guard\n`
        )
        .setFooter({ text: "Use the ⏭️ Next and ⏮️ Previous buttons to navigate pages!" }),
        new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Help • Prefix Commands (2/3)")
        .setThumbnail("attachment://thumbnail.jpg")
        .setDescription(
            `🛡️ **Moderation**\n` +
            `• \`ct kick <user> [reason]\` Kick member\n` +
            `• \`ct ban <user> [reason]\` Ban member\n` +
            `• \`ct unban <userId> [reason]\` Remove ban\n` +
            `• \`ct mute <user> [minutes] [reason]\` Timeout member\n` +
            `• \`ct unmute <user> [reason]\` Remove timeout\n` +
            `• \`ct lock\` Lock this channel for configured lock roles\n` +
            `• \`ct unlock\` Unlock this channel for configured lock roles\n\n` +
            `🎛️ **Server Tools**\n` +
            `• \`ct move <from> <to>\` Move VC users\n` +
            `• \`ct announce <text>\` Post announcement in current channel\n` +
            `• \`ct postboymod [text]\` Post boy-mod application panel\n` +
            `• \`ct postgirlmod [text]\` Post girl-mod application panel\n` +
            `• \`ct vc\` Mention users in your VC\n`
        )
        .setFooter({ text: "Use the ⏮️ Previous and ⏭️ Next buttons to navigate pages!" }),
        new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Help • Systems & Channels (3/3)")
        .setThumbnail("attachment://thumbnail.jpg")
        .setDescription(
            `📝 **Complaints**\n` +
            `• File complaint button: ${complaintWriteChannel}\n` +
            `• Complaint feed: ${complaintFeedChannel}\n` +
            `• Complaint admin review: ${complaintAdminChannel}\n\n` +
            `🕵️ **Confessions**\n` +
            `• Start confession: ${confessionInputChannel}\n` +
            `• Anonymous posts go to: ${confessionOutputChannel}\n` +
            `📊 **Logs**\n` +
            `• Message logs: ${messageLogChannel}\n` +
            `• Member logs: ${memberLogChannel}\n` +
            `• Channel logs: ${channelLogChannel}\n` +
            `• Voice logs: ${voiceLogChannel}\n` +
            `• Mod logs: ${modLogChannel}\n\n` +
            `🔊 **Other Active Systems**\n` +
            `• Private VC trigger: ${privateVcTriggerChannel}\n` +
            `• AI reply channels: ${aiReplyChannels}\n` +
            `• Verification flow channel: ${verifyChannel}\n` +
            `• Welcome/leave embeds, spam auto-timeout, revival pings, ping/pong, vanity and voice-role sync are active.`
        )
        .setFooter({ text: "Use the ⏮️ Previous and ⏭️ Next buttons to navigate pages!" }),
        ];
    };

function getHelpRow(page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("prev")
            .setLabel("⏮️ Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page === 0),
        new ButtonBuilder()
            .setCustomId("next")
            .setLabel("Next ⏭️")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(page === totalPages - 1),
        new ButtonBuilder()
            .setCustomId("close")
            .setLabel("❌ Close")
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    getHelpPages,
    getHelpRow,
};