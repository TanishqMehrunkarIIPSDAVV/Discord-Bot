const { SlashCommandBuilder, EmbedBuilder, channelMention, userMention } = require("discord.js");
const { ensureHistoryLoaded, queryLoreHistory, buildScopeLabel } = require("../utils/chatLoreStore");

function formatTimestamp(value) {
    if (!value) return null;
    return `<t:${Math.floor(Number(value) / 1000)}:F>`;
}

function formatDuration(startedAt, endedAt) {
    const deltaMs = Math.max(0, Number(endedAt) - Number(startedAt));
    const totalMinutes = Math.max(1, Math.round(deltaMs / 60000));
    if (totalMinutes < 60) {
        return `${totalMinutes} minute${totalMinutes === 1 ? "" : "s"}`;
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (!minutes) {
        return `${hours} hour${hours === 1 ? "" : "s"}`;
    }

    return `${hours} hour${hours === 1 ? "" : "s"} ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName("lore")
        .setDescription("Summarize explainable chat lore from tracked conversations.")
        .addUserOption((option) =>
            option
                .setName("user")
                .setDescription("The main user to inspect")
        )
        .addUserOption((option) =>
            option
                .setName("partner")
                .setDescription("Optional second user to focus on a pair")
        )
        .addChannelOption((option) =>
            option
                .setName("channel")
                .setDescription("Optional channel to narrow the history")
        )
        .addIntegerOption((option) =>
            option
                .setName("limit")
                .setDescription("How many chat segments to summarize")
                .setMinValue(1)
                .setMaxValue(5)
        ),
    async execute(interaction) {
        await ensureHistoryLoaded();

        if (!interaction.guild) {
            return interaction.reply({ content: "This command only works inside a server.", flags: 64 });
        }

        const userOption = interaction.options.getUser("user");
        const partner = interaction.options.getUser("partner");
        const channel = interaction.options.getChannel("channel");
        const limit = interaction.options.getInteger("limit") || 3;

        // Determine scope: channel-wide by default, or user-specific if user/partner provided
        let userIds = [];
        let scopeType = "channel"; // "channel", "user", "pair"
        let scopeLabel = "";

        if (userOption || partner) {
            // User or pair scope
            userIds.push(userOption?.id || interaction.user.id);
            if (partner) {
                userIds.push(partner.id);
                scopeType = "pair";
                scopeLabel = buildScopeLabel({
                    userMentions: [userMention(userIds[0]), userMention(userIds[1])],
                    channelMentionText: channel ? channelMention(channel.id) : null,
                });
            } else {
                scopeType = "user";
                scopeLabel = buildScopeLabel({
                    userMentions: [userMention(userIds[0])],
                    channelMentionText: channel ? channelMention(channel.id) : null,
                });
            }
        } else if (channel) {
            // Channel-wide scope (no user filter)
            scopeType = "channel";
            scopeLabel = `${channelMention(channel.id)}`;
        } else {
            // Default to current user
            userIds.push(interaction.user.id);
            scopeType = "user";
            scopeLabel = buildScopeLabel({
                userMentions: [userMention(interaction.user.id)],
                channelMentionText: null,
            });
        }

        const channelId = channel?.id || null;
        const segments = queryLoreHistory({
            guildId: interaction.guild.id,
            userIds,
            channelId,
            limit,
        });

        if (!segments.length) {
            return interaction.reply({
                content: `I do not have enough tracked lore yet for ${scopeLabel}. Try again after there has been more chat activity in a tracked channel.`,
                flags: 64,
            });
        }

        const summaryLines = segments.map((segment, index) => {
            const timeRange = `${formatTimestamp(segment.startedAt) || "Unknown start"} → ${formatTimestamp(segment.lastAt) || "Unknown end"}`;
            const duration = formatDuration(segment.startedAt, segment.lastAt || segment.startedAt);
            return `**${index + 1}.** ${segment.summary}\n*${segment.channelName ? `Channel: ${segment.channelName} • ` : ""}${duration} • ${timeRange}*`;
        });

        const topSegment = segments[0];
        const patternTags = [...new Set(segments.flatMap((segment) => segment.tags || []))].slice(0, 4);
        const patternLine = patternTags.length
            ? `Most common patterns: ${patternTags.join(", ")}.`
            : "Most common patterns: general back-and-forth conversation.";

        let titlePrefix = "Lore summary for";
        let descriptionPrefix = "Here's what happened:";
        if (scopeType === "channel") {
            titlePrefix = "Channel lore in";
            descriptionPrefix = "This channel's recent chat history:";
        } else if (scopeType === "pair") {
            titlePrefix = "Lore between";
            descriptionPrefix = "Their chat history:";
        } else if (scopeType === "user") {
            titlePrefix = "Lore for";
            descriptionPrefix = "Their chat history:";
        }

        const embed = new EmbedBuilder()
            .setColor("#5865F2")
            .setTitle(`${titlePrefix} ${scopeLabel}`)
            .setDescription(descriptionPrefix)
            .addFields(
                {
                    name: "What happened",
                    value: summaryLines.join("\n\n").slice(0, 4096),
                },
                {
                    name: "Evidence",
                    value: topSegment.evidence?.length
                        ? topSegment.evidence.map((line) => `• ${line}`).join("\n").slice(0, 1024)
                        : "No evidence snippets were stored for this segment.",
                },
                {
                    name: "Pattern",
                    value: patternLine.slice(0, 1024),
                }
            )
            .setFooter({ text: `Based on ${segments.length} tracked segment${segments.length === 1 ? "" : "s"}.` });

        return interaction.reply({ embeds: [embed], flags: 64 });
    },
};
