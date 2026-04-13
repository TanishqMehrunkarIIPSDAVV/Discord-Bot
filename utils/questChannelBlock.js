let config = {};
try {
  config = require("../config.json");
} catch {
  config = {};
}

const blockedQuestChannelIds = new Set([
  ...((config.questBlockedChannelIds || []).map((id) => String(id))),
  ...((process.env.BLOCKED_QUEST_CHANNEL_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)),
]);

const getChannelIdsToCheck = (channelLike) => {
  if (!channelLike) return [];

  if (typeof channelLike === "string") {
    return [channelLike];
  }

  const ids = [];
  if (channelLike.id) ids.push(String(channelLike.id));
  if (channelLike.parentId) ids.push(String(channelLike.parentId));
  return ids;
};

const isQuestBlockedChannel = (channelLike) => {
  const ids = getChannelIdsToCheck(channelLike);
  return ids.some((id) => blockedQuestChannelIds.has(id));
};

module.exports = {
  isQuestBlockedChannel,
  QUEST_BLOCKED_MESSAGE: "Quest commands are disabled in this channel.",
};
