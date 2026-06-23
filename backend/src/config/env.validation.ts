import { z } from 'zod';

/**
 * Canonical environment contract. Mirrors ../.env.example (ADR-0008 provider choices).
 * Fail-fast: the process must not boot with a missing/invalid required variable.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  PUBLIC_DOMAIN: z.string().min(1).default('localhost'),

  // PostgreSQL — single source of connectivity is DATABASE_URL.
  DATABASE_URL: z.string().url().startsWith('postgres'),

  // Redis — required for throttler storage + caching.
  REDIS_URL: z.string().url().startsWith('redis'),

  // Object storage (S3-compatible). Not exercised by Phase 0 health, but validated for shape.
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  S3_REGION: z.string().min(1).default('ru-central1'),

  // Auth / JWT — secrets must be long enough to be meaningful.
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().min(1).default('15m'),
  JWT_REFRESH_TTL: z.string().min(1).default('7d'),

  // Identity: server pepper for the deterministic phone_hash = HMAC-SHA256(phone, pepper)
  // (spec 01 round-4). Must be long/secret; rotating it invalidates phone-based lookups.
  PHONE_HASH_PEPPER: z.string().min(32),

  // Agent service-auth signing secret (ADR-0011 §5.2). FORM ONLY in MVP: declared and length-validated
  // (≥32) at boot, but the AGENT gate is off so no agent service token is ever issued/verified. Optional
  // in dev/test; the prod-required check is enforced by the .superRefine below (same discipline as JWT
  // secrets). Empty string is treated as "not set" so dev/test boot without it.
  AGENT_SERVICE_SIGNING_SECRET: z
    .string()
    .min(32)
    .optional()
    .or(z.literal('')),

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
  OAUTH_TELEGRAM_BOT_TOKEN: z.string().optional().default(''),
  OAUTH_VK_CLIENT_ID: z.string().optional().default(''),
  OAUTH_VK_CLIENT_SECRET: z.string().optional().default(''),

  // Payments — Фаза 2+, gated by feature_toggles.payments (ADR-0008). Interface defined now; stub in MVP.
  PAYMENT_PROVIDER: z.string().default('yookassa'),
  YOOKASSA_SHOP_ID: z.string().optional().default(''),
  YOOKASSA_SECRET_KEY: z.string().optional().default(''),

  // Observability.
  SENTRY_DSN: z.string().optional().default(''),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
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
  return parsed.data;
}
