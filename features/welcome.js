const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, EmbedBuilder } = require("discord.js");

const welcome = () => {
    client.on("guildMemberAdd", async (member) => {
        const channel = member.guild.channels.cache.get('1439533068208570420');
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor("#57F287")
            .setTitle("🎉 Welcome!")
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setDescription(
                `Hey ${userMention(member.id)}, welcome to **${member.guild.name}**!\n\n` +
                "We're glad to have you here. Make sure to check out the rules and introduce yourself!"
            )
            .setFooter({ text: "Enjoy your stay!", iconURL: member.guild.iconURL() })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    });

    client.on("guildMemberRemove", async (member) => {
        const channel = member.guild.channels.cache.get('1439550592090505216');
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setColor("#ED4245")
            .setTitle("👋 Goodbye!")
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setDescription(
                `**${member.user.globalName || member.user.username}** has left the server.\n` +
                "We'll miss you! Hope to see you again."
            )
            .setFooter({ text: "Farewell!", iconURL: member.guild.iconURL() })
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    });
};

module.exports = welcome;