import { createHash } from 'node:crypto';

/**
 * Deterministic rollout bucket in [0, 99] for a `(key, subject)` pair. Stable across calls,
 * processes and restarts (pure hash), so a user keeps the same on/off decision as a toggle's
 * percentage ramps — the property a percentage rollout needs to be non-flickering.
 */
export function rolloutBucket(key: string, subjectId: string): number {
  const digest = createHash('sha256').update(`${key}:${subjectId}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/** Whether `subjectId` falls inside a `rolloutPercentage` rollout of `key`. */
export function isInRollout(key: string, subjectId: string, rolloutPercentage: number): boolean {
  if (rolloutPercentage <= 0) return false;
  if (rolloutPercentage >= 100) return true;
  return rolloutBucket(key, subjectId) < rolloutPercentage;
}
