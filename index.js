"use strict";

const {token} = require("./config.json");
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection,GatewayIntentBits,Partials} = require('discord.js');
const startServer=require("./server");

const client = new Client(
{
    intents:
    [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
    Partials.Message,
    Partials.Channel,
    Partials.Reaction,
    Partials.User,
    Partials.GuildMember
  ]
});

// Allow many feature modules to attach their own listeners without warnings
client.setMaxListeners(0);

client.commands = new Collection();

const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles)
{
  const filePath = path.join(commandsPath, file);
  const command = require(filePath);
  client.commands.set(command.data.name, command);
}

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error while executing /${interaction.commandName}:`, error);
        const errorReply = { content: 'There was an error while executing this command.', ephemeral: true };

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(errorReply).catch(() => {});
        } else {
            await interaction.reply(errorReply).catch(() => {});
        }
    }
});

startServer();
module.exports=client;
const binMicWale=require("./features/binMicWale");
binMicWale();
//const bump=require("./features/bump");
//bump();
const distubeFunc=require("./features/distube");
distubeFunc();
//const naam=require("./features/naam");
//naam();
const onReady=require("./features/onReady");
onReady();
const pingPong=require("./features/pingPong");
pingPong();
const spam=require("./features/spam");
spam();
const member = require("./features/member");
member();
// const speech=require("./features/speech");
// speech();
const vcUpdate=require("./features/vcUpdate");
vcUpdate();
const help=require("./features/help");
help();
const tts=require("./features/tts");
tts();
const welcome=require("./features/welcome");
welcome();
const kick = require("./features/kick");
kick();
const ban = require("./features/ban");
ban();
const mute = require("./features/mute");
mute();
const unmute = require("./features/unmute");
unmute();
const unban = require("./features/unban");
unban();
const auditLogs = require("./features/auditLogs");
auditLogs();
const messageLogs = require("./features/messageLogs");
messageLogs();
const vanity = require("./features/vanity");
vanity();
const move = require("./features/move");
move();
client.login(token);
console.log('tested');