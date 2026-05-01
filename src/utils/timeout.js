function createTimeoutError(message, { code = 'ETIMEDOUT', status = 504, retryable = true } = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.retryable = retryable;
  return error;
}

async function withTimeout(operation, timeoutMs, message, options = {}) {
  const numericTimeout = Number(timeoutMs);
  if (!Number.isFinite(numericTimeout) || numericTimeout <= 0) {
    return Promise.resolve().then(operation);
  }

  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        createTimeoutError(
          message || `Operation timed out after ${numericTimeout}ms`,
          options
        )
      );
    }, numericTimeout);
  });

  try {
    return await Promise.race([Promise.resolve().then(operation), timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = {
  createTimeoutError,
  withTimeout,
};
