/**
 * Refresh-token rotation + reuse/theft detection end-to-end (spec 01 round-4 normative), now over the
 * HttpOnly-cookie transport (API_CONVENTIONS §2 / AUDIT3 security.md #2). The refresh token lives in
 * a `refresh_token` HttpOnly+Secure+SameSite=Strict cookie scoped to /v1/auth and is NEVER in the
 * JSON body — closing the XSS-exfil ATO chain. This suite verifies: (a) rotation, (b) reuse→family
 * burn, (c) logout revoke, plus the cookie-transport negatives (missing cookie → 401; body never
 * leaks the refresh token; cookie attributes are hardened).
 *
 * Drives the real HTTP stack (PG + Redis). dev-token mints a real DB-backed session (returns the
 * refresh cookie). e2e hits HOST pg/redis (localhost); flush host redis if stale 429s.
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

/** The `refresh_token=<value>` pair from a Set-Cookie response, ready to resend as a Cookie header. */
const refreshCookie = (res: request.Response): string => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const found = (raw ?? []).find((c) => c.startsWith('refresh_token='));
  if (!found) throw new Error('no refresh_token Set-Cookie on response');
  return found.split(';')[0]; // "refresh_token=abc"
};
const rawSetCookie = (res: request.Response): string => {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return (raw ?? []).find((c) => c.startsWith('refresh_token=')) ?? '';
};

describe('Auth refresh-token rotation/reuse over HttpOnly cookie (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const userIds: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;

  /** Mint a real DB-backed session; returns the access token (body) + the refresh cookie pair. */
  const session = async (uid: string): Promise<{ accessToken: string; cookie: string }> => {
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201);
    expect(res.body.refreshToken).toBeUndefined(); // INVARIANT: refresh never in the body
    return { accessToken: res.body.accessToken as string, cookie: refreshCookie(res) };
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

  it('dev-token sets a hardened refresh cookie (HttpOnly, Secure, SameSite=Strict, Path=/v1/auth)', async () => {
    const uid = await mkUser('Cookie Attrs');
    const res = await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201);
    const cookie = rawSetCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/v1\/auth/i);
    expect(res.body.accessToken).toEqual(expect.any(String));
  });

  it('(a) a valid refresh rotates → 200 + a NEW cookie; the OLD cookie is revoked (replay → 401)', async () => {
    const uid = await mkUser('Refresh Rotate');
    const { cookie: original } = await session(uid);

    const rot = await request(server()).post('/v1/auth/refresh').set('Cookie', original).expect(200);
    expect(rot.body.accessToken).toEqual(expect.any(String));
    expect(rot.body.refreshToken).toBeUndefined(); // INVARIANT: not echoed in body
    const rotated = refreshCookie(rot);
    expect(rotated).not.toBe(original); // rotated, not the same value

    // The presented (now-rotated) cookie is revoked: replaying it is rejected.
    const replay = await request(server()).post('/v1/auth/refresh').set('Cookie', original).expect(401);
    expect(replay.headers['content-type']).toContain('application/problem+json');
    expect(replay.body.code).toBe('UNAUTHENTICATED');
  });

  it('(b) replaying a rotated cookie detects reuse and burns the WHOLE family (siblings revoked on live PG)', async () => {
    const uid = await mkUser('Refresh Reuse');
    const { cookie: original } = await session(uid);

    const rot = await request(server()).post('/v1/auth/refresh').set('Cookie', original).expect(200);
    const child = refreshCookie(rot);

    const liveBefore = await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } });
    expect(liveBefore).toBe(1);

    // Replay the ALREADY-ROTATED original → reuse/theft → 401 + burn the family.
    const reuse = await request(server()).post('/v1/auth/refresh').set('Cookie', original).expect(401);
    expect(reuse.body.code).toBe('UNAUTHENTICATED');

    const rows = await prisma.refresh_tokens.findMany({ where: { user_id: uid } });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.revoked_at !== null)).toBe(true);

    // The previously-good child is now unusable too (family burned).
    const childReuse = await request(server()).post('/v1/auth/refresh').set('Cookie', child).expect(401);
    expect(childReuse.body.code).toBe('UNAUTHENTICATED');
  });

  it('(c) /auth/logout with the refresh cookie revokes its family + clears the cookie; later refresh → 401', async () => {
    const uid = await mkUser('Refresh Logout');
    const { accessToken, cookie } = await session(uid);

    const out = await request(server())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', cookie)
      .expect(204);
    // The response clears the cookie (Max-Age=0 / Expires in the past).
    expect(rawSetCookie(out)).toMatch(/Max-Age=0|Expires=/i);

    const live = await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } });
    expect(live).toBe(0);

    await request(server()).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('(c2) /auth/logout WITHOUT a cookie revokes ALL sessions for the user', async () => {
    const uid = await mkUser('Refresh LogoutAll');
    const s1 = await session(uid);
    await session(uid); // a second device/family
    expect(await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } })).toBe(2);

    await request(server())
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${s1.accessToken}`)
      .expect(204);

    expect(await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } })).toBe(0);
  });

  it('refresh with NO cookie → 401 (token is read only from the cookie, never the body)', async () => {
    const res = await request(server())
      .post('/v1/auth/refresh')
      .send({ refreshToken: 'ignored-body-value' }) // body is NOT a valid transport anymore
      .expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a garbage / unknown refresh cookie with 401 (no family, no leak)', async () => {
    const res = await request(server())
      .post('/v1/auth/refresh')
      .set('Cookie', 'refresh_token=not-a-real-token')
      .expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
  });

  it('refresh of a session whose account was deactivated → 401 (re-checks account on rotate)', async () => {
    const uid = await mkUser('Refresh Deactivated');
    const { cookie } = await session(uid);
    await prisma.users.update({ where: { id: uid }, data: { status: 'DEACTIVATED', is_active: false, deactivated_at: new Date() } });

    const res = await request(server()).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(await prisma.refresh_tokens.count({ where: { user_id: uid, revoked_at: null } })).toBe(0);
  });
});
