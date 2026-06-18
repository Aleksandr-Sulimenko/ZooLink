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

  // Providers (ADR-0008). Empty in dev → adapters run in stub mode.
  SMS_PROVIDER: z.string().default('smsru'),
  SMSRU_API_ID: z.string().optional().default(''),
  EMAIL_PROVIDER: z.string().default('unisender'),
  UNISENDER_API_KEY: z.string().optional().default(''),
  YANDEX_MAPS_API_KEY: z.string().optional().default(''),

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
  return parsed.data;
}
