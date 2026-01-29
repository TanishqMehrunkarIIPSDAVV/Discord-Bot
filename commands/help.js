const path = require('node:path');
const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const helpPages = [
    new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Help • Basics (1/3)")
        .setThumbnail('attachment://thumbnail.jpg')
        .setDescription(
            `👋 **Quick start:** Mention me or type \`ct help\` to open this menu.\n\n` +
            `**1.** </help:> / mention bot: Open help menu 📚\n` +
            `**2.** </ping:>: Bot latency 🏓\n` +
            `**3.** </avatar:>: View avatars 🔎\n` +
            `**4.** </user:>: User info (joined at) 🧾\n` +
            `**5.** </server:>: Server info 📰\n` +
            `**6.** </prune:>: Bulk delete 1-99 msgs 🧹\n` +
            `**7.** \`ping\` / \`pong\`: Text ping-pong fun 🎯\n` +
            `**8.** \`ct vc\`: Ping everyone in your VC 🍭\n`
        )
        .setFooter({ text: "Use the ⏭️ Next and ⏮️ Previous buttons to navigate pages!" }),
    new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Help • Moderation (2/3)")
        .setThumbnail('attachment://thumbnail.jpg')
        .setDescription(
            `**9.** \`ct kick <user> [reason]\`: Kick user (with DMs) 🦵\n` +
            `**10.** \`ct ban <user> [reason]\`: Ban user/ID 🔨\n` +
            `**11.** \`ct unban <userId> [reason]\`: Lift a ban 🔓\n` +
            `**12.** \`ct mute <user> [minutes] [reason]\`: Timeout user ⏱️\n` +
            `**13.** \`ct unmute <user> [reason]\`: Remove timeout 🟢\n` +
            `**14.** </prune:>: Bulk delete (repeat) 🧹\n` +
            `**15.** Automations: message delete logs, welcome/leave, VC mute-role sync ⚙️\n`
        )
        .setFooter({ text: "Use the ⏮️ Previous and ⏭️ Next buttons to navigate pages!" }),
    new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Help • Voice & Music (3/3)")
        .setThumbnail('attachment://thumbnail.jpg')
        .setDescription(
            `**16.** \`ct play <query/url>\`: Play/add song 🎵\n` +
            `**17.** \`ct stop\`: Stop/clear queue 🛑\n` +
            `**18.** \`ct pause\` / \`ct resume\`: Pause/Resume ⏯️\n` +
            `**19.** \`ct repeat\`: Repeat mode 🔁\n` +
            `**20.** \`ct shuffle\`: Shuffle queue 🔀\n` +
            `**21.** \`ct skip\`: Skip current song ⏭️\n` +
            `**22.** \`ct queue\`: Show queue 🎶\n` +
            `**23.** \`ct tts <text>\`: Speak in VC 🎤\n` +
            `**24.** </removeme:>: Schedule VC removal ⏰\n` +
            `**25.** \`ct disconnect\`: Disconnect bot ❌\n`
        )
        .setFooter({ text: "Use the ⏮️ Previous and ⏭️ Next buttons to navigate pages!" }),
];

function getRow(page) {
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
            .setDisabled(page === helpPages.length - 1),
        new ButtonBuilder()
            .setCustomId("close")
            .setLabel("❌ Close")
            .setStyle(ButtonStyle.Danger)
    );
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all bot commands and features!'),
    async execute(interaction) {
        let page = 0;
        const thumbnailPath = path.join(__dirname, '..', 'assets', 'thumbnail.jpg');
        const sent = await interaction.reply({
            embeds: [helpPages[page]],
            components: [getRow(page)],
            files: [{ attachment: thumbnailPath, name: 'thumbnail.jpg' }],
            ephemeral: true
        });

        const msg = await interaction.fetchReply();
        const collector = msg.createMessageComponentCollector({ time: 120000 });

        collector.on("collect", async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: "Only you can use these buttons for your help menu.", ephemeral: true });
            }
            if (i.customId === "next" && page < helpPages.length - 1) page++;
            if (i.customId === "prev" && page > 0) page--;
            if (i.customId === "close") {
                collector.stop();
                return await i.update({ content: "Help menu closed.", embeds: [], components: [] });
            }
            await i.update({ embeds: [helpPages[page]], components: [getRow(page)] });
        });

        collector.on("end", async () => {
            try {
                const disabledRow = getRow(page);
                disabledRow.components.forEach(btn => btn.setDisabled(true));
                await msg.edit({ components: [disabledRow] });
            } catch (e) {}
        });
    }
};