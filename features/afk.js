const fs = require("node:fs");
const path = require("node:path");
const client = require(`${path.dirname(__dirname)}/index.js`);

const afkFilePath = path.join(__dirname, "..", "data", "afk-state.json");

const loadAfkState = () => {
  try {
    const raw = fs.readFileSync(afkFilePath, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveAfkState = (state) => {
  fs.writeFileSync(afkFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const ensureGuildState = (state, guildId) => {
  if (!state[guildId] || typeof state[guildId] !== "object") {
    state[guildId] = {};
  }
  return state[guildId];
};

const AFK_PREFIX = "[AFK] ";
const MAX_NICKNAME_LENGTH = 32;

const getDisplayNickname = (member) => member.nickname || member.user.username;

const stripAfkPrefix = (nickname) => {
  if (typeof nickname !== "string") return "";
  return nickname.startsWith(AFK_PREFIX) ? nickname.slice(AFK_PREFIX.length) : nickname;
};

const buildAfkNickname = (nickname) => {
  const baseName = stripAfkPrefix(nickname || "").trim() || "AFK";
  const availableLength = MAX_NICKNAME_LENGTH - AFK_PREFIX.length;
  return `${AFK_PREFIX}${baseName.slice(0, Math.max(0, availableLength))}`.slice(0, MAX_NICKNAME_LENGTH);
};

const canManageNickname = (message) => {
  const botMember = message.guild.members.me;
  if (!botMember?.permissions?.has?.("ManageNicknames")) return false;
  if (!message.member) return false;
  return botMember.roles.highest.position > message.member.roles.highest.position;
};

const applyAfkNickname = async (message, member, stateEntry) => {
  const currentNickname = member.nickname ?? null;
  const existingStoredNickname = typeof stateEntry.nickname === "string" ? stateEntry.nickname : null;
  const nextNickname = buildAfkNickname(currentNickname || member.user.username);

  if (!existingStoredNickname) {
    stateEntry.nickname = currentNickname;
  }

  if (currentNickname === nextNickname) return { changed: false, reason: null };

  try {
    await member.setNickname(nextNickname, "AFK status enabled");
    return { changed: true, reason: null };
  } catch (error) {
    return { changed: false, reason: "I couldn't change the nickname because I don't have permission or my role is too low." };
  }
};

const restoreNickname = async (member, stateEntry) => {
  const storedNickname = Object.prototype.hasOwnProperty.call(stateEntry, "nickname")
    ? stateEntry.nickname
    : null;

  if (storedNickname === null) {
    const currentNickname = member.nickname ?? "";
    if (!currentNickname.startsWith(AFK_PREFIX)) return null;
    const stripped = stripAfkPrefix(currentNickname).trim();
    try {
      await member.setNickname(stripped || null, "AFK status removed");
      return null;
    } catch {
      return "I couldn't restore the nickname because I don't have permission or my role is too low.";
    }
  }

  try {
    await member.setNickname(storedNickname || null, "AFK status removed");
    return null;
  } catch {
    return "I couldn't restore the nickname because I don't have permission or my role is too low.";
  }
};

const formatAfkReason = (reason) => {
  const trimmed = (reason || "").trim();
  return trimmed || "AFK";
};

const isClearAfkCommand = (parts) => {
  const action = (parts[2] || "").toLowerCase();
  return ["off", "back", "return", "clear", "remove", "end"].includes(action);
};

const afk = () => {
  client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();
    const state = loadAfkState();
    const guildState = ensureGuildState(state, message.guild.id);

    if (lower.startsWith("ct afk")) {
      const parts = content.split(/\s+/g);

      if (isClearAfkCommand(parts)) {
        const existingEntry = guildState[message.author.id];
        if (!existingEntry) {
          return message.reply("You are not marked as AFK.");
        }

        const restoreError = await restoreNickname(message.member, existingEntry);
        delete guildState[message.author.id];
        saveAfkState(state);

        return message.reply(
          restoreError ? `Your AFK status has been removed. ${restoreError}` : "Your AFK status has been removed."
        );
      }

      const reason = formatAfkReason(parts.slice(2).join(" "));
      const stateEntry = guildState[message.author.id] || {};
      guildState[message.author.id] = {
        ...stateEntry,
        reason,
        since: Date.now(),
      };
      const savedEntry = guildState[message.author.id];
      const nicknameChange = await applyAfkNickname(message, message.member, savedEntry);
      saveAfkState(state);

      return message.reply(
        nicknameChange.reason
          ? `You are now AFK. Reason: ${reason}\n${nicknameChange.reason}`
          : `You are now AFK. Reason: ${reason}`
      );
    }

    if (guildState[message.author.id]) {
      const restoreError = await restoreNickname(message.member, guildState[message.author.id]);
      delete guildState[message.author.id];
      saveAfkState(state);
      await message.reply(
        restoreError
          ? `Welcome back. Your AFK status has been removed. ${restoreError}`
          : "Welcome back. Your AFK status has been removed."
      ).catch(() => null);
    }

    const mentionedAfkUsers = [...new Map(message.mentions.users.map((user) => [user.id, user])).values()]
      .filter((user) => user.id !== message.author.id && guildState[user.id]);

    if (!mentionedAfkUsers.length) return;

    const lines = mentionedAfkUsers.map((user) => {
      const afkEntry = guildState[user.id];
      const reason = afkEntry?.reason || "AFK";
      const since = afkEntry?.since ? `<t:${Math.floor(Number(afkEntry.since) / 1000)}:R>` : "recently";
      return `**${user.username}** is AFK since ${since}. Reason: ${reason}`;
    });

    return message.reply({ content: lines.join("\n"), allowedMentions: { repliedUser: false } }).catch(() => null);
  });
};

module.exports = afk;