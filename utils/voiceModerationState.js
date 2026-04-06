const suppressedVoiceLogs = new Map();

const markVoiceLogSuppressed = (userId, ttlMs = 8000) => {
  if (!userId) return;
  suppressedVoiceLogs.set(userId, Date.now() + ttlMs);
};

const shouldSuppressVoiceLog = (userId) => {
  if (!userId) return false;
  const expiry = suppressedVoiceLogs.get(userId);
  if (!expiry) return false;
  if (Date.now() <= expiry) return true;
  suppressedVoiceLogs.delete(userId);
  return false;
};

module.exports = {
  markVoiceLogSuppressed,
  shouldSuppressVoiceLog,
};