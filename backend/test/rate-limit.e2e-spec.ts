/**
 * Rate-limit 429 + headers at the HTTP layer (AUDIT_2026-06-30 MAJOR). The @Throttle caps on
 * sensitive auth endpoints (identity.controller.ts) were never exercised over HTTP, and
 * API_CONVENTIONS §12 requires RateLimit headers on sensitive ops. This proves: under-limit
 * requests carry X-RateLimit-* headers, and the over-limit request returns 429
 * application/problem+json (code=RATE_LIMITED) with Retry-After.
 *
 * Deterministic: we flush all throttler keys immediately before each test so prior suites/runs cannot
 * leak hits. register/phone is capped at 5/15min; the ThrottlerGuard runs BEFORE the ValidationPipe,
 * so a junk body still consumes a hit and we incur zero OTP/DB side effects. e2e hits HOST pg/redis.
 *
 * AUDIT5 §F1b added the per-client bucket: the tracker keys on the edge-supplied `X-Real-IP` instead
 * of the socket address (which behind Caddy is the SAME value for the entire internet — the whole
 * platform shared one 5/15min registration bucket). The suites below drive that header directly.
 *
 * ⚠ SCOPE LIMIT, stated plainly: supertest talks to the Nest server, so `deploy/Caddyfile` is NOT in
 * the loop. These tests prove the APPLICATION half (distinct client IPs ⇒ distinct buckets, and the
 * value is validated before it is trusted). They CANNOT prove the anti-spoof half, because at this
 * layer a client-supplied `X-Real-IP` is *supposed* to be trusted — that is the contract the edge
 * upholds by overwriting it. The anti-spoof axis lives in two other places, deliberately:
 *   · scripts/check-edge-client-ip.sh — CI lock making the two halves mutually obligatory (У-6);
 *   · a live run through real Caddy on the stand (owner's acceptance) — verified once during the
 *     build: with `header_up X-Real-IP {remote_host}` a client-sent `X-Real-IP: 6.6.6.6` arrived as
 *     the real peer, and without the site-level `request_header -X-Real-IP` a handle that forgot the
 *     rewrite passed `6.6.6.6` through verbatim.
 * Do not "strengthen" the tests below into a fake anti-spoof proof: it would be decorative.
 */
import { join } from 'node:path';
import type { Server } from 'node:http';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/lib/http/problem.filter';
import { resetThrottle } from './throttle-reset.util';
import { applyGlobalApiPrefix } from '../src/config/api-base';

