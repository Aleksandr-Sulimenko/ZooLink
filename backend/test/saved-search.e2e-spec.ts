/**
 * Listings Slice 3 — saved searches (geo-search-api.yaml `/saved-searches`, spec 07 round-5 SS-1..SS-6)
 * end-to-end against the real stack (PG + Redis). Proves own-scope reads (SS-1), 404-no-leak delete
 * (SS-2), the bounded `filters` whitelist incl. size cap + price coherence (SS-3), lat/lng/radius
 * coherence + bounds (SS-4), the {items, meta: PageMeta} envelope + sort whitelist (SS-5), and
 * Idempotency-Key as the only dedup (SS-6). e2e hits HOST pg/redis (localhost).
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

describe('Listings Slice 3 — saved searches (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let aliceId: string;
  let bobId: string;
  let modId: string;
  let vetId: string;
  let aliceTok: string;
  let bobTok: string;
  let modTok: string;
  let vetTok: string;
  const createdIds: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const save = (tok: string, body: Record<string, unknown>, key = randomUUID()) =>
    request(server()).post('/v1/saved-searches').set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', key).send(body);
  const track = (res: { body: { id?: unknown } }): string => {
    const id = res.body.id as string;
    if (id) createdIds.push(id);
    return id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = app.get(PrismaService);

    const mk = (n: string, role: string) => prisma.users.create({ data: { full_name: n, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    aliceId = (await mk('SSAlice', 'USER')).id;
    bobId = (await mk('SSBob', 'USER')).id;
    modId = (await mk('SSMod', 'MODERATOR')).id;
    vetId = (await mk('SSVet', 'VETERINARIAN')).id; // "USER + extra capabilities" — inherits the saved-search capability
    [aliceTok, bobTok, modTok, vetTok] = await Promise.all([devToken(aliceId), devToken(bobId), devToken(modId), devToken(vetId)]);
  });

  afterAll(async () => {
    await prisma.saved_searches.deleteMany({ where: { user_id: { in: [aliceId, bobId, modId, vetId] } } }).catch(() => undefined);
    for (const id of [aliceId, bobId, modId, vetId]) if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── auth gate ─────────────────────────────────────────────────────────────────────────────────
  it('an unauthenticated request → 401 on list, create, delete', async () => {
    await request(server()).get('/v1/saved-searches').expect(401);
    await request(server()).post('/v1/saved-searches').set('Idempotency-Key', randomUUID()).send({ filters: {} }).expect(401);
    await request(server()).delete(`/v1/saved-searches/${randomUUID()}`).expect(401);
  });

  // ── SS-1 own-scope + SS-5 envelope ──────────────────────────────────────────────────────────────
  it('SS-1/SS-5: create + own-scope list with the {items, meta: PageMeta} envelope; owner = the actor', async () => {
    const res = await save(aliceTok, { name: 'corgis near me', filters: { market: 'pet', species_id: 1 }, lat: 55.75, lng: 37.61, radiusM: 5000 }).expect(201);
    expect(res.body.userId).toBe(aliceId); // server-derived owner
    expect(res.body.filters).toEqual({ market: 'pet', species_id: 1 }); // stored verbatim
    expect(res.body.radiusM).toBe(5000);
    track(res);

    const list = await request(server()).get('/v1/saved-searches?limit=100').set('Authorization', `Bearer ${aliceTok}`).expect(200);
    expect(Array.isArray(list.body.items)).toBe(true);
    expect(list.body.meta).toMatchObject({ page: 1, limit: 100 });
    for (const r of list.body.items as { userId: string }[]) expect(r.userId).toBe(aliceId);
  });

  it('SS-1 negative: Bob’s saved search never appears in Alice’s list; a MODERATOR sees only their own', async () => {
    const bobRow = track(await save(bobTok, { name: 'bob private', filters: { market: 'livestock' } }).then((r) => { expect(r.status).toBe(201); return r; }));
    const aliceList = await request(server()).get('/v1/saved-searches?limit=100').set('Authorization', `Bearer ${aliceTok}`).expect(200);
    const aliceIds = (aliceList.body.items as { id: string }[]).map((r) => r.id);
    expect(aliceIds).not.toContain(bobRow);
    // A MODERATOR is not widened — they see only their OWN (here: none).
    const modList = await request(server()).get('/v1/saved-searches?limit=100').set('Authorization', `Bearer ${modTok}`).expect(200);
    for (const r of modList.body.items as { userId: string }[]) expect(r.userId).toBe(modId);
    expect((modList.body.items as { id: string }[]).map((r) => r.id)).not.toContain(bobRow);
  });

  it('SS-1 (added roles): a VETERINARIAN ("USER + extra") can create + list their OWN, and own-scope still holds', async () => {
    const vetRow = track(await save(vetTok, { name: 'vet watchlist', filters: { market: 'pet' } }).then((r) => { expect(r.status).toBe(201); return r; }));
    const vetList = await request(server()).get('/v1/saved-searches?limit=100').set('Authorization', `Bearer ${vetTok}`).expect(200);
    const vetIds = (vetList.body.items as { id: string }[]).map((r) => r.id);
    expect(vetIds).toContain(vetRow); // sees their own
    for (const r of vetList.body.items as { userId: string }[]) expect(r.userId).toBe(vetId); // and ONLY their own (own-scope holds for the added role)
    expect(vetIds).not.toContain(bobId); // never another user's row
  });

  // ── SS-2 404-no-leak delete ─────────────────────────────────────────────────────────────────────
  it('SS-2: a non-existent id and another user’s id both → identical 404 SAVED_SEARCH_NOT_FOUND (never 403); the row survives', async () => {
    const aliceRow = track(await save(aliceTok, { filters: { market: 'pet' } }).then((r) => { expect(r.status).toBe(201); return r; }));
    // non-existent id → 404
    const missing = await request(server()).delete(`/v1/saved-searches/${randomUUID()}`).set('Authorization', `Bearer ${aliceTok}`).expect(404);
    expect(missing.body.code).toBe('SAVED_SEARCH_NOT_FOUND');
    // Bob deletes Alice's id → identical 404 (NOT 403)
    const notOwned = await request(server()).delete(`/v1/saved-searches/${aliceRow}`).set('Authorization', `Bearer ${bobTok}`).expect(404);
    expect(notOwned.body.code).toBe('SAVED_SEARCH_NOT_FOUND');
    expect(missing.body.code).toBe(notOwned.body.code); // byte-identical code, no existence leak
    // Alice's row still exists.
    expect(await prisma.saved_searches.findUnique({ where: { id: aliceRow } })).not.toBeNull();
    // The owner can delete it → 204.
    await request(server()).delete(`/v1/saved-searches/${aliceRow}`).set('Authorization', `Bearer ${aliceTok}`).expect(204);
    expect(await prisma.saved_searches.findUnique({ where: { id: aliceRow } })).toBeNull();
  });

  // ── SS-3 bounded filters ─────────────────────────────────────────────────────────────────────────
  it('SS-3: an unknown key, an oversized body, and price_max<price_min all → 422 INVALID_FILTERS (never persisted)', async () => {
    const unknown = await save(aliceTok, { filters: { color: 'red' } }).expect(422);
    expect(unknown.body.code).toBe('INVALID_FILTERS');
    const oversized = await save(aliceTok, { filters: { q: 'x'.repeat(3000) } }).expect(422);
    expect(oversized.body.code).toBe('INVALID_FILTERS');
    const badPrice = await save(aliceTok, { filters: { price_min: 5000, price_max: 1000 } }).expect(422);
    expect(badPrice.body.code).toBe('INVALID_FILTERS');
    // A body `userId` (IDOR attempt) is a non-whitelisted top-level key → 400 at the edge.
    await save(aliceTok, { filters: {}, userId: bobId }).expect(400);
  });

  // ── SS-4 radius coherence ────────────────────────────────────────────────────────────────────────
  it('SS-4: lat-without-lng & point-without-radius → 422 GEO_PARAMS_INCOMPLETE; out-of-range radius → 422 RADIUS_OUT_OF_RANGE', async () => {
    const latOnly = await save(aliceTok, { filters: {}, lat: 55.7, radiusM: 5000 }).expect(422);
    expect(latOnly.body.code).toBe('GEO_PARAMS_INCOMPLETE');
    const noRadius = await save(aliceTok, { filters: {}, lat: 55.7, lng: 37.6 }).expect(422);
    expect(noRadius.body.code).toBe('GEO_PARAMS_INCOMPLETE');
    const radiusNoPoint = await save(aliceTok, { filters: {}, radiusM: 5000 }).expect(422);
    expect(radiusNoPoint.body.code).toBe('GEO_PARAMS_INCOMPLETE');
    const tooSmall = await save(aliceTok, { filters: {}, lat: 55.7, lng: 37.6, radiusM: 500 }).expect(422);
    expect(tooSmall.body.code).toBe('RADIUS_OUT_OF_RANGE');
    const tooBig = await save(aliceTok, { filters: {}, lat: 55.7, lng: 37.6, radiusM: 200000 }).expect(422);
    expect(tooBig.body.code).toBe('RADIUS_OUT_OF_RANGE');
  });

  // ── SS-5 sort whitelist ──────────────────────────────────────────────────────────────────────────
  it('SS-5: a non-whitelisted sort → 400 INVALID_SORT; a whitelisted sort is accepted', async () => {
    const bad = await request(server()).get('/v1/saved-searches?sort=name:asc').set('Authorization', `Bearer ${aliceTok}`).expect(400);
    expect(bad.body.code).toBe('INVALID_SORT');
    await request(server()).get('/v1/saved-searches?sort=updated_at:asc').set('Authorization', `Bearer ${aliceTok}`).expect(200);
  });

  // ── SS-6 idempotency-only dedup ──────────────────────────────────────────────────────────────────
  it('SS-6: same key + same body → replayed 201 (one row); same key + different body → 422; no body-based dedup', async () => {
    const key = randomUUID();
    const body = { name: 'dedup-test', filters: { market: 'pet' } };
    const first = await save(aliceTok, body, key).expect(201);
    track(first);
    // replay: same key + same body → the stored 201, same id (no second row).
    const replay = await save(aliceTok, body, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    // same key + different body → 422 (platform §11 key reuse).
    await save(aliceTok, { name: 'changed', filters: { market: 'livestock' } }, key).expect(422);
    // No DB dedup: an identical body under a DIFFERENT key → a brand-new row (allowed by design, SS-6).
    const second = await save(aliceTok, body).expect(201);
    track(second);
    expect(second.body.id).not.toBe(first.body.id);
  });
});
