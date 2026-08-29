import {
  validateEnv,
  RF_ALLOWED_PROVIDER_HOSTS,
  RF_ALLOWED_REGIONS,
  RF_ALLOWED_HOST_SUFFIXES,
  RF_ALLOWED_STORAGE_HOSTS,
  RF_DATABASE_URL_SCHEMES,
  RF_REDIS_URL_SCHEMES,
  isRfRegion,
  isResidentTelemetryHost,
  isResidentStorageHost,
  isResidentDataStoreHost,
  checkTelemetryDsn,
  checkStorageEndpoint,
  checkMediaCdnHost,
  checkDatabaseUrl,
  checkRedisUrl,
  databaseUrlRejectionMessage,
  redisUrlRejectionMessage,
  isAllowedProviderHost,
  isResidentHost,
  sanitizedHostList,
  STAND_HOSTS_TOGGLE_ON,
  STAND_HOSTS_TOGGLE_OFF,
  STAND_HOSTS_TOGGLE_VALUES,
  standHostsToggleOn,
  standHostsAllowed,
} from './env.validation';

/**
 * Security-critical env parsing (AUDIT3 security.md #1). Two invariants proven with negatives:
 *  - NODE_ENV FAILS SAFE: a config that forgets it defaults to 'production' (locked-down), never
 *    'development' (permissive) — the fail-open root cause of the dev-token ATO chain.
 *  - ENABLE_DEV_TOKEN is fail-closed AND strictly parsed: default false, and only the literal
 *    'true'/'false' are accepted (a typo like '1'/'TRUE'/'yes' is a boot-blocking error, never
 *    silently truthy the way z.coerce.boolean() would treat 'false' as true).
 */
// ФИКСТУРА ОДНА НА ФАЙЛ: второй набор осей (флаг стендов) требовал тех же обязательных полей,
// и копия фикстуры зеленела бы вместе с оригиналом, расходясь с ним молча.
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

describe('validateEnv — security defaults', () => {
  // Minimal set of the boot-required secrets so the parse reaches the fields under test.

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

/**
 * ADR-0017 clause 4 — the PII-bearing OBJECT STORE (`S3_ENDPOINT`) and the CDN in front of it
 * (`MEDIA_CDN_HOST`). Third and fourth instance of ONE defect: the residency guardrail checks
 * REGIONS while the data leaves by HOST. Measured red-before on 2026-08-09 — with
 * `S3_REGION=ru-central1` untouched, `S3_ENDPOINT=https://s3.us-west-004.backblazeb2.com` and
 * `MEDIA_CDN_HOST=cdn.cloudflare.com` both booted cleanly AND the CI gate exited 0.
 *
 * `MEDIA_CDN_HOST` is the more dangerous of the two: its host is ADDED to the media-URL allowlist
 * (lib/media/media-url.ts), so a foreign value both serves avatars (PII, ADR-0012) from abroad and
 * widens the own-storage check that stops moderation-swap / latent SSRF.
 */
describe('validateEnv — object-storage & CDN residency (ADR-0017 п.4)', () => {
  const prodBase = {
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    S3_ENDPOINT: 'http://minio:9000',
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

  // --- S3_ENDPOINT, axis 1: negative. A foreign bucket must stop the boot, and the message must be
  // about RESIDENCY (an operator who reads "invalid URL" learns nothing and reaches for a workaround).
  it.each([
    'https://s3.us-west-004.backblazeb2.com', // the measured red-before value
    'https://s3.amazonaws.com',
    'https://s3.eu-central-1.wasabisys.com',
    'https://storage.yandexcloud.net.evil.com', // look-alike: NOT a subdomain of the approved host
  ])('THROWS at boot on a foreign S3_ENDPOINT %p in production', (endpoint) => {
    expect(() => validateEnv({ ...prodBase, S3_ENDPOINT: endpoint })).toThrow(
      /object-storage host .* is NOT RF-resident/,
    );
  });

  it('names ADR-0017 п.4 and ФЗ-152 in the S3_ENDPOINT rejection, and does not leak credentials', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        S3_ENDPOINT: 'https://key:secret@s3.us-west-004.backblazeb2.com',
      }),
    ).toThrow(/ADR-0017 п\.4 \/ ФЗ-152 ст\.18 ч\.5/);
    // The message must name the HOST, never the userinfo it was carrying.
    try {
      validateEnv({
        ...prodBase,
        S3_ENDPOINT: 'https://key:secret@s3.us-west-004.backblazeb2.com',
      });
      throw new Error('expected validateEnv to throw');
    } catch (e) {
      expect((e as Error).message).not.toContain('secret');
    }
  });

  it('resolves the host by a REAL URL parse, not a substring test (userinfo cannot fake residency)', () => {
    // `includes('.ru')` would pass this: the "ru.example.com" part is USERINFO; the host is evil.com.
    expect(() =>
      validateEnv({ ...prodBase, S3_ENDPOINT: 'https://ru.example.com@evil.com/' }),
    ).toThrow(/object-storage host "evil\.com" is NOT RF-resident/);
  });

  // --- S3_ENDPOINT, axis 2: positive. Every shape a real deployment uses must still boot.
  it.each([
    'http://minio:9000', // docker-compose service name — the live dev/CI stand
    'http://localhost:9000',
    'http://10.0.0.5:9000', // RFC1918 self-hosted MinIO
    'https://storage.yandexcloud.net', // ADR-0008 prod object storage (non-RF TLD, explicitly approved)
    'https://zoolink-media.storage.yandexcloud.net', // virtual-host bucket form of the same provider
    'https://s3.storage.selcloud.ru', // an RF-domain provider, covered by the suffix rule
  ])('boots in production with an approved S3_ENDPOINT %p', (endpoint) => {
    expect(() =>
      validateEnv({ ...prodBase, S3_ENDPOINT: endpoint }),
    ).not.toThrow();
  });

  // --- S3_ENDPOINT, axis 3: fail-closed on anything unreadable. There is NO lawful "empty" mode —
  // the app cannot store media without a bucket — so empty is an error, not a "disabled" state.
  it.each([
    'ftp://s3.example.com', // z.string().url() accepted ANY scheme — measured red-before
    's3://bucket',
    'file:///tmp/bucket',
  ])('THROWS at boot on a non-http(s) S3_ENDPOINT %p (fail-closed)', (endpoint) => {
    expect(() => validateEnv({ ...prodBase, S3_ENDPOINT: endpoint })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('rejects a bare public IP endpoint (residency is unverifiable for it)', () => {
    expect(() =>
      validateEnv({ ...prodBase, S3_ENDPOINT: 'http://203.0.113.7:9000' }),
    ).toThrow(/object-storage host "203\.0\.113\.7" is NOT RF-resident/);
  });

  // --- S3_ENDPOINT, axis 4: the dev escape hatch, and its absence in production.
  it('allows a foreign S3_ENDPOINT in dev ONLY under RESIDENCY_ALLOW_NON_RF_DEV', () => {
    const foreign = 'https://s3.us-west-004.backblazeb2.com';
    expect(() =>
      validateEnv({ ...prodBase, NODE_ENV: 'development', S3_ENDPOINT: foreign }),
    ).toThrow(/object-storage host .* is NOT RF-resident/);
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        S3_ENDPOINT: foreign,
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).not.toThrow();
  });

  it('IGNORES the dev bypass for S3_ENDPOINT in production (residency is unconditional there)', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        S3_ENDPOINT: 'https://s3.us-west-004.backblazeb2.com',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/object-storage host .* is NOT RF-resident/);
  });

  it('never lets the dev bypass rescue an UNPARSEABLE S3_ENDPOINT', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        S3_ENDPOINT: 'ftp://s3.example.com',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  // --- MEDIA_CDN_HOST, axis 1: negative.
  it.each([
    'cdn.cloudflare.com', // the measured red-before value
    'd1234abcd.cloudfront.net',
    'zoolink.b-cdn.net',
    'foo.ru.evil.com', // a `.ru` label that is NOT the TLD — endsWith is the right test
  ])('THROWS at boot on a foreign MEDIA_CDN_HOST %p in production', (host) => {
    expect(() => validateEnv({ ...prodBase, MEDIA_CDN_HOST: host })).toThrow(
      /media CDN host .* is NOT RF-resident/,
    );
  });

  it('explains WHY the CDN host matters (it is added to the media-URL allowlist)', () => {
    expect(() =>
      validateEnv({ ...prodBase, MEDIA_CDN_HOST: 'cdn.cloudflare.com' }),
    ).toThrow(/ADDED to the media-URL allowlist/);
  });

  // --- MEDIA_CDN_HOST, axis 2: positive-1 — empty is a LAWFUL mode (no CDN) and is today's live
  // value in .env.example. This is the no-capability-regression axis for the variable.
  it('boots with an EMPTY MEDIA_CDN_HOST (no CDN — the lawful documented default)', () => {
    const parsed = validateEnv({ ...prodBase, MEDIA_CDN_HOST: '' });
    expect(parsed.MEDIA_CDN_HOST).toBe('');
  });

  it('boots when MEDIA_CDN_HOST is omitted entirely (schema default)', () => {
    const parsed = validateEnv({ ...prodBase });
    expect(parsed.MEDIA_CDN_HOST).toBe('');
  });

  // --- MEDIA_CDN_HOST, axis 3: positive-2 — approved hosts.
  it.each([
    'cdn.zoolink.ru', // the value .env.example documents
    'CDN.ZooLink.RU', // case-insensitive
    'cdn.zoolink.ru:8443', // host[:port] — the media allowlist compares host INCLUDING port
    'media.zoolink.su',
    'storage.yandexcloud.net', // serving straight off the approved RF bucket
    'minio', // single-label service name
  ])('boots in production with an approved MEDIA_CDN_HOST %p', (host) => {
    expect(() =>
      validateEnv({ ...prodBase, MEDIA_CDN_HOST: host }),
    ).not.toThrow();
  });

  // --- MEDIA_CDN_HOST, axis 4: form. It is a BARE host, so anything wearing a host's clothes is
  // refused before the residency test — otherwise it would be a silently-unmatchable allowlist entry.
  it.each([
    'https://cdn.zoolink.ru', // a scheme is not part of a host
    'evil.com/cdn.zoolink.ru',
    'key@evil.com',
    'evil.com%2f.ru',
    'cdn.zoolink.ru cdn.evil.com',
    ':9000',
  ])('THROWS at boot on a malformed MEDIA_CDN_HOST %p (fail-closed)', (host) => {
    expect(() => validateEnv({ ...prodBase, MEDIA_CDN_HOST: host })).toThrow(
      /MEDIA_CDN_HOST must be a bare host\[:port\]/,
    );
  });

  it('never lets the dev bypass rescue a MALFORMED MEDIA_CDN_HOST', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        MEDIA_CDN_HOST: 'https://cdn.zoolink.ru',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/MEDIA_CDN_HOST must be a bare host\[:port\]/);
  });

  it('allows a foreign MEDIA_CDN_HOST in dev ONLY under RESIDENCY_ALLOW_NON_RF_DEV, never in prod', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        MEDIA_CDN_HOST: 'cdn.cloudflare.com',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnv({
        ...prodBase,
        MEDIA_CDN_HOST: 'cdn.cloudflare.com',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/media CDN host .* is NOT RF-resident/);
  });

  // --- NO-CAPABILITY-REGRESSION: the configuration that exists TODAY must boot untouched. Values
  // are read from the schema defaults / .env.example shape, not invented for the test.
  it('boots the LIVE configuration (.env.example shape) with no .env edits at all', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        S3_ENDPOINT: 'http://minio:9000', // .env.example:29
        MEDIA_CDN_HOST: '', // .env.example:36
        S3_REGION: 'ru-central1', // .env.example:40
        SENTRY_DSN: '', // .env.example:117
      }),
    ).not.toThrow();
  });

  it('boots the CI configuration (ci.yml S3_ENDPOINT=http://localhost:9000)', () => {
    expect(() =>
      validateEnv({ ...prodBase, S3_ENDPOINT: 'http://localhost:9000' }),
    ).not.toThrow();
  });
});

