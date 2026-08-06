/**
 * /metrics access gate (AUDIT3 security.md — defence-in-depth, not Caddy-only). Proves the ops-token
 * layer end-to-end over the real app: with METRICS_TOKEN configured, an anonymous scrape with no/wrong
 * credential gets a 404 (no-leak), and only the correct token yields the Prometheus body.
 */
import { join } from 'node:path';
import type { Server } from 'node:http';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

// MUST be set before the app boots so the guard reads it (guard reads process.env per request).
process.env.METRICS_TOKEN = 'test-metrics-secret';

import { VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/lib/http/problem.filter';
import { applyGlobalApiPrefix } from '../src/config/api-base';

describe('/metrics gate (e2e)', () => {
  let app: INestApplication;
  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new ProblemExceptionFilter());
    applyGlobalApiPrefix(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    delete process.env.METRICS_TOKEN;
  });

  it('404s an anonymous scrape with NO credential (no-leak, not 401/403)', async () => {
    await request(server()).get('/metrics').expect(404);
  });

  it('404s a scrape with the WRONG token', async () => {
    await request(server()).get('/metrics').set('X-Metrics-Token', 'nope').expect(404);
  });

  it('200s with the correct X-Metrics-Token and returns Prometheus text', async () => {
    const res = await request(server()).get('/metrics').set('X-Metrics-Token', 'test-metrics-secret').expect(200);
    expect(res.text).toContain('# HELP');
  });

  it('200s with the correct Bearer token', async () => {
    await request(server()).get('/metrics').set('Authorization', 'Bearer test-metrics-secret').expect(200);
  });
});
