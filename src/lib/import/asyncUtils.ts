/**
 * Small, provider-agnostic async helpers (retry with backoff, timeout) used by
 * AI-backed import providers. Kept dependency-free and pure so retry/timeout
 * behavior can be unit-tested without ever calling a real network API.
 */

export interface RetryOptions {
  /** Number of retries AFTER the first attempt (so 2 = up to 3 total attempts). */
  retries: number;
  /** Delay before the next attempt, in ms, given the (1-based) attempt number that just failed. */
  delayMs?: (attempt: number) => number;
  /** Decides whether a given error is worth retrying at all. Defaults to always-retryable. */
  isRetryable?: (err: unknown) => boolean;
  /** Called right before each retry attempt - e.g. for logging. Never log the raw error payload here if it may contain sensitive data; callers decide what to extract. */
  onRetry?: (attempt: number, err: unknown) => void;
}

/**
 * Retries `fn` up to `options.retries` extra times when the thrown error is
 * retryable, waiting `delayMs(attempt)` between attempts. Rethrows the last
 * error once retries are exhausted or the error isn't retryable.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> {
  const { retries, delayMs, isRetryable = () => true, onRetry } = options;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const hasAttemptsLeft = attempt < retries;
      if (!hasAttemptsLeft || !isRetryable(err)) throw err;
      onRetry?.(attempt + 1, err);
      const wait = delayMs?.(attempt + 1) ?? 0;
      if (wait > 0) await sleep(wait);
    }
  }
  throw lastError;
}

/** Rejects with `onTimeout()`'s error if `promise` doesn't settle within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(onTimeout()), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
