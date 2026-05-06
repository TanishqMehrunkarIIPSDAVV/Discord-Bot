"use strict";

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
    const warningMessage = typeof warning === "string" ? warning : warning?.message || "";
    const warningCode = typeof warning === "object" ? warning?.code : args[1];

    // Suppress noisy third-party DEP0169 logs while keeping other warnings visible.
    if (warningCode === "DEP0169" || warningMessage.includes("`url.parse()` behavior is not standardized")) {
        return;
    }

    return originalEmitWarning(warning, ...args);
};

require("dotenv").config();

const config = require('./config.json');
const token = (
    process.env.DISCORD_TOKEN ||
    process.env.TOKEN ||
    process.env.token ||
    config.token ||
    ""
).trim();
const fs = require('node:fs');
const path = require('node:path');
const { Client, Collection,GatewayIntentBits,Partials} = require('discord.js');
const startServer=require("./server");
const { initializeBot } = require("./botInit");

if (!token) {
    console.error(
        "Missing Discord bot token. Set one of DISCORD_TOKEN/TOKEN env vars or add `token` in config.json."
    );
    process.exit(1);
}

const client = new Client(
{
    intents:
    [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions
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
        const errorReply = { content: 'There was an error while executing this command.', flags: 64 };

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(errorReply).catch(() => {});
        } else {
            await interaction.reply(errorReply).catch(() => {});
        }
    }
});

// Initialize MongoDB and data sync on bot ready
client.once("clientReady", async () => {
    console.log(`\n✅ Bot connected as ${client.user.tag}`);
    
    // Initialize MongoDB support
    await initializeBot();
});

startServer();
module.exports=client;
const inviteBlock = require("./features/inviteBlock");
inviteBlock(client);
const binMicWale=require("./features/binMicWale");
binMicWale();
//const bump=require("./features/bump");
//bump();
//const distubeFunc=require("./features/distube");
//distubeFunc();
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
const vcPoints = require("./features/vcPoints");
vcPoints();
const messageCoins = require("./features/messageCoins");
messageCoins();
const help=require("./features/help");
help();
const info = require("./features/info");
info();
const lockChannel = require("./features/lockChannel");
lockChannel();
// const tts=require("./features/tts");
// tts();
const welcome=require("./features/welcome");
welcome();
const kick = require("./features/kick");
kick();
const ban = require("./features/ban");
ban();
const mute = require("./features/mute");
mute();
const warn = require("./features/warn");
warn();
const cases = require("./features/cases");
cases();
const afk = require("./features/afk");
afk();
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
const voiceDragCases = require("./features/voiceDragCases");
voiceDragCases();
const mentionReaction = require("./features/mentionReaction");
mentionReaction();
const confessions = require("./features/confessions");
confessions();
const complaints = require("./features/complaints");
complaints();
const privateVoice = require("./features/privateVoice");
privateVoice();
const girlModApplication = require("./features/girlModApplication");
girlModApplication();
const boyModApplication = require("./features/boyModApplication");
boyModApplication();
const aiReply = require("./features/aiReply");
aiReply();
const attachmentOnly = require("./features/attachmentOnly");
attachmentOnly();
const chatLore = require("./features/chatLore");
chatLore();
const announcement = require("./features/announcement");
announcement();
const revivalMentions = require("./features/revivalMentions");
revivalMentions();
const userRatings = require("./features/userRatings");
userRatings();
const suggestions = require("./features/suggestions");
suggestions();
const quest = require("./features/quest");
quest();
const questShop = require("./features/questShop");
questShop();
const storyChallenge = require("./features/storyChallenge");
storyChallenge();
const tickets = require("./features/tickets");
tickets();
client.login(token).catch((err) => {
    console.error("Failed to login Discord client:", err?.message || err);
    process.exit(1);
});
console.log('tested');