/** Host rules in isolation — the units the boot refine and the CI gate both mirror. */
describe('isResidentStorageHost / checkStorageEndpoint / checkMediaCdnHost', () => {
  it('admits the approved provider host and its subdomains, but not a look-alike', () => {
    expect(RF_ALLOWED_STORAGE_HOSTS).toContain('storage.yandexcloud.net');
    expect(isResidentStorageHost('storage.yandexcloud.net')).toBe(true);
    expect(isResidentStorageHost('zoolink-media.storage.yandexcloud.net')).toBe(true);
    expect(isResidentStorageHost('storage.yandexcloud.net.evil.com')).toBe(false);
    expect(isResidentStorageHost('yandexcloud.net')).toBe(false);
  });

  it('keeps the telemetry rule NARROWER than the storage rule (a bucket is not an error sink)', () => {
    // The provider carve-out must not leak into the DSN rule: storage.yandexcloud.net is an object
    // store, and admitting it as a telemetry ingest would widen clause 6 by accident.
    expect(isResidentStorageHost('storage.yandexcloud.net')).toBe(true);
    expect(isResidentTelemetryHost('storage.yandexcloud.net')).toBe(false);
  });

  it('shares ONE suffix list with the telemetry rule (no second list to drift)', () => {
    expect(RF_ALLOWED_HOST_SUFFIXES).toContain('.ru');
    for (const suffix of RF_ALLOWED_HOST_SUFFIXES) {
      expect(isResidentTelemetryHost(`sink${suffix}`)).toBe(true);
      expect(isResidentStorageHost(`bucket${suffix}`)).toBe(true);
    }
  });

  it('treats an empty CDN host as "no CDN", but an empty S3 endpoint as an error', () => {
    expect(checkMediaCdnHost('')).toEqual({ ok: true, host: null, reason: 'disabled' });
    expect(checkMediaCdnHost('   ')).toEqual({ ok: true, host: null, reason: 'disabled' });
    expect(checkStorageEndpoint('')).toEqual({
      ok: false,
      host: null,
      reason: 'unparseable',
    });
  });
});

/**
 * ADR-0017 clause 1 — the PRIMARY store of personal data (`DATABASE_URL`) and the cache/throttler store
 * in front of it (`REDIS_URL`). LAST and HEAVIEST member of the same defect class as clauses 4 and 6:
 * the residency guardrail scans REGIONS while the data leaves by HOST, and neither DSN carries a region
 * string at all.
 *
 * MEASURED red-before, 2026-08-09, at NODE_ENV=production with every other layer green:
 *   DATABASE_URL=postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db  → ACCEPTED (6/6 foreign DSN configs)
 *   REDIS_URL=rediss://d:p@eu2-x.upstash.io:6379                   → ACCEPTED
 * and the CI residency gate exited 0 on the region-token-free variants (`ep-x.aws.neon.tech`,
 * `eu2-x.upstash.io`) with no output at all. The whole database of РФ-citizens' personal data could be
 * moved abroad by editing one `.env` line, with three green residency layers reporting compliance.
 */
