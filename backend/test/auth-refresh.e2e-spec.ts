/**
 * Refresh-token rotation + reuse/theft detection end-to-end (spec 01 round-4 normative).
 * Closes the CRITICAL coverage gap (AUDIT_2026-06-30): `/v1/auth/refresh` and `/v1/auth/logout`
 * had ZERO behavioral tests though the token-theft defense is the #1 risk.
 *
 * Drives the real HTTP stack (PG + Redis): dev-token mints a real DB-backed session, then we
 * rotate, replay a rotated token (→ family burn), and logout. Family-revocation is verified on
 * live PG via the refresh_tokens table (sibling rows' revoked_at set). e2e hits HOST pg/redis
 * (localhost); flush host redis if stale 429s.
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

describe('Auth refresh-token rotation/reuse (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;

  /** Mint a real DB-backed session (access + opaque refresh) for an existing user. */
  const session = async (uid: string): Promise<{ accessToken: string; refreshToken: string }> => {
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201);
    return { accessToken: res.body.accessToken as string, refreshToken: res.body.refreshToken as string };
  };

  const mkUser = async (name: string): Promise<string> => {
    const u = await prisma.users.create({
      data: { full_name: name, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
    });
    userIds.push(u.id);
    return u.id;
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
  });

  afterAll(async () => {
    for (const id of userIds) {
      await prisma.refresh_tokens.deleteMany({ where: { user_id: id } }).catch(() => undefined);
      await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  it('(a) a valid refresh rotates → 200 + a NEW token; the OLD token is revoked (replay → 401)', async () => {
    const uid = await mkUser('Refresh Rotate');
    const { refreshToken: original } = await session(uid);

    const rot = await request(server()).post('/v1/auth/refresh').send({ refreshToken: original }).expect(200);
    expect(rot.body.accessToken).toEqual(expect.any(String));
    expect(rot.body.refreshToken).toEqual(expect.any(String));
    expect(rot.body.refreshToken).not.toBe(original); // rotated, not echoed

    // The presented (now-rotated) token is revoked: replaying it is rejected.
    const replay = await request(server()).post('/v1/auth/refresh').send({ refreshToken: original }).expect(401);
    expect(replay.headers['content-type']).toContain('application/problem+json');
    expect(replay.body.code).toBe('UNAUTHENTICATED');
  });

  it('(b) replaying a rotated token detects reuse and burns the WHOLE family (siblings revoked on live PG)', async () => {
    const uid = await mkUser('Refresh Reuse');
    const { refreshToken: original } = await session(uid);

    // Rotate once: family now has the (revoked) original + a fresh active child.
    const rot = await request(server()).post('/v1/auth/refresh').send({ refreshToken: original }).expect(200);
    const child = rot.body.refreshToken as string;

    // Sanity on live PG: the family has exactly one live (non-revoked) row before the reuse.
    const liveBefore = await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } });
    expect(liveBefore).toBe(1);

    // Replay the ALREADY-ROTATED original → reuse/theft → 401 + burn the family.
    const reuse = await request(server()).post('/v1/auth/refresh').send({ refreshToken: original }).expect(401);
    expect(reuse.body.code).toBe('UNAUTHENTICATED');

    // The whole family is revoked on live PG — no row left live.
    const rows = await prisma.refresh_tokens.findMany({ where: { user_id: uid } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);

    // The previously-good child is now unusable too (family was burned).
    const childReuse = await request(server()).post('/v1/auth/refresh').send({ refreshToken: child }).expect(401);
    expect(childReuse.body.code).toBe('UNAUTHENTICATED');
  });

  it('(c) /auth/logout with a refresh token revokes its family; a later refresh → 401', async () => {
    const uid = await mkUser('Refresh Logout');
    const { accessToken, refreshToken } = await session(uid);

    await request(server())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ refreshToken })
      .expect(204);

    // Family revoked on live PG.
    const live = await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } });
    expect(live).toBe(0);

    // The revoked refresh can no longer be rotated.
    await request(server()).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('(c2) /auth/logout WITHOUT a token revokes ALL sessions for the user', async () => {
    const uid = await mkUser('Refresh LogoutAll');
    const s1 = await session(uid);
    await session(uid); // a second device/family
    expect(await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } })).toBe(2);

    await request(server())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${s1.accessToken}`)
      .send({})
      .expect(204);

    expect(await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } })).toBe(0);
  });

  it('rejects a garbage / unknown refresh token with 401 (no family, no leak)', async () => {
    const res = await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'not-a-real-token' })
      .expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('refresh of a session whose account was deactivated → 401 (re-checks account on rotate)', async () => {
    const uid = await mkUser('Refresh Deactivated');
    const { refreshToken } = await session(uid);
    // Deactivate the account directly (also fires the user-deactivation cascade, harmless here).
    await prisma.users.update({ where: { id: uid }, data: { status: 'DEACTIVATED', is_active: false, deactivated_at: new Date() } });

    const res = await request(server()).post('/v1/auth/refresh').send({ refreshToken }).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    // The rotation family is revoked when the account is found unusable.
    expect(await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } })).toBe(0);
  });
});
