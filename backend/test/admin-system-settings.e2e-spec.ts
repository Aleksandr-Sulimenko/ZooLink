/**
 * Admin Slice 3 (System Settings) end-to-end against the real stack (PG + Redis). Covers admin-api.yaml
 * getSystemSettings + updateSystemSetting: ADMIN-only RBAC (401 unauth / 403 non-admin), the object-MAP
 * GET response (NOT a {items,meta} page — per the contract), and If-Match/ETag optimistic concurrency
 * (428 missing / 412 stale / 200 valid). The mutation is delegated to FeatureToggleService.flip, so a
 * successful PATCH also writes an audit_log row (asserted via the audit endpoint).
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
import { PrismaService } from '../src/lib/db/prisma.service';
import { resetThrottle } from './throttle-reset.util';

describe('Admin System Settings (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminId: string;
  let userId: string;
  let adminToken: string;
  let userToken: string;

  const suffix = Math.random().toString(36).slice(2, 8);
  const settingKey = `e2e_setting_${suffix}`;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> => {
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201);
    return res.body.accessToken as string;
  };
  /** The real client loop: GET the setting, read its ETag header (the PATCH's If-Match validator). */
  const fetchEtag = async (key: string): Promise<string> => {
    const res = await request(server())
      .get(`/v1/system/settings/${key}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    return res.headers['etag'];
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);

    const admin = await prisma.users.create({
      data: { full_name: `SetAdmin_${suffix}`, role: 'ADMIN', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    adminId = admin.id;
    const user = await prisma.users.create({
      data: { full_name: `SetUser_${suffix}`, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    userId = user.id;
    adminToken = await devToken(adminId);
    userToken = await devToken(userId);

    // A throwaway toggle (backing storage for a "system setting") to mutate without touching seeded ones.
    await prisma.feature_toggles.create({
      data: { key: settingKey, description: 'e2e setting', is_enabled: false, rollout_percentage: 0 },
    });
  });

  afterAll(async () => {
    await prisma.feature_toggles.delete({ where: { key: settingKey } }).catch(() => undefined);
    for (const id of [userId, adminId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  describe('GET /v1/system/settings', () => {
    it('401 for an unauthenticated request', async () => {
      await request(server()).get('/v1/system/settings').expect(401);
    });

    it('403 for a non-ADMIN principal', async () => {
      await request(server()).get('/v1/system/settings').set('Authorization', `Bearer ${userToken}`).expect(403);
    });

    it('returns an object MAP keyed by setting key (not a {items,meta} page)', async () => {
      const res = await request(server())
        .get('/v1/system/settings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body).not.toHaveProperty('items');
      expect(res.body).not.toHaveProperty('meta');
      expect(res.body[settingKey]).toBeDefined();
      expect(res.body[settingKey].key).toBe(settingKey);
      // value is a JSON string encoding the toggle state.
      expect(JSON.parse(res.body[settingKey].value as string)).toEqual({ isEnabled: false, rolloutPercentage: 0 });
    });
  });

  describe('GET /v1/system/settings/{key}', () => {
    it('401 for an unauthenticated request', async () => {
      await request(server()).get(`/v1/system/settings/${settingKey}`).expect(401);
    });

    it('403 for a non-ADMIN principal', async () => {
      await request(server())
        .get(`/v1/system/settings/${settingKey}`)
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);
    });

    it('200: returns the SystemSetting + an ETag header + private,no-store Cache-Control', async () => {
      const res = await request(server())
        .get(`/v1/system/settings/${settingKey}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.key).toBe(settingKey);
      expect(JSON.parse(res.body.value as string)).toEqual({ isEnabled: false, rolloutPercentage: 0 });
      expect(res.headers['etag']).toBeTruthy();
      expect(res.headers['cache-control']).toBe('private, no-store');
    });

    it('404 for an unknown setting key', async () => {
      await request(server())
        .get('/v1/system/settings/does_not_exist_xyz')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);
    });
  });

  describe('PATCH /v1/system/settings/{key}', () => {
    const body = { value: JSON.stringify({ isEnabled: true, rolloutPercentage: 100 }) };

    it('401 unauth / 403 non-admin', async () => {
      await request(server()).patch(`/v1/system/settings/${settingKey}`).send(body).expect(401);
      await request(server())
        .patch(`/v1/system/settings/${settingKey}`)
        .set('Authorization', `Bearer ${userToken}`)
        .set('If-Match', 'W/"x"')
        .send(body)
        .expect(403);
    });

    it('428 when If-Match is missing', async () => {
      await request(server())
        .patch(`/v1/system/settings/${settingKey}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(body)
        .expect(428);
    });

    it('412 when If-Match is stale', async () => {
      await request(server())
        .patch(`/v1/system/settings/${settingKey}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', 'W/"deadbeef"')
        .send(body)
        .expect(412);
    });

    it('404 for an unknown setting key', async () => {
      await request(server())
        .patch('/v1/system/settings/does_not_exist_xyz')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', 'W/"x"')
        .send(body)
        .expect(404);
    });

    it('200 with a valid If-Match: GET→ETag→PATCH client loop flips the toggle + new ETag, writes audit', async () => {
      // SF-2: obtain the If-Match from the real per-setting GET ETag header (no DB reach-around).
      const etag = await fetchEtag(settingKey);

      const res = await request(server())
        .patch(`/v1/system/settings/${settingKey}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', etag)
        .send(body)
        .expect(200);
      expect(res.headers['etag']).toBeTruthy();
      expect(res.headers['etag']).not.toBe(etag); // fresh validator after the change
      expect(res.body.key).toBe(settingKey);
      expect(JSON.parse(res.body.value as string)).toEqual({ isEnabled: true, rolloutPercentage: 100 });
      expect(res.body.updatedBy).toEqual(
        expect.objectContaining({ actorId: adminId, principalType: 'HUMAN' }),
      );

      // the flip was audited (feature_toggle.flip on the feature-toggle entity).
      const audit = await request(server())
        .get('/v1/audit/log?entityType=feature-toggle&actionType=feature_toggle.flip')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const flipped = (audit.body.items as Record<string, unknown>[]).find(
        (e) => typeof e.details === 'string' && e.details.includes(settingKey),
      );
      expect(flipped).toBeDefined();
      expect(flipped?.entityType).toBe('feature-toggle');
    });

    it('400 on a non-JSON value', async () => {
      const etag = await fetchEtag(settingKey);
      await request(server())
        .patch(`/v1/system/settings/${settingKey}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('If-Match', etag)
        .send({ value: 'not-json' })
        .expect(400);
    });
  });
});
