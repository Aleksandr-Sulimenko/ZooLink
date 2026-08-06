import { z } from 'zod';

/**
 * ADR-0017 (RF data residency; ФЗ-152 ст.18 ч.5) — the SINGLE canonical allowlist of approved
 * RF region identifiers. Every region-bearing env var (today `S3_REGION`; forward: any `*_REGION`
 * for managed-PG / replica / backup / DR-failover / PII-bearing log sink) must resolve to one of
 * these, or the process refuses to boot. This is layer 1 of the 3-layer residency guardrail
 * (layer 2 = the blocking CI residency gate, which derives its list from THIS constant so the two
 * never diverge; layer 3 = the documented region-pin in deployment_specification.md).
 *
 * Identifiers derive from the ADR-0008 provider (Yandex Cloud, `ru-central1*`). A region *string*
 * is a config-hygiene guard, NOT proof of physical location — it layers on top of provider choice,
 * it does not replace it. TODO(legal): confirm the exact approved zone set (уточнить с legal).
 */
export const RF_ALLOWED_REGIONS = [
  'ru-central1',
  'ru-central1-a',
  'ru-central1-b',
  'ru-central1-c',
  'ru-central1-d',
] as const;

export function isRfRegion(value: string): boolean {
  return (RF_ALLOWED_REGIONS as readonly string[]).includes(value);
}

/**
 * Canonical environment contract. Mirrors ../.env.example (ADR-0008 provider choices).
 * Fail-fast: the process must not boot with a missing/invalid required variable.
 */
