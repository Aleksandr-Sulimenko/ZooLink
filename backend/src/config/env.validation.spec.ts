import { validateEnv, RF_ALLOWED_REGIONS, isRfRegion } from './env.validation';

/**
 * Security-critical env parsing (AUDIT3 security.md #1). Two invariants proven with negatives:
 *  - NODE_ENV FAILS SAFE: a config that forgets it defaults to 'production' (locked-down), never
 *    'development' (permissive) — the fail-open root cause of the dev-token ATO chain.
 *  - ENABLE_DEV_TOKEN is fail-closed AND strictly parsed: default false, and only the literal
 *    'true'/'false' are accepted (a typo like '1'/'TRUE'/'yes' is a boot-blocking error, never
 *    silently truthy the way z.coerce.boolean() would treat 'false' as true).
 */
describe('validateEnv — security defaults', () => {
  // Minimal set of the boot-required secrets so the parse reaches the fields under test.
  const base = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'x',
    S3_SECRET_KEY: 'x',
    S3_BUCKET: 'b',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    PHONE_HASH_PEPPER: 'c'.repeat(32),
    PII_DATA_KEY: 'd'.repeat(32),
    PII_BLIND_INDEX_KEY: 'e'.repeat(32),
    // NODE_ENV set to development so the production-only superRefines (agent secret / Apple) are
    // out of the way — we assert NODE_ENV/ENABLE_DEV_TOKEN behaviour, not those.
    NODE_ENV: 'development',
  };

  it('defaults NODE_ENV to production (fail-safe) when omitted', () => {
    const { NODE_ENV, ...noNodeEnv } = base;
    void NODE_ENV;
    // Omitting NODE_ENV in production would also require the agent secret; provide it so the parse
    // reaches its natural default rather than tripping the unrelated superRefine.
    const parsed = validateEnv({
      ...noNodeEnv,
      AGENT_SERVICE_SIGNING_SECRET: 'f'.repeat(32),
    });
    expect(parsed.NODE_ENV).toBe('production');
  });

  it('defaults ENABLE_DEV_TOKEN to false when omitted (fail-closed)', () => {
    const parsed = validateEnv({ ...base });
    expect(parsed.ENABLE_DEV_TOKEN).toBe(false);
  });

  it('parses ENABLE_DEV_TOKEN="true" to boolean true', () => {
    const parsed = validateEnv({ ...base, ENABLE_DEV_TOKEN: 'true' });
    expect(parsed.ENABLE_DEV_TOKEN).toBe(true);
  });

  it('parses ENABLE_DEV_TOKEN="false" to boolean false (NOT truthy — the coerce footgun)', () => {
    const parsed = validateEnv({ ...base, ENABLE_DEV_TOKEN: 'false' });
    expect(parsed.ENABLE_DEV_TOKEN).toBe(false);
  });

  it.each(['1', '0', 'TRUE', 'True', 'yes', 'on', ''])(
    'rejects a non-strict ENABLE_DEV_TOKEN value %p (boot-blocking)',
    (bad) => {
      expect(() => validateEnv({ ...base, ENABLE_DEV_TOKEN: bad })).toThrow(
        /Invalid environment configuration/,
      );
    },
  );
});

/**
 * ADR-0017 (RF data residency, ФЗ-152 ст.18 ч.5) — layer-1 runtime guardrail. Every `*_REGION`
 * env var must resolve to an approved RF region or the process refuses to boot; a non-RF region is
 * tolerated only under an explicit dev bypass, and NEVER in production.
 */
describe('validateEnv — RF data residency (ADR-0017)', () => {
  // Full boot-required set with production secrets, so the parse reaches the residency refine
  // without tripping the unrelated production superRefines (agent secret / Apple).
  const prodBase = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://localhost:9000',
    S3_ACCESS_KEY: 'x',
    S3_SECRET_KEY: 'x',
    S3_BUCKET: 'b',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    PHONE_HASH_PEPPER: 'c'.repeat(32),
    PII_DATA_KEY: 'd'.repeat(32),
    PII_BLIND_INDEX_KEY: 'e'.repeat(32),
    AGENT_SERVICE_SIGNING_SECRET: 'f'.repeat(32),
    NODE_ENV: 'production',
  };

  it('exposes ru-central1 in the canonical allowlist and isRfRegion agrees', () => {
    expect(RF_ALLOWED_REGIONS).toContain('ru-central1');
    expect(isRfRegion('ru-central1')).toBe(true);
    expect(isRfRegion('us-east-1')).toBe(false);
  });

  it('boots with the default S3_REGION (approved RF id) when omitted', () => {
    const parsed = validateEnv({ ...prodBase });
    expect(parsed.S3_REGION).toBe('ru-central1');
  });

  it.each(RF_ALLOWED_REGIONS)('accepts approved RF region %p', (region) => {
    expect(() => validateEnv({ ...prodBase, S3_REGION: region })).not.toThrow();
  });

  it.each(['us-east-1', 'eu-west-1', 'ap-southeast-2', 'ru-central2'])(
    'THROWS at boot on a non-RF S3_REGION %p in production',
    (bad) => {
      expect(() => validateEnv({ ...prodBase, S3_REGION: bad })).toThrow(
        /not an approved RF region/,
      );
    },
  );

  it('rejects the MinIO us-east-1 trap in production even with the dev bypass set', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        S3_REGION: 'us-east-1',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/not an approved RF region/);
  });

  it('allows a non-RF S3_REGION in dev ONLY with the explicit bypass', () => {
    const devBase = { ...prodBase, NODE_ENV: 'development' };
    // Without the bypass, dev is still strict.
    expect(() => validateEnv({ ...devBase, S3_REGION: 'us-east-1' })).toThrow(
      /not an approved RF region/,
    );
    // With the explicit bypass, dev tolerates the native MinIO default.
    const parsed = validateEnv({
      ...devBase,
      S3_REGION: 'us-east-1',
      RESIDENCY_ALLOW_NON_RF_DEV: 'true',
    });
    expect(parsed.S3_REGION).toBe('us-east-1');
  });
});
