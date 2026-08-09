import * as Sentry from '@sentry/node';
import {
  checkTelemetryDsn,
  telemetryDsnRejectionMessage,
} from '../../config/env.validation';
import type { Env } from '../../config/env.validation';

/**
 * Initialize Sentry as early as possible (before Nest bootstrap). No-op when SENTRY_DSN is empty,
 * so dev/test never ship errors anywhere. Called from main.ts/worker.ts.
 *
 * RF residency (ADR-0017 п.6 / ФЗ-152 ст.18 ч.5) is re-checked HERE, not only in the env validator,
 * and that is the load-bearing part of the guard: main.ts calls this from RAW `process.env` BEFORE
 * `NestFactory.create`, i.e. before `validateEnv` ever runs. Without this check the sequence with a
 * foreign DSN would be — Sentry initialised against the foreign ingest → env validation throws →
 * the rejection escapes `void bootstrap()` → the process guard hands it to `Sentry.captureException`
 * → the "your residency config is invalid" report is delivered abroad, together with whatever
 * context the boot error carries. Failing closed at boot only helps if nothing was sent before it.
 *
 * A non-resident host is a REFUSAL TO INITIALISE (returns false), never a silent init: error
 * reporting is degraded, residency is not. The message names the host only — never the DSN, which
 * carries a credential.
 */
export function initSentry(
  env: Pick<Env, 'SENTRY_DSN' | 'NODE_ENV'> &
    Partial<Pick<Env, 'RESIDENCY_ALLOW_NON_RF_DEV'>>,
): boolean {
  if (!env.SENTRY_DSN) return false;

  const verdict = checkTelemetryDsn(env.SENTRY_DSN);
  // Same dev-only escape hatch as the env validator, and the same rule: in production the flag is
  // IGNORED. An unparseable DSN is never bypassable.
  const devBypass =
    env.NODE_ENV !== 'production' && env.RESIDENCY_ALLOW_NON_RF_DEV === true;
  if (!verdict.ok && !(verdict.reason === 'non-rf-host' && devBypass)) {
    process.stderr.write(
      `[sentry] NOT initialised — ${telemetryDsnRejectionMessage(verdict)}\n`,
    );
    return false;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
  return true;
}

export { Sentry };
