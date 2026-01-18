const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");

const getRole = (guild) => guild.roles.cache.find((r) => r.name === "Bin Mic Wale");

const addRole = (state) => {
  const role = getRole(state.guild);
  const member = role && state.guild.members.cache.get(state.id);
  if (role && member) member.roles.add(role).catch(console.error);
};

const removeRole = (state) => {
  const role = getRole(state.guild);
  const member = role && state.guild.members.cache.get(state.id);
  if (role && member) member.roles.remove(role).catch(console.error);
};

const vcUpdate = () => {
  client.on("voiceStateUpdate", (oldState, newState) => {
    if (oldState.channelId === null) {
      if (newState.selfMute) {
        addRole(newState);
      } else {
        removeRole(newState);
      }
    } else if (newState.channelId === null) {
      // Always remove the role on disconnect, even if they left while muted
      removeRole(oldState);
    } else if (oldState.selfMute !== newState.selfMute) {
      if (newState.selfMute) {
        addRole(newState);
      } else {
        removeRole(newState);
      }
    }
  });
};
module.exports = vcUpdate;
