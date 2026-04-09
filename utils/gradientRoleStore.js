const fs = require("node:fs");
const path = require("node:path");

const gradientRoleFilePath = path.join(__dirname, "..", "data", "gradient-roles.json");

/**
 * Load gradient role mappings from file
 * Structure: { guildId: { userId: { roleId, startColor, endColor, createdAt } } }
 */
const loadGradientRoleState = () => {
  try {
    const raw = fs.readFileSync(gradientRoleFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { guilds: {} };
    if (!parsed.guilds || typeof parsed.guilds !== "object") parsed.guilds = {};
    return parsed;
  } catch {
    return { guilds: {} };
  }
};

/**
 * Save gradient role mappings to file
 */
const saveGradientRoleState = (state) => {
  fs.writeFileSync(gradientRoleFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

/**
 * Ensure guild exists in state
 */
const ensureGuild = (state, guildId) => {
  if (!state.guilds[guildId] || typeof state.guilds[guildId] !== "object") {
    state.guilds[guildId] = {};
  }
  return state.guilds[guildId];
};

/**
 * Get or create user's gradient role entry
 */
const getUserGradientRole = (guildId, userId) => {
  const state = loadGradientRoleState();
  const guild = ensureGuild(state, guildId);
  return guild[userId] || null;
};

/**
 * Save user's new gradient role (overwrites previous if exists)
 */
const saveUserGradientRole = (guildId, userId, roleId, startColor, endColor) => {
  const state = loadGradientRoleState();
  const guild = ensureGuild(state, guildId);
  
  guild[userId] = {
    roleId,
    startColor,
    endColor,
    createdAt: new Date().toISOString(),
  };
  
  saveGradientRoleState(state);
};

/**
 * Remove user's gradient role entry
 */
const removeUserGradientRole = (guildId, userId) => {
  const state = loadGradientRoleState();
  const guild = ensureGuild(state, guildId);
  
  if (guild[userId]) {
    delete guild[userId];
    saveGradientRoleState(state);
  }
};

/**
 * Get all gradient roles for a guild (useful for cleanup)
 */
const getGuildGradientRoles = (guildId) => {
  const state = loadGradientRoleState();
  const guild = ensureGuild(state, guildId);
  return guild;
};

module.exports = {
  loadGradientRoleState,
  saveGradientRoleState,
  ensureGuild,
  getUserGradientRole,
  saveUserGradientRole,
  removeUserGradientRole,
  getGuildGradientRoles,
};
