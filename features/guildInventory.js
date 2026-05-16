const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { saveData } = require("../utils/dataSync");
const { saveDocument } = require("../utils/db");

let registered = false;
let isSyncing = false;

const STORE_NAME = "bot-guilds";

const buildSnapshot = () => {
  const guilds = [...client.guilds.cache.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((guild) => ({
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount ?? null,
      ownerId: guild.ownerId ?? null,
    }));

  return {
    updatedAt: new Date().toISOString(),
    guildCount: guilds.length,
    guilds,
  };
};

const formatServerList = (snapshot) => {
  if (!snapshot.guilds.length) {
    return "I am not currently joined to any servers.";
  }

  const lines = snapshot.guilds.map((guild, index) => {
    return `${index + 1}. ${guild.name} (${guild.id})`;
  });

  return [`I am currently in ${snapshot.guildCount} server(s):`, ...lines].join("\n");
};

const persistSnapshot = async (reason = "Snapshot") => {
  if (isSyncing) return;
  isSyncing = true;

  try {
    const snapshot = buildSnapshot();

    console.log(`[GuildInventory] ${reason} | ${snapshot.guildCount} server(s)`);
    for (const guild of snapshot.guilds) {
      console.log(`[GuildInventory] - ${guild.name} (${guild.id})`);
    }

    await saveData(STORE_NAME, snapshot);
    await saveDocument(STORE_NAME, { _id: "main" }, snapshot);

    return snapshot;
  } catch (error) {
    console.error("guildInventory sync error:", error);
    return null;
  } finally {
    isSyncing = false;
  }
};

const guildInventory = () => {
  if (registered) return;
  registered = true;

  client.once("clientReady", async () => {
    await persistSnapshot("Bot is currently in");
  });

  client.on("guildCreate", async () => {
    await persistSnapshot("Joined a server");
  });

  client.on("guildDelete", async () => {
    await persistSnapshot("Left a server");
  });

  client.on("messageCreate", async (message) => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim();
    if (content.toLowerCase() !== "ct servers") return;

    const snapshot = (await persistSnapshot("Server list requested")) || buildSnapshot();
    const response = formatServerList(snapshot);

    await message.reply(response).catch(() => {});
  });
};

module.exports = guildInventory;