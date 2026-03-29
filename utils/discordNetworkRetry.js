const TRANSIENT_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ECONNRESET",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
]);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientDiscordNetworkError = (error) => {
  if (!error) return false;

  if (TRANSIENT_ERROR_CODES.has(error.code)) return true;

  // Retry gateway/API edge outages and rate-limited upstream scenarios.
  if (typeof error.status === "number" && [429, 500, 502, 503, 504].includes(error.status)) {
    return true;
  }

  return false;
};

const withDiscordNetworkRetry = async (operation, options = {}) => {
  const {
    retries = 3,
    baseDelayMs = 1000,
    label = "discord-operation",
    onRetry,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isRetryable = isTransientDiscordNetworkError(error);
      const hasAttemptLeft = attempt < retries;

      if (!isRetryable || !hasAttemptLeft) {
        throw error;
      }

      const delayMs = baseDelayMs * 2 ** attempt;
      if (typeof onRetry === "function") {
        onRetry({ error, attempt: attempt + 1, retries, delayMs, label });
      }

      await wait(delayMs);
    }
  }

  throw lastError;
};

module.exports = {
  isTransientDiscordNetworkError,
  withDiscordNetworkRetry,
};