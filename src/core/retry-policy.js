export const DEFAULT_RETRY_POLICY = {
  maxAttempts: 2,
  baseDelayMs: 1200,
  maxDelayMs: 8000
};

export function shouldRetry(error, attempt, policy = DEFAULT_RETRY_POLICY) {
  return Boolean(error?.retryable) && attempt < policy.maxAttempts;
}

export function retryDelay(attempt, policy = DEFAULT_RETRY_POLICY) {
  return Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempt - 1), policy.maxDelayMs);
}

export function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
