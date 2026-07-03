/**
 * FAIL-CLOSED negative for the DEV-ONLY master-key route (AUDIT3 security.md #1). When
 * ENABLE_DEV_TOKEN is not explicitly true, /v1/auth/dev-token must be a 404 — even in a non-prod
 * NODE_ENV. This is the control that closes the arbitrary-account-takeover chain: the endpoint is
 * gated on an explicit opt-in flag, independent of (and in addition to) the production check.
 *
 * We boot a SECOND app instance with ENABLE_DEV_TOKEN forced off (process.env wins over .env in
 * @nestjs/config), keeping NODE_ENV=development to prove the flag alone shuts the route.
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

describe('Auth dev-token fail-closed (e2e)', () => {
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;
  const original = process.env.ENABLE_DEV_TOKEN;

  beforeAll(async () => {
    process.env.ENABLE_DEV_TOKEN = 'false'; // force the flag off (NODE_ENV stays development)
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
  });

  afterAll(async () => {
    await app.close();
    // Restore so sibling suites (runInBand, shared worker) keep the dev flag on.
    if (original === undefined) delete process.env.ENABLE_DEV_TOKEN;
    else process.env.ENABLE_DEV_TOKEN = original;
  });

  it('POST /v1/auth/dev-token → 404 when ENABLE_DEV_TOKEN is not true (fail-closed)', async () => {
    const res = await request(server())
      .post('/v1/auth/dev-token')
      .send({ userId: '00000000-0000-0000-0000-000000000000' })
      .expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
