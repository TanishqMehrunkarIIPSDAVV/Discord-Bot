const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { Events } = require("discord.js");
const { ensureHistoryLoaded, recordLoreMessage } = require("../utils/chatLoreStore");

let registered = false;

const chatLore = () => {
    if (registered) return;
    registered = true;

    client.on(Events.MessageCreate, async (message) => {
        await ensureHistoryLoaded();
        recordLoreMessage(message);
    });
};

module.exports = chatLore;