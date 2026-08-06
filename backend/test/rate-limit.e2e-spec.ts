/**
 * Rate-limit 429 + headers at the HTTP layer (AUDIT_2026-06-30 MAJOR). The @Throttle caps on
 * sensitive auth endpoints (identity.controller.ts) were never exercised over HTTP, and
 * API_CONVENTIONS §12 requires RateLimit headers on sensitive ops. This proves: under-limit
 * requests carry X-RateLimit-* headers, and the over-limit request returns 429
 * application/problem+json (code=RATE_LIMITED) with Retry-After.
 *
 * Deterministic: the throttler key is the (fixed) loopback IP, and we flush all throttler keys
 * immediately before the burst so prior suites/runs cannot leak hits. register/phone is capped at
 * 5/15min; the ThrottlerGuard runs BEFORE the ValidationPipe, so a junk body still consumes a hit
 * and we incur zero OTP/DB side effects. e2e hits HOST pg/redis (localhost).
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

  it('under-limit requests carry X-RateLimit-* headers; the limit+1 request → 429 problem+json + Retry-After', async () => {
    // A junk body 400s in the pipe but still consumes a throttle hit (guard runs first).
    const junk = { phone: '123' };

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
});
