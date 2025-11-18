const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

const helpPages = [
    new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Bot Help - Page 1 / 2")
        .setThumbnail("https://res.cloudinary.com/dlvoithw3/image/upload/v1747582675/a4c4f7d0e2f8bb9d50df90d0c114646f_qod2s6.webp")
        .setDescription(
            `👋 **Hi! Need help? Here are my features:**\n\n` +
            `**1.** <Tag me> or </help:>: Show all commands ⁉️\n` +
            `**2.** </ping:>: Show bot ping 🏓\n` +
            `**3.** </avatar:>: Show user avatar 🔎\n` +
            `**4.** </die:>: Kill yourself 😎\n` +
            `**5.** </kick:>: Kick a user [Not really] 🦵\n` +
            `**6.** </plead:>: Plead to a user 🙏\n` +
            `**7.** </prune:>: Delete multiple messages 🕵️\n` +
            `**8.** </punch:>: Punch a user 👊\n` +
            `**9.** </server:>: Server info 📰\n` +
            `**10.** </slap:>: Slap a user 🤚\n` +
            `**11.** </user:>: When you joined ❔\n` +
            `**12.** \`op vc\`: Ping everyone in VC 🍭\n` +
            `**13.** \`op play\`: Play/add song in VC 🎵\n` +
            `**14.** \`op stop\`: Stop song queue 🛑\n`
        )
        .setFooter({ text: "Use the ⏭️ Next and ⏮️ Previous buttons to navigate pages!" }),
    new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Bot Help - Page 2 / 2")
        .setThumbnail("https://res.cloudinary.com/dlvoithw3/image/upload/v1747582675/a4c4f7d0e2f8bb9d50df90d0c114646f_qod2s6.webp")
        .setDescription(
            `**15.** \`op pause\`: Pause song queue ⏸️\n` +
            `**16.** \`op resume\`: Resume song queue ▶️\n` +
            `**17.** \`op repeat\`: Set repeat mode 🔁\n` +
            `**18.** \`op shuffle\`: Shuffle queue 🔀\n` +
            `**19.** \`op skip\`: Skip current song ⏭️\n` +
            `**20.** \`op queue\`: Show song queue 🎶\n` +
            `**21.** \`brawl/brawlhalla\`: Ping brawlhalla role 🎮\n` +
            `**22.** \`valorant/valo/valorand\`: Ping valorant role 🎮\n` +
            `**23.** \`vc\`: Ping VC role 🎮\n` +
            `**24.** \`ping\`: Replies with pong! 🏓\n` +
            `**25.** \`pong\`: Replies with ping! 🏓\n` +
            `**26.** \`op tts\`: Speak text in VC 🎤\n` +
            `**27.** \`op disconnect\`: Disconnect bot from VC ❌\n`+
            `**28.** \`op kick [userid or mention user] [reason: optional]\`: Kick a User from Server\n`+
            `**29.** \`op ban [userid or mention user] [reason: optional]\`: Ban a User from Server\n`
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
        const sent = await interaction.reply({
            embeds: [helpPages[page]],
            components: [getRow(page)],
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