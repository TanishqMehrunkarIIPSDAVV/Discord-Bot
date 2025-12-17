const path=require("node:path");
const client=require(`${path.dirname(__dirname)}/index.js`);
const { ActivityType } = require("discord.js");
const {Events} = require("discord.js");

const onReady=()=>
{
    client.on(Events.ClientReady, () =>
    {
        client.user.setActivity("Serving 𝑪𝒉𝒂𝒊 𝑻𝒂𝒑𝒓𝒊.𝒆𝒙𝒆 Server",
        {
          type: ActivityType.Watching,
        });
        console.log('Ready!');
    });
}
module.exports=onReady;