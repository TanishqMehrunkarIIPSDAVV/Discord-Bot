const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);
const { userMention } = require("discord.js");
const {
  recordCorrectCount,
  recordWrongCount,
  getChannelSnapshot,
  getUserSnapshot,
} = require("../utils/countingStore");

let registered = false;

function loadConfig() {
  try {
    delete require.cache[require.resolve("../config.json")];
    return require("../config.json");
  } catch {
    return {};
  }
}

function getCountingChannelIds() {
  const config = loadConfig();
  const envValue = process.env.COUNTING_CHANNEL_IDS || "";

  const envIds = envValue
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  const configIds = [];
  if (Array.isArray(config.countingChannelIds)) {
    configIds.push(...config.countingChannelIds);
  }
  if (config.countingChannelId) {
    configIds.push(config.countingChannelId);
  }

  return new Set(
    [...configIds, ...envIds]
      .map((id) => String(id).trim())
      .filter(Boolean)
  );
}

function formatBigInt(value) {
  try {
    return BigInt(value).toString();
  } catch {
    return String(value);
  }
}

function getCountingCheckpoints() {
  const config = loadConfig();
  const fallback = [50, 100, 200, 500, 1000];
  const values = Array.isArray(config.countingCheckpoints)
    ? config.countingCheckpoints
    : Array.isArray(config.countingMilestones)
      ? config.countingMilestones
      : fallback;

  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
}

function getPreviousCheckpoint(count, checkpoints) {
  let previous = 0n;
  const safeCount = BigInt(count || 0n);

  for (const checkpoint of checkpoints) {
    const checkpointValue = BigInt(checkpoint);
    if (checkpointValue > safeCount) break;
    previous = checkpointValue;
  }

  return previous;
}

function getNextCheckpoint(count, checkpoints) {
  const safeCount = BigInt(count || 0n);

  for (const checkpoint of checkpoints) {
    const checkpointValue = BigInt(checkpoint);
    if (checkpointValue > safeCount) return checkpointValue;
  }

  return null;
}

function buildWrongInputMessage(message, result, reason) {
  const userState = getUserSnapshot(message.guild.id, message.channelId, message.author.id);
  const channelWarnings = Number(result.channelWarnings) || 0;
  const resetCount = formatBigInt(result.resetCount ?? 0);

  if (result.usedSave) {
    return `${userMention(message.author.id)} broke the count (${reason}). A save was used so the current count was preserved. Channel warning #${channelWarnings}. Remaining saves: **${userState.saves}**.`;
  }

  return `${userMention(message.author.id)} broke the count (${reason}). Count reset to the previous checkpoint **${resetCount}**. Channel warning #${channelWarnings}. Personal warning #${userState.warnings}. Next expected number is **${(BigInt(result.resetCount ?? 0) + 1n).toString()}**.`;
}

const counting = () => {
  if (registered) return;
  registered = true;

  const countingChannelIds = getCountingChannelIds();
  if (countingChannelIds.size === 0) {
    console.log("ℹ️  Counting feature: No channels configured. Add 'countingChannelIds' to config.json to enable.");
    return;
  }

  client.on("messageCreate", async (message) => {
    try {
      if (!message.guild) return;
      if (message.author?.bot) return;
      if (!countingChannelIds.has(message.channelId)) return;

      const content = (message.content || "").trim();
      if (!content) return;

      // Only act on messages that start with a number; ignore everything else.
      const leading = content.match(/^(\d+)/);
      if (!leading) return; // message doesn't start with a number => ignore

      const numberStr = leading[1];

      const channelState = getChannelSnapshot(message.guild.id, message.channelId);
      const expectedNumber = channelState.count + 1n;
      const checkpoints = getCountingCheckpoints();
      const previousCheckpoint = getPreviousCheckpoint(channelState.count, checkpoints);

      const submittedNumber = BigInt(numberStr);
      if (submittedNumber <= 0n) {
        const result = recordWrongCount(message.guild.id, message.channelId, message.author.id, previousCheckpoint);
        const response = buildWrongInputMessage(message, result, "the number must be at least 1");
        try { await message.react('❌'); } catch {}
        return message.channel.send(response);
      }

      if (submittedNumber !== expectedNumber) {
        const result = recordWrongCount(message.guild.id, message.channelId, message.author.id, previousCheckpoint);
        const response = buildWrongInputMessage(
          message,
          result,
          `expected **${expectedNumber.toString()}** but got **${submittedNumber.toString()}**`
        );
        try { await message.react('❌'); } catch {}
        return message.channel.send(response);
      }

      if (channelState.lastUserId && channelState.lastUserId === message.author.id) {
        const result = recordWrongCount(message.guild.id, message.channelId, message.author.id, previousCheckpoint);
        const response = buildWrongInputMessage(message, result, "the same user cannot count twice in a row");
        try { await message.react('❌'); } catch {}
        return message.channel.send(response);
      }

      const result = recordCorrectCount(message.guild.id, message.channelId, message.author.id);
      // React with a tick for correct counts; do not send a confirmation message.
      try { await message.react('✅'); } catch {}
      if (result.savesEarned > 0) {
        const savesEarned = result.savesEarned;
        const totalSaves = result.userState.saves || 0;
        await message.channel.send(
          `${message.author} earned **${savesEarned}** save${savesEarned === 1 ? "" : "s"}. Total saves: **${totalSaves}**.`
        );
      }
      // Announce checkpoints (configurable via config.json -> countingCheckpoints)
      try {
        for (const checkpoint of checkpoints) {
          if (BigInt(checkpoint) === result.count) {
            const announceChannel = message.channel;
            const countStr = formatBigInt(result.count);
            const nextCheckpoint = getNextCheckpoint(result.count, checkpoints);
            const nextCheckpointText = nextCheckpoint
              ? ` Next checkpoint: **${formatBigInt(nextCheckpoint)}**.`
              : " You have reached the final checkpoint.";
            const announcement = `🎉 Checkpoint reached: **${countStr}** in ${announceChannel}! Congratulations ${message.author}!${nextCheckpointText}`;
            try { await announceChannel.send(announcement); } catch {}
            break;
          }
        }
      } catch (err) {
        // don't let announcement errors interrupt counting
      }
    } catch (error) {
      console.error("counting feature error:", error);
    }
  });

  console.log(`✅ Counting feature loaded for ${countingChannelIds.size} channel(s)`);
};

module.exports = counting;