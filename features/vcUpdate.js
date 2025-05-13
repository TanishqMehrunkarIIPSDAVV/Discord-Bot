const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");
const {SpeechClient} = require("discord-speech-recognition");

const roleAssign = (newState) => {
  if (newState.selfMute) {
    const role = newState.guild.roles.cache.find(
      (role) => role.name === "Bin Mic Wale"
    );
    if (role) {
      const member = newState.guild.members.cache.get(newState.id);
      if (member) {
        member.roles.add(role).catch(console.error);
      }
    }
  } else {
    const role = newState.guild.roles.cache.find(
      (role) => role.name === "Bin Mic Wale"
    );
    if (role) {
      const member = newState.guild.members.cache.get(newState.id);
      if (member) {
        member.roles.remove(role).catch(console.error);
      }
    }
  }
};

const vcUpdate = () => {
  client.on("voiceStateUpdate", (oldState, newState) => {
    const ch = client.channels.cache.get("962590186598989824");
    if (oldState.channelId === null) {
      ch.send(`${userMention(newState.id)} joined the VC`);
      roleAssign(newState);
    } else if (newState.channelId === null) {
      ch.send(`${userMention(oldState.id)} left the VC`);
      roleAssign(oldState);
    } else if (oldState.selfMute !== newState.selfMute) {
      roleAssign(newState);
    }
  });
};
module.exports = vcUpdate;
