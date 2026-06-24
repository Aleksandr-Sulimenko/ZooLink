const BASE_SECONDS = 10;
const FACTOR = 2;
const MAX_SECONDS = 3600; // cap a single wait at 1 hour

/** Give up (dead-letter) after this many delivery attempts. */
export const MAX_ATTEMPTS = 8;

/**
 * Exponential backoff (seconds) before retrying a failed delivery: 10, 20, 40, … capped at
 * {@link MAX_SECONDS}. `attempts` is the count *after* the failed attempt (>=1), so attempt 1
 * waits the base delay. Deterministic (no jitter) to keep the relay testable; jitter can be
 * layered in later if a thundering herd appears.
 */
export function backoffSeconds(attempts: number): number {
  const n = Math.max(1, attempts);
  return Math.min(MAX_SECONDS, BASE_SECONDS * FACTOR ** (n - 1));
}
