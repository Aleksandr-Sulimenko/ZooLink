/**
 * Redis-down edge survival (AUDIT5 §F1c — acceptance M-c1 / M-c2 / M-c3), over real HTTP against a
 * REAL unreachable Redis port. Not a mock: the point is exactly what ioredis + the global
 * ThrottlerGuard do when the socket refuses.
 *
 * The loop this closes: the global ThrottlerGuard stores counters in Redis and runs BEFORE every
 * controller, so a dependency-free liveness probe returned 500 when Redis was down. The Dockerfile
 * HEALTHCHECK polls /health/live and compose restarts on failure — and the restarted process died at
 * boot on the rejected `connect()`. A Redis blip therefore became a restart loop the container could
 * not leave until Redis returned.
 *
 * Three axes, each catching its own production mutation:
 *   M-c2  the app BOOTS with Redis dead                (revert the try/catch in RedisService → RED)
 *   M-c1  /health/live answers 200 with Redis dead     (remove @SkipThrottle from health → RED)
 *   M-c3  /health/ready answers an HONEST 503          (not 200, and not the guard's 500)
 *
 * It also PINS the current failure direction of the rate limiter itself (HTTP 500 on a throttled
 * route with Redis down). That is deliberately NOT fixed here — choosing fail-open vs a clean
 * fail-closed 429 is an architecture/security decision owned by AUDIT5 §F2. The assertion is a
 * tripwire: when §F2 lands, this test must be updated, which is how the change stays visible.
 */
import { join } from 'node:path';
import type { Server } from 'node:http';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

// MUST be set before AppModule is instantiated: @nestjs/config caches, and dotenv never overrides an
// already-set process.env var, so this wins over both .env files. Port 6399 is not a Redis port.
const DEAD_REDIS_URL = 'redis://127.0.0.1:6399';
const realRedisUrl = process.env.REDIS_URL;
process.env.REDIS_URL = DEAD_REDIS_URL;

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/lib/http/problem.filter';
import { applyGlobalApiPrefix } from '../src/config/api-base';

describe('Redis down: health stays truthful, the process stays alive (e2e)', () => {
  let app: INestApplication;
  let bootError: unknown;

  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    try {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
      );
      app.useGlobalFilters(new ProblemExceptionFilter());
      applyGlobalApiPrefix(app);
      app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
      await app.init();
    } catch (error) {
      bootError = error;
    }
  }, 60_000);

  afterAll(async () => {
    if (app) await app.close();
    // Restore for whatever spec file jest runs next in this worker.
    if (realRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = realRedisUrl;
  });

  it('M-c2: boots with an unreachable Redis instead of killing the process', () => {
    expect(bootError).toBeUndefined();
    expect(app).toBeDefined();
  });

  it('M-c2: really is pointed at a dead Redis (guards against a false green)', async () => {
    const { RedisService } = await import('../src/lib/redis/redis.service');
    const redis = app.get(RedisService);
    expect(redis.client.options.port).toBe(6399);
    await expect(redis.ping()).rejects.toThrow();
  });

  it('M-c1: GET /health/live → 200 (dependency-free liveness never touches Redis)', async () => {
    const res = await request(server()).get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    // @SkipThrottle also means the probe carries no rate-limit headers.
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('M-c1: /health/live keeps answering 200 on repeat (no restart-loop trigger)', async () => {
    for (let i = 0; i < 5; i++) {
      await request(server()).get('/health/live').expect(200);
    }
  });

  it('M-c3: GET /health/ready → 503 honest degraded (NOT 200, and NOT the guard’s 500)', async () => {
    const res = await request(server()).get('/health/ready');
    expect(res.status).toBe(503);
    expect(res.status).not.toBe(200); // would mean readiness lies about a missing dependency
    expect(res.status).not.toBe(500); // would mean the throttler guard, not the health check, answered
    // The global RFC 7807 filter reshapes the thrown Terminus result into a problem document, so the
    // per-indicator report is not in the BODY — the diagnosis is asserted directly below.
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.status).toBe(503);
    expect(res.body.code).toBe('UPSTREAM_UNAVAILABLE'); // codeForStatus(503), API_CONVENTIONS §4
  }, 20_000);

  it('M-c3: the 503 is diagnosed correctly — postgres up, redis down', async () => {
    const [{ PrismaHealthIndicator }, { RedisHealthIndicator }] = await Promise.all([
      import('../src/health/indicators/prisma.health'),
      import('../src/health/indicators/redis.health'),
    ]);
    const postgres = await app.get(PrismaHealthIndicator).isHealthy('postgres');
    const redis = await app.get(RedisHealthIndicator).isHealthy('redis');

    expect(postgres.postgres.status).toBe('up');
    expect(redis.redis.status).toBe('down');
  }, 20_000);

  it('AUDIT5 §F2 tripwire: a throttled route still 500s with Redis down (direction unchanged here)', async () => {
    // The bucket lookup rejects and the global guard surfaces it. Documented, not endorsed:
    // fail-open vs a clean 429 is §F2's decision. A junk body means no OTP/DB side effects — the
    // guard runs before the validation pipe.
    const res = await request(server()).post('/api/v1/auth/register/phone').send({ phone: '123' });
    expect(res.status).toBe(500);
  }, 20_000);
});