describe('validateEnv — primary-store residency (ADR-0017 п.1)', () => {
  const prodBase = {
    DATABASE_URL: 'postgresql://zoolink:pw@postgres:5432/zoolink?schema=public',
    REDIS_URL: 'redis://:pw@redis:6379',
    S3_ENDPOINT: 'http://minio:9000',
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

  // --- axis 1: negative. The measured red-before values, plus the managed-provider hosts an operator
  // would realistically paste in. The message must be about RESIDENCY, not "invalid url".
  it.each([
    'postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db', // the measured red-before value
    'postgresql://u:p@ep-x.aws.neon.tech/db', // same provider, no region token: axis 2 of the gate is blind to it
    'postgresql://u:p@db.abc.eu-west-1.rds.amazonaws.com:5432/z',
    'postgresql://postgres:p@db.abcxyz.supabase.co:5432/postgres',
    'postgres://u:p@ep.azure.neon.tech/db',
  ])('THROWS at boot in production on a foreign DATABASE_URL %p', (url) => {
    expect(() => validateEnv({ ...prodBase, DATABASE_URL: url })).toThrow(
      /database host .* is NOT RF-resident \(ADR-0017 п\.1/,
    );
  });

  it.each([
    'rediss://d:p@eu2-x.upstash.io:6379', // the measured red-before value
    'redis://default:p@redis-12345.c1.gce.cloud.redislabs.com:12345',
    'redis://cache.example.com:6379',
  ])('THROWS at boot in production on a foreign REDIS_URL %p', (url) => {
    expect(() => validateEnv({ ...prodBase, REDIS_URL: url })).toThrow(
      /Redis host .* is NOT RF-resident \(ADR-0017 п\.1/,
    );
  });

  it('states WHY the database matters (primary PII store) and WHY Redis does (derived PII)', () => {
    expect(() =>
      validateEnv({ ...prodBase, DATABASE_URL: 'postgresql://u:p@ep.neon.tech/db' }),
    ).toThrow(/PRIMARY store of personal data/);
    expect(() =>
      validateEnv({ ...prodBase, REDIS_URL: 'rediss://d:p@eu2-x.upstash.io:6379' }),
    ).toThrow(/not "just a cache"/);
  });

  it('names the HOST and never the DSN (a DSN carries the database password)', () => {
    let message = '';
    try {
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgresql://zoolink:sup3rs3cretpw@ep-x.aws.neon.tech/db',
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('ep-x.aws.neon.tech');
    expect(message).not.toContain('sup3rs3cretpw');
  });

  it('rejects a bare public IP (residency is unverifiable for it)', () => {
    expect(() =>
      validateEnv({ ...prodBase, DATABASE_URL: 'postgresql://u:p@203.0.113.7:5432/db' }),
    ).toThrow(/database host "203\.0\.113\.7" is NOT RF-resident/);
  });

  // --- axis 2: the traps a naive implementation falls into. Each one is a MEASURED property of
  // `new URL()` on Node 20, not a hypothetical.
  it('is not fooled by a host-shaped CREDENTIAL in front of a foreign host', () => {
    // The userinfo sits BEFORE the host, so `includes('.ru')` on the whole DSN would pass this.
    expect(() =>
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgresql://zoolink.ru@ep-abroad.example.com/db',
      }),
    ).toThrow(/database host "ep-abroad\.example\.com" is NOT RF-resident/);
  });

  it('checks EVERY host of a libpq multi-host DSN, not the comma-joined string', () => {
    // `new URL('postgres://u:p@localhost,eu2-x.upstash.io/db').hostname` is the ONE string
    // "localhost,eu2-x.upstash.io" — dotless-adjacent and therefore waved through by any
    // single-label rule, while the client happily fails over to the foreign host.
    expect(() =>
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgres://u:p@localhost,eu2-x.upstash.io/db',
      }),
    ).toThrow(/database host "eu2-x\.upstash\.io" is NOT RF-resident/);
    expect(() =>
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgres://u:p@postgres,ep-x.aws.neon.tech/db',
      }),
    ).toThrow(/database host "ep-x\.aws\.neon\.tech" is NOT RF-resident/);
  });

  it('checks the ?host= parameter too, where a host parser never looks', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgresql://u:p@localhost/db?host=ep-x.aws.neon.tech',
      }),
    ).toThrow(/database host "ep-x\.aws\.neon\.tech" is NOT RF-resident/);
  });

  // --- axis 3: fail-closed on anything unreadable. Both variables are boot-required, so there is no
  // lawful "empty/disabled" mode to preserve — unlike SENTRY_DSN and MEDIA_CDN_HOST.
  it.each([
    'postgres://', // no authority at all
    'postgres-evil://u:p@postgres:5432/db', // startsWith('postgres') accepted this — measured
    'postgresql://u:p@%ZZbroken/db', // malformed percent-escape
  ])('THROWS at boot on an unreadable DATABASE_URL %p (fail-closed)', (url) => {
    expect(() => validateEnv({ ...prodBase, DATABASE_URL: url })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('pins the SCHEME rather than trusting the startsWith() prefix test', () => {
    // `z.string().url().startsWith('postgres')` is a PREFIX test on the whole string: it admits
    // `postgres-evil://…`, i.e. a value whose host slot would be read under the wrong grammar.
    expect(RF_DATABASE_URL_SCHEMES).toEqual(['postgresql', 'postgres']);
    expect(RF_REDIS_URL_SCHEMES).toEqual(['redis', 'rediss']);
    // ПРИЧИНА НАЗЫВАЕТСЯ ТОЧНО (находка №136): не «хост нечитаем», а «схема не наша» — и вердикт
    // несёт саму схему, чтобы текст отказа мог её напечатать.
    expect(checkDatabaseUrl('postgres-evil://u:p@postgres:5432/db')).toMatchObject({
      ok: false,
      reason: 'bad-scheme',
      scheme: 'postgres-evil',
    });
    expect(checkRedisUrl('rediss-evil://x@redis:6379')).toMatchObject({
      ok: false,
      reason: 'bad-scheme',
      scheme: 'rediss-evil',
    });
    // …and the legitimate schemes are all still accepted.
    expect(checkDatabaseUrl('postgresql://u:p@postgres:5432/db').ok).toBe(true);
    expect(checkDatabaseUrl('postgres://u:p@postgres:5432/db').ok).toBe(true);
    expect(checkRedisUrl('redis://redis:6379').ok).toBe(true);
    expect(checkRedisUrl('rediss://:p@cache.zoolink.ru:6380').ok).toBe(true);
  });

  it('measures the shape that never reaches the refine: multi-host WITH ports is rejected by .url()', () => {
    // `new URL('postgres://u:p@h1:5432,h2:5432/db')` throws ERR_INVALID_URL, so `z.string().url()`
    // blocks the boot one step earlier. Documented as a KNOWN LIMIT of the form, not as coverage.
    expect(() => new URL('postgres://u:p@h1:5432,h2:5432/db')).toThrow();
    expect(() =>
      validateEnv({ ...prodBase, DATABASE_URL: 'postgres://u:p@h1:5432,h2:5432/db' }),
    ).toThrow(/Invalid environment configuration/);
  });

  // --- axis 4: NO-CAPABILITY-REGRESSION. Every value that exists in a LIVE config file today, plus
  // every self-hosted shape the runbooks allow, must still boot. Sources are named per line.
  it.each([
    // .env.example:22 / deploy/gen-env.sh:345 — the documented prod topology (compose service name)
    'postgresql://zoolink:__change_me__@postgres:5432/zoolink?schema=public',
    // .github/workflows/ci.yml:23
    'postgresql://zoolink:ci@localhost:5432/zoolink_test?schema=public',
    // .github/workflows/performance-tests.yml:61 — note the shorter `postgres://` scheme
    'postgres://postgres:postgres@localhost:5432/zoolink_perf_test?schema=public',
    // backend/.env (local dev stand)
    'postgresql://zoolink:zoolink@localhost:5432/zoolink?schema=public',
    'postgresql://u:p@10.0.0.5:5432/db', // RFC1918 self-hosted PG
    'postgresql://u:p@172.20.0.9:5432/db',
    'postgresql://u:p@192.168.1.10:5432/db',
    'postgresql://u:p@[fd00::5]:5432/db', // IPv6 ULA
    'postgresql://u:p@[::1]:5432/db',
    'postgresql:///zoolink?host=/var/run/postgresql', // unix socket, libpq query form
    'postgresql://%2Fvar%2Frun%2Fpostgresql/zoolink', // unix socket, percent-encoded authority form
    'postgresql://%2Fvar%2Frun%2Fpg.sock/zoolink', // …and one whose path contains a dot
    'postgresql://u:p@pg.zoolink.ru:5432/db', // RF domain
    'postgresql://u:p@PG.ZooLink.RU:5432/db', // case-insensitive
    'postgres://u:p@pg-a.zoolink.ru,pg-b.zoolink.ru/db', // multi-host, both resident
  ])('boots in production with the live/self-hosted DATABASE_URL %p', (url) => {
    expect(() => validateEnv({ ...prodBase, DATABASE_URL: url })).not.toThrow();
  });

  it.each([
    'redis://:__change_me__@redis:6379', // .env.example:26 / deploy/gen-env.sh:347
    'redis://localhost:6379', // ci.yml:24, performance-tests.yml:67
    'redis://172.20.0.9:6379',
    'redis://[::1]:6379',
    'redis://[fd00::5]:6379',
    'rediss://:p@cache.zoolink.ru:6380', // TLS to an RF host
    'redis://cache.zoolink.su:6379',
  ])('boots in production with the live/self-hosted REDIS_URL %p', (url) => {
    expect(() => validateEnv({ ...prodBase, REDIS_URL: url })).not.toThrow();
  });

  it('boots the ENTIRE live .env.example residency surface at once, with no .env edits', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgresql://zoolink:__change_me__@postgres:5432/zoolink?schema=public',
        REDIS_URL: 'redis://:__change_me__@redis:6379',
        S3_ENDPOINT: 'http://minio:9000',
        MEDIA_CDN_HOST: '',
        S3_REGION: 'ru-central1',
        SENTRY_DSN: '',
      }),
    ).not.toThrow();
  });

  // --- axis 5: the dev escape hatch, and its absence in production. Identical discipline to every
  // other clause: it relaxes only `non-rf-host`, only outside production, and never `unparseable`.
  it('permits a foreign DATABASE_URL in dev ONLY with the explicit bypass', () => {
    const foreign = 'postgresql://u:p@ep-x.aws.neon.tech/db';
    expect(() =>
      validateEnv({ ...prodBase, NODE_ENV: 'development', DATABASE_URL: foreign }),
    ).toThrow(/database host .* is NOT RF-resident/);
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        DATABASE_URL: foreign,
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).not.toThrow();
  });

  it('permits a foreign REDIS_URL in dev ONLY with the explicit bypass', () => {
    const foreign = 'rediss://d:p@eu2-x.upstash.io:6379';
    expect(() =>
      validateEnv({ ...prodBase, NODE_ENV: 'development', REDIS_URL: foreign }),
    ).toThrow(/Redis host .* is NOT RF-resident/);
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        REDIS_URL: foreign,
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).not.toThrow();
  });

  it('IGNORES the dev bypass in production for both DSNs (residency is unconditional there)', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        DATABASE_URL: 'postgresql://u:p@ep-x.aws.neon.tech/db',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/database host .* is NOT RF-resident/);
    expect(() =>
      validateEnv({
        ...prodBase,
        REDIS_URL: 'rediss://d:p@eu2-x.upstash.io:6379',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/Redis host .* is NOT RF-resident/);
  });

  it('never lets the dev bypass rescue an UNREADABLE DSN', () => {
    expect(() =>
      validateEnv({
        ...prodBase,
        NODE_ENV: 'development',
        DATABASE_URL: 'postgres://',
        RESIDENCY_ALLOW_NON_RF_DEV: 'true',
      }),
    ).toThrow(/Invalid environment configuration/);
  });
});

