/**
 * Cascade deactivation + uq_active_listing_per_type negative coverage (AUDIT_2026-06-30 MAJOR).
 * Closes the gaps: the two AFTER-UPDATE triggers (cascade_animal_deactivation /
 * cascade_user_deactivation, database_schema.sql:994-1019) and the partial unique index
 * uq_active_listing_per_type (schema:323) had no behavioral test.
 *
 * Self-contained fixtures (own seller/animals) so deactivating them never disturbs other suites.
 * Drives listings to ACTIVE through the real submit → claim → APPROVE path. e2e hits HOST pg/redis
 * (localhost); flush host redis if stale 429s.
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
import { applyGlobalApiPrefix } from '../src/config/api-base';

describe('Listing cascade-deactivation + uq_active_listing_per_type (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const animalsCreated: string[] = [];
  const userIds: string[] = [];
  let sellerId: string;
  let modId: string;
  let sellerTok: string;
  let modTok: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  let speciesId: number;
  let breedId: number;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/api/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const newAnimal = async (owner: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: {
        owner_id: owner,
        species_id: speciesId,
        breed_id: breedId,
        nickname_localized: { en: 'Csc', ru: 'Кск' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animalsCreated.push(a.id);
    return a.id;
  };

  const baseBody = (over: Record<string, unknown> = {}) => ({
    animalId: '',
    listingType: 'sale',
    titleLocalized: { en: 'Puppy', ru: 'Щенок' },
    priceCents: 5000,
    ...over,
  });
  const create = (tok: string, body: Record<string, unknown>, key = randomUUID()) =>
    request(server()).post('/api/v1/listings').set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', key).send(body);
  const addPhoto = (tok: string, id: string) =>
    request(server()).post(`/api/v1/listings/${id}/photos`).set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', randomUUID()).send({ url: `http://localhost:9000/${randomUUID()}.jpg` });
  const getEtag = async (tok: string, id: string): Promise<string> =>
    (await request(server()).get(`/api/v1/listings/${id}`).set('Authorization', `Bearer ${tok}`).expect(200)).headers['etag'];

  /** Drive a fresh listing of the given type all the way to ACTIVE (submit → claim → APPROVE). */
  const makeActive = async (animalId: string, listingType = 'sale'): Promise<string> => {
    const id = (await create(sellerTok, baseBody({ animalId, listingType })).expect(201)).body.id as string;
    await addPhoto(sellerTok, id).expect(201);
    const etag = await getEtag(sellerTok, id);
    await request(server()).post(`/api/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    await request(server()).post(`/api/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);
    await request(server()).post('/api/v1/moderation/action').set('Authorization', `Bearer ${modTok}`).send({ listingId: id, action: 'APPROVE' }).expect(200);
    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('ACTIVE');
    return id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    applyGlobalApiPrefix(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);

    const mk = async (n: string, role: string): Promise<string> => {
      const u = await prisma.users.create({ data: { full_name: n, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
      userIds.push(u.id);
      return u.id;
    };
    sellerId = await mk('CscSeller', 'USER');
    modId = await mk('CscMod', 'MODERATOR');
    [sellerTok, modTok] = await Promise.all([devToken(sellerId), devToken(modId)]);

    const sp = await prisma.species.create({ data: { code: `csc_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `csc_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    // Clean up the outbox events our APPROVE flips emit (aggregateType 'Listing', aggregate_id =
    // listing id). Leaving them unprocessed in the SHARED PG would fill the relay batch and starve
    // the outbox.e2e relay tests (test-isolation: this suite must not leak unconsumed events).
    for (const animalId of animalsCreated) {
      const ls = await prisma.listings.findMany({ where: { animal_id: animalId }, select: { id: true } }).catch(() => [] as { id: string }[]);
      for (const l of ls) {
        await prisma.outbox_events.deleteMany({ where: { aggregate_type: 'Listing', aggregate_id: l.id } }).catch(() => undefined);
      }
    }
    for (const id of animalsCreated) {
      await prisma.listings.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    }
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of userIds) {
      await prisma.refresh_tokens.deleteMany({ where: { user_id: id } }).catch(() => undefined);
      await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  // ── cascade_animal_deactivation ───────────────────────────────────────────────────────────────
  it('deactivating an animal cascades its ACTIVE listing → DEACTIVATED', async () => {
    const animalId = await newAnimal(sellerId);
    const listingId = await makeActive(animalId);

    await request(server()).patch(`/api/v1/animals/${animalId}/deactivate`).set('Authorization', `Bearer ${sellerTok}`).expect(200);

    const row = await prisma.listings.findUnique({ where: { id: listingId } });
    expect(row?.status).toBe('DEACTIVATED');
    // NOTE: the cascade trigger sets status only; is_active is left stale (true). Visibility is
    // gated on status='ACTIVE' (listing.service.ts:639/657/669) so this does NOT leak the listing,
    // but it drifts from the app-level paths (service:291/391) that always pair is_active=false with
    // DEACTIVATED. Tracked as the it.todo below (needs a trigger fix).
  });

  // FIXED (migration 0025, fix-wave 1.1): both cascade triggers now set is_active=false alongside
  // status='DEACTIVATED', matching the app-level paths (listing.service.ts:293/393). is_active is a
  // DERIVED flag (data-model.md §"derived from status"); the cascade must keep it bit-identical with
  // the lifecycle status so future is_active-based filters stay correct.
  it('cascade triggers clear is_active (status→DEACTIVATED also sets is_active=false)', async () => {
    const animalId = await newAnimal(sellerId);
    const listingId = await makeActive(animalId);

    await request(server()).patch(`/api/v1/animals/${animalId}/deactivate`).set('Authorization', `Bearer ${sellerTok}`).expect(200);

    const row = await prisma.listings.findUnique({ where: { id: listingId } });
    expect(row?.status).toBe('DEACTIVATED');
    expect(row?.is_active).toBe(false);
  });

  // ── cascade_user_deactivation ─────────────────────────────────────────────────────────────────
  it('deactivating the seller cascades their ACTIVE listing → DEACTIVATED', async () => {
    // Dedicated seller so deactivating it cannot disturb the shared fixture's listings.
    const seller2 = await prisma.users.create({ data: { full_name: 'CscSeller2', role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    userIds.push(seller2.id);
    const seller2Tok = await devToken(seller2.id);

    const animalId = (await prisma.animals.create({ data: { owner_id: seller2.id, species_id: speciesId, breed_id: breedId, nickname_localized: { en: 'Csc2', ru: 'Кск2' }, sex: 'Female', date_of_birth: new Date('2021-01-01T00:00:00Z') } })).id;
    animalsCreated.push(animalId);
    // Drive to ACTIVE as seller2 (override the shared sellerTok for this listing's lifecycle).
    const id = (await request(server()).post('/api/v1/listings').set('Authorization', `Bearer ${seller2Tok}`).set('Idempotency-Key', randomUUID()).send(baseBody({ animalId })).expect(201)).body.id as string;
    await request(server()).post(`/api/v1/listings/${id}/photos`).set('Authorization', `Bearer ${seller2Tok}`).set('Idempotency-Key', randomUUID()).send({ url: `http://localhost:9000/${randomUUID()}.jpg` }).expect(201);
    const etag = (await request(server()).get(`/api/v1/listings/${id}`).set('Authorization', `Bearer ${seller2Tok}`).expect(200)).headers['etag'];
    await request(server()).post(`/api/v1/listings/${id}/submit`).set('Authorization', `Bearer ${seller2Tok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    await request(server()).post(`/api/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);
    await request(server()).post('/api/v1/moderation/action').set('Authorization', `Bearer ${modTok}`).send({ listingId: id, action: 'APPROVE' }).expect(200);
    expect((await prisma.listings.findUnique({ where: { id } }))?.status).toBe('ACTIVE');

    // Deactivate the seller (fires cascade_user_deactivation).
    await prisma.users.update({ where: { id: seller2.id }, data: { status: 'DEACTIVATED', is_active: false, deactivated_at: new Date() } });

    const row = await prisma.listings.findUnique({ where: { id } });
    expect(row?.status).toBe('DEACTIVATED');
  });

  // ── negative: SOLD / EXPIRED are NOT cascaded ─────────────────────────────────────────────────
  it('a SOLD or EXPIRED listing is NOT touched by the animal-deactivation cascade', async () => {
    const animalId = await newAnimal(sellerId);
    const soldId = await makeActive(animalId, 'breeding'); // different type → no uq clash with below
    const expiredId = await makeActive(animalId, 'adoption');
    // Move them to terminal states the cascade must skip.
    await prisma.listings.update({ where: { id: soldId }, data: { status: 'SOLD' } });
    await prisma.listings.update({ where: { id: expiredId }, data: { status: 'EXPIRED' } });

    await request(server()).patch(`/api/v1/animals/${animalId}/deactivate`).set('Authorization', `Bearer ${sellerTok}`).expect(200);

    expect((await prisma.listings.findUnique({ where: { id: soldId } }))?.status).toBe('SOLD');
    expect((await prisma.listings.findUnique({ where: { id: expiredId } }))?.status).toBe('EXPIRED');
  });

  // ── one-sidedness: reactivating the animal does NOT resurrect the listing ─────────────────────
  it('reactivating the animal does NOT resurrect a cascade-DEACTIVATED listing (one-way)', async () => {
    const animalId = await newAnimal(sellerId);
    const listingId = await makeActive(animalId);
    await request(server()).patch(`/api/v1/animals/${animalId}/deactivate`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect((await prisma.listings.findUnique({ where: { id: listingId } }))?.status).toBe('DEACTIVATED');

    await request(server()).patch(`/api/v1/animals/${animalId}/reactivate`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    // The listing stays DEACTIVATED — reactivation is not a resurrection trigger.
    expect((await prisma.listings.findUnique({ where: { id: listingId } }))?.status).toBe('DEACTIVATED');
  });

  // ── uq_active_listing_per_type: two ACTIVE of the same type on one animal → clean 409 ─────────
  // FIXED (fix-wave 1.1): moderation.service.ts runWrite() now maps the partial-unique violation
  // (Prisma P2002 / SQLSTATE 23505) on the APPROVE flip to a clean 409 CONFLICT (code
  // ACTIVE_LISTING_EXISTS) instead of bubbling as a 500. A second ACTIVE listing of the same type on
  // one animal is blocked by uq_active_listing_per_type; the second APPROVE must surface that as 409.
  it('uq_active_listing_per_type: second ACTIVE listing of the same type on one animal → 409 ACTIVE_LISTING_EXISTS', async () => {
    const animalId = await newAnimal(sellerId);
    await makeActive(animalId, 'sale'); // first 'sale' listing → ACTIVE

    // Drive a SECOND 'sale' listing to the APPROVE step; the flip collides with the partial-unique index.
    const id2 = (await create(sellerTok, baseBody({ animalId, listingType: 'sale' })).expect(201)).body.id as string;
    await addPhoto(sellerTok, id2).expect(201);
    const etag2 = await getEtag(sellerTok, id2);
    await request(server()).post(`/api/v1/listings/${id2}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag2).expect(200);
    await request(server()).post(`/api/v1/moderation/queue/${id2}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);

    const res = await request(server())
      .post('/api/v1/moderation/action')
      .set('Authorization', `Bearer ${modTok}`)
      .send({ listingId: id2, action: 'APPROVE' })
      .expect(409);
    expect(res.body.code).toBe('ACTIVE_LISTING_EXISTS');

    // The second listing must NOT have flipped to ACTIVE (the guarded flip rolled back).
    expect((await prisma.listings.findUnique({ where: { id: id2 } }))?.status).not.toBe('ACTIVE');
  });
});
