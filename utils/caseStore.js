const fs = require("node:fs");
const path = require("node:path");

const caseFilePath = path.join(__dirname, "..", "data", "mod-cases.json");

const loadCaseState = () => {
  try {
    const raw = fs.readFileSync(caseFilePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { nextCaseId: 1, guilds: {} };
    if (!parsed.guilds || typeof parsed.guilds !== "object") parsed.guilds = {};
    if (!Number.isFinite(Number(parsed.nextCaseId)) || Number(parsed.nextCaseId) < 1) parsed.nextCaseId = 1;
    return parsed;
  } catch {
    return { nextCaseId: 1, guilds: {} };
  }
};

const saveCaseState = (state) => {
  fs.writeFileSync(caseFilePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
};

const ensureGuildCases = (state, guildId) => {
  if (!state.guilds[guildId] || typeof state.guilds[guildId] !== "object") {
    state.guilds[guildId] = { cases: [] };
  }
  if (!Array.isArray(state.guilds[guildId].cases)) {
    state.guilds[guildId].cases = [];
  }
  return state.guilds[guildId].cases;
};

const createCase = ({
  guildId,
  type,
  actorId = null,
  targetUserId = null,
  reason = "No reason provided",
  details = {},
}) => {
  if (!guildId) return null;
  const state = loadCaseState();
  const list = ensureGuildCases(state, guildId);

  const caseId = Number(state.nextCaseId) || 1;
  state.nextCaseId = caseId + 1;

  const entry = {
    id: caseId,
    guildId,
    type: String(type || "note").toLowerCase(),
    actorId: actorId ? String(actorId) : null,
    targetUserId: targetUserId ? String(targetUserId) : null,
    reason: String(reason || "No reason provided"),
    details: details && typeof details === "object" ? details : {},
    createdAt: Date.now(),
  };

  list.push(entry);
  saveCaseState(state);
  return entry;
};

const getGuildCases = (guildId) => {
  const state = loadCaseState();
  const list = ensureGuildCases(state, guildId);
  return [...list];
};

const getCaseById = (guildId, caseId) => {
  const id = Number(caseId);
  if (!Number.isFinite(id)) return null;
  const list = getGuildCases(guildId);
  return list.find((entry) => Number(entry.id) === id) || null;
};

module.exports = {
  createCase,
  getGuildCases,
  getCaseById,
};