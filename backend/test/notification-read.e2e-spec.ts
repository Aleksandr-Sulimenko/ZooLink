/**
 * Slice H3 / AUDIT4 P2-5 — GET /v1/me/notifications (the IN_APP read side) against the real HTTP stack.
 * The IN_APP write path (worker consumer) is proven separately in notification-consumer.e2e-spec.ts; here
 * we seed IN_APP `notification_logs` rows directly and prove the READ contract:
 *   - own-scope only (a user sees ONLY their own IN_APP rows — IDOR closed; no operator widening)
 *   - IN_APP channel only (EMAIL/SMS delivery logs never leak into the personal inbox)
 *   - {items, meta: PageMeta} pagination + newest-first + ETag / If-None-Match → 304
 * e2e hits HOST pg (localhost).
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
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

describe('GET /me/notifications (P2-5, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const users: string[] = [];
  let aliceId: string;
  let bobId: string;
  let aliceTok: string;
  let bobTok: string;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const mkUser = async (name: string): Promise<string> => {
    const u = await prisma.users.create({ data: { full_name: name, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    users.push(u.id);
    return u.id;
  };

  /** Seed a notification_logs row (channel = type) for `userId`. */
  const seedNotif = (userId: string, type: string, content: string): Promise<{ id: string }> =>
    prisma.notification_logs.create({
      data: { user_id: userId, type, recipient: userId, content, status: 'SENT', idempotency_key: randomUUID() },
    });

  const list = (tok: string, qs = '') =>
    request(server()).get(`/v1/me/notifications${qs}`).set('Authorization', `Bearer ${tok}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = app.get(PrismaService);

    aliceId = await mkUser('NotifAlice');
    bobId = await mkUser('NotifBob');
    [aliceTok, bobTok] = await Promise.all([devToken(aliceId), devToken(bobId)]);

    // Alice: 2 IN_APP rows + 1 EMAIL row (must be filtered out). Bob: 1 IN_APP row (own-scope isolation).
    await seedNotif(aliceId, 'IN_APP', 'Your listing was approved');
    await seedNotif(aliceId, 'IN_APP', 'A transfer was initiated');
    await seedNotif(aliceId, 'EMAIL', 'Email delivery log — not an inbox item');
    await seedNotif(bobId, 'IN_APP', "Bob's private notification");
  });

  afterAll(async () => {
    await prisma.notification_logs.deleteMany({ where: { user_id: { in: users } } }).catch(() => undefined);
    for (const id of users) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it('returns the caller-own IN_APP rows only (EMAIL filtered), newest-first, with PageMeta + ETag', async () => {
    const res = await list(aliceTok).expect(200);
    expect(res.headers['etag']).toMatch(/^W\//);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.meta).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(res.body.items).toHaveLength(2); // the EMAIL row is excluded
    for (const item of res.body.items) expect(item.type).toBe('IN_APP');
    // Newest-first: the transfer row was seeded last → appears first.
    expect(res.body.items[0].content).toBe('A transfer was initiated');
  });

  it("own-scope: Bob never sees Alice's notifications and vice-versa (IDOR closed)", async () => {
    const res = await list(bobTok).expect(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].content).toBe("Bob's private notification");
  });

  it('honours If-None-Match → 304 when the inbox is unchanged', async () => {
    const first = await list(aliceTok).expect(200);
    const etag = first.headers['etag'];
    await list(aliceTok).set('If-None-Match', etag).expect(304);
  });

  it('paginates via page/limit', async () => {
    const res = await list(aliceTok, '?page=1&limit=1').expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
  });

  it('rejects an unauthenticated request', async () => {
    await request(server()).get('/v1/me/notifications').expect(401);
  });
});
