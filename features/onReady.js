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
        
        // Initialize scheduled removals with slight delay to ensure full client readiness
        setTimeout(() => {
            try {
                const removemeCommand = require('../commands/removeme');
                if (removemeCommand.initializeTimers) {
                    removemeCommand.initializeTimers(client);
                    console.log('[RemoveMe] Scheduled removals initialized');
                } else {
                    console.log('[RemoveMe] initializeTimers function not found');
                }
            } catch (err) {
                console.error('[RemoveMe] Error initializing scheduled removals:', err);
            }
        }, 1000);
    });
}
module.exports=onReady;