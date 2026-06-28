/**
 * Slice 4b — content reports (moderation-api.yaml `/content-reports`, invariants CR-1..CR-12) end-to-end
 * against the real stack (PG + Redis). Proves server-derived reporter (CR-1), DB-enforced dedup (CR-2),
 * entity existence + MESSAGE gate (CR-3), file authz (CR-4), read-scope no-leak (CR-5), resolve authz
 * (CR-6), transition legality + terminal immutability incl. concurrency (CR-7/CR-8), in-tx audit (CR-9),
 * If-Match (CR-10), and reason/entity-type enums (CR-11). e2e hits HOST pg/redis (localhost); flush host
 * redis if stale 429s.
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
import { resetThrottle } from './throttle-reset.util';

describe('Slice 4b — content reports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const reportIds: string[] = [];
  let reporterId: string;
  let otherId: string;
  let modId: string;
  let targetUserId: string;
  let reporterTok: string;
  let otherTok: string;
  let modTok: string;
  const suffix = Math.random().toString(36).slice(2, 8);

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const file = (tok: string, body: Record<string, unknown>, key = randomUUID()) =>
    request(server()).post('/v1/content-reports').set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', key).send(body);
  // A throwaway USER to report, so each test targets a distinct (reporter, entity) pair and never
  // trips the dedup unique-OPEN constraint against another test's report.
  const targetUsers: string[] = [];
  const freshTarget = async (): Promise<string> => {
    const u = await prisma.users.create({ data: { full_name: `CRTgt_${randomUUID().slice(0, 8)}`, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    targetUsers.push(u.id);
    return u.id;
  };
  const idOf = (res: { body: { id?: unknown } }): string => res.body.id as string;
  const track = (res: { body: { id?: unknown } }): string => {
    const id = idOf(res);
    reportIds.push(id);
    return id;
  };
  const getEtag = async (tok: string, id: string): Promise<string> => {
    const r = await request(server()).get(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${tok}`).expect(200);
    return r.headers['etag'];
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

    const mk = (n: string, role: string) => prisma.users.create({ data: { full_name: n, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    reporterId = (await mk('CRReporter', 'USER')).id;
    otherId = (await mk('CROther', 'USER')).id;
    modId = (await mk('CRMod', 'MODERATOR')).id;
    targetUserId = (await mk(`CRTarget_${suffix}`, 'USER')).id; // a USER target to report
    [reporterTok, otherTok, modTok] = await Promise.all([devToken(reporterId), devToken(otherId), devToken(modId)]);
  });

  // Filing is throttled (report-spam protection, 10/15min); the throttle itself is unit-tested, so we
  // reset the throttle slate before each test to keep the business-flow assertions deterministic.
  beforeEach(async () => {
    await resetThrottle(app);
  });

  afterAll(async () => {
    for (const id of reportIds) await prisma.content_reports.delete({ where: { id } }).catch(() => undefined);
    await prisma.content_reports.deleteMany({ where: { entity_id: { in: [targetUserId, otherId, ...targetUsers] } } }).catch(() => undefined);
    for (const id of targetUsers) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    for (const id of [reporterId, otherId, modId, targetUserId]) if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── CR-4 file authz ───────────────────────────────────────────────────────────────────────────
  it('CR-4: an unauthenticated file → 401', async () => {
    await request(server()).post('/v1/content-reports').set('Idempotency-Key', randomUUID()).send({ entityType: 'USER', entityId: targetUserId, reason: 'SPAM' }).expect(401);
  });

  // ── CR-1 server-derived reporter ──────────────────────────────────────────────────────────────
  it('CR-1: files a report (OPEN); a body reporterId is rejected 400; reporter = the actor', async () => {
    await file(reporterTok, { entityType: 'USER', entityId: targetUserId, reason: 'SPAM', reporterId: otherId }).expect(400); // unknown field
    const res = await file(reporterTok, { entityType: 'USER', entityId: targetUserId, reason: 'ABUSE' }).expect(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.reporterId).toBe(reporterId);
    track(res);
  });

  // ── CR-2 dedup ────────────────────────────────────────────────────────────────────────────────
  it('CR-2: a second OPEN report on the same target by the same reporter → 409 DUPLICATE_REPORT', async () => {
    const dup = await file(reporterTok, { entityType: 'USER', entityId: targetUserId, reason: 'FRAUD' }).expect(409);
    expect(dup.body.code).toBe('DUPLICATE_REPORT');
    // A DIFFERENT reporter on the same target is allowed.
    const other = await file(otherTok, { entityType: 'USER', entityId: targetUserId, reason: 'SPAM' }).expect(201);
    track(other);
  });

  it('CR-2 (after-terminal): once a prior report is resolved (terminal), the same reporter may file again (201)', async () => {
    // The dedup index is partial `WHERE status='OPEN'`, so only an OPEN prior blocks a new report —
    // a DISMISSED/ACTIONED prior on the same (reporter, entity_type, entity_id) must NOT block.
    const target = await freshTarget();
    const first = track(await file(reporterTok, { entityType: 'USER', entityId: target, reason: 'SPAM' }).expect(201));
    // A MOD resolves it to a terminal state.
    const etag = await getEtag(modTok, first);
    await request(server()).patch(`/v1/content-reports/${first}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', etag).send({ status: 'DISMISSED' }).expect(200);
    // The same reporter files again on the same target → 201 (the terminal prior does not block).
    const again = await file(reporterTok, { entityType: 'USER', entityId: target, reason: 'ABUSE' }).expect(201);
    expect(again.body.status).toBe('OPEN');
    expect(again.body.id).not.toBe(first);
    track(again);
  });

  // ── CR-3 entity existence + MESSAGE gate; CR-11 enums ─────────────────────────────────────────
  it('CR-3: a MESSAGE report → 422 ENTITY_TYPE_UNAVAILABLE; a non-existent target → 404', async () => {
    const msg = await file(reporterTok, { entityType: 'MESSAGE', entityId: randomUUID(), reason: 'SPAM' }).expect(422);
    expect(msg.body.code).toBe('ENTITY_TYPE_UNAVAILABLE');
    await file(reporterTok, { entityType: 'LISTING', entityId: randomUUID(), reason: 'SPAM' }).expect(404);
  });

  it('CR-11: an unknown reason / entity_type → 400 (enum)', async () => {
    await file(reporterTok, { entityType: 'USER', entityId: targetUserId, reason: 'NONSENSE' }).expect(400);
    await file(reporterTok, { entityType: 'PLANET', entityId: targetUserId, reason: 'SPAM' }).expect(400);
  });

  // ── CR-5 read-scope ───────────────────────────────────────────────────────────────────────────
  it('CR-5: a USER lists only their own; a non-owner USER GET/{id} → 404 (no leak); MOD sees all', async () => {
    const mine = track(await file(reporterTok, { entityType: 'USER', entityId: otherId, reason: 'INAPPROPRIATE' }).expect(201));
    // reporter lists — sees their own report; otherId-as-reporter filter cannot widen.
    const list = await request(server()).get(`/v1/content-reports?reporter_id=${otherId}&limit=100`).set('Authorization', `Bearer ${reporterTok}`).expect(200);
    for (const r of list.body.items as { reporterId: string }[]) expect(r.reporterId).toBe(reporterId);
    // a different USER cannot read the reporter's report → 404 (no existence leak).
    await request(server()).get(`/v1/content-reports/${mine}`).set('Authorization', `Bearer ${otherTok}`).expect(404);
    // the reporter can; a MODERATOR can.
    await request(server()).get(`/v1/content-reports/${mine}`).set('Authorization', `Bearer ${reporterTok}`).expect(200);
    await request(server()).get(`/v1/content-reports/${mine}`).set('Authorization', `Bearer ${modTok}`).expect(200);
  });

  // ── CR-6 resolve authz ────────────────────────────────────────────────────────────────────────
  it('CR-6: a USER (incl. the reporter) cannot resolve → 403; a MODERATOR can', async () => {
    const id = track(await file(reporterTok, { entityType: 'USER', entityId: await freshTarget(), reason: 'OTHER' }).expect(201));
    const etag = await getEtag(reporterTok, id);
    await request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${reporterTok}`).set('If-Match', etag).send({ status: 'DISMISSED' }).expect(403);
    const modEtag = await getEtag(modTok, id);
    const res = await request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', modEtag).send({ status: 'REVIEWED' }).expect(200);
    expect(res.body.status).toBe('REVIEWED');
    expect(res.body.resolvedBy.actorId).toBe(modId);
    expect(res.body.resolvedBy).toHaveProperty('principalType');
  });

  // ── CR-9 audit + CR-7 transitions ─────────────────────────────────────────────────────────────
  it('CR-9: resolve writes resolved_by + an audit row in one tx', async () => {
    const id = track(await file(otherTok, { entityType: 'USER', entityId: await freshTarget(), reason: 'ABUSE' }).expect(201));
    const etag = await getEtag(modTok, id);
    await request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', etag).send({ status: 'ACTIONED' }).expect(200);
    const row = await prisma.content_reports.findUnique({ where: { id } });
    expect(row?.status).toBe('ACTIONED');
    expect(row?.resolved_by).toBe(modId);
    const audit = await prisma.audit_log.findMany({ where: { entity_id: id, action: 'content_report.actioned' } });
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(modId);
  });

  // ── CR-8 terminal immutability + CR-10 If-Match ───────────────────────────────────────────────
  it('CR-8/CR-10: resolve on a terminal report → 409 REPORT_TERMINAL; missing/stale If-Match → 428/412', async () => {
    const id = track(await file(reporterTok, { entityType: 'USER', entityId: await freshTarget(), reason: 'SPAM' }, randomUUID()).expect(201));
    let etag = await getEtag(modTok, id);
    await request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${modTok}`).send({ status: 'DISMISSED' }).expect(428); // missing If-Match
    await request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', 'W/"x"').send({ status: 'DISMISSED' }).expect(412); // stale
    await request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', etag).send({ status: 'DISMISSED' }).expect(200);
    // now terminal → 409.
    etag = await getEtag(modTok, id);
    const term = await request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', etag).send({ status: 'ACTIONED' }).expect(409);
    expect(term.body.code).toBe('REPORT_TERMINAL');
  });

  // ── CR-8 concurrency: double-resolve single-winner ────────────────────────────────────────────
  it('CR-8 concurrency: two parallel resolves (same ETag) → exactly one 200, one 409/412; single final status', async () => {
    const id = track(await file(otherTok, { entityType: 'USER', entityId: await freshTarget(), reason: 'FRAUD' }).expect(201));
    const etag = await getEtag(modTok, id);
    const fire = (status: string) => request(server()).patch(`/v1/content-reports/${id}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', etag).send({ status });
    const [a, b] = await Promise.all([fire('DISMISSED'), fire('ACTIONED')]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 412]).toContain(statuses[1]); // loser: lost the guarded claim (409) or stale ETag (412)
    const row = await prisma.content_reports.findUnique({ where: { id } });
    expect(['DISMISSED', 'ACTIONED']).toContain(row?.status); // exactly one terminal status, not a mix
  });
});