/** DSN host rules in isolation — the unit the boot refine and the CI gate axis (5) both mirror. */
describe('checkDatabaseUrl / checkRedisUrl / isResidentDataStoreHost', () => {
  it('shares ONE host core with clauses 4 and 6 (no second rule to drift)', () => {
    for (const suffix of RF_ALLOWED_HOST_SUFFIXES) {
      expect(isResidentDataStoreHost(`pg${suffix}`)).toBe(true);
    }
    expect(isResidentDataStoreHost('postgres')).toBe(true); // single-label service name
    expect(isResidentDataStoreHost('ep-x.aws.neon.tech')).toBe(false);
  });

  it('keeps the data-store rule NARROWER than the storage rule (a bucket is not a database)', () => {
    // The object-storage carve-out must not leak into clause 1: `storage.yandexcloud.net` is an S3
    // endpoint, and admitting it as a database host would widen clause 1 by accident.
    expect(isResidentStorageHost('storage.yandexcloud.net')).toBe(true);
    expect(isResidentDataStoreHost('storage.yandexcloud.net')).toBe(false);
  });

  it('reports every target it checked, so the verdict is auditable', () => {
    expect(checkDatabaseUrl('postgres://u:p@pg-a.zoolink.ru,pg-b.zoolink.ru/db')).toEqual({
      ok: true,
      targets: ['pg-a.zoolink.ru', 'pg-b.zoolink.ru'],
      offending: null,
      reason: 'resident',
      scheme: null,
    });
    expect(checkDatabaseUrl('postgresql:///db?host=/var/run/postgresql')).toEqual({
      ok: true,
      targets: ['unix:/var/run/postgresql'],
      offending: null,
      reason: 'resident',
      scheme: null,
    });
  });

  it('has NO lawful empty mode (both DSNs are boot-required)', () => {
    // …и беда названа СВОИМ именем: `empty`, а не сваленное в кучу «нечитаемо» (находка №136).
    expect(checkDatabaseUrl('')).toEqual({
      ok: false,
      targets: [],
      offending: null,
      reason: 'empty',
      scheme: null,
    });
    expect(checkRedisUrl('   ')).toEqual({
      ok: false,
      targets: [],
      offending: null,
      reason: 'empty',
      scheme: null,
    });
  });
});

/**
 * ОТКАЗ СТАРТА ОБЯЗАН НАЗЫВАТЬ СВОЮ ПРИЧИНУ, А НЕ ЧУЖУЮ (находка №136, круг 5).
 *
 * ЗАМЕР ДО ЛЕЧЕНИЯ (jiti, прямой вызов `checkDatabaseUrl` + `databaseUrlRejectionMessage`):
 *   mysql://zoolink:pw@postgres:5432/zoolink → reason=unparseable
 *     → «DATABASE_URL names no readable database host …»
 *   postgres:5432/zoolink                    → тот же вердикт, тот же текст
 *   postgresql://                            → тот же вердикт, тот же текст
 *   ''                                       → тот же вердикт, тот же текст
 *   postgresql://u:p@%ZZbroken/db            → тот же вердикт, тот же текст
 * Пять разных бед — один диагноз, и он ЛОЖЕН в четырёх случаях из пяти: хост `postgres` стоит в
 * строке и ВЕРЕН. Читающий первое предложение идёт пинговать исправный хост, проверять compose и
 * сеть докера — всё исправно, и отказ выглядит поломкой валидатора, а не собственной опечаткой.
 *
 * ЧЕМ ОПРОВЕРГАЛОСЬ (дословно из находки): «Прогон с `mysql://…@postgres:5432/db`, где отказ
 * называет СХЕМУ, а не нечитаемость хоста». Ось ниже — этот прогон, поставленный на обе переменные.
 *
 * ФОРМА ОСИ ДВУХПОЛЮСНАЯ, и второй полюс важнее первого: мало проверить, что верное слово
 * ПОЯВИЛОСЬ — надо проверить, что ложное слово ИСЧЕЗЛО. Поэтому каждая проба утверждает и то, что
 * текст называет свою беду, и то, что он БОЛЬШЕ НЕ обвиняет хост.
 */
describe('отказ DATABASE_URL/REDIS_URL называет ИСТИННУЮ причину (находка №136)', () => {
  const ЛОЖНЫЙ_ДИАГНОЗ = /names no readable (database|Redis) host/;

  const пробы: ReadonlyArray<{
    значение: string;
    причина: string;
    ждём: RegExp;
  }> = [
    {
      значение: 'mysql://zoolink:pw@postgres:5432/zoolink',
      причина: 'bad-scheme',
      ждём: /unsupported scheme "mysql:\/\/"/,
    },
    {
      значение: 'postgres-evil://u:p@postgres:5432/db',
      причина: 'bad-scheme',
      ждём: /unsupported scheme "postgres-evil:\/\/"/,
    },
    {
      значение: 'postgres:5432/zoolink',
      причина: 'no-scheme',
      ждём: /has no postgresql:\/\/ or postgres:\/\/ scheme/,
    },
    {
      значение: 'postgresql://',
      причина: 'no-host',
      ждём: /names no host at all/,
    },
    { значение: '', причина: 'empty', ждём: /is empty/ },
    {
      значение: 'postgresql://u:p@%ZZbroken/db',
      причина: 'unreadable-host',
      ждём: /names a host that cannot be read/,
    },
  ];

  it.each(пробы)(
    'DATABASE_URL=«$значение» → $причина, и текст называет ЕЁ',
    ({ значение, причина, ждём }) => {
      const вердикт = checkDatabaseUrl(значение);
      expect(вердикт.reason).toBe(причина);
      const текст = databaseUrlRejectionMessage(вердикт);
      expect(текст).toMatch(ждём);
      // ВТОРОЙ ПОЛЮС: прежний ложный диагноз про нечитаемый хост здесь больше не звучит.
      expect(текст).not.toMatch(ЛОЖНЫЙ_ДИАГНОЗ);
    },
  );

  it('REDIS_URL ломается тем же классом и лечится тем же разбором (:708 находки)', () => {
    const схема = checkRedisUrl('mysql://x@redis:6379');
    expect(схема.reason).toBe('bad-scheme');
    expect(redisUrlRejectionMessage(схема)).toMatch(
      /REDIS_URL uses the unsupported scheme "mysql:\/\/"/,
    );
    expect(redisUrlRejectionMessage(схема)).not.toMatch(ЛОЖНЫЙ_ДИАГНОЗ);

    const безСхемы = checkRedisUrl('redis:6379');
    expect(безСхемы.reason).toBe('no-scheme');
    expect(redisUrlRejectionMessage(безСхемы)).toMatch(
      /has no redis:\/\/ or rediss:\/\/ scheme/,
    );
  });

  it('«нечитаемый хост» ОСТАЛСЯ — но только там, где он правда (единственный честный случай)', () => {
    const вердикт = checkDatabaseUrl('postgresql://u:p@%ZZbroken/db');
    expect(вердикт.reason).toBe('unreadable-host');
    expect(databaseUrlRejectionMessage(вердикт)).toMatch(/cannot be read/);
  });

  it('ТЕКСТ НЕ НЕСЁТ СЕКРЕТА: DSN — это учётные данные, в отказ попадает ИМЯ переменной', () => {
    const вердикт = checkDatabaseUrl('mysql://zoolink:s3cr3t-pw@postgres:5432/zoolink');
    const текст = databaseUrlRejectionMessage(вердикт);
    expect(текст).toContain('DATABASE_URL');
    expect(текст).not.toContain('s3cr3t-pw');
    expect(текст).not.toContain('zoolink:s3cr3t-pw');
    // Имя схемы — единственное, что берётся из значения, и по построению регулярного выражения
    // `^([A-Za-z][A-Za-z0-9+.-]*)://` секретом быть не может.
    expect(вердикт.scheme).toBe('mysql');
  });

  it('НЕ РАСШИРИЛ БАЙПАС: dev-послабление по-прежнему смягчает ТОЛЬКО non-rf-host', () => {
    // Пять новых причин — это пять новых значений, каждое из которых обязано остаться fail-closed
    // в ЛЮБОЙ среде. Ось стережёт ровно это: флаг выставлен, среда не боевая — и всё равно отказ.
    const dev = {
      ...base,
      NODE_ENV: 'development',
      RESIDENCY_ALLOW_NON_RF_DEV: 'true',
    };
    for (const плохой of [
      'mysql://u:p@postgres:5432/db',
      'postgres:5432/db',
      'postgresql://',
      'postgresql://u:p@%ZZbroken/db',
    ]) {
      expect(() => validateEnv({ ...dev, DATABASE_URL: плохой })).toThrow(
        /Invalid environment configuration/,
      );
    }
    // …а то, что байпас действительно смягчает, он смягчает по-прежнему (способность не отнята).
    expect(() =>
      validateEnv({ ...dev, DATABASE_URL: 'postgresql://u:p@ep-x.aws.neon.tech/db' }),
    ).not.toThrow();
  });
});

/**
 * ЛЕСТНИЦА ОТКАЗОВ СТАРТА СВЕДЕНА В ОДИН ОТЧЁТ, А НЕПОЛНЫЙ ОТЧЁТ НАЗЫВАЕТ СЕБЯ НЕПОЛНЫМ
 * (находка №138, круг 5).
 *
 * ЗАМЕР ДО ЛЕЧЕНИЯ (jiti, боевой конфиг, три прод-требования не выставлены) — три ПЕРЕЗАПУСКА:
 *   A → «Invalid environment configuration:\n  - AGENT_SERVICE_SIGNING_SECRET: …»
 *   B → «…:\n  - METRICS_TOKEN: …»
 *   C → «…:\n  - OAUTH_APPLE_TEAM_ID / KEY_ID / PRIVATE_KEY: …»
 * При этом ветка zod те же три беды печатала РАЗОМ, а заголовок у всех четырёх отчётов был
 * ПОБУКВЕННО один — значит «полный список» и «первый из очереди» выглядели одинаково.
 *
 * ЧЕМ ОПРОВЕРГАЛОСЬ (дословно из находки): «прогон, где при пустых AGENT_SERVICE_SIGNING_SECRET и
 * METRICS_TOKEN одновременно печатаются ОБЕ строки (либо где заголовок второй половины честно
 * говорит, что список не полон)». Ось ниже закрывает ОБА условия сразу.
 */
describe('отказ старта: один отчёт вместо лестницы перезапусков (находка №138)', () => {
  const прод = {
    ...base,
    NODE_ENV: 'production',
    OAUTH_APPLE_CLIENT_ID: 'ru.zoolink.app',
  };

  const текстОтказа = (env: Record<string, unknown>): string => {
    try {
      validateEnv(env);
      throw new Error('ОСЬ СЛОМАНА: конфиг обязан был отвергнуться, а старт прошёл');
    } catch (e) {
      return (e as Error).message;
    }
  };

  it('ВСЕ прод-требования называются РАЗОМ — один старт вместо трёх', () => {
    const текст = текстОтказа(прод);
    // Ровно тот прогон, которым находка опровергалась: обе строки в ОДНОМ отчёте…
    expect(текст).toContain('AGENT_SERVICE_SIGNING_SECRET');
    expect(текст).toContain('METRICS_TOKEN');
    // …и третья беда, которая раньше ждала второго перезапуска, тоже здесь.
    expect(текст).toContain('OAUTH_APPLE_TEAM_ID');
    expect(текст).toContain('OAUTH_APPLE_KEY_ID');
    expect(текст).toContain('OAUTH_APPLE_PRIVATE_KEY');
  });

  it('лечение НЕ ОТНЯЛО отказа: каждая беда по отдельности по-прежнему роняет старт', () => {
    // Закон храповика: сведение в один отчёт не смеет превратиться в «пропустили две из трёх».
    const безАгента = текстОтказа({
      ...прод,
      METRICS_TOKEN: 'm'.repeat(16),
      OAUTH_APPLE_CLIENT_ID: '',
    });
    expect(безАгента).toContain('AGENT_SERVICE_SIGNING_SECRET');

    const безМетрик = текстОтказа({
      ...прод,
      AGENT_SERVICE_SIGNING_SECRET: 'f'.repeat(32),
      OAUTH_APPLE_CLIENT_ID: '',
    });
    expect(безМетрик).toContain('METRICS_TOKEN');

    const половинаApple = текстОтказа({
      ...прод,
      AGENT_SERVICE_SIGNING_SECRET: 'f'.repeat(32),
      METRICS_TOKEN: 'm'.repeat(16),
    });
    expect(половинаApple).toContain('OAUTH_APPLE_TEAM_ID');
  });

  it('ПОЛНЫЙ конфиг проходит — способность стартовать не отнята', () => {
    expect(() =>
      validateEnv({
        ...прод,
        AGENT_SERVICE_SIGNING_SECRET: 'f'.repeat(32),
        METRICS_TOKEN: 'm'.repeat(16),
        OAUTH_APPLE_TEAM_ID: 'TEAMID1234',
        OAUTH_APPLE_KEY_ID: 'KEYID12345',
        OAUTH_APPLE_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----x-----END PRIVATE KEY-----',
      }),
    ).not.toThrow();
  });

  it('ДВЕ ШАПКИ РАЗЛИЧИМЫ: неполный отчёт объявляет себя неполным, полный — полным', () => {
    // Половина zod физически не может слиться со второй (вторая читает parsed.data, которого при
    // провале zod нет). Раз слить нельзя — форма обязана СКАЗАТЬ, а не молчать.
    const zodОтчёт = текстОтказа({ ...прод, S3_REGION: 'us-east-1' });
    expect(zodОтчёт).toMatch(/stage 1 of 2/);
    expect(zodОтчёт).toMatch(/have NOT run yet/);
    expect(zodОтчёт).not.toMatch(/complete list/);

    const продОтчёт = текстОтказа(прод);
    expect(продОтчёт).toMatch(/stage 2 of 2/);
    expect(продОтчёт).toMatch(/complete list/);
    expect(продОтчёт).not.toMatch(/stage 1 of 2/);

    // ГРАНИЦА: обе шапки сохраняют прежний префикс — по нему ищут CI (ci.yml:527,532) и оси файла.
    expect(zodОтчёт.startsWith('Invalid environment configuration')).toBe(true);
    expect(продОтчёт.startsWith('Invalid environment configuration')).toBe(true);
  });
});


/**
 * ДВЕРЬ ИСХОДЯЩЕГО ПЕРИМЕТРА: IPv6 link-local и ULA закрыты ЦЕЛИКОМ (находка №6 ре-гейта 15.08).
 *
 * Предписание находки требовало закрыть link-local «169.254.0.0/16 И fe80::/10», а выполнено было
 * только для IPv4 — и исход стоял «починена», пока reviewer-qa не замерил обратное на поставляемом
 * коде. Отсюда две оси СРАЗУ, а не одна: дверь обязана ОТКАЗЫВАТЬ, и резидентность обязана
 * ПРОДОЛЖАТЬ ПРИНИМАТЬ те же адреса — иначе лечение отняло бы работающую способность (БД/кэш по
 * ULA-адресу, `no-capability-regression`). Класс, ради которого ось стоит ПАРОЙ полюсов:
 * «лечение взводит мину» и «ось-встречающая».
 */
describe('isAllowedProviderHost — IPv6 link-local / ULA (ре-гейт 15.08, находка №6)', () => {
  const IMDS_AND_FRIENDS = [
    'fe80::1', // link-local, форма из замера лейна
    '[fe80::1]', // та же в скобочной форме — дверь получает host из URL
    'fe80::a00:27ff:fe4e:66a1',
    'fd00:ec2::254', // IPv6-IMDS у AWS — ЖИВЁТ В ULA, а не в link-local
    'fc00::1',
    'fd12:3456:789a::1',
  ];

  it.each(IMDS_AND_FRIENDS)('дверь ОТКАЗЫВАЕТ %s', (host) => {
    expect(isAllowedProviderHost(host)).toBe(false);
  });

  it('дверь по-прежнему пускает ::1 — loopback остаётся своим', () => {
    expect(isAllowedProviderHost('::1')).toBe(true);
    expect(isAllowedProviderHost('0:0:0:0:0:0:0:1')).toBe(true);
  });

  it('РЕЗИДЕНТНОСТЬ (не дверь) те же ULA/link-local ПРИНИМАЕТ — способность не отнята', () => {
    // Без outbound-строгости `fd00::5` — законная «своя машина в своей сети»: по такому адресу
    // у нас принимаются DATABASE_URL и REDIS_URL (env.validation.spec:852,869). Если эта ось
    // покраснеет, значит починка двери отняла работающую способность.
    expect(isResidentHost('fd00::5')).toBe(true);
    expect(isResidentHost('fe80::1')).toBe(true);
  });

  it('дверь не путает ULA-литерал с ДОМЕННЫМ именем, начинающимся так же', () => {
    // `fdcompany.com` — не литерал; правило префикса не должно ловить имена.
    expect(isAllowedProviderHost('fdcompany.com')).toBe(false);
    expect(isAllowedProviderHost('fe80.example.com')).toBe(false);
  });
});

/**
 * ОДНОСЕГМЕНТНЫЕ ИМЯ У ДВЕРИ: СТРОГО ВСЕГДА, ПОСЛАБЛЕНИЕ — ТОЛЬКО ЯВНЫМ ФЛАГОМ (находка №9).
 *
 * Ось ТРЁХПОЛЮСНАЯ по прямому требованию держателя: (1) без флага — отказ; (2) с флагом — проход
 * (способность стендов не отнята, закон храповика); (3) значение, ВЫГЛЯДЯЩЕЕ как выключение
 * (`0`, `false`, пустое, опечатка), — тоже отказ. Третий полюс поставлен потому, что находка №60
 * показала обратный случай: пустое значение вырождало сопоставление в «совпадает со всем».
 * Отдельно проверяется, что РЕЗИДЕНТНОСТЬ односегментные имена принимает всегда — иначе лечение
 * убило бы `postgres`/`redis`/`minio` в DATABASE_URL и REDIS_URL.
 */
describe('isAllowedProviderHost — односегментное имя и флаг стендов (находка №9)', () => {
  const saved = process.env.ALLOW_LOCAL_STAND_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    else process.env.ALLOW_LOCAL_STAND_HOSTS = saved;
  });

  it('ЧИСЛОВОЕ имя хоста — не «своё»: 134744072 есть 8.8.8.8 в десятичной форме (находка №51)', () => {
    // Проверяем ОБА режима: и резидентность (DATABASE_URL/REDIS_URL), и исходящую дверь.
    expect(isResidentHost('134744072', [], { allowRfSuffixes: false })).toBe(false);
    expect(isAllowedProviderHost('134744072')).toBe(false);
    // ...и не сломали односегментные имена стендов, ради которых правило вообще есть
    expect(isResidentHost('postgres', [], { allowRfSuffixes: false })).toBe(true);
  });

  it('без флага — ОТКАЗ (fail-closed по умолчанию)', () => {
    delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    expect(isAllowedProviderHost('mock-sms')).toBe(false);
    expect(isAllowedProviderHost('evilhost')).toBe(false);
  });

  it.each(['1', 'true', 'TRUE', 'yes', ' 1 '])('с явным флагом «%s» — проход', (v) => {
    process.env.ALLOW_LOCAL_STAND_HOSTS = v;
    expect(isAllowedProviderHost('mock-sms')).toBe(true);
  });

  it.each(['TRUE', 'True', ' Yes '])(
    'СХЕМА принимает «%s» так же, как дверь — два читателя одной переменной не расходятся',
    (v) => {
      // До круга 4 схема брала только строчные, а дверь приводила к нижнему регистру: `TRUE` роняло
      // СТАРТ, хотя дверь его понимала. Расхождение fail-closed, но всё равно расхождение.
      expect(() => validateEnv({ ...base, ALLOW_LOCAL_STAND_HOSTS: v })).not.toThrow();
    },
  );

  it.each(['0', 'false', '', 'да', 'Production'])(
    'значение «%s» выглядит как выключение либо мусор — СТРОГО',
    (v) => {
      process.env.ALLOW_LOCAL_STAND_HOSTS = v;
      expect(isAllowedProviderHost('mock-sms')).toBe(false);
    },
  );

  it('РЕЗИДЕНТНОСТЬ односегментные принимает всегда — postgres/redis/minio не отняты', () => {
    delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    expect(isResidentHost('postgres')).toBe(true);
    expect(isResidentHost('redis')).toBe(true);
    expect(isResidentHost('minio')).toBe(true);
  });
});

/**
 * СОГЛАСИЕ ЧИТАТЕЛЕЙ ТУМБЛЕРА ПО МНОЖЕСТВУ ЗНАЧЕНИЙ (находка №165, круг 5).
 *
 * ЧТО БЫЛО ЗАМЕРЕНО ДО ЛЕЧЕНИЯ: в дверь дописан `|| raw === 'on'` (применение доказано грепом
 * строки 170) — `npx jest src/config/env.validation.spec.ts` дал 220 passed, 220 total, 0 КРАСНЫХ,
 * при том что дверь начинала пускать односегментные имена стендов по значению, которого схема не
 * знает. Соседние оси мимо: `it.each(['TRUE','True',' Yes '])` спрашивала ТОЛЬКО схему («не
 * бросила»), а `it.each(['1','true','TRUE','yes',' 1 '])` — ТОЛЬКО дверь. Ни одна не сверяла ДВА
 * ОТВЕТА НА ОДНО ЗНАЧЕНИЕ: классика «ось меряет ПРИЗНАК, а не СПОСОБНОСТЬ».
 *
 * ЧТО СТЕРЕЖЁТ ЭТА ОСЬ (двухсторонне, на ОДНОМ и том же значении):
 *  (1) дверь не смеет ОТКРЫТЬСЯ на значении, которое схема отвергает — ровно форма мутанта `'on'`;
 *  (2) схема не смеет ПРИНЯТЬ значение, о котором дверь не имеет мнения (словарь = ВКЛ ∪ ВЫКЛ);
 *  (3) словарь объявлен один раз: ВКЛ и ВЫКЛ не пересекаются и в сумме дают полный перечень.
 *
 * Третий читатель — `standHostsWarning` в `lib/providers/providers.module.ts` — переведён на
 * `standHostsToggleOn` 25.08 (после обрыва сессии-автора этой оси; «другой агент», правивший его
 * файл, умер вместе с ней, не записав ни строки). Его собственная ось живёт в
 * `providers.module.spec.ts` и судит предупреждение ПО СЛОВАРЮ, а не рукописной копией. Копий
 * разбора не осталось: схема · дверь · предупреждение зовут ОДИН `standHostsToggleOn`.
 */
describe('тумблер стендов: ОДИН разбор на всех читателей (находка №165)', () => {
  const saved = process.env.ALLOW_LOCAL_STAND_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    else process.env.ALLOW_LOCAL_STAND_HOSTS = saved;
  });

  it('словарь объявлен ОДИН раз: ВКЛ ∪ ВЫКЛ = полный перечень, пересечение пусто', () => {
    expect([...STAND_HOSTS_TOGGLE_VALUES]).toEqual([
      ...STAND_HOSTS_TOGGLE_ON,
      ...STAND_HOSTS_TOGGLE_OFF,
    ]);
    const on = new Set<string>(STAND_HOSTS_TOGGLE_ON);
    expect(STAND_HOSTS_TOGGLE_OFF.filter((v) => on.has(v))).toEqual([]);
    // Перечни заморожены — дозапись обязана бросать, иначе «один источник» дописывается в рантайме.
    expect(() =>
      (STAND_HOSTS_TOGGLE_ON as unknown as string[]).push('on'),
    ).toThrow();
  });

  // Пробы: весь словарь + значения ВНЕ него (в т.ч. `'on'` — ровно мутант круга 5) + регистр и
  // пробелы, которые обе стороны обязаны съедать ОДНОЙ нормализацией.
  const ПРОБЫ = [
    '1',
    'true',
    'yes',
    '0',
    'false',
    'no',
    'TRUE',
    'True',
    ' Yes ',
    ' 1 ',
    'NO',
    'on',
    'off',
    'enabled',
    '',
    'да',
    'Production',
    '2',
  ];

  it.each(ПРОБЫ)(
    'значение «%s»: дверь и схема решают СОГЛАСОВАННО (мутант «on» краснит именно здесь)',
    (v) => {
      process.env.ALLOW_LOCAL_STAND_HOSTS = v;
      const дверьОткрыта = isAllowedProviderHost('mock-sms');
      expect(standHostsAllowed()).toBe(дверьОткрыта);

      const схемаПриняла = (() => {
        try {
          validateEnv({ ...base, ALLOW_LOCAL_STAND_HOSTS: v });
          return true;
        } catch {
          return false;
        }
      })();

      // (1) ГЛАВНОЕ: открытая дверь на значении, которого схема не знает, — молчащее послабление.
      if (дверьОткрыта) expect(схемаПриняла).toBe(true);

      // (2) схема принимает РОВНО словарь (после той же нормализации), не шире и не уже;
      const норм = v.trim().toLowerCase();
      expect(схемаПриняла).toBe(
        (STAND_HOSTS_TOGGLE_VALUES as readonly string[]).includes(норм),
      );

      // (3) …а дверь открыта РОВНО на половине ВКЛ того же словаря.
      expect(дверьОткрыта).toBe(
        (STAND_HOSTS_TOGGLE_ON as readonly string[]).includes(норм),
      );
    },
  );

  it('разбор ЭКСПОРТИРОВАН и не читает process.env — его может позвать любой третий читатель', () => {
    delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    expect(standHostsToggleOn('1')).toBe(true);
    expect(standHostsToggleOn(' TRUE ')).toBe(true);
    expect(standHostsToggleOn('on')).toBe(false);
    expect(standHostsToggleOn(undefined)).toBe(false);
    expect(standHostsToggleOn(1)).toBe(false); // не-строка — СТРОГИЙ режим, не «истинно»
    // …и дверь — ровно этот разбор, приложенный к process.env (способность не изменилась).
    process.env.ALLOW_LOCAL_STAND_HOSTS = 'yes';
    expect(standHostsAllowed()).toBe(standHostsToggleOn('yes'));
  });
});

