import {
  validateEnv,
  RF_ALLOWED_REGIONS,
  isRfRegion,
  isResidentTelemetryHost,
  checkTelemetryDsn,
} from './env.validation';

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
      // Defaulting to production also makes METRICS_TOKEN required — provide it so the parse reaches
      // its natural NODE_ENV default rather than tripping the unrelated /metrics gate refine.
      METRICS_TOKEN: 'm'.repeat(16),
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
    METRICS_TOKEN: 'm'.repeat(16),
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

/**
 * ADR-0017 clause 6 — the PII-bearing observability sink (ФЗ-152 ст.18 ч.5). SENTRY_DSN names a HOST,
 * carries no region string, and is therefore invisible to the region axes above: before this gate, a
 * single `.env` line could ship stack traces (and the PII inside them) to a foreign ingest while all
 * three residency layers reported green. Empty DSN = sink disabled, which must keep working.
 */
describe('validateEnv — error-sink residency (ADR-0017 п.6)', () => {
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
    METRICS_TOKEN: 'm'.repeat(16),
    NODE_ENV: 'production',
  };

  // --- axis 1: negative. A foreign ingest must stop the boot, with a residency-specific message.
  it.each([
    'https://abc123@o4507.ingest.sentry.io/42',
    'https://abc123@o4507.ingest.us.sentry.io/42',
    'https://abc123@sentry.example.com/42',
    'https://abc123@errors.example.de/1',
  ])('THROWS at boot in production on a foreign error-sink DSN %p', (dsn) => {
    expect(() => validateEnv({ ...prodBase, SENTRY_DSN: dsn })).toThrow(
      /is NOT RF-resident \(ADR-0017/,
    );
  });

  it('names the host and NOT the DSN in the boot error (the DSN carries a credential)', () => {
    let message = '';
    try {
      validateEnv({
        ...prodBase,
        SENTRY_DSN: 'https://sup3rs3cretkey@o1.ingest.sentry.io/42',
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('o1.ingest.sentry.io');
    expect(message).not.toContain('sup3rs3cretkey');
  });

  // --- axis 2 / axis 5: the CURRENT live mode (sink disabled) keeps booting, untouched.
  it('boots with an EMPTY SENTRY_DSN (sink disabled — the lawful default, capability preserved)', () => {
    const parsed = validateEnv({ ...prodBase, SENTRY_DSN: '' });
    expect(parsed.SENTRY_DSN).toBe('');
  });

  it('boots when SENTRY_DSN is omitted entirely (schema default)', () => {
    expect(() => validateEnv({ ...prodBase })).not.toThrow();
  });

  // --- axis 3: an allowed sink (self-hosted or RF domain) boots.
  it.each([
    'http://key@sentry:9000/2', // compose service name (self-hosted)
    'http://key@localhost:9000/2',
    'http://key@127.0.0.1:9000/2',
    'http://key@10.1.2.3:9000/2',
    'http://key@172.20.0.5:9000/2',
    'http://key@192.168.1.10:9000/2',
    'https://key@sentry.zoolink.ru/2',
    'https://key@errors.example.su/2',
  ])('boots in production with an allowed error-sink DSN %p', (dsn) => {
    expect(() => validateEnv({ ...prodBase, SENTRY_DSN: dsn })).not.toThrow();
  });

  // --- the userinfo trap: the DSN's public key sits BEFORE the host, so any substring check on the
  // whole string is defeated. This is why the implementation must parse a URL.
  it('is not fooled by an RF-looking public key in front of a foreign host', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        SENTRY_DSN: 'https://sentry.zoolink.ru@o1.ingest.sentry.io/42',
      }),
    ).toThrow(/is NOT RF-resident/);
  });

  it('is not fooled by an RF-looking path/query on a foreign host', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        SENTRY_DSN: 'https://key@o1.ingest.sentry.io/42?host=sentry.zoolink.ru',
      }),
    ).toThrow(/is NOT RF-resident/);
  });

  // --- fail-closed on garbage: a host we cannot read is a host we cannot clear.
  it.each(['not-a-url', 'ftp://key@sentry.zoolink.ru/1', 'https://', '   x   '])(
    'THROWS at boot on an unparseable SENTRY_DSN %p (fail-closed)',
    (dsn) => {
      expect(() => validateEnv({ ...prodBase, SENTRY_DSN: dsn })).toThrow(
        /no http\(s\) ingest host could be parsed/,
      );
    },
  );

  // --- the escape hatch: dev-only, and IGNORED in production (same rule as the region bypass).
  it('permits a foreign sink in dev ONLY with the explicit bypass', () => {
    const devBase = { ...prodBase, NODE_ENV: 'development' };
    const dsn = 'https://key@o1.ingest.sentry.io/42';
    expect(() => validateEnv({ ...devBase, SENTRY_DSN: dsn })).toThrow(
      /is NOT RF-resident/,
    );
    expect(() =>
      validateEnv({
        ...devBase,
        SENTRY_DSN: dsn,
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).not.toThrow();
  });

  it('IGNORES the dev bypass in production (residency is unconditional there)', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        SENTRY_DSN: 'https://key@o1.ingest.sentry.io/42',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/is NOT RF-resident/);
  });

  it('never bypasses an unparseable DSN, even in dev with the flag set', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        SENTRY_DSN: 'not-a-url',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/no http\(s\) ingest host could be parsed/);
  });
});

