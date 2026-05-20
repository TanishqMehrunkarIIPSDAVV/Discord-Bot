const { REST, Routes } = require('discord.js');
require('dotenv').config();
const config = require('./config.json');
const fs = require('node:fs');
const path = require('node:path');

const clientId = process.env.CLIENT_ID || config.clientId;
const guildId = process.env.GUILD_ID || config.guildId;
const token = (
	process.env.DISCORD_TOKEN ||
	process.env.TOKEN ||
	process.env.token ||
	config.token ||
	""
).trim();

if (!token) {
	console.error('Missing Discord bot token. Set DISCORD_TOKEN/TOKEN env var or add token in config.json.');
	process.exit(1);
}

if (!clientId || !guildId) {
	console.error('Missing clientId or guildId. Set CLIENT_ID/GUILD_ID env vars or add them in config.json.');
	process.exit(1);
}

var commands = [];
var globalCommands = [];
// Grab all the command files from the commands directory you created earlier
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

// Grab the SlashCommandBuilder#toJSON() output of each command's data for deployment
for (const file of commandFiles) {
	const command = require(`./commands/${file}`);
	const payload = command.data.toJSON();
	if (command.global) {
		globalCommands.push(payload);
	} else {
		commands.push(payload);
	}
}

// Construct and prepare an instance of the REST module
const rest = new REST({ version: '10' }).setToken(token);

// and deploy your commands!
(async () => {
	try {
		console.log(`Started refreshing ${commands.length} guild application (/) commands and ${globalCommands.length} global application (/) commands.`);

		if (globalCommands.length) {
			await rest.put(
				Routes.applicationCommands(clientId),
				{ body: globalCommands },
			);
		}

		// The put method is used to fully refresh all commands in the guild with the current set
		const data = await rest.put(
			Routes.applicationGuildCommands(clientId, guildId),
			{ body: commands },
		);

		console.log(`Successfully reloaded ${data.length} guild commands and ${globalCommands.length} global commands.`);
	} catch (error) {
		// And of course, make sure you catch and log any errors!
		console.error(error);
	}
})();