/**
 * Admin Slice 2 (Users & Roles list + Audit-log viewer) end-to-end against the real stack (PG + Redis).
 * Covers admin-api.yaml getUsersWithRoles + getAuditLog: ADMIN-only RBAC (401 unauth / 403 non-admin),
 * the {items, meta} envelope, role/isActive/search filters, the entityId XOR entityIdInt 400, the
 * INT-entity (reference-data) audit filter, and the {actorId, principalType} actor badge.
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

describe('Admin Users & Audit (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminId: string;
  let userId: string;
  let adminToken: string;
  let userToken: string;

  const suffix = Math.random().toString(36).slice(2, 8);
  const adminName = `S2Admin_${suffix}`;
  const userName = `S2User_${suffix}`;
  const userEmail = `s2user_${suffix}@example.com`;
  const refEntityIdInt = Math.floor(Math.random() * 2_000_000_000) + 1;
  const createdAuditIds: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> => {
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201);
    return res.body.accessToken as string;
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
      data: { full_name: adminName, role: 'ADMIN', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    adminId = admin.id;
    const user = await prisma.users.create({
      data: { full_name: userName, role: 'MODERATOR', principal_type: 'HUMAN', status: 'ACTIVE', is_active: false, email: userEmail },
    });
    userId = user.id;
    adminToken = await devToken(adminId);
    userToken = await devToken(userId);

    // Seed two known audit rows: a UUID-keyed user action (HUMAN) and an INT-keyed reference-data
    // action (so the entityIdInt filter has something to reach).
    const userAction = await prisma.audit_log.create({
      data: {
        actor_id: adminId, actor_role: 'ADMIN', actor_principal_type: 'HUMAN',
        action: 'identity.role_changed', entity_type: 'user', entity_id: userId,
        after_data: { role: 'MODERATOR' },
      },
    });
    const refAction = await prisma.audit_log.create({
      data: {
        actor_id: adminId, actor_role: 'ADMIN', actor_principal_type: 'HUMAN',
        action: 'reference_data.created', entity_type: 'reference-data:species', entity_id_int: refEntityIdInt,
        after_data: { dataset: 'species', id: refEntityIdInt },
      },
    });
    createdAuditIds.push(userAction.id, refAction.id);
  });

  afterAll(async () => {
    // audit_log is append-only (UPDATE/DELETE trigger). Drop the trigger's guard via a raw delete is
    // not allowed; instead remove the trigger-protected rows is impossible — so we leave seeded audit
    // rows in place (they are inert test data) and only clean the users we created.
    for (const id of [userId, adminId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  // ---- GET /users/roles ----------------------------------------------------------------------
  describe('GET /v1/users/roles', () => {
    it('401 for an unauthenticated request', async () => {
      await request(server()).get('/v1/users/roles').expect(401);
    });

    it('403 for a non-ADMIN (MODERATOR) principal', async () => {
      await request(server()).get('/v1/users/roles').set('Authorization', `Bearer ${userToken}`).expect(403);
    });

    it('returns the {items, meta} envelope and a safe UserRoleInfo projection', async () => {
      const res = await request(server())
        .get(`/v1/users/roles?search=${suffix}&limit=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(Array.isArray(res.body.items)).toBe(true);
      expect(res.body.meta).toEqual(expect.objectContaining({ page: 1, total: expect.any(Number) }));
      const me = (res.body.items as Record<string, unknown>[]).find((u) => u.id === adminId);
      expect(me).toEqual(expect.objectContaining({ fullName: adminName, role: 'ADMIN', isActive: true }));
      // never leaks credentials/identifiers
      expect(me).not.toHaveProperty('phoneHash');
      expect(me).not.toHaveProperty('passwordHash');
      expect(me).not.toHaveProperty('oauthGoogleId');
    });

    it('filters by role and isActive', async () => {
      const res = await request(server())
        .get(`/v1/users/roles?role=MODERATOR&isActive=false&search=${suffix}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ids = (res.body.items as { id: string }[]).map((i) => i.id);
      expect(ids).toContain(userId);
      expect(ids).not.toContain(adminId);
    });

    it('400 on an out-of-enum role filter', async () => {
      await request(server())
        .get('/v1/users/roles?role=SUPERHERO')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });

  // ---- GET /audit/log ------------------------------------------------------------------------
  describe('GET /v1/audit/log', () => {
    it('401 for an unauthenticated request', async () => {
      await request(server()).get('/v1/audit/log').expect(401);
    });

    it('403 for a non-ADMIN principal', async () => {
      await request(server()).get('/v1/audit/log').set('Authorization', `Bearer ${userToken}`).expect(403);
    });

    it('400 when entityId and entityIdInt are both supplied', async () => {
      const res = await request(server())
        .get(`/v1/audit/log?entityId=${userId}&entityIdInt=${refEntityIdInt}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('filters a UUID entity and exposes the {actorId, principalType} actor badge', async () => {
      const res = await request(server())
        .get(`/v1/audit/log?entityId=${userId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.meta).toEqual(expect.objectContaining({ page: 1 }));
      const entry = (res.body.items as Record<string, unknown>[])[0];
      expect(entry.entityType).toBe('user');
      expect(entry.entityId).toBe(userId);
      expect(entry.entityIdInt).toBeNull();
      expect(entry.referenceDataset).toBeNull();
      // reconciled vocabulary: the stored {domain}.{verb} is returned verbatim.
      expect(entry.actionType).toBe('identity.role_changed');
      expect(entry.actor).toEqual(
        expect.objectContaining({ actorId: adminId, principalType: 'HUMAN', actorDisplayName: adminName }),
      );
    });

    it('filters an INT-keyed reference-data entity by entityIdInt and splits out referenceDataset (D4)', async () => {
      const res = await request(server())
        .get(`/v1/audit/log?entityIdInt=${refEntityIdInt}&entityType=reference-data`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const items = res.body.items as Record<string, unknown>[];
      expect(items.length).toBeGreaterThanOrEqual(1);
      const entry = items[0];
      expect(entry.entityType).toBe('reference-data'); // suffixed form normalised
      expect(entry.referenceDataset).toBe('species'); // split out of reference-data:species
      expect(entry.entityIdInt).toBe(refEntityIdInt);
      expect(entry.entityId).toBeNull();
      expect(entry.actionType).toBe('reference_data.created'); // verbatim
    });

    it('narrows to one dataset via referenceDataset (exact suffixed entity_type)', async () => {
      const res = await request(server())
        .get('/v1/audit/log?entityType=reference-data&referenceDataset=species')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const found = (res.body.items as Record<string, unknown>[]).find((e) => e.entityIdInt === refEntityIdInt);
      expect(found).toBeDefined();
      expect(found?.referenceDataset).toBe('species');
    });

    it('400 on a malformed actionType (not a {domain}.{verb} verb)', async () => {
      await request(server())
        .get('/v1/audit/log?actionType=NOTAVERB')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });

    it('400 on a malformed entityId (non-uuid)', async () => {
      await request(server())
        .get('/v1/audit/log?entityId=not-a-uuid')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);
    });
  });
});
