import * as Sentry from '@sentry/node';
import type { Env } from '../../config/env.validation';

/**
 * Initialize Sentry as early as possible (before Nest bootstrap). No-op when SENTRY_DSN is empty,
 * so dev/test never ship errors anywhere. Called from main.ts/worker.ts.
 */
export function initSentry(env: Pick<Env, 'SENTRY_DSN' | 'NODE_ENV'>): boolean {
  if (!env.SENTRY_DSN) return false;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  return true;
}

export { Sentry };
