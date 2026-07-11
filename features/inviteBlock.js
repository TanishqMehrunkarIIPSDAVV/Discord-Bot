let registered = false;

const config = require("../config.json");

const INVITE_PATTERN = /discord\.gg/i;
const ALLOWED_INVITE = "discord.gg/chaitapri";

function getExcludedChannelIds() {
  const excludedIds = [];

  if (Array.isArray(config.inviteBlockExcludedChannelIds)) {
    excludedIds.push(...config.inviteBlockExcludedChannelIds);
  }

  if (config.inviteBlockExcludedChannelId) {
    excludedIds.push(config.inviteBlockExcludedChannelId);
  }

  return new Set(excludedIds.map((id) => String(id).trim()).filter(Boolean));
}

const inviteBlock = (client) => {
  if (registered) return;
  registered = true;

  if (!client || typeof client.on !== "function") {
    throw new TypeError("inviteBlock requires a Discord client instance");
  }

  const excludedChannelIds = getExcludedChannelIds();

  client.on("messageCreate", async (message) => {
    try {
      if (!message?.content) return;
      if (message.author?.id === client.user?.id) return;
      if (message.content.toLowerCase().includes(ALLOWED_INVITE)) return;
      if (!INVITE_PATTERN.test(message.content)) return;
      if (excludedChannelIds.has(String(message.channelId || ""))) return;

      if (message.deletable) {
        await message.delete().catch(() => {});
      }
    } catch (error) {
      console.error("inviteBlock feature error:", error);
    }
  });
};

module.exports = inviteBlock;