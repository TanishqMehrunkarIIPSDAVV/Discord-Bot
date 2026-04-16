const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('prune')
        .setDescription('Prune up to 99 messages.')
        .addIntegerOption(option => option.setName('amount').setDescription('Number of messages to prune'))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),
    async execute(interaction) {
        const amount = interaction.options.getInteger('amount');

        if (!interaction.member.permissions.has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: 'You do not have permission to manage messages.', flags: 64 });
        }
        if (!interaction.guild.members.me.permissionsIn(interaction.channel).has(PermissionFlagsBits.ManageMessages)) {
            return interaction.reply({ content: 'I do not have permission to manage messages in this channel.', flags: 64 });
        }
        if (amount < 1 || amount > 99) {
            return interaction.reply({ content: 'You need to input a number between 1 and 99.', flags: 64 });
        }
        try {
            await interaction.channel.bulkDelete(amount, true);
            return interaction.reply({ content: `Successfully pruned \`${amount}\` messages.`, flags: 64 });
        } catch (error) {
            console.error(error);
            return interaction.reply({ content: 'There was an error trying to prune messages in this channel!', flags: 64 });
        }
    },
};
