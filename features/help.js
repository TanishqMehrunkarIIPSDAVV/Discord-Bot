const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { getHelpPages, getHelpRow } = require("../utils/helpContent");

const help = () => {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;
        if (message.content.toLowerCase() === "ct help") {
            const helpPages = getHelpPages();
            let page = 0;
            const totalPages = helpPages.length;
            const thumbnailPath = path.join(__dirname, '..', 'assets', 'thumbnail.jpg');
            const sent = await message.channel.send({ embeds: [helpPages[page]], components: [getHelpRow(page, totalPages)], files: [{ attachment: thumbnailPath, name: 'thumbnail.jpg' }] });

            const collector = sent.createMessageComponentCollector({ time: 120000 });

            collector.on("collect", async (i) => {
                if (i.user.id !== message.author.id) {
                    return i.reply({ content: "Only you can use these buttons for your help menu.", ephemeral: true });
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
                    await sent.edit({ components: [] });
                } catch (e) {}
            });
        }
    });
};

module.exports = help;