/**
 * `*.localhost` У ДВЕРИ ЗАКРЫТ (находка безопасника, круг 2 — блокер).
 *
 * Лечение находки №9 закрыло односегментные имена и оставило тот же класс ЭТАЖОМ ВЫШЕ: ветка
 * «имя петли» стояла выше всей outbound-логики, поэтому `evil.localhost` проходил дверь БЕЗ флага,
 * включая ОТКРЫТЫЙ http. Обещание RFC 6761 («*.localhost — это петля») держит не наш перечень, а
 * резолвер среды: в нашем же образе node:20-alpine имя разрешалось в подсунутый чужой адрес.
 * Ось двухполюсная: дверь ОТКАЗЫВАЕТ, резидентность ПРИНИМАЕТ (способность не отнята).
 */
describe('isAllowedProviderHost — *.localhost закрыт для двери (круг 2)', () => {
  const saved = process.env.ALLOW_LOCAL_STAND_HOSTS;
  afterEach(() => {
    if (saved === undefined) delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    else process.env.ALLOW_LOCAL_STAND_HOSTS = saved;
  });

  it.each(['evil.localhost', 'sub.evil.localhost', 'collector.localhost'])(
    'дверь ОТКАЗЫВАЕТ %s без флага стендов',
    (host) => {
      delete process.env.ALLOW_LOCAL_STAND_HOSTS;
      expect(isAllowedProviderHost(host)).toBe(false);
    },
  );

  it('ТОЧНЫЙ localhost остаётся своим — способность стендов не отнята', () => {
    delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    expect(isAllowedProviderHost('localhost')).toBe(true);
  });

  /**
   * ЯВНО ПРИНЯТЫЙ РИСК, А НЕ «ПРАВИЛО ДЕЙСТВУЕТ ТОЛЬКО У ДВЕРИ» (решение держателя 20.08.2026,
   * круг 4). Прежнее имя оси несло ОБОСНОВАНИЕ, которое сгорело: «RFC 6761 обещает петлю» опровергнут
   * замером в том же файле — в нашем образе имя разрешил РЕЗОЛВЕР СРЕДЫ и вернул публичный адрес.
   * Держатель: «решение, чьё основание опровергнуто, больше не связывает» — и поставил условие:
   * закрываем КЛАСС целиком либо не закрываем ничего и называем риск вслух, потому что полумера
   * меняет не защиту, а самоощущение.
   * ЗАМЕР ЦЕНЫ (20.08, по его прямой просьбе): у `*.localhost` цена нулевая — ни одного вхождения.
   * У РАВНОЗНАЧНОГО случая — односегментных имён — цена НЕ нулевая: `postgres`, `redis`, `minio`
   * несут ВСЮ объявленную топологию (.env.example:34/43/55, deploy/gen-env.sh:140/240/355/357,
   * живой .env стенда). То есть закрыть класс целиком сегодня нельзя, а закрыть половину — хуже,
   * чем ничего: цена та же, а в голове остаётся «класс закрыт».
   * ПОЭТОМУ: резидентность принимает и `*.localhost`, и односегментные имена; свойство у них ОДНО —
   * разрешение отдано резолверу среды. Риск принят ИМЕНЕМ ДЕРЖАТЕЛЯ (архитектор-4724c583).
   * Что его снимет: переход резидентных адресов на литералы/FQDN — тогда класс закрывается разом.
   */
  it('РИСК ПРИНЯТ ЯВНО: резидентность принимает *.localhost И односегментные имена — свойство у них одно', () => {
    expect(isResidentHost('evil.localhost')).toBe(true);
    expect(isResidentHost('postgres')).toBe(true); // равнозначный случай — тот же резолвер среды
    // ...и у ДВЕРИ закрыты оба (там цена снятия нулевая и она уплачена флагом стендов)
    delete process.env.ALLOW_LOCAL_STAND_HOSTS;
    expect(isAllowedProviderHost('evil.localhost')).toBe(false);
    expect(isAllowedProviderHost('postgres')).toBe(false);
  });
});

/**
 * ЗАМОРОЖЕНЫ ВСЕ ЧЕТЫРЕ ПЕРЕЧНЯ (находка безопасника круга 2: заморозили два из четырёх, и
 * незамороженным остался САМЫЙ ШИРОКИЙ — суффиксы, которые стерегут DATABASE_URL, REDIS_URL, S3,
 * CDN и Sentry разом). Ось на СВОЙСТВО, а не на строку: дозапись обязана бросать.
 */
describe('перечни резидентности заморожены (круг 2)', () => {
  it.each([
    // ПЕРЕЧЕНЬ ДВЕРИ ПЕРВЫМ: его пропуск в этой оси доказан мутацией круга 3 — снятие Object.freeze
    // с RF_ALLOWED_PROVIDER_HOSTS проходило 256/256 ЗЕЛЁНЫМ, при том что это ЕДИНСТВЕННЫЙ перечень,
    // которым живёт дверь, и именно для него в коде записан замер «дверь начинала пропускать
    // дописанный хост». Ось, забывшая свой главный предмет, — худший вид зелёного.
    ['RF_ALLOWED_PROVIDER_HOSTS', RF_ALLOWED_PROVIDER_HOSTS],
    ['RF_ALLOWED_REGIONS', RF_ALLOWED_REGIONS],
    ['RF_ALLOWED_HOST_SUFFIXES', RF_ALLOWED_HOST_SUFFIXES],
    ['RF_ALLOWED_STORAGE_HOSTS', RF_ALLOWED_STORAGE_HOSTS],
    ['RF_DATABASE_URL_SCHEMES', RF_DATABASE_URL_SCHEMES],
    ['RF_REDIS_URL_SCHEMES', RF_REDIS_URL_SCHEMES],
  ])('%s не расширяется в рантайме', (_name, list) => {
    expect(Object.isFrozen(list)).toBe(true);
    expect(() => (list as unknown as string[]).push('.evil')).toThrow();
  });
});

