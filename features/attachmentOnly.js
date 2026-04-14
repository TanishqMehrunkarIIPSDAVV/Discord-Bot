const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);

let registered = false;

function loadConfig() {
  try {
    delete require.cache[require.resolve("../config.json")];
    return require("../config.json");
  } catch {
    return {};
  }
}

function getAttachmentOnlyChannelIds() {
  const config = loadConfig();
  const envValue = process.env.ATTACHMENT_ONLY_CHANNEL_IDS || "";

  const envIds = envValue
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const configIds = Array.isArray(config.attachmentOnlyChannelIds)
    ? config.attachmentOnlyChannelIds.map((id) => String(id).trim()).filter(Boolean)
    : [];

  return new Set([...configIds, ...envIds]);
}

const attachmentOnly = () => {
  if (registered) return;
  registered = true;

  client.on("messageCreate", async (message) => {
    try {
      if (!message.guild) return;
      if (message.author?.bot) return;

      const restrictedChannelIds = getAttachmentOnlyChannelIds();
      if (restrictedChannelIds.size === 0) return;
      if (!restrictedChannelIds.has(message.channelId)) return;

      const hasText = (message.content || "").trim().length > 0;
      const hasAttachments = message.attachments?.size > 0;

      // Allowed: attachment-only messages with no text.
      if (!hasText && hasAttachments) return;

      if (message.deletable) {
        await message.delete().catch(() => {});
      }
    } catch (error) {
      console.error("attachmentOnly feature error:", error);
    }
  });
};

module.exports = attachmentOnly;
