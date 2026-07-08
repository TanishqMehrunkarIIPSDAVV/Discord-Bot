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

// Wrap event listeners to prevent handler exceptions from crashing the process.
// Stores original -> wrapped mapping so removeListener/off still works.
{
    const listenerMap = new WeakMap();
    const wrap = (fn) => {
        if (typeof fn !== 'function') return fn;
        if (listenerMap.has(fn)) return listenerMap.get(fn);
        const wrapped = (...args) => {
            try {
                const result = fn(...args);
                if (result && typeof result.then === 'function') {
                    result.catch((err) => console.error('Async handler error:', err));
                }
            } catch (err) {
                console.error('Event handler error:', err);
            }
        };
        listenerMap.set(fn, wrapped);
        return wrapped;
    };

    const origOn = client.on.bind(client);
    const origAdd = client.addListener ? client.addListener.bind(client) : null;
    const origOnce = client.once.bind(client);
    const origPrepend = client.prependListener ? client.prependListener.bind(client) : null;
    const origRemove = client.removeListener ? client.removeListener.bind(client) : client.off ? client.off.bind(client) : null;

    client.on = (event, listener) => {
        return origOn(event, wrap(listener));
    };

    if (origAdd) {
        client.addListener = (event, listener) => origAdd(event, wrap(listener));
    }

    client.once = (event, listener) => origOnce(event, wrap(listener));

    if (origPrepend) {
        client.prependListener = (event, listener) => origPrepend(event, wrap(listener));
    }

    if (origRemove) {
        client.removeListener = (event, listener) => origRemove(event, listenerMap.get(listener) || listener);
        client.off = (event, listener) => origRemove(event, listenerMap.get(listener) || listener);
    }
}

// Global process-level handlers to keep the bot running on unexpected errors
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

process.on('uncaughtExceptionMonitor', (err) => {
    console.error('Uncaught Exception (monitor):', err);
});

// Discord client-level error handlers
client.on('error', (err) => {
    console.error('Discord client error:', err);
});

client.on('shardError', (err) => {
    console.error('Shard error:', err);
});

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
// Safe feature loader - prevents a single broken feature from crashing startup
const safeLoad = (featurePath) => {
    try {
        const mod = require(featurePath);
        if (typeof mod === 'function') {
            try {
                mod(client);
            } catch (err) {
                console.error(`Feature init failed for ${featurePath}:`, err);
            }
        }
    } catch (err) {
        console.error(`Failed to require ${featurePath}:`, err);
    }
};

// Load features safely
safeLoad("./features/inviteBlock");
safeLoad("./features/binMicWale");
//safeLoad("./features/bump");
//safeLoad("./features/distube");
//safeLoad("./features/naam");
safeLoad("./features/onReady");
safeLoad("./features/pingPong");
safeLoad("./features/spam");
safeLoad("./features/member");
//safeLoad("./features/speech");
safeLoad("./features/vcUpdate");
safeLoad("./features/vcPoints");
safeLoad("./features/messageCoins");
safeLoad("./features/help");
safeLoad("./features/info");
safeLoad("./features/lockChannel");
//safeLoad("./features/tts");
safeLoad("./features/welcome");
safeLoad("./features/kick");
safeLoad("./features/ban");
safeLoad("./features/mute");
safeLoad("./features/warn");
safeLoad("./features/counting");
safeLoad("./features/cases");
safeLoad("./features/afk");
safeLoad("./features/unmute");
safeLoad("./features/unban");
safeLoad("./features/auditLogs");
safeLoad("./features/messageLogs");
safeLoad("./features/vanity");
safeLoad("./features/move");
safeLoad("./features/voiceDragCases");
safeLoad("./features/mentionReaction");
safeLoad("./features/confessions");
safeLoad("./features/complaints");
safeLoad("./features/privateVoice");
safeLoad("./features/girlModApplication");
safeLoad("./features/boyModApplication");
safeLoad("./features/aiReply");
safeLoad("./features/attachmentOnly");
safeLoad("./features/chatLore");
safeLoad("./features/announcement");
safeLoad("./features/revivalMentions");
safeLoad("./features/suggestions");
safeLoad("./features/guildInventory");
safeLoad("./features/quest");
safeLoad("./features/questShop");
safeLoad("./features/storyChallenge");
safeLoad("./features/tickets");
safeLoad("./features/memberswithout");
client.login(token).catch((err) => {
    console.error("Failed to login Discord client:", err?.message || err);
    process.exit(1);
});
console.log('tested');

