const fs = require("node:fs");
const path = require("node:path");

const DATA_PATH = path.join(__dirname, "..", "data", "channel-names.json");

const createDefaultStore = () => ({
  guilds: {},
  updatedAt: Date.now(),
});

const loadStore = () => {
  try {
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return {
      guilds: parsed.guilds && typeof parsed.guilds === "object" ? parsed.guilds : {},
      updatedAt: Number(parsed.updatedAt) || Date.now(),
    };
  } catch {
    const store = createDefaultStore();
    saveStore(store);
    return store;
  }
};

const saveStore = (store) => {
  const data = {
    guilds: store.guilds && typeof store.guilds === "object" ? store.guilds : {},
    updatedAt: Date.now(),
  };

  fs.writeFileSync(DATA_PATH, `${JSON.stringify(data, null, 2)}\n`, "utf8");
};

const saveGuildChannelNames = (guild, channels) => {
  if (!guild) return { saved: 0 };

  const store = loadStore();
  const channelEntries = Array.from(channels?.values?.() || []);
  const savedAt = Date.now();

  store.guilds[guild.id] = {
    guildId: guild.id,
    guildName: guild.name || null,
    savedAt,
    channels: channelEntries.reduce((accumulator, channel) => {
      if (!channel?.id || typeof channel.name !== "string") {
        return accumulator;
      }

      accumulator[channel.id] = {
        id: channel.id,
        name: channel.name,
        type: channel.type,
        parentId: channel.parentId || null,
      };

      return accumulator;
    }, {}),
  };

  saveStore(store);

  return {
    saved: Object.keys(store.guilds[guild.id].channels || {}).length,
    savedAt,
  };
};

const getGuildChannelNames = (guildId) => {
  const store = loadStore();
  return store.guilds[guildId] || null;
};

module.exports = {
  loadStore,
  saveStore,
  saveGuildChannelNames,
  getGuildChannelNames,
};