const path = require("node:path");
const fs = require("node:fs");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");
const { markVoiceLogSuppressed } = require("../utils/voiceModerationState");
const configPath = path.join(__dirname, "..", "config.json");

let cfg = {};
try {
  cfg = require("../config.json");
} catch {
  cfg = {};
}

const blockedVcUserIds = new Set([
  ...((cfg.blockedVcUserIds || []).map((id) => String(id))),
  ...((process.env.BLOCKED_VC_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)),
]);

const isVcGuardEnabled = () => {
  if (typeof process.env.VC_AUTO_DISCONNECT_ENABLED === "string") {
    return process.env.VC_AUTO_DISCONNECT_ENABLED.toLowerCase() === "true";
  }
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    const liveConfig = JSON.parse(raw);
    return liveConfig.vcAutoDisconnectEnabled !== false;
  } catch {
    return cfg.vcAutoDisconnectEnabled !== false;
  }
};

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
  client.on("voiceStateUpdate", async (oldState, newState) => {
    if (!isVcGuardEnabled()) return;

    const changedChannel = oldState.channelId !== newState.channelId;
    const joinedOrMovedIntoVc = changedChannel && Boolean(newState.channelId);

    if (joinedOrMovedIntoVc && blockedVcUserIds.has(newState.id)) {
      // Suppress voice logs for forced disconnect events triggered by this guard.
      markVoiceLogSuppressed(newState.id);
      await newState
        .setChannel(null, "Blocked user is not allowed in voice channels")
        .catch((err) => console.error("vcUpdate blocked user disconnect error:", err));
      return;
    }

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
