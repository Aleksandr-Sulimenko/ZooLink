/**
 * Auth/AuthZ end-to-end against the real HTTP stack. Boots AppModule (global JwtAuthGuard +
 * RolesGuard + PoliciesGuard) and drives the test endpoints on AuthController, proving the
 * Phase-1 DoD: "authentication/authorization work end-to-end on a test endpoint".
 *
 * Needs PG + Redis (DATABASE_URL/REDIS_URL) and the JWT secrets — loaded from backend/.env
 * locally; provided by the CI environment otherwise. Access tokens are stateless, so no DB rows
 * are required: we mint them directly via TokenService.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
// Local convenience: load backend/.env if present. In CI the vars come from the job env, and
// this is a silent no-op (quiet).
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import type { Server } from 'node:http';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/lib/http/problem.filter';
import { TokenService } from '../src/modules/auth/token.service';

describe('Auth/AuthZ (e2e)', () => {
  let app: INestApplication;
  let userToken: string;
  let moderatorToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();

    const tokens = app.get(TokenService);
    userToken = tokens.signAccess({ userId: randomUUID(), role: 'USER', principalType: 'HUMAN' });
    moderatorToken = tokens.signAccess({
      userId: randomUUID(),
      role: 'MODERATOR',
      principalType: 'HUMAN',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const server = (): Server => app.getHttpServer() as Server;

  it('rejects an unauthenticated request with 401 (RFC7807)', async () => {
    const res = await request(server()).get('/v1/auth/whoami').expect(401);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('authenticates a valid access token and returns the principal', async () => {
    const res = await request(server())
      .get('/v1/auth/whoami')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);
    expect(res.body.role).toBe('USER');
    expect(res.body.principalType).toBe('HUMAN');
  });

  it('forbids a USER on an operator-only route with 403', async () => {
    const res = await request(server())
      .get('/v1/auth/operator-check')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('allows a MODERATOR on the operator-only route', async () => {
    const res = await request(server())
      .get('/v1/auth/operator-check')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);
    expect(res.body).toEqual({ ok: true, role: 'MODERATOR' });
  });

  it('rejects a garbage token with 401', async () => {
    await request(server())
      .get('/v1/auth/whoami')
      .set('Authorization', 'Bearer not-a-jwt')
      .expect(401);
  });
});
