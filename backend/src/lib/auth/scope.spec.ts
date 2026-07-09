import { assertValidScope, parseScopeClaim } from './scope';

describe('scope — assertValidScope (ADR-0037 §2 validator)', () => {
  it('accepts a well-formed non-wildcard scope', () => {
    expect(() =>
      assertValidScope([
        { action: 'read', subject: 'ModerationQueue' },
        { action: 'create', subject: 'ModerationDecision' },
      ]),
    ).not.toThrow();
  });

  it('rejects the manage action', () => {
    expect(() => assertValidScope([{ action: 'manage', subject: 'Listing' }])).toThrow(/manage/);
  });

  it('rejects the all subject', () => {
    expect(() => assertValidScope([{ action: 'read', subject: 'all' }])).toThrow(/all/);
  });

  it('rejects an unknown action', () => {
    expect(() => assertValidScope([{ action: 'frobnicate', subject: 'Listing' }])).toThrow();
  });

  it('rejects a non-array and malformed grants', () => {
    expect(() => assertValidScope('nope')).toThrow();
    expect(() => assertValidScope([null])).toThrow();
    expect(() => assertValidScope([{ action: 'read' }])).toThrow();
  });
});

describe('scope — parseScopeClaim (fail-safe JWT claim parsing)', () => {
  it('returns undefined for missing/empty/non-array input', () => {
    expect(parseScopeClaim(undefined)).toBeUndefined();
    expect(parseScopeClaim(null)).toBeUndefined();
    expect(parseScopeClaim([])).toBeUndefined();
    expect(parseScopeClaim('x')).toBeUndefined();
  });

  it('keeps valid grants and drops malformed / wildcard ones (narrows, never widens)', () => {
    const parsed = parseScopeClaim([
      { action: 'read', subject: 'Listing' },
      { action: 'manage', subject: 'all' }, // wildcard → dropped
      { action: 'nope', subject: 'Listing' }, // bad action → dropped
      { action: 'read' }, // malformed → dropped
      { action: 'create', subject: 'ModerationDecision' },
    ]);
    expect(parsed).toEqual([
      { action: 'read', subject: 'Listing' },
      { action: 'create', subject: 'ModerationDecision' },
    ]);
  });

  it('a scope consisting only of wildcards resolves to undefined (deny-by-default)', () => {
    expect(parseScopeClaim([{ action: 'manage', subject: 'all' }])).toBeUndefined();
  });
});
