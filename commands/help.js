const path = require('node:path');
const { SlashCommandBuilder } = require('discord.js');
const { getHelpPages, getHelpRow } = require("../utils/helpContent");

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all bot commands and features!'),
    async execute(interaction) {
        const helpPages = getHelpPages();
        let page = 0;
        const totalPages = helpPages.length;
        const thumbnailPath = path.join(__dirname, '..', 'assets', 'thumbnail.jpg');
        const sent = await interaction.reply({
            embeds: [helpPages[page]],
            components: [getHelpRow(page, totalPages)],
            files: [{ attachment: thumbnailPath, name: 'thumbnail.jpg' }],
            flags: 64
        });

        const msg = await interaction.fetchReply();
        const collector = msg.createMessageComponentCollector({ time: 120000 });

        collector.on("collect", async (i) => {
            if (i.user.id !== interaction.user.id) {
                return i.reply({ content: "Only you can use these buttons for your help menu.", flags: 64 });
            }
            if (i.customId === "next" && page < helpPages.length - 1) page++;
            if (i.customId === "prev" && page > 0) page--;
            if (i.customId === "close") {
                collector.stop();
                return await i.update({ content: "Help menu closed.", embeds: [], components: [] });
            }
            await i.update({ embeds: [helpPages[page]], components: [getHelpRow(page, totalPages)] });
        });

        collector.on("end", async () => {
            try {
                const disabledRow = getHelpRow(page, totalPages);
                disabledRow.components.forEach(btn => btn.setDisabled(true));
                await msg.edit({ components: [disabledRow] });
            } catch (e) {}
        });
    }
};