/** Host-level rule in isolation — the unit the boot refine, initSentry and the CI gate all mirror. */
describe('isResidentTelemetryHost / checkTelemetryDsn', () => {
  it.each([
    'localhost',
    'sentry', // single-label = container/LAN name, not publicly routable
    'sentry.zoolink.ru',
    'a.b.c.su',
    '127.0.0.1',
    '10.0.0.1',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.0.1',
    '::1',
    'fd00:1234::5',
    '[fd00::5]',
  ])('accepts self-hosted / RF host %p', (host) => {
    expect(isResidentTelemetryHost(host)).toBe(true);
  });

  it.each([
    'o1.ingest.sentry.io',
    'sentry.io',
    'errors.example.com',
    '8.8.8.8',
    '172.32.0.1', // just outside RFC1918
    '172.15.0.1',
    '2001:4860:4860::8888',
    'fdservice.com', // starts with "fd" but is a DNS name, not an IPv6 ULA
    'fe80.example.com',
    '',
  ])('rejects non-resident host %p', (host) => {
    expect(isResidentTelemetryHost(host)).toBe(false);
  });

  it('treats an empty DSN as "sink disabled", not as a violation', () => {
    expect(checkTelemetryDsn('')).toEqual({
      ok: true,
      host: null,
      reason: 'disabled',
    });
  });
});

/**
 * /metrics scrape-credential gate (AUDIT3 security.md, D8 🟡). In production METRICS_TOKEN MUST be set
 * (≥16); without it MetricsGuard falls back to trusting req.ip, which behind the reverse proxy makes
 * /metrics world-readable. Optional in dev/test (the internal-client fallback covers local scraping).
 */
describe('validateEnv — /metrics token gate (production-required)', () => {
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

  it('THROWS at boot in production when METRICS_TOKEN is missing', () => {
    expect(() => validateEnv({ ...prodBase })).toThrow(/METRICS_TOKEN: required in production/);
  });

  it('THROWS at boot in production when METRICS_TOKEN is empty', () => {
    expect(() => validateEnv({ ...prodBase, METRICS_TOKEN: '' })).toThrow(
      /METRICS_TOKEN: required in production/,
    );
  });

  it('boots in production with a valid METRICS_TOKEN (≥16)', () => {
    const parsed = validateEnv({ ...prodBase, METRICS_TOKEN: 'm'.repeat(16) });
    expect(parsed.METRICS_TOKEN).toBe('m'.repeat(16));
  });

  it('rejects a too-short METRICS_TOKEN even in production (shape-check ≥16)', () => {
    expect(() => validateEnv({ ...prodBase, METRICS_TOKEN: 'short' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('boots in dev WITHOUT a METRICS_TOKEN (internal-client fallback covers local scraping)', () => {
    const parsed = validateEnv({ ...prodBase, NODE_ENV: 'development' });
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.METRICS_TOKEN).toBeUndefined();
  });
});
