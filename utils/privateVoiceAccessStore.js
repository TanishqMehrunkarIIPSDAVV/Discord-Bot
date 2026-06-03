const fs = require("node:fs");
const path = require("node:path");

const configPath = path.join(__dirname, "..", "config.json");

const loadConfig = () => {
  try {
    delete require.cache[require.resolve("../config.json")];
    return require("../config.json");
  } catch {
    return {};
  }
};

const persistConfig = (nextConfig) => {
  fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  const cached = require("../config.json");
  Object.keys(cached).forEach((key) => {
    if (!(key in nextConfig)) delete cached[key];
  });
  Object.assign(cached, nextConfig);
};

const normalizeIdList = (value) =>
  Array.from(new Set((Array.isArray(value) ? value : []).map((id) => String(id).trim()).filter(Boolean)));

const getProtectedVoiceChannelId = () => {
  const config = loadConfig();
  const envValue = process.env.PRIVATE_VC_PROTECTED_CHANNEL_ID || process.env.PRIVATE_VC_CHANNEL_ID || "";

  return String(envValue || config.privateVcProtectedChannelId || config.privateVcChannelId || "").trim();
};

const getAllowedUserIds = () => {
  const config = loadConfig();
  const envValue = process.env.PRIVATE_VC_ALLOWED_USER_IDS || "";
  const envIds = envValue
    .split(",")
    .map((id) => String(id).trim())
    .filter(Boolean);

  return new Set(
    normalizeIdList([...(Array.isArray(config.privateVcAllowedUserIds) ? config.privateVcAllowedUserIds : []), ...envIds])
  );
};

const setProtectedVoiceChannelId = (channelId) => {
  const config = loadConfig();
  config.privateVcProtectedChannelId = String(channelId || "").trim();
  persistConfig(config);
  return config.privateVcProtectedChannelId;
};

const addAllowedUserId = (userId) => {
  const config = loadConfig();
  const nextAllowed = new Set(getAllowedUserIds());
  nextAllowed.add(String(userId || "").trim());
  config.privateVcAllowedUserIds = Array.from(nextAllowed).filter(Boolean);
  persistConfig(config);
  return new Set(config.privateVcAllowedUserIds);
};

const removeAllowedUserId = (userId) => {
  const config = loadConfig();
  const nextAllowed = new Set(getAllowedUserIds());
  nextAllowed.delete(String(userId || "").trim());
  config.privateVcAllowedUserIds = Array.from(nextAllowed).filter(Boolean);
  persistConfig(config);
  return new Set(config.privateVcAllowedUserIds);
};

module.exports = {
  loadConfig,
  persistConfig,
  getProtectedVoiceChannelId,
  getAllowedUserIds,
  setProtectedVoiceChannelId,
  addAllowedUserId,
  removeAllowedUserId,
};