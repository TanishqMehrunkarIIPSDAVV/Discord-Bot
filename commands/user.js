const { SlashCommandBuilder } = require('discord.js');
const { buildUserInfoEmbed } = require('../utils/infoEmbeds');

module.exports = {
	data: new SlashCommandBuilder()
		.setName('user')
		.setDescription('Provides information about a user.')
		.addUserOption(option => option.setName('target').setDescription('The user to inspect')),
	async execute(interaction) {
		const targetUser = interaction.options.getUser('target') || interaction.user;
		const targetMember = interaction.options.getMember('target') || interaction.member;

		const embed = buildUserInfoEmbed({
			guild: interaction.guild,
			member: targetMember,
			user: targetUser,
			requestedBy: interaction.user,
		});

		await interaction.reply({ embeds: [embed] });
	},
};