/**
 * Listings Slice 1 (listings-api.yaml, invariants L-P0..L-15) end-to-end against the real stack
 * (PG + Redis). Exercises create→DRAFT, photos, submit→PENDING_MODERATION, soft-withdraw, owner-scoped
 * reads, and the value/ownership/P0 invariants that cross HTTP. e2e hits HOST pg/redis (localhost);
 * flush host redis if stale 429s.
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

describe('Listings Slice 1 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const listings: string[] = [];
  const animalsCreated: string[] = [];
  let sellerId: string;
  let otherId: string;
  let modId: string;
  let adminId: string;
  let sellerTok: string;
  let otherTok: string;
  let modTok: string;
  let adminTok: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  let speciesId: number;
  let breedId: number;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const newAnimal = async (owner: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: {
        owner_id: owner,
        species_id: speciesId,
        breed_id: breedId,
        nickname_localized: { en: 'Lst', ru: 'Лст' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animalsCreated.push(a.id);
    return a.id;
  };

  const idOf = (res: { body: { id?: unknown } }): string => res.body.id as string;
  const create = (tok: string, body: Record<string, unknown>, key = randomUUID()) =>
    request(server()).post('/v1/listings').set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', key).send(body);
  const track = (res: { body: { id?: unknown } }): string => {
    const id = idOf(res);
    listings.push(id);
    return id;
  };
  const getEtag = async (tok: string, id: string): Promise<string> => {
    const r = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${tok}`).expect(200);
    return r.headers['etag'];
  };
  const addPhoto = (tok: string, id: string) =>
    request(server()).post(`/v1/listings/${id}/photos`).set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', randomUUID()).send({ url: `http://x/${randomUUID()}.jpg` });
  const baseBody = (over: Record<string, unknown> = {}) => ({
    animalId: '', // filled per-test
    listingType: 'sale',
    titleLocalized: { en: 'Puppy', ru: 'Щенок' },
    priceCents: 5000,
    ...over,
  });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);

    const mk = (n: string, role: string) =>
      prisma.users.create({ data: { full_name: n, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    sellerId = (await mk('LSeller', 'USER')).id;
    otherId = (await mk('LOther', 'USER')).id;
    modId = (await mk('LMod', 'MODERATOR')).id;
    adminId = (await mk('LAdmin', 'ADMIN')).id;
    [sellerTok, otherTok, modTok, adminTok] = await Promise.all([
      devToken(sellerId),
      devToken(otherId),
      devToken(modId),
      devToken(adminId),
    ]);

    const sp = await prisma.species.create({ data: { code: `lst_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `lst_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    for (const id of listings) {
      await prisma.listing_photos.deleteMany({ where: { listing_id: id } }).catch(() => undefined);
      await prisma.listings.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of animalsCreated) {
      await prisma.listings.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    }
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of [sellerId, otherId, modId, adminId]) {
      if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  it('requires auth on create (401)', async () => {
    await request(server()).post('/v1/listings').set('Idempotency-Key', randomUUID()).send({}).expect(401);
  });

  it('creates a DRAFT; seller is server-derived (L-1, a body sellerId is rejected 400 as an unknown field)', async () => {
    const animalId = await newAnimal(sellerId);
    const res = await create(sellerTok, { ...baseBody({ animalId }), sellerId: otherId }).expect(400); // forbidNonWhitelisted: unknown sellerId rejected
    expect(res.body.status).toBe(400);
    // Without the illegal field, create succeeds and seller = the actor.
    const ok = await create(sellerTok, baseBody({ animalId })).expect(201);
    expect(ok.body.sellerId).toBe(sellerId);
    expect(ok.body.status).toBe('DRAFT');
    expect(ok.body.moderationStatus).toBe('PENDING');
    expect(ok.headers['etag']).toBeTruthy();
    track(ok);
  });

  it('L-2: creating a listing for another user’s animal → 403', async () => {
    const animalId = await newAnimal(otherId);
    await create(sellerTok, baseBody({ animalId })).expect(403);
  });

  it('L-3: MODERATOR is write-blocked on create (403)', async () => {
    const animalId = await newAnimal(sellerId);
    await create(modTok, baseBody({ animalId })).expect(403);
  });

  it('L-4: branchId without organizationId → 422', async () => {
    const animalId = await newAnimal(sellerId);
    await create(sellerTok, baseBody({ animalId, branchId: randomUUID() })).expect(422);
  });

  it('L-9: negative price / quantity 0 / bad currency / half-set latlng → 422 or 400', async () => {
    const animalId = await newAnimal(sellerId);
    await create(sellerTok, baseBody({ animalId, priceCents: -1 })).expect(400); // DTO @Min(0)
    await create(sellerTok, baseBody({ animalId, quantity: 0 })).expect(400); // DTO @Min(1)
    await create(sellerTok, baseBody({ animalId, currency: 'rub' })).expect(400); // DTO pattern
    await create(sellerTok, baseBody({ animalId, lat: 10 })).expect(422); // service half-set
  });

  it('L-P0: a forced ACTIVE while moderation_status≠APPROVED is rejected by the trigger (clean error, not 500)', async () => {
    const animalId = await newAnimal(sellerId);
    const listing = await prisma.listings.create({
      data: { animal_id: animalId, seller_id: sellerId, listing_type: 'sale', title_localized: { en: 'X', ru: 'X' }, status: 'DRAFT', moderation_status: 'PENDING' },
    });
    listings.push(listing.id);
    // Direct forced ACTIVE while PENDING → trigger RAISE.
    await expect(
      prisma.$executeRaw`UPDATE listings SET status = 'ACTIVE' WHERE id = ${listing.id}::uuid`,
    ).rejects.toThrow(/cannot be ACTIVE unless moderation_status/i);
  });

  it('L-5: a non-owner / anonymous cannot read or list someone’s DRAFT (404, no leak)', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    // Owner sees it; a stranger and anonymous get 404 (existence not leaked).
    await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${otherTok}`).expect(404);
    await request(server()).get(`/v1/listings/${id}`).expect(404);
    // The stranger's public list does not include the DRAFT.
    const list = await request(server()).get('/v1/listings?limit=100').set('Authorization', `Bearer ${otherTok}`).expect(200);
    expect((list.body.items as { id: string }[]).map((i) => i.id)).not.toContain(id);
  });

  it('PATCH: DRAFT-edit with If-Match (428 missing / 412 stale / 200 valid); L-12 unknown field 400', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    const etag = await getEtag(sellerTok, id);
    await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).send({ priceCents: 7000 }).expect(428);
    await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', 'W/"x"').send({ priceCents: 7000 }).expect(412);
    const ok = await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).send({ priceCents: 7000 }).expect(200);
    expect(ok.body.priceCents).toBe(7000);
    // L-12: status is readOnly → unknown field rejected by the whitelist.
    const etag2 = await getEtag(sellerTok, id);
    await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag2).send({ status: 'ACTIVE' }).expect(400);
  });

  it('L-6/L-7: submit needs ≥1 photo; submits DRAFT→PENDING_MODERATION; re-submit → 409 LISTING_NOT_DRAFT', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    let etag = await getEtag(sellerTok, id);
    // No photo → 422.
    await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(422);
    await addPhoto(sellerTok, id).expect(201);
    etag = await getEtag(sellerTok, id);
    const sub = await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    expect(sub.body.status).toBe('PENDING_MODERATION');
    // L-7: submitting again (now PENDING) → 409.
    etag = await getEtag(sellerTok, id);
    const again = await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(409);
    expect(again.body.code).toBe('LISTING_NOT_DRAFT');
  });

  it('TOCTOU: two parallel submits (same ETag, distinct keys) → exactly one 200, one 409, one PENDING_MODERATION', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    await addPhoto(sellerTok, id).expect(201);
    const etag = await getEtag(sellerTok, id);
    // Same valid If-Match, DISTINCT Idempotency-Keys (so neither is an idempotent replay) → races the
    // inner guarded DRAFT→PENDING_MODERATION claim, not the idempotency cache.
    const fire = () =>
      request(server())
        .post(`/v1/listings/${id}/submit`)
        .set('Authorization', `Bearer ${sellerTok}`)
        .set('Idempotency-Key', randomUUID())
        .set('If-Match', etag)
        .send();
    const [a, b] = await Promise.all([fire(), fire()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 412]).toContain(statuses[1]); // loser: 409 (lost the claim) or 412 (its If-Match went stale)
    // Single-winner: the listing is PENDING_MODERATION exactly once (no double-transition).
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('PENDING_MODERATION');
  });

  it('submit does NOT and CANNOT make the listing ACTIVE (L-P0)', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    await addPhoto(sellerTok, id).expect(201);
    const etag = await getEtag(sellerTok, id);
    const sub = await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    expect(sub.body.status).toBe('PENDING_MODERATION');
    expect(sub.body.status).not.toBe('ACTIVE');
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('PENDING_MODERATION');
    expect(row?.moderation_status).toBe('PENDING');
  });

  it('L-14: MAX_MEDIA_ITEMS=10 — the 11th photo → 422', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    for (let i = 0; i < 10; i++) await addPhoto(sellerTok, id).expect(201);
    await addPhoto(sellerTok, id).expect(422);
    // Photos are listed (DRAFT visible to owner).
    const photos = await request(server()).get(`/v1/listings/${id}/photos`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect(photos.body).toHaveLength(10);
    // Remove one (owner). A non-owner removing → 403.
    const photoId = (photos.body as { id: string }[])[0].id;
    await request(server()).delete(`/v1/listings/${id}/photos/${photoId}`).set('Authorization', `Bearer ${otherTok}`).expect(403);
    await request(server()).delete(`/v1/listings/${id}/photos/${photoId}`).set('Authorization', `Bearer ${sellerTok}`).expect(204);
  });

  it('DELETE soft-withdraws → DEACTIVATED; a second withdraw → 409; L-3 non-owner → 403', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    await request(server()).delete(`/v1/listings/${id}`).set('Authorization', `Bearer ${otherTok}`).expect(403);
    const del = await request(server()).delete(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect(del.body.status).toBe('DEACTIVATED');
    expect(del.body.isActive).toBe(false);
    await request(server()).delete(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(409);
  });

  it('Idempotency-Key replays create without a duplicate', async () => {
    const animalId = await newAnimal(sellerId);
    const key = randomUUID();
    const body = baseBody({ animalId });
    const first = await create(sellerTok, body, key).expect(201);
    track(first);
    const replay = await create(sellerTok, body, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('ADMIN/MODERATOR can read a non-active listing (operator scope)', async () => {
    const animalId = await newAnimal(sellerId);
    const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
    await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${modTok}`).expect(200);
    await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${adminTok}`).expect(200);
  });

  // ── Slice 4c (B): lastModerationResult embed on GET /listings/{id} (EMB-1..4) ──────────────────
  describe('lastModerationResult embed (EMB-1..4)', () => {
    /** Drive a listing through submit → MOD claim → REJECT, leaving a moderation decision on it. */
    const moderateReject = async (id: string): Promise<void> => {
      await addPhoto(sellerTok, id).expect(201);
      const etag = await getEtag(sellerTok, id);
      await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
      await request(server()).post(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);
      await request(server()).post('/v1/moderation/action').set('Authorization', `Bearer ${modTok}`).send({ listingId: id, action: 'REJECT', reason: 'poor_photos' }).expect(200);
    };

    beforeAll(async () => {
      // Ensure the reason used by the moderation REJECT exists (seeded normally; upsert for isolation).
      await prisma.moderation_reasons.upsert({ where: { code: 'poor_photos' }, update: {}, create: { code: 'poor_photos', description_localized: { en: 'Poor photos', ru: 'Плохие фото' }, applies_to: 'LISTING', is_active: true } });
    });

    it('EMB-3: a never-moderated listing → lastModerationResult is null', async () => {
      const animalId = await newAnimal(sellerId);
      const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
      const res = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
      expect(res.body).toHaveProperty('lastModerationResult', null);
    });

    it('EMB-1/EMB-2: the owner sees the result (with agent-transparency fields); a non-owner USER does NOT (null, no leak)', async () => {
      const animalId = await newAnimal(sellerId);
      const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
      await moderateReject(id);

      // Owner (seller) sees the embed.
      const owner = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
      expect(owner.body.lastModerationResult).toEqual(expect.objectContaining({ decision: 'REJECTED' }));
      expect(owner.body.lastModerationResult).toHaveProperty('decidedByAgent');
      expect(owner.body.lastModerationResult.decidedBy).toHaveProperty('principalType'); // EMB-2 transparency
      // A MODERATOR/operator also sees it.
      const mod = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${modTok}`).expect(200);
      expect(mod.body.lastModerationResult.decision).toBe('REJECTED');

      // EMB-1: a different USER — the listing is now DEACTIVATED so they get 404 anyway; re-approve a
      // fresh one to test the ACTIVE-but-non-owner case (the embed must still be null, no leak).
    });

    it('EMB-1: a non-owner reader of an ACTIVE moderated listing gets lastModerationResult null (no leak)', async () => {
      const animalId = await newAnimal(sellerId);
      const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
      // submit → claim → APPROVE so the listing is ACTIVE (publicly readable).
      await addPhoto(sellerTok, id).expect(201);
      const etag = await getEtag(sellerTok, id);
      await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
      await request(server()).post(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);
      await request(server()).post('/v1/moderation/action').set('Authorization', `Bearer ${modTok}`).send({ listingId: id, action: 'APPROVE' }).expect(200);

      // Owner sees APPROVED; a non-owner USER reading the now-ACTIVE listing sees null (no leak).
      const owner = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
      expect(owner.body.lastModerationResult.decision).toBe('APPROVED');
      const stranger = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${otherTok}`).expect(200);
      expect(stranger.body.lastModerationResult).toBeNull();
      // Anonymous too.
      const anon = await request(server()).get(`/v1/listings/${id}`).expect(200);
      expect(anon.body.lastModerationResult).toBeNull();
    });

    it('EMB-4: the GET /listings list response does NOT embed lastModerationResult (no N+1)', async () => {
      // The list path always sets it null (no per-row moderation lookup). Use an authenticated owner
      // list so the moderated listing is in scope, and assert every row's field is null.
      const res = await request(server()).get('/v1/listings?limit=100').set('Authorization', `Bearer ${sellerTok}`).expect(200);
      for (const item of res.body.items as { lastModerationResult: unknown }[]) {
        expect(item.lastModerationResult).toBeNull();
      }
    });
  });

  // ── Slice 4d (M-14): re-moderation on material ACTIVE edit ────────────────────────────────────
  describe('M-14 re-moderation on ACTIVE edit', () => {
    beforeAll(async () => {
      await prisma.moderation_reasons.upsert({ where: { code: 'poor_photos' }, update: {}, create: { code: 'poor_photos', description_localized: { en: 'Poor photos', ru: 'Плохие фото' }, applies_to: 'LISTING', is_active: true } });
    });

    /** Drive a fresh listing all the way to ACTIVE (submit → claim → APPROVE). Returns its id. */
    const makeActive = async (): Promise<string> => {
      const animalId = await newAnimal(sellerId);
      const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
      await addPhoto(sellerTok, id).expect(201);
      const etag = await getEtag(sellerTok, id);
      await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
      await request(server()).post(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);
      await request(server()).post('/v1/moderation/action').set('Authorization', `Bearer ${modTok}`).send({ listingId: id, action: 'APPROVE' }).expect(200);
      const row = await prisma.listings.findUnique({ where: { id } });
      expect(row?.status).toBe('ACTIVE');
      return id;
    };

    it('M14-1: a material edit (price) of an ACTIVE listing → PENDING_MODERATION + PENDING + enqueued; leaves ACTIVE (M-P0)', async () => {
      const id = await makeActive();
      const etag = await getEtag(sellerTok, id);
      const res = await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).send({ priceCents: 9999 }).expect(200);
      expect(res.body.status).toBe('PENDING_MODERATION');
      expect(res.body.priceCents).toBe(9999);
      const row = await prisma.listings.findUnique({ where: { id } });
      expect(row?.status).toBe('PENDING_MODERATION');
      expect(row?.moderation_status).toBe('PENDING');
      expect(row?.moderation_enqueued_at).not.toBeNull();
      expect(row?.is_active).toBe(false);
    });

    it('M14-5: re-enqueue clears a stale moderator lock and resets escalated_at (so the 4c job can re-escalate)', async () => {
      const id = await makeActive();
      // Contrive a stale lock + an escalated marker on the ACTIVE row (as if from a prior cycle).
      await prisma.listings.update({ where: { id }, data: { assigned_to: modId, locked_at: new Date(), lock_expires_at: new Date(Date.now() + 600_000), escalated_at: new Date() } });
      const etag = await getEtag(sellerTok, id);
      await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).send({ titleLocalized: { en: 'Edited', ru: 'Изменено' } }).expect(200);
      const row = await prisma.listings.findUnique({ where: { id } });
      expect(row?.assigned_to).toBeNull();
      expect(row?.locked_at).toBeNull();
      expect(row?.lock_expires_at).toBeNull();
      expect(row?.escalated_at).toBeNull();
    });

    it('M14-2: a forced in-place UPDATE keeping status=ACTIVE while flipping moderation_status=PENDING is blocked by the P0 trigger', async () => {
      const id = await makeActive();
      await expect(
        prisma.$executeRaw`UPDATE listings SET moderation_status='PENDING' WHERE id=${id}::uuid AND status='ACTIVE'`,
      ).rejects.toThrow(/cannot be ACTIVE unless moderation_status/i);
    });

    it('M14-4: a non-owner USER editing an ACTIVE listing → 403; a MODERATOR → 403', async () => {
      const id = await makeActive();
      const etag = await getEtag(otherTok, id); // ACTIVE is publicly readable
      await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${otherTok}`).set('If-Match', etag).send({ priceCents: 1 }).expect(403);
      await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${modTok}`).set('If-Match', etag).send({ priceCents: 1 }).expect(403);
    });

    it('M14-7: a SOLD/terminal listing is not editable → 409 LISTING_NOT_EDITABLE', async () => {
      const animalId = await newAnimal(sellerId);
      const id = track(await create(sellerTok, baseBody({ animalId })).expect(201));
      await prisma.listings.update({ where: { id }, data: { status: 'SOLD' } });
      const etag = await getEtag(sellerTok, id);
      const res = await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).send({ priceCents: 1 }).expect(409);
      expect(res.body.code).toBe('LISTING_NOT_EDITABLE');
    });

    it('M14-8: animalId is not an editable field → 400 (unknown field rejected by the whitelist)', async () => {
      const id = await makeActive();
      const etag = await getEtag(sellerTok, id);
      await request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).send({ animalId: randomUUID() }).expect(400);
    });

    it('M14-3 (concurrency): two parallel edits of an ACTIVE listing → exactly one 200, one 409; single PENDING_MODERATION', async () => {
      const id = await makeActive();
      const etag = await getEtag(sellerTok, id);
      const fire = (price: number) => request(server()).patch(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).send({ priceCents: price });
      const [a, b] = await Promise.all([fire(111), fire(222)]);
      const statuses = [a.status, b.status].sort();
      expect(statuses[0]).toBe(200);
      expect([409, 412]).toContain(statuses[1]); // loser: lost the guarded ACTIVE claim (409) or stale ETag (412)
      const row = await prisma.listings.findUnique({ where: { id } });
      expect(row?.status).toBe('PENDING_MODERATION'); // re-enqueued exactly once
    });
  });
});
