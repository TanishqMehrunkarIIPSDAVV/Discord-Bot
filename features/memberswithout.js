const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');

const memberswithout = () => {
    client.on("messageCreate", async (message) => {
        // Ignore bot messages
        if (message.author.bot) return;

        // Check if message starts with "ct memberswithout"
        if (!message.content.toLowerCase().startsWith('ct memberswithout ')) return;

        try {
            // Check if user has admin permissions
            if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return message.reply({
                    content: '❌ You need Administrator permissions to use this command!'
                }).then(msg => setTimeout(() => msg.delete(), 5000));
            }

            // Extract role ID from command
            const args = message.content.slice('ct memberswithout '.length).trim().split(/\s+/);
            const roleId = args[0];

            if (!roleId) {
                return message.reply({
                    content: '❌ Please provide a role ID!\n**Usage:** `ct memberswithout <roleId>`'
                }).then(msg => setTimeout(() => msg.delete(), 10000));
            }

            // Validate that it's a valid Discord ID format
            if (!/^\d{17,19}$/.test(roleId)) {
                return message.reply({
                    content: '❌ Invalid role ID format! Role IDs should be 17-19 digit numbers.'
                }).then(msg => setTimeout(() => msg.delete(), 10000));
            }

            // Fetch the role
            let role;
            try {
                role = await message.guild.roles.fetch(roleId);
            } catch (err) {
                return message.reply({
                    content: `❌ Could not find role with ID: \`${roleId}\``
                }).then(msg => setTimeout(() => msg.delete(), 10000));
            }

            // Show loading message
            const loadingMsg = await message.reply({
                content: '⏳ Fetching members... This may take a moment.'
            });

            // Fetch all members
            let allMembers;
            try {
                allMembers = await message.guild.members.fetch();
            } catch (err) {
                await loadingMsg.edit({
                    content: '❌ Failed to fetch guild members.'
                }).then(msg => setTimeout(() => msg.delete(), 5000));
                return;
            }

            // Filter: exclude bots and exclude members who have the role
            const membersWithout = allMembers
                .filter(member => !member.user.bot) // Exclude bots
                .filter(member => !member.roles.cache.has(roleId)) // Exclude members with the role
                .sort((a, b) => a.user.username.localeCompare(b.user.username));

            if (membersWithout.size === 0) {
                return loadingMsg.edit({
                    content: `ℹ️ All non-bot members have the role **${role.name}**`
                }).then(msg => setTimeout(() => msg.delete(), 10000));
            }

            // Create embeds for the results (Discord has character limits)
            const embedColor = role.color || '#808080';
            const embeds = [];
            let currentPage = [];
            let charCount = 0;
            const maxCharsPerPage = 4000;

            for (const member of membersWithout.values()) {
                const memberInfo = `**${member.user.username}** (${member.id})\n` +
                    `└ Joined: <t:${Math.floor(member.joinedTimestamp / 1000)}:R>\n`;

                if (charCount + memberInfo.length > maxCharsPerPage) {
                    // Create embed with current page
                    embeds.push(
                        new EmbedBuilder()
                            .setColor(embedColor)
                            .setTitle(`Members WITHOUT role: ${role.name}`)
                            .setDescription(currentPage.join('') || 'No members')
                            .setFooter({ text: `Page ${embeds.length + 1}` })
                    );
                    currentPage = [];
                    charCount = 0;
                }

                currentPage.push(memberInfo);
                charCount += memberInfo.length;
            }

            // Add last page
            if (currentPage.length > 0) {
                embeds.push(
                    new EmbedBuilder()
                        .setColor(embedColor)
                        .setTitle(`Members WITHOUT role: ${role.name}`)
                        .setDescription(currentPage.join('') || 'No members')
                        .setFooter({ text: `Page ${embeds.length + 1} | Total: ${membersWithout.size} members` })
                );
            }

            // Send first page and remove loading message
            await loadingMsg.delete();
            
            if (embeds.length === 0) {
                return message.reply({
                    content: `ℹ️ All non-bot members have the role **${role.name}**`
                }).then(msg => setTimeout(() => msg.delete(), 10000));
            }

            // Send embeds
            const sentMessages = [];
            for (const embed of embeds) {
                sentMessages.push(await message.reply({ embeds: [embed] }));
            }

            // Add summary
            await message.reply({
                content: `📊 **Summary:** Found **${membersWithout.size}** non-bot members without the **${role.name}** role.`
            });

        } catch (error) {
            console.error('Error in memberswithout command:', error);
            message.reply({
                content: '❌ An error occurred while processing your request.'
            }).then(msg => setTimeout(() => msg.delete(), 5000));
        }
    });
};

module.exports = memberswithout;