// ── ТОКЕН НЕ ДОЖИВАЕТ ДО ЗАГОЛОВКА С УПРАВЛЯЮЩИМ ЗНАКОМ (крит круга 5: утечка секрета в журнал) ──
// КРАСНОЕ-ДО замерено СВОЕЙ РУКОЙ до лечения: fetch с заголовком `Bearer <токен со ВСТРОЕННЫМ \r\n>`
// даёт `Headers.append: "Bearer mQ7bV2xLpR9k\r\n_BOEVOY_TOKEN_MAX_4f81ac" is an invalid header value.`
// — сообщение НЕСЁТ ВЕСЬ СЕКРЕТ и уходит в журнал сервера через текст ProviderError.
// Лечим ИСТОЧНИК: плохое значение отвергается на СТАРТЕ и до заголовка не доходит.
describe('MAX_BOT_TOKEN: управляющий знак отвергается на старте, значение в текст не попадает', () => {
  const базовый = { ...base };

  it.each([
    ['встроенный CRLF (секрет склеен из двух строк)', 'mQ7bV2xLpR9k\r\n_BOEVOY_TOKEN'],
    ['встроенный LF', 'abc\ndef'],
    ['табуляция', 'abc\tdef'],
    ['возврат каретки', 'abc\rdef'],
  ])('ОТКАЗЫВАЕТ на старте: %s', (_имя, токен) => {
    expect(() => validateEnv({ ...базовый, MAX_BOT_TOKEN: токен })).toThrow(
      /MAX_BOT_TOKEN содержит управляющий знак/,
    );
  });

  it('🔴 СЕКРЕТ НЕ ПОПАДАЕТ В ТЕКСТ ОТКАЗА — иначе лечение само стало бы утечкой', () => {
    const секрет = 'mQ7bV2xLpR9k\r\n_BOEVOY_TOKEN_MAX_4f81ac';
    let текст = '';
    try {
      validateEnv({ ...базовый, MAX_BOT_TOKEN: секрет });
    } catch (e) {
      текст = e instanceof Error ? e.message : String(e);
    }
    expect(текст).toMatch(/MAX_BOT_TOKEN/);
    expect(текст).not.toContain('_BOEVOY_TOKEN_MAX_4f81ac');
    expect(текст).not.toContain('mQ7bV2xLpR9k');
  });

  it('СПОСОБНОСТЬ НЕ ОТНЯТА (закон храповика): хвостовой перевод строки СНИМАЕТСЯ, а не отвергается', () => {
    // Замер до лечения: одиночный хвостовой \r/\n undici обрезает сам и НЕ течёт — то есть самый
    // частый операционный случай («секрет из файла с концевым переводом») был рабочим и остаётся им.
    const env = validateEnv({ ...базовый, MAX_BOT_TOKEN: '  boevoy-token-123\n' });
    expect(env.MAX_BOT_TOKEN).toBe('boevoy-token-123');
  });

  it('обычный токен проходит без изменений', () => {
    const env = validateEnv({ ...базовый, MAX_BOT_TOKEN: 'boevoy-token-123' });
    expect(env.MAX_BOT_TOKEN).toBe('boevoy-token-123');
  });
});

// ── ДВЕРЬ ПЕРЕЧНЕЙ (находка №119; решение держателя 24.08 — лечить перечень, а не читателя) ──
// Класс: пустой элемент перечня не «ни с чем не совпадает», а СОВПАДАЕТ СО ВСЕМ, потому что
// `'evil.example.com'.endsWith('')` === true. В bash он виден как звёздочка, в JS — не виден вовсе.
// Оси стоят НА ДВЕРИ, а не у каждого читателя: читателей перечня уже двое (:275 и :286), и
// следующего найдут не глазами.
describe('дверь перечней хостов: пустой элемент не доживает до сопоставителя', () => {
  it('выбрасывает пустые и пробельные элементы, остальное сохраняет по порядку', () => {
    expect(sanitizedHostList(['.ru', '', '  ', '\t', '.su'])).toEqual(['.ru', '.su']);
  });

  it('обрезает пробелы по краям — «.ru » и «.ru» это один суффикс', () => {
    expect(sanitizedHostList([' .ru '])).toEqual(['.ru']);
  });

  it('ПОЛОЖИТЕЛЬНЫЙ КОНТРОЛЬ: без двери пустой элемент совпадает с чем угодно, с дверью — нет', () => {
    // Красное-до, замеренное на живом коде 24.08 (мутант: '' первым элементом суффиксов):
    // evil.example.com и s3.us-west-004.backblazeb2.com объявлялись РЕЗИДЕНТНЫМИ.
    const сырой = ['', '.ru'];
    expect(сырой.some((s) => 'evil.example.com'.endsWith(s))).toBe(true);
    expect(
      sanitizedHostList(сырой).some((s) => 'evil.example.com'.endsWith(s)),
    ).toBe(false);
  });

  it('БОЕВЫЕ перечни пусты от пустых — утверждение об ИСТОЧНИКЕ, не о его копии', () => {
    // Тест читает сами константы, а не воспроизводит их у себя: общий эталон даёт зелёный свод,
    // пока обе стороны ошибаются одинаково (урок 14.08).
    for (const перечень of [
      RF_ALLOWED_HOST_SUFFIXES,
      RF_ALLOWED_STORAGE_HOSTS,
      RF_ALLOWED_PROVIDER_HOSTS,
    ]) {
      expect(перечень.filter((s) => s.trim() === '')).toEqual([]);
      // И вторая половина класса (находка №170): пробельная ОБВЯЗКА не пустой элемент, но запись
      // с ней МЕРТВА для сопоставителя (host === h / endsWith не режут пробелы). До этой строки
      // `' sms.ru '` в перечне двери ловился только СОВПАДЕНИЕМ — тем, что поведенческие оси
      // называют все хосты поимённо.
      expect(перечень.filter((s) => s !== s.trim())).toEqual([]);
    }
  });

  it('ГРАНИЦА, НАЗВАННАЯ ВСЛУХ: суффиксы читаются isResidentHost из модульной константы, поэтому '
    + 'поведенческой оси на них без подмены модуля нет — дверь закрывает их РОЖДЕНИЕМ', () => {
    expect(RF_ALLOWED_HOST_SUFFIXES).toContain('.ru');
    expect(isResidentHost('evil.example.com')).toBe(false);
    expect(isResidentHost('s3.us-west-004.backblazeb2.com')).toBe(false);
  });
});

/**
 * ШАБЛОН ОКРУЖЕНИЯ ОБЯЗАН СТАРТОВАТЬ ДОСЛОВНО (стражи находок №148, №157 и №172).
 *
 * ПОЧЕМУ ОСЬ, А НЕ ВЫЧИТКА ГЛАЗАМИ. `.env.example` объявлен в шапке env.validation.ts зеркалом
 * контракта («Canonical environment contract. Mirrors ../.env.example»), и человек, впервые
 * видящий систему, копирует его дословно. Замер 29.08 показал ДВЕ разные ловушки в одном файле,
 * и обе прошли бы вычитку: METRICS_TOKEN стоял пустым при NODE_ENV=production (обязателен, ≥16
 * знаков) — то есть шаблон НЕ СТАРТОВАЛ; а моя же первая правка добавила пустой
 * ALLOW_LOCAL_STAND_HOSTS и уронила старт ВТОРОЙ раз, потому что схема принимает только словарь,
 * и ПУСТОЕ значение отвергает, хотя ОТСУТСТВИЕ строки законно, а дверь пустое читает как
 * «выключено». Лечение, взводящее мину, — наш повторяющийся класс; ось ставится ПРОТИВ НЕГО.
 *
 * ЕДИНИЦА ЗАМЕРА — САМ ФАЙЛ, А НЕ ЕГО КОПИЯ В ТЕСТЕ: копия эталона зеленеет вместе с источником
 * (закон общего эталона), поэтому читаем настоящий `.env.example` с диска.
 */
describe('.env.example — контракт окружения стартует ДОСЛОВНО (№148/№157/№172)', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('node:fs') as typeof import('node:fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require('node:path') as typeof import('node:path');
  const файл = path.join(__dirname, '..', '..', '..', '.env.example');

  /** Разбор ровно как у оператора: KEY=VALUE, хвостовой комментарий после пробела отрезается. */
  function изШаблона(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const строка of fs.readFileSync(файл, 'utf8').split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(строка);
      if (!m) continue;
      let v = m[2];
      const хвост = v.indexOf(' #');
      if (хвост >= 0) v = v.slice(0, хвост);
      env[m[1]] = v.trim();
    }
    return env;
  }

  it('файл найден и не пуст — ось не смеет пройти, не посмотрев (три состояния, не два)', () => {
    expect(fs.existsSync(файл)).toBe(true);
    expect(Object.keys(изШаблона()).length).toBeGreaterThan(20);
  });

  it('СКОПИРОВАННЫЙ ДОСЛОВНО ШАБЛОН ПРИНИМАЕТСЯ validateEnv — иначе первый же старт это отказ', () => {
    expect(() => validateEnv(изШаблона())).not.toThrow();
  });

  it('переменная, которую называет отказ двери, ПРИСУТСТВУЕТ в контракте (№157)', () => {
    expect(изШаблона()).toHaveProperty('ALLOW_LOCAL_STAND_HOSTS');
  });

  it('и её значение в шаблоне — из СЛОВАРЯ, а не пустое (№172: пустое схема отвергает)', () => {
    const v = изШаблона().ALLOW_LOCAL_STAND_HOSTS;
    expect([...STAND_HOSTS_TOGGLE_VALUES] as string[]).toContain(v);
  });
});
