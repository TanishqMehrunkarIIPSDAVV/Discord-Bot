const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention, EmbedBuilder } = require("discord.js");

const WELCOME_CHANNEL_ID = "1439533068208570420";
const GOODBYE_CHANNEL_ID = "1439550592090505216";

const welcome = () => {
    client.on("guildMemberAdd", async (member) => {
        try {
            const channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
            if (!channel) {
                console.warn("welcome: welcome channel not found", WELCOME_CHANNEL_ID);
                return;
            }

            const rulesHint = member.guild.rulesChannel
                ? `Please read ${member.guild.rulesChannel} and grab your roles.`
                : "Please read the rules channel and grab your roles.";

            const embed = new EmbedBuilder()
                .setColor("#57F287")
                .setTitle("🎉 Welcome!")
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `Hey ${userMention(member.id)}, welcome to **${member.guild.name}**!\n\n${rulesHint}`
                )
                .addFields(
                    { name: "Account Created", value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
                    { name: "Member Count", value: `${member.guild.memberCount}`, inline: true },
                    { name: "Getting Started", value: "Say hi in chat, share your interests, and have fun!" }
                )
                .setFooter({ text: "Enjoy your stay!", iconURL: member.guild.iconURL() })
                .setTimestamp();

            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error("welcome: failed to send welcome embed", err);
        }
    });

    client.on("guildMemberRemove", async (member) => {
        try {
            const channel = member.guild.channels.cache.get(GOODBYE_CHANNEL_ID);
            if (!channel) {
                console.warn("welcome: goodbye channel not found", GOODBYE_CHANNEL_ID);
                return;
            }

            const embed = new EmbedBuilder()
                .setColor("#ED4245")
                .setTitle("👋 Goodbye!")
                .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                .setDescription(
                    `**${member.user.globalName || member.user.username}** has left the server.\n` +
                    "We'll miss you—come back anytime."
                )
                .addFields({ name: "Member Count", value: `${Math.max(member.guild.memberCount, 1)}`, inline: true })
                .setFooter({ text: "Farewell!", iconURL: member.guild.iconURL() })
                .setTimestamp();

            await channel.send({ embeds: [embed] });
        } catch (err) {
            console.error("welcome: failed to send goodbye embed", err);
        }
    });
};

module.exports = welcome;