export const envSchema = z.object({
  // Fail-SAFE default (OWASP fail-safe defaults): a boot that FORGETS to set NODE_ENV lands in the
  // most-restrictive mode ('production'), never the permissive one. This is the security-critical
  // fix for the dev-token fail-OPEN chain (AUDIT3 security.md #1): the old `.default('development')`
  // meant a prod deploy that omitted NODE_ENV booted with isProduction===false and left the
  // master-key /auth/dev-token route LIVE. dev/test set NODE_ENV explicitly (.env / jest), so only a
  // genuinely-unconfigured boot inherits the locked-down default.
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  // Dev-token master-key route (auth.controller devToken) is gated by this flag, INDEPENDENT of
  // NODE_ENV, and defaults to false (fail-closed). Strict parse: only the literal 'true'/'false'
  // are accepted — a typo ('1','TRUE','yes') is a boot-blocking error, never silently truthy (a
  // z.coerce.boolean() would treat 'false' as true — the exact footgun we avoid). The endpoint is
  // reachable ONLY when ENABLE_DEV_TOKEN===true AND NODE_ENV!=='production' (see AppConfigService).
  ENABLE_DEV_TOKEN: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_DOMAIN: z.string().min(1).default('localhost'),

  // CORS allowlist for cross-origin browsers — comma-separated EXACT origins (e.g.
  // "http://localhost:5173"). EMPTY (the default) = CORS disabled: the production topology is
  // same-origin behind Caddy (ADR-0009), where no CORS header is needed. Set it ONLY for cross-origin
  // LOCAL development (a SPA dev-server on another port). main.ts enables CORS with credentials:true
  // when this is non-empty — never a wildcard, because the refresh cookie requires an exact origin.
  // This lists the ALLOWED front-end origins only; the public base path itself lives in config/api-base.
  CORS_ORIGINS: z.string().optional().default(''),

  // ADR-0017 dev-only escape hatch. Permits a NON-RF `*_REGION` value (e.g. a local MinIO left at
  // its native `us-east-1` default) ONLY when NODE_ENV!=='production'. Strict-parsed / fail-closed
  // (same discipline as ENABLE_DEV_TOKEN). In production this flag is IGNORED — the RF allowlist is
  // unconditional there, because residency is a hard legal precondition (ФЗ-152 ст.18 ч.5). The CI
  // residency gate additionally blocks any non-RF region in prod config regardless of this flag.
  RESIDENCY_ALLOW_NON_RF_DEV: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  // PostgreSQL — single source of connectivity is DATABASE_URL.
  DATABASE_URL: z.string().url().startsWith('postgres'),

  // Redis — required for throttler storage + caching.
  REDIS_URL: z.string().url().startsWith('redis'),

  // Object storage (S3-compatible). Not exercised by Phase 0 health, but validated for shape.
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // Region string. Shape-validated here; the RF-residency allowlist (ADR-0017) is enforced by the
  // .superRefine below (which also covers any future `*_REGION` var). Default is an approved RF id,
  // so a dev on our .env.example is compliant without extra config; MinIO's native `us-east-1`
  // default is rejected in prod (must be pinned to an approved RF id) — the intended trap.
  S3_REGION: z.string().min(1).default('ru-central1'),

  // Optional prod CDN host placed in FRONT of the S3/MinIO origin (e.g. a Yandex CDN / caching layer
  // over the bucket). When set, its host is ADDED to the media-URL allowlist (lib/media/media-url.ts)
  // alongside the S3_ENDPOINT host, so listing photos served from the CDN pass the own-storage check
  // (AUDIT3 media host allowlist, Wave B2). HOST only (no scheme/path), e.g. `cdn.zoolink.ru`. Empty =
  // no CDN (S3 host is the sole allowed origin — the MVP default). Shape-only here; the allowlist build
  // lives in lib/media so the rule stays testable in isolation.
  MEDIA_CDN_HOST: z.string().optional().default(''),

  // Auth / JWT — secrets must be long enough to be meaningful.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  JWT_REFRESH_TTL: z.string().min(1).default('7d'),

  // Identity: server pepper for the deterministic phone_hash = HMAC-SHA256(phone, pepper)
  // (spec 01 round-4). Must be long/secret; rotating it invalidates phone-based lookups.
  PHONE_HASH_PEPPER: z.string().min(32),

  // PII-at-rest crypto seam (ADR-0019, enforcing ADR-0012). Two independent secrets, no default
  // (boot-blocking, same discipline as JWT/pepper) — the KMS/СКЗИ swap-point is inside CryptoService.
  //  - PII_DATA_KEY: source of the AES-256-GCM data key (field-encrypt email/contact_phone). Rotating
  //    it requires a re-encrypt migration of the affected columns.
  //  - PII_BLIND_INDEX_KEY: HMAC key for the deterministic email blind index (email_bidx). Rotating it
  //    requires a blind-index backfill (recovery/admin-search lookups would otherwise stop matching).
  PII_DATA_KEY: z.string().min(32),
  PII_BLIND_INDEX_KEY: z.string().min(32),

  // Agent service-auth signing secret (ADR-0011 §5.2). FORM ONLY in MVP: declared and length-validated
  // (≥32) at boot, but the AGENT gate is off so no agent service token is ever issued/verified. Optional
  // in dev/test; the prod-required check is enforced by the .superRefine below (same discipline as JWT
  // secrets). Empty string is treated as "not set" so dev/test boot without it.
  AGENT_SERVICE_SIGNING_SECRET: z
    .string()
    .min(32)
    .optional()
    .or(z.literal('')),

  // Retention job (D2, ADMIN_PHASE_ACTION_PLAN.md). Worker-only periodic pass:
  //  - RETENTION_TICK_CRON: cron expression for the tick (default hourly). Read at decorator-eval
  //    time by RetentionExpireJob (@nestjs/schedule decorators cannot read DI), so it is a
  //    deployment-time constant; still declared here so its shape is documented and validated.
  //  - RETENTION_GRACE_DAYS: deactivation grace before erase_user runs (spec 01 / data-governance.md;
  //    30-day grace is the documented default).
  RETENTION_TICK_CRON: z.string().min(1).default('0 * * * *'),
  RETENTION_GRACE_DAYS: z.coerce.number().int().positive().default(30),

  // Listing-creation quota (AUDIT4 P1-4): max NEW listings a single user may create per rolling 24h,
  // Redis-backed per-user counter. Caps supply-flood / Sybil poisoning of per-city liquidity + the
  // moderation-queue DoS the create path otherwise has no defence against (only Idempotency-Key). The
  // default (20/day) is a generous ceiling for a legitimate seller; tune per market/abuse-signal later.
  LISTING_CREATION_QUOTA_PER_DAY: z.coerce.number().int().positive().default(20),

  // Providers (ADR-0008). Empty credential → that adapter runs in stub mode.
  SMS_PROVIDER: z.string().default('smsru'),
  SMSRU_API_ID: z.string().optional().default(''),
  SMS_FROM: z.string().optional().default(''), // approved SMS.RU sender name (optional)
  EMAIL_PROVIDER: z.string().default('unisender'),
  UNISENDER_API_KEY: z.string().optional().default(''),
  UNISENDER_LIST_ID: z.string().optional().default(''), // Unisender list for unsubscribe footer
  EMAIL_FROM: z.string().optional().default(''), // verified sender address
  EMAIL_FROM_NAME: z.string().optional().default('ZooLink'),
  YANDEX_MAPS_API_KEY: z.string().optional().default(''),

  // OAuth providers (ADR-0008). Empty → that provider is stub-in-dev / rejected-in-prod.
  OAUTH_GOOGLE_CLIENT_ID: z.string().optional().default(''),
  OAUTH_GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
  OAUTH_APPLE_CLIENT_ID: z.string().optional().default(''),
  // Sign in with Apple uses a client-secret JWT signed with an ES256 .p8 key, so it needs three
  // additional values beyond the client id (D3 / OPS-11 — env FORM only; the adapter is deferred).
  // Form chosen: the .p8 contents go in OAUTH_APPLE_PRIVATE_KEY (mounted as a secret file and read
  // into the env), matching how every other secret is handled here (no file paths in env, no key
  // material in the repo). Optional in dev/test; for a real prod Apple integration all three are
  // required together — enforced by the .superRefine below.
  OAUTH_APPLE_TEAM_ID: z.string().optional().default(''),
  OAUTH_APPLE_KEY_ID: z.string().optional().default(''),
  OAUTH_APPLE_PRIVATE_KEY: z.string().optional().default(''),
  OAUTH_TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  OAUTH_VK_CLIENT_ID: z.string().optional().default(''),
  OAUTH_VK_CLIENT_SECRET: z.string().optional().default(''),

  // Payments — Фаза 2+, gated by feature_toggles.payments (ADR-0008). Interface defined now; stub in MVP.
  PAYMENT_PROVIDER: z.string().default('yookassa'),
  YOOKASSA_SHOP_ID: z.string().optional().default(''),
  YOOKASSA_SECRET_KEY: z.string().optional().default(''),

  // Observability.
  // /metrics scrape credential (ops secret). MetricsGuard reads it per-request straight from
  // process.env (defence-in-depth gate), so it is NOT consumed off the typed config surface — but its
  // PRESENCE is boot-validated here: OPTIONAL in dev/test (MetricsGuard's internal-client fallback
  // covers local/in-cluster scraping), REQUIRED (≥16 chars) in production — enforced in the
  // validateEnv block below, same discipline as AGENT_SERVICE_SIGNING_SECRET. WHY prod-required:
  // without a token, prod MetricsGuard falls back to trusting the source IP (req.ip); behind the Caddy
  // reverse proxy every request's remote address looks internal/loopback, so /metrics (business volumes
  // + route/label cardinality) would be effectively world-readable. Requiring the token in prod closes
  // the D8-gate 🟡 (AUDIT3 security.md). If set anywhere, must be ≥16 (a too-short token is a boot error).
  METRICS_TOKEN: z.string().min(16).optional().or(z.literal('')),
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
})
  // ADR-0017 layer 1 (runtime, fail-at-boot). Scan EVERY `*_REGION` var generically (S3_REGION
  // today; managed-PG / replica / backup / DR / log-sink region vars in future) and reject any
  // value outside RF_ALLOWED_REGIONS. Aggregates into the same boot-blocking error report as the
  // rest of the schema. The dev bypass applies ONLY outside production (residency is unconditional
  // in prod). Non-string values (there are none today) are skipped defensively.
  .superRefine((val, ctx) => {
    const devBypass =
      val.NODE_ENV !== 'production' && val.RESIDENCY_ALLOW_NON_RF_DEV === true;
    for (const [key, raw] of Object.entries(val)) {
      if (!key.endsWith('_REGION') || typeof raw !== 'string') continue;
      if (isRfRegion(raw) || devBypass) continue;
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [key],
        message: `"${raw}" is not an approved RF region (ADR-0017 / ФЗ-152 ст.18 ч.5). Allowed: ${RF_ALLOWED_REGIONS.join(
          ', ',
        )}. A non-RF region is permitted only in dev with RESIDENCY_ALLOW_NON_RF_DEV=true.`,
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by @nestjs/config `validate`. Throws (boot-blocking) with a readable report. */
export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  // ADR-0011 §5.2: the agent service-signing secret is optional in dev/test (form-only, gate off) but
  // MUST be present (≥32) in production so the form is boot-ready the moment the AGENT gate is enabled.
  if (
    parsed.data.NODE_ENV === 'production' &&
    !parsed.data.AGENT_SERVICE_SIGNING_SECRET
  ) {
    throw new Error(
      'Invalid environment configuration:\n  - AGENT_SERVICE_SIGNING_SECRET: required in production (min 32 chars)',
    );
  }
  // /metrics gate hardening (AUDIT3 security.md, D8 🟡): in production METRICS_TOKEN MUST be set (≥16,
  // shape-checked above). Without it MetricsGuard falls back to trusting req.ip — and behind the reverse
  // proxy every client looks internal — so the scrape endpoint would be world-readable. Optional in
  // dev/test (the internal-client fallback is fine there). Empty string is treated as "not set".
  if (
    parsed.data.NODE_ENV === 'production' &&
    !parsed.data.METRICS_TOKEN
  ) {
    throw new Error(
      'Invalid environment configuration:\n  - METRICS_TOKEN: required in production (min 16 chars) — else MetricsGuard trusts req.ip behind the proxy and /metrics is world-readable',
    );
  }
  // D3 / OPS-11: Sign in with Apple is all-or-nothing. The adapter is deferred (stub-on-empty), but if
  // any Apple credential is supplied in production, the full set must be present so the form is never
  // half-configured. All-empty = Apple OAuth simply off (stub-in-dev / 503-in-prod, like other providers).
  if (parsed.data.NODE_ENV === 'production') {
    const apple = {
      OAUTH_APPLE_CLIENT_ID: parsed.data.OAUTH_APPLE_CLIENT_ID,
      OAUTH_APPLE_TEAM_ID: parsed.data.OAUTH_APPLE_TEAM_ID,
      OAUTH_APPLE_KEY_ID: parsed.data.OAUTH_APPLE_KEY_ID,
      OAUTH_APPLE_PRIVATE_KEY: parsed.data.OAUTH_APPLE_PRIVATE_KEY,
    };
    const set = Object.entries(apple).filter(([, v]) => v !== '');
    if (set.length > 0 && set.length < Object.keys(apple).length) {
      const missing = Object.entries(apple)
        .filter(([, v]) => v === '')
        .map(([k]) => `  - ${k}: required when any OAUTH_APPLE_* is set in production`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${missing}`);
    }
  }
  return parsed.data;
}
