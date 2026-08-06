import { RequestMethod } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';

/**
 * SINGLE SOURCE OF TRUTH for the public API base path (AUDIT5 C1 / §F1a).
 *
 * The published contract base is `/api/v1` — declared identically by `servers:` in all 13 OpenAPI
 * files, by `API_CONVENTIONS.md`, and by the edge (`deploy/Caddyfile` `handle /api/*`, which does
 * NOT strip the prefix). It is composed of two independent layers:
 *   1. a global route prefix `api`  → applied via app.setGlobalPrefix (this file)
 *   2. URI versioning        `v1`   → @Controller({ version: '1' }) + enableVersioning(defaultVersion)
 *
 * Everything that must agree on this base — the global prefix, the refresh-cookie `Path`, the CORS
 * reasoning, the `Location` headers — derives it from HERE. Before this file the base lived in three
 * places at once and drifted (main.ts had NO prefix → served `/v1`; Caddy proxied `/api/*`; the
 * refresh cookie was pinned to `/v1/auth`) → the whole documented API 404'd through the edge and the
 * session silently dropped every 15 min. Keep it ONE copy so a third truth can never re-form.
 */

/** Global route prefix segment (no slashes). Consumed by app.setGlobalPrefix. */
export const API_GLOBAL_PREFIX = 'api';

/** URI API version digit. Consumed by enableVersioning; MUST match @Controller({ version }). */
export const API_VERSION = '1';

/** The public base a browser / Caddy sees, e.g. `/api/v1`. Derive cookie `Path` & `Location` from this. */
export const API_BASE_PATH = `/${API_GLOBAL_PREFIX}/v${API_VERSION}`;

/**
 * Routes that OPT OUT of the `api` prefix and stay at the domain root. They are version-neutral and
 * are reached directly (NOT through `/api`) by infrastructure that must keep working:
 *   - `/health/live`, `/health/ready` — the container HEALTHCHECK (docker-compose.yml `api` probes
 *     `/health/ready`) and Caddy's `handle /health/*` passthrough for external uptime checks.
 *   - `/metrics` — the ops scraper (guarded by MetricsGuard); Caddy/prod access is by the root path.
 * Moving any of these under `/api/health` or `/api/metrics` would silently break the healthcheck and
 * the scrape, so they are excluded from the global prefix.
 */
export const API_PREFIX_EXCLUDE = ['health/live', 'health/ready', 'metrics'] as const;

/**
 * Applies the global `api` prefix (with the health/metrics opt-out) to a Nest app, so the real
 * bootstrap (main.ts) and every e2e app expose the SAME public base the browser hits through Caddy —
 * no second truth between production and the test suite. URI versioning is configured by the caller
 * next to this call (it never drifted; the prefix did).
 */
export function applyGlobalApiPrefix(app: INestApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX, {
    exclude: API_PREFIX_EXCLUDE.map((path) => ({ path, method: RequestMethod.ALL })),
  });
}
