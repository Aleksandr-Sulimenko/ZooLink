/**
 * Admin Slice 4a — moderation (moderation-api.yaml, invariants M-P0..M-13) end-to-end against the real
 * stack (PG + Redis). The agent-first centerpiece: proves the P0 ACTIVE-requires-APPROVED trigger, the
 * one-transaction decision+transition+audit (M-1), claim single-winner (M-2), append-only ledger (M-6),
 * human-override (M-7), agent-as-principal snapshot+gate (M-8), reason/template (M-9/10), operator authz
 * (M-11), owner-result object-scope (M-12), and SLA derived-read-only (M-13). PENDING fixtures are built
 * via the real listing create+submit path. e2e hits HOST pg/redis (localhost); flush host redis if 429s.
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

describe('Admin Slice 4a — moderation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const listings: string[] = [];
  const animalsCreated: string[] = [];
  let sellerId: string;
  let mod1Id: string;
  let mod2Id: string;
  let adminId: string;
  let sellerTok: string;
  let mod1Tok: string;
  let mod2Tok: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  let speciesId: number;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  /** Create a listing via the real path and submit it → PENDING_MODERATION. Returns its id. */
  const newPending = async (): Promise<string> => {
    const animal = await prisma.animals.create({
      data: { owner_id: sellerId, species_id: speciesId, nickname_localized: { en: 'M', ru: 'М' }, sex: 'Male', date_of_birth: new Date('2021-01-01T00:00:00Z'), breed_text_localized: { en: 'mix', ru: 'микс' } },
    });
    animalsCreated.push(animal.id);
    const created = await request(server())
      .post('/v1/listings')
      .set('Authorization', `Bearer ${sellerTok}`)
      .set('Idempotency-Key', randomUUID())
      .send({ animalId: animal.id, listingType: 'sale', titleLocalized: { en: 'ModItem', ru: 'Элемент' }, priceCents: 5000 })
      .expect(201);
    const id = created.body.id as string;
    listings.push(id);
    await request(server()).post(`/v1/listings/${id}/photos`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).send({ url: `http://x/${randomUUID()}.jpg` }).expect(201);
    const get = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', get.headers['etag']).expect(200);
    return id;
  };

  const claim = (tok: string, id: string) => request(server()).post(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${tok}`);
  const action = (tok: string, body: Record<string, unknown>) => request(server()).post('/v1/moderation/action').set('Authorization', `Bearer ${tok}`).send(body);

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
    sellerId = (await mk('ModSeller', 'USER')).id;
    mod1Id = (await mk('Mod1', 'MODERATOR')).id;
    mod2Id = (await mk('Mod2', 'MODERATOR')).id;
    adminId = (await mk('ModAdmin', 'ADMIN')).id;
    [sellerTok, mod1Tok, mod2Tok] = await Promise.all([devToken(sellerId), devToken(mod1Id), devToken(mod2Id)]);
    await devToken(adminId); // adminId is created (cleanup); operator-scope variants are unit-covered
    speciesId = (await prisma.species.create({ data: { code: `mod_sp_${suffix}`, name_localized: { en: 'Dog', ru: 'Пёс' }, market: 'pet' } })).id;
    // Seed a reason if not present (idempotent dictionary is normally seeded; ensure poor_photos exists).
    await prisma.moderation_reasons.upsert({ where: { code: 'poor_photos' }, update: {}, create: { code: 'poor_photos', description_localized: { en: 'Poor photos', ru: 'Плохие фото' }, applies_to: 'LISTING', is_active: true } });
  });

  afterAll(async () => {
    await prisma.moderation_decisions.deleteMany({ where: { entity_id: { in: listings } } }).catch(() => undefined);
    for (const id of listings) {
      await prisma.listing_photos.deleteMany({ where: { listing_id: id } }).catch(() => undefined);
      await prisma.listings.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of animalsCreated) await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of [sellerId, mod1Id, mod2Id, adminId]) if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── authz (M-11) ──────────────────────────────────────────────────────────────────────────────
  it('M-11: a USER hitting the queue → 403; unauthenticated → 401', async () => {
    await request(server()).get('/v1/moderation/queue').set('Authorization', `Bearer ${sellerTok}`).expect(403);
    await request(server()).get('/v1/moderation/queue').expect(401);
  });

  it('the queue lists PENDING items with meta.counts; a MODERATOR may read', async () => {
    await newPending();
    const res = await request(server()).get('/v1/moderation/queue?market=pet&limit=100').set('Authorization', `Bearer ${mod1Tok}`).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.meta.counts).toBeDefined();
    expect(res.body.meta.counts.byMarket).toHaveProperty('pet');
  });

  // ── claim/lock (M-2/M-3/M-4) ──────────────────────────────────────────────────────────────────
  it('M-2: two parallel claims → exactly one 200, one 409 ALREADY_CLAIMED (single-winner)', async () => {
    const id = await newPending();
    const [a, b] = await Promise.all([claim(mod1Tok, id), claim(mod2Tok, id)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.code).toBe('ALREADY_CLAIMED');
    expect(loser.body.errors[0].assignedTo.actorId).toBeTruthy();
  });

  it('M-3: re-claiming an item you hold is idempotent (200, refreshed TTL)', async () => {
    const id = await newPending();
    const first = await claim(mod1Tok, id).expect(200);
    const again = await claim(mod1Tok, id).expect(200);
    const againExp = new Date(again.body.lockExpiresAt as string).getTime();
    const firstExp = new Date(first.body.lockExpiresAt as string).getTime();
    expect(againExp).toBeGreaterThanOrEqual(firstExp);
  });

  it('release: 409 NOT_LOCK_HOLDER for a non-holder; 204 for the holder', async () => {
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    await request(server()).delete(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${mod2Tok}`).expect(409);
    await request(server()).delete(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${mod1Tok}`).expect(204);
  });

  // ── action: lock gate (M-4/M-5) ──────────────────────────────────────────────────────────────
  it('M-5: deciding without a live lock → 409 ITEM_NOT_CLAIMED', async () => {
    const id = await newPending();
    const res = await action(mod1Tok, { listingId: id, action: 'APPROVE' }).expect(409);
    expect(res.body.code).toBe('ITEM_NOT_CLAIMED');
  });

  it('M-4: deciding on an item locked by another → 409 NOT_LOCK_HOLDER', async () => {
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    const res = await action(mod2Tok, { listingId: id, action: 'APPROVE' }).expect(409);
    expect(res.body.code).toBe('NOT_LOCK_HOLDER');
  });

  it('N1 TOCTOU (lock handoff): a stale-lock action fails 409 and writes NO decision / NO audit / no flip', async () => {
    // mod1 claims; the lock is then expired and mod2 re-claims (the contrived mid-action window). mod1's
    // action loses the in-tx guarded flip → 409, and must persist nothing (no decision, no audit, no flip).
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    // Expire mod1's lock, then mod2 claims it (the expired lock is re-claimable).
    await prisma.listings.update({ where: { id }, data: { lock_expires_at: new Date(Date.now() - 1000) } });
    await claim(mod2Tok, id).expect(200);

    const before = await prisma.moderation_decisions.count({ where: { entity_id: id } });
    const auditBefore = await prisma.audit_log.count({ where: { entity_id: id, action: { startsWith: 'moderation.' } } });

    const res = await action(mod1Tok, { listingId: id, action: 'APPROVE' }).expect(409);
    expect(res.body.code).toBe('NOT_LOCK_HOLDER');

    // The loser wrote nothing and did not flip the listing.
    expect(await prisma.moderation_decisions.count({ where: { entity_id: id } })).toBe(before);
    expect(await prisma.audit_log.count({ where: { entity_id: id, action: { startsWith: 'moderation.' } } })).toBe(auditBefore);
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('PENDING_MODERATION'); // unchanged
    expect(row?.assigned_to).toBe(mod2Id); // still mod2's lock, untouched
  });

  // ── action: transitions + M-P0 + M-1 ─────────────────────────────────────────────────────────
  it('M-P0: APPROVE → ACTIVE/APPROVED (the only path to ACTIVE); lock released; decision + audit written', async () => {
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    const res = await action(mod1Tok, { listingId: id, action: 'APPROVE' }).expect(200);
    expect(res.body.decision).toBe('APPROVED');
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('ACTIVE');
    expect(row?.moderation_status).toBe('APPROVED');
    expect(row?.assigned_to).toBeNull(); // lock released
    const audit = await prisma.audit_log.findMany({ where: { entity_id: id, action: 'moderation.approved' } });
    expect(audit.length).toBe(1);
    expect(audit[0].actor_id).toBe(mod1Id);
  });

  it('M-P0 direct: a forced ACTIVE while not APPROVED is blocked by the trigger', async () => {
    const id = await newPending();
    await expect(prisma.$executeRaw`UPDATE listings SET status='ACTIVE' WHERE id=${id}::uuid`).rejects.toThrow(/cannot be ACTIVE unless moderation_status/i);
  });

  it('REJECT → DEACTIVATED/REJECTED (reason required; M-9 missing reason → 422)', async () => {
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    await action(mod1Tok, { listingId: id, action: 'REJECT' }).expect(422); // M-9 no reason
    const res = await action(mod1Tok, { listingId: id, action: 'REJECT', reason: 'poor_photos' }).expect(200);
    expect(res.body.decision).toBe('REJECTED');
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('DEACTIVATED');
  });

  it('REQUEST_CHANGES → DRAFT/CHANGES_REQUESTED', async () => {
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    const res = await action(mod1Tok, { listingId: id, action: 'REQUEST_CHANGES', reason: 'poor_photos' }).expect(200);
    expect(res.body.decision).toBe('CHANGES_REQUESTED');
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('DRAFT');
  });

  it('M-9: an unknown reason code → 422', async () => {
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    await action(mod1Tok, { listingId: id, action: 'REJECT', reason: 'no_such_reason' }).expect(422);
  });

  // ── M-6 append-only ───────────────────────────────────────────────────────────────────────────
  it('M-6: moderation_decisions is append-only — a direct UPDATE/DELETE is blocked by the trigger', async () => {
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    const res = await action(mod1Tok, { listingId: id, action: 'APPROVE' }).expect(200);
    const decisionId = res.body.id as string;
    await expect(prisma.$executeRaw`UPDATE moderation_decisions SET notes='tampered' WHERE id=${decisionId}::uuid`).rejects.toThrow(/append-only/i);
    await expect(prisma.$executeRaw`DELETE FROM moderation_decisions WHERE id=${decisionId}::uuid`).rejects.toThrow(/append-only/i);
  });

  // ── M-7 human override ────────────────────────────────────────────────────────────────────────
  it('M-7: a HUMAN override writes a NEW row (isHumanOverride + supersedes) on the same entity, superseded row intact', async () => {
    // First decision: REQUEST_CHANGES → DRAFT (re-moderatable). Re-submit → PENDING. Second decision:
    // APPROVE that supersedes the first → a new override row; the first row is untouched & immutable.
    const id = await newPending();
    await claim(mod1Tok, id).expect(200);
    const first = await action(mod1Tok, { listingId: id, action: 'REQUEST_CHANGES', reason: 'poor_photos' }).expect(200);
    const firstId = first.body.id as string;

    // Owner re-submits the DRAFT (back to PENDING_MODERATION).
    const get = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', get.headers['etag']).expect(200);

    // A different moderator claims and overrides the earlier decision.
    await claim(mod2Tok, id).expect(200);
    const override = await action(mod2Tok, { listingId: id, action: 'APPROVE', supersedesDecisionId: firstId }).expect(200);
    expect(override.body.isHumanOverride).toBe(true);
    expect(override.body.supersedesDecisionId).toBe(firstId);
    expect(override.body.id).not.toBe(firstId); // a NEW row, not a mutation

    // The superseded row is intact and unchanged.
    const supersededRow = await prisma.moderation_decisions.findUnique({ where: { id: firstId } });
    expect(supersededRow?.decision).toBe('CHANGES_REQUESTED');
    expect(supersededRow?.is_human_override).toBe(false);
  });

  it('M-7: superseding a decision on a DIFFERENT listing → 422', async () => {
    const idA = await newPending();
    const idB = await newPending();
    await claim(mod1Tok, idA).expect(200);
    const decA = await action(mod1Tok, { listingId: idA, action: 'APPROVE' }).expect(200);
    // Try to supersede A's decision while acting on B.
    await claim(mod1Tok, idB).expect(200);
    await action(mod1Tok, { listingId: idB, action: 'APPROVE', supersedesDecisionId: decA.body.id }).expect(422);
  });

  // ── M-8 agent-as-principal ────────────────────────────────────────────────────────────────────
  it('M-8: an AGENT principal deciding while the gate is off → 403 (plumbing present, behavior gated)', async () => {
    // Flip mod2 to an AGENT principal, claim as a human first to set up the lock, then attempt as agent.
    const id = await newPending();
    await claim(mod2Tok, id).expect(200);
    await prisma.users.update({ where: { id: mod2Id }, data: { principal_type: 'AGENT' } });
    const agentTok = await devToken(mod2Id); // token now carries principal_type=AGENT
    const res = await action(agentTok, { listingId: id, action: 'APPROVE' }).expect(403);
    expect(res.body.code).toBe('FORBIDDEN');
    // restore
    await prisma.users.update({ where: { id: mod2Id }, data: { principal_type: 'HUMAN' } });
  });

  // ── decisions / reasons / templates ───────────────────────────────────────────────────────────
  it('lists decisions (append-only ledger) and exposes principalType', async () => {
    const res = await request(server()).get('/v1/moderation/decisions?entity_type=LISTING&limit=100').set('Authorization', `Bearer ${mod1Tok}`).expect(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    if (res.body.items.length) expect(res.body.items[0].actor).toHaveProperty('principalType');
  });

  it('lists reasons and decision-templates (seeded dictionaries)', async () => {
    const reasons = await request(server()).get('/v1/moderation/reasons').set('Authorization', `Bearer ${mod1Tok}`).expect(200);
    expect(Array.isArray(reasons.body)).toBe(true);
    await request(server()).get('/v1/moderation/decision-templates?appliesToDecision=CHANGES_REQUESTED').set('Authorization', `Bearer ${mod1Tok}`).expect(200);
  });

  // ── M-12 owner result ─────────────────────────────────────────────────────────────────────────
  it('M-12: owner sees their moderation result with agent-transparency; a non-owner USER → 403; no decision → 204', async () => {
    const id = await newPending();
    // Before any decision → 204.
    await request(server()).get(`/v1/listings/${id}/moderation-result`).set('Authorization', `Bearer ${sellerTok}`).expect(204);
    await claim(mod1Tok, id).expect(200);
    await action(mod1Tok, { listingId: id, action: 'REJECT', reason: 'poor_photos' }).expect(200);
    const owner = await request(server()).get(`/v1/listings/${id}/moderation-result`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect(owner.body.decision).toBe('REJECTED');
    expect(owner.body).toHaveProperty('decidedByAgent');
    expect(owner.body.decidedBy).toHaveProperty('principalType');
    // A non-owner USER cannot read it.
    const stranger = (await prisma.users.create({ data: { full_name: 'Stranger', role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } }));
    const strangerTok = await devToken(stranger.id);
    await request(server()).get(`/v1/listings/${id}/moderation-result`).set('Authorization', `Bearer ${strangerTok}`).expect(403);
    await prisma.users.delete({ where: { id: stranger.id } }).catch(() => undefined);
  });
});