describe('Rate limiting 429 + headers (e2e)', () => {
  let app: INestApplication;
  const REGISTER_LIMIT = 5; // identity.controller.ts REGISTER_THROTTLE

  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    applyGlobalApiPrefix(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  beforeEach(async () => {
    await resetThrottle(app); // fixed key (loopback IP) + clean slate → deterministic
  });

  afterAll(async () => {
    await app.close();
  });

  // A junk body 400s in the pipe but still consumes a throttle hit (guard runs first).
  const junk = { phone: '123' };
  const register = (clientIp?: string) => {
    const req = request(server()).post('/api/v1/auth/register/phone');
    return (clientIp === undefined ? req : req.set('X-Real-IP', clientIp)).send(junk);
  };
  /** Spend the whole register window for one client; the last allowed request must still pass. */
  const exhaust = async (clientIp: string): Promise<void> => {
    for (let i = 1; i <= REGISTER_LIMIT; i++) {
      const r = await register(clientIp);
      expect(r.status).not.toBe(429);
    }
  };

  it('under-limit requests carry X-RateLimit-* headers; the limit+1 request → 429 problem+json + Retry-After', async () => {
    // First request: allowed → headers present, advertising the cap.
    const first = await request(server()).post('/api/v1/auth/register/phone').send(junk);
    expect(first.status).not.toBe(429);
    expect(first.headers['x-ratelimit-limit']).toBe(String(REGISTER_LIMIT));
    expect(first.headers['x-ratelimit-remaining']).toBeDefined();
    expect(Number(first.headers['x-ratelimit-remaining'])).toBeLessThanOrEqual(REGISTER_LIMIT - 1);

    // Exhaust the rest of the window (requests 2..5 stay under the cap).
    for (let i = 2; i <= REGISTER_LIMIT; i++) {
      const r = await request(server()).post('/api/v1/auth/register/phone').send(junk);
      expect(r.status).not.toBe(429);
    }

    // The (limit+1)th request is blocked.
    const blocked = await request(server()).post('/api/v1/auth/register/phone').send(junk).expect(429);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.body.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
  });

  describe('per-client buckets (AUDIT5 §F1b — the platform-wide bucket defect)', () => {
    it('a SECOND client is unaffected by the first client spending its whole window', async () => {
      await exhaust('203.0.113.10');
      // Same socket, different edge client: without the getTracker override both requests key on the
      // one loopback address and this is a 429 — that is precisely the defect §F1b fixes.
      await expect(register('203.0.113.10').expect(429)).resolves.toBeDefined();

      const other = await register('198.51.100.20');
      expect(other.status).not.toBe(429);
      expect(other.headers['x-ratelimit-remaining']).toBe(String(REGISTER_LIMIT - 1));
    });

    it('the SAME client is capped no matter which socket it arrives on', async () => {
      await exhaust('203.0.113.11');
      await register('203.0.113.11').expect(429);
    });

    it('an IPv4-mapped form is the SAME bucket as the plain IPv4 form (no free second window)', async () => {
      await exhaust('203.0.113.12');
      await register('::ffff:203.0.113.12').expect(429);
    });

    it('one IPv6 client cannot rotate inside its own /64 for a fresh bucket', async () => {
      await exhaust('2001:db8:cafe:1::1');
      await register('2001:db8:cafe:1::999').expect(429);
      // A genuinely different /64 is a different client.
      const elsewhere = await register('2001:db8:cafe:2::1');
      expect(elsewhere.status).not.toBe(429);
    });

    it('a malformed header does not mint a new bucket per value (falls back to one shared bucket)', async () => {
      // Each junk value must land in the SAME fallback bucket, otherwise junk = unlimited buckets.
      for (let i = 1; i <= REGISTER_LIMIT; i++) {
        const r = await register(`garbage-${i}`);
        expect(r.status).not.toBe(429);
      }
      await register('1.1.1.1, 2.2.2.2').expect(429);
      await register('').expect(429);
    });
  });

  describe('the fallback alarm is really exported (У-4b amendment)', () => {
    it('a header-less request lands in the live /metrics scrape as absent{peer="loopback"}', async () => {
      // Guards the defect class the amendment's point 3 is about: a metric can be wired in code and
      // never reach the registry (that is exactly how zoolink_audit_actions_total died unnoticed).
      // supertest connects over loopback, so this run IS the benign series — which is also the proof
      // that an in-container caller cannot raise the alarm series' baseline.
      await request(server()).post('/api/v1/auth/register/phone').send(junk); // no X-Real-IP

      // MetricsGuard: when METRICS_TOKEN is configured (root .env, or leaked in by another e2e file in
      // this worker) the token is REQUIRED and there is no internal-only fallback — present it if set.
      const token = process.env.METRICS_TOKEN?.trim();
      const scrapeReq = request(server()).get('/metrics');
      const scrape = await (token ? scrapeReq.set('X-Metrics-Token', token) : scrapeReq).expect(200);
      expect(scrape.text).toContain('zoolink_ratelimit_tracker_fallback_total');
      expect(scrape.text).toMatch(
        /zoolink_ratelimit_tracker_fallback_total\{[^}]*source="absent"[^}]*peer="loopback"[^}]*\}\s+[1-9]/,
      );
      // The alarm series must NOT have fired for a loopback caller.
      expect(scrape.text).not.toMatch(
        /zoolink_ratelimit_tracker_fallback_total\{[^}]*source="absent"[^}]*peer="network"[^}]*\}\s+[1-9]/,
      );
      // And the rule + its premise travel with the metric, for whoever reads the scrape.
      expect(scrape.text).toContain('ALERT on absent{peer="network"} != 0');
    });
  });

  describe('health opts out of the rate limiter (AUDIT5 §F1c / У-4a)', () => {
    it('/health/live and /health/ready carry no rate-limit headers at all', async () => {
      for (const path of ['/health/live', '/health/ready']) {
        const res = await request(server()).get(path).set('X-Real-IP', '203.0.113.30');
        expect(res.status).toBe(200);
        expect(res.headers['x-ratelimit-limit']).toBeUndefined();
        expect(res.headers['x-ratelimit-remaining']).toBeUndefined();
        expect(res.headers['x-ratelimit-reset']).toBeUndefined();
      }
    });

    it('/health/ready reports every dependency up when Redis is alive (positive control)', async () => {
      const res = await request(server()).get('/health/ready').expect(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.info.postgres.status).toBe('up');
      expect(res.body.info.redis.status).toBe('up');
    });

    it('liveness answers even past the DEFAULT cap — a spent bucket must not fail the probe', async () => {
      // Without @SkipThrottle these share the default 100/60s bucket and #101 would be a 429, so an
      // orchestrator could kill a healthy container over a noisy neighbour.
      const overCap = 105; // > DEFAULT_THROTTLE_LIMIT
      for (let i = 0; i < overCap; i++) {
        await request(server()).get('/health/live').set('X-Real-IP', '203.0.113.31').expect(200);
      }
    }, 30_000);
  });
});
