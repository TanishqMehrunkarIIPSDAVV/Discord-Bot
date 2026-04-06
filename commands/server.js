const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const verificationLevels = ['None', 'Low', 'Medium', 'High', 'Very High'];
const boostTiers = ['None', 'Tier 1', 'Tier 2', 'Tier 3'];

module.exports = {
	data: new SlashCommandBuilder()
		.setName('server')
		.setDescription('Display info about this server.'),
	async execute(interaction) {
		const guild = interaction.guild;
		const owner = await guild.fetchOwner().catch(() => null);
		const iconURL = guild.iconURL({ size: 256 });

		const embed = new EmbedBuilder()
			.setColor('#5865F2')
			.setTitle(`Server Info • ${guild.name}`)
			.addFields(
				{ name: 'Server Name', value: guild.name, inline: true },
				{ name: 'Server ID', value: guild.id, inline: true },
				{ name: 'Owner', value: owner ? `${owner.user.tag}` : 'Unknown', inline: true },
				{ name: 'Members', value: `${guild.memberCount}`, inline: true },
				{ name: 'Roles', value: `${guild.roles.cache.size}`, inline: true },
				{ name: 'Channels', value: `${guild.channels.cache.size}`, inline: true },
				{ name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`, inline: true },
				{ name: 'Boost Level', value: boostTiers[guild.premiumTier] ?? `Tier ${guild.premiumTier}`, inline: true },
				{ name: 'Verification', value: verificationLevels[guild.verificationLevel] ?? 'Unknown', inline: true },
			)
			.setFooter({ text: `Requested by ${interaction.user.tag}` });

		if (iconURL) {
			embed.setThumbnail(iconURL);
		}

		return interaction.reply({ embeds: [embed] });
	},
};