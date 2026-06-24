import { isInRollout, rolloutBucket } from './rollout';

describe('rolloutBucket', () => {
  it('is in [0, 99]', () => {
    for (const id of ['u1', 'u2', 'abc', '550e8400-e29b-41d4-a716-446655440000']) {
      const b = rolloutBucket('payments', id);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(100);
    }
  });

  it('is deterministic for the same (key, subject)', () => {
    expect(rolloutBucket('payments', 'u1')).toBe(rolloutBucket('payments', 'u1'));
  });

  it('differs by key for the same subject', () => {
    expect(rolloutBucket('payments', 'u1')).not.toBe(rolloutBucket('boost', 'u1'));
  });
});

describe('isInRollout', () => {
  it('0% is always off, 100% is always on', () => {
    expect(isInRollout('k', 'u1', 0)).toBe(false);
    expect(isInRollout('k', 'u1', 100)).toBe(true);
  });

  it('is monotonic: once in, raising the percentage keeps the subject in', () => {
    const id = 'subject-42';
    const bucket = rolloutBucket('k', id);
    expect(isInRollout('k', id, bucket)).toBe(false); // bucket < pct is exclusive at the edge
    expect(isInRollout('k', id, bucket + 1)).toBe(true);
    expect(isInRollout('k', id, 100)).toBe(true);
  });

  it('roughly honours the percentage across many subjects (±6pp)', () => {
    const n = 5000;
    let inCount = 0;
    for (let i = 0; i < n; i++) {
      if (isInRollout('k', `user-${i}`, 30)) inCount++;
    }
    const pct = (inCount / n) * 100;
    expect(pct).toBeGreaterThan(24);
    expect(pct).toBeLessThan(36);
  });
});
