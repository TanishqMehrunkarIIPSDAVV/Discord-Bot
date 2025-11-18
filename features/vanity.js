const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);

const vanity=()=>{
    client.on("messageCreate",(msg)=>{
        if(msg.author.bot) return;
        const content = String(msg.content).toLowerCase();
        if(content === "vanity" || content.includes("perm"))
        {
            msg.channel.send("https://discord.gg/EDBaF2EGBP\nPut this Link in your Bio !!!").catch(()=>{});
        }
    });
};

module.exports = vanity;