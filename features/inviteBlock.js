let registered = false;

const INVITE_PATTERN = /discord\.gg/i;
const ALLOWED_INVITE = "discord.gg/chaitapri";

const inviteBlock = (client) => {
  if (registered) return;
  registered = true;

  if (!client || typeof client.on !== "function") {
    throw new TypeError("inviteBlock requires a Discord client instance");
  }

  client.on("messageCreate", async (message) => {
    try {
      if (!message?.content) return;
      if (message.author?.id === client.user?.id) return;
      if (message.content.toLowerCase().includes(ALLOWED_INVITE)) return;
      if (!INVITE_PATTERN.test(message.content)) return;

      if (message.deletable) {
        await message.delete().catch(() => {});
      }
    } catch (error) {
      console.error("inviteBlock feature error:", error);
    }
  });
};

module.exports = inviteBlock;