const path=require("node:path");
const client=require(`${path.dirname(__dirname)}/index.js`);
const {userMention}=require("discord.js");

const vcUpdate=()=>
{
    client.on('voiceStateUpdate', (oldState, newState) =>
    {
        const ch=client.channels.cache.get("962590186598989824");
        if(oldState.channelId===null) ch.send(`VC se baahar nikal laude ${userMention(newState.id)}`);
        else if(newState.channelId===null) ch.send(`VC me vaapis aa laude ${userMention(oldState.id)}`);
        else if(oldState.selfDeaf !== newState.selfDeaf)
        {
            if(newState.selfDeaf) ch.send(`Deafen ho gaya ${userMention(newState.id)} laude`);
            else ch.send(`Undeafen ho gaya ${userMention(newState.id)} laude`);
        }
        else if(oldState.selfMute !== newState.selfMute)
        {
            if(newState.selfMute)
            {
                ch.send(`Le BSDK ${userMention(newState.id)} bin mic wale`);
                const role=newState.guild.roles.cache.find(role => role.name === "Bin Mic Wale");
                if(role)
                {
                    const member=newState.guild.members.cache.get(newState.id);
                    if(member)
                    {
                        member.roles.add(role).catch(console.error);
                    }
                    else ch.send(`Member nahi mila ${userMention(newState.id)} laude`);
                }
                else ch.send(`Role nahi mila ${userMention(newState.id)} laude`);
            }
            else
            {
                ch.send(`Le BSDK ${userMention(newState.id)} hata diya bin mic wale`);
                const role=newState.guild.roles.cache.find(role => role.name === "Bin Mic Wale");
                if(role)
                {
                    const member=newState.guild.members.cache.get(newState.id);
                    if(member)
                    {
                        member.roles.remove(role).catch(console.error);
                    }
                    else ch.send(`Member nahi mila ${userMention(newState.id)} laude`);
                }
                else ch.send(`Role nahi mila ${userMention(newState.id)} laude`);
            }
        }
    });
}
module.exports=vcUpdate;