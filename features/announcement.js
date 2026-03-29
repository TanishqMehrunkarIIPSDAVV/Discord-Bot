const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const announcement = () => {
    client.on("messageCreate", async (message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        // Check if message starts with "ct announcement"
        if (!message.content.toLowerCase().startsWith('ct announcement ')) return;

        try {
            // Check if user has admin permissions
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply({
                    content: '❌ You need Administrator permissions to use this command!'
                }).then(msg => setTimeout(() => msg.delete(), 5000));
            }

            // Get the announcement text (everything after "ct announcement ")
            const announcementText = message.content.slice('ct announcement '.length).trim();

            if (!announcementText) {
                return message.reply({
                    content: '❌ Please provide an announcement message!'
                }).then(msg => setTimeout(() => msg.delete(), 5000));
            }

            // Create embed for announcement
            const announcementEmbed = new EmbedBuilder()
                .setColor('#FF6B6B')
                .setTitle('📢 Server Announcement')
                .setDescription(announcementText)
                .setAuthor({
                    name: message.author.username,
                    iconURL: message.author.displayAvatarURL({ dynamic: true })
                })
                .setTimestamp();

            // Send announcement with @everyone mention
            await message.channel.send({
                content: '@everyone',
                embeds: [announcementEmbed]
            });

            // Delete the command message
            await message.delete();

            // Confirm to command author
            message.author.send('✅ Announcement sent successfully!').catch(() => {});

        } catch (error) {
            console.error('Announcement command error:', error);
            message.reply({
                content: '❌ Failed to send announcement. Please try again.'
            }).then(msg => setTimeout(() => msg.delete(), 5000));
        }
    });
};

module.exports = announcement;
