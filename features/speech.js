const path=require("node:path");
const client=require(`${path.dirname(__dirname)}/index.js`);
const { addSpeechEvent, SpeechEvents } = require("discord-speech-recognition");
const { joinVoiceChannel} = require('@discordjs/voice');

const speech=()=>
{
    let connection;

    client.on(SpeechEvents.speech, (msg) =>
    {
        if (!msg.content)
        {
            return;
        }
                // Resolve a text channel within the speaker's guild to avoid cross-guild posting
                const guild = msg?.member?.guild || msg?.guild || null;
                if (!guild) return;

                // Prefer system channel, otherwise find first text channel we can send to
                let ch = guild.systemChannel && guild.systemChannel.isTextBased() ? guild.systemChannel : null;
                if (!ch) {
                    ch = guild.channels.cache.find((c) => c && c.isTextBased && c.permissionsFor(guild.members.me)?.has("SendMessages"));
                }
                if (!ch) return;

                ch.send(msg.content).catch(() => {});
                if (msg.content === "disconnect") {
                    ch.send("Disconnected!!!").catch(() => {});
                    connection?.destroy?.();
                    return;
                }
    });

    client.on("messageCreate",async (message)=>
    {
        if(message.content==="join" || message.content==="connect")
        {
            message.content=message.content.toLowerCase();
            const voiceChannel = message.member?.voice.channel;
            if (voiceChannel)
            {
              connection=joinVoiceChannel(
              {
                channelId: voiceChannel.id,
                guildId: voiceChannel.guild.id,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
              });
              if(connection) console.log("Connected!!!");
            }
        }
    });
    addSpeechEvent(client);
}
module.exports=speech;