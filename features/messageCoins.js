const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const config = require("../config.json");
const { addQuestCoins } = require("../utils/questStore");
const fs = require("node:fs");

const STORE_PATH = path.join(__dirname, "..", "data", "message-coin-tracker.json");
const MESSAGES_PER_COIN = 10;

let registered = false;
let messageTracker = {};

const loadTracker = () => {
  try {
    if (fs.existsSync(STORE_PATH)) {
      const data = fs.readFileSync(STORE_PATH, "utf8");
      return JSON.parse(data);
    }
  } catch {
    // Ignore errors
  }
  return {};
};

const saveTracker = () => {
  fs.writeFileSync(STORE_PATH, JSON.stringify(messageTracker, null, 2), "utf8");
};

const trackMessage = (userId, guildId) => {
  if (!userId || !guildId) return 0;

  const key = `${guildId}:${userId}`;
  messageTracker[key] = (messageTracker[key] || 0) + 1;

  const messageCount = messageTracker[key];
  let coinsEarned = 0;

  // Award 1 coin per 10 messages
  if (messageCount % MESSAGES_PER_COIN === 0) {
    coinsEarned = 1;
    addQuestCoins(guildId, userId, coinsEarned);
  }

  saveTracker();
  return coinsEarned;
};

const messageCoins = () => {
  if (registered) return;
  registered = true;

  messageTracker = loadTracker();

  // Get list of channels where coins should be earned
  const messageCoinChannelIds = new Set(
    (Array.isArray(config.messageCoinChannelIds) ? config.messageCoinChannelIds : [])
      .map(id => String(id).trim())
      .filter(id => id)
  );

  if (messageCoinChannelIds.size === 0) {
    console.log(
      "ℹ️  Message coins feature: No channels configured. Add 'messageCoinChannelIds' to config.json to enable."
    );
    return;
  }

  client.on("messageCreate", async (message) => {
    try {
      if (!message?.content) return;
      if (message.author?.bot) return;
      if (!message.guild) return;

      // Check if message is in a configured coin channel
      if (!messageCoinChannelIds.has(message.channelId)) return;

      // Track the message and earn coins if threshold is reached
      const coinsEarned = trackMessage(message.author.id, message.guild.id);

      if (coinsEarned > 0) {
        console.log(
          `💰 ${message.author.username} earned ${coinsEarned} quest coin(s) in #${message.channel.name}`
        );
      }
    } catch (error) {
      console.error("messageCoins feature error:", error);
    }
  });

  console.log(`✅ Message coins feature loaded for ${messageCoinChannelIds.size} channel(s) (1 coin per ${MESSAGES_PER_COIN} messages)`);
};

module.exports = messageCoins;
