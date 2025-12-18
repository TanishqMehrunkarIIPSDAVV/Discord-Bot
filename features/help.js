const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require("discord.js");

const helpPages = [
    new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Bot Help - Page 1 / 2")
        .setThumbnail('attachment://thumbnail.jpg')
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
            `**12.** \`ct vc\`: Ping everyone in VC 🍭\n` +
            `**13.** \`ct play\`: Play/add song in VC 🎵\n` +
            `**14.** \`ct stop\`: Stop song queue 🛑\n`
        )
        .setFooter({ text: "Use the ⏭️ Next and ⏮️ Previous buttons to navigate pages!" }),
    new EmbedBuilder()
        .setColor("#5865F2")
        .setTitle("🤖 Bot Help - Page 2 / 2")
        .setThumbnail('attachment://thumbnail.jpg')
        .setDescription(
            `**15.** \`ct pause\`: Pause song queue ⏸️\n` +
            `**16.** \`ct resume\`: Resume song queue ▶️\n` +
            `**17.** \`ct repeat\`: Set repeat mode 🔁\n` +
            `**18.** \`ct shuffle\`: Shuffle queue 🔀\n` +
            `**19.** \`ct skip\`: Skip current song ⏭️\n` +
            `**20.** \`ct queue\`: Show song queue 🎶\n` +
            `**21.** \`ping\`: Replies with pong! 🏓\n` +
            `**22.** \`pong\`: Replies with ping! 🏓\n` +
            `**23.** \`ct tts\`: Speak text in VC 🎤\n` +
            `**24.** \`ct disconnect\`: Disconnect bot from VC ❌\n` +
            `**25.** \`ct kick [userid or mention user] [reason: optional]\`: Kick a User from Server\n`+
            `**26.** \`ct ban [userid or mention user] [reason: optional]\`: Ban a User from Server\n`
        )
        .setFooter({ text: "Use the ⏮️ Previous and ⏭️ Next buttons to navigate pages!" }),
];

const help = () => {
    client.on("messageCreate", async (message) => {
        if (message.author.bot) return;
        if (message.content.includes(`${userMention("1080879295586643978")}`)) {
            let page = 0;
            const getRow = (page) => new ActionRowBuilder().addComponents(
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
            const thumbnailPath = path.join(__dirname, '..', 'assets', 'thumbnail.jpg');
            const sent = await message.channel.send({ embeds: [helpPages[page]], components: [getRow(page)], files: [{ attachment: thumbnailPath, name: 'thumbnail.jpg' }] });

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
                await i.update({ embeds: [helpPages[page]], components: [getRow(page)] });
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