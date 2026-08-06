/**
 * Favorites (favorites-api.yaml v1.0.0 — Wave D / D11) end-to-end against the real stack (PG + Redis).
 * Proves: add → 201 with the OfferingRef pair written (offeringType/offeringId==listingId + deprecated
 * listingId alias), idempotent add (a repeat → the same row, no duplicate), own-scope list with the
 * {items, meta: PageMeta} envelope (no operator widening), remove → idempotent leak-free 204 (absent /
 * not-owned both → identical 204, never 404/403), and the visibility gate (favoriting another user's
 * non-ACTIVE listing → 404 no-leak). e2e hits HOST pg/redis (localhost).
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
import { applyGlobalApiPrefix } from '../src/config/api-base';

describe('Favorites (D11, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);

  let aliceId: string;
  let bobId: string;
  let vetId: string;
  let modId: string;
  let aliceTok: string;
  let bobTok: string;
  let vetTok: string;
  let modTok: string;
  let speciesId: number;
  let breedId: number;

  const users: string[] = [];
  const animalsCreated: string[] = [];
  const listings: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/api/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const mkUser = async (name: string, role: string): Promise<string> => {
    const u = await prisma.users.create({ data: { full_name: name, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    users.push(u.id);
    return u.id;
  };

  const newAnimal = async (owner: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: { owner_id: owner, species_id: speciesId, breed_id: breedId, nickname_localized: { en: 'F', ru: 'И' }, sex: 'Male', date_of_birth: new Date('2021-01-01T00:00:00Z') },
    });
    animalsCreated.push(a.id);
    return a.id;
  };

  /** Seed a listing owned by `seller` in the given status (default ACTIVE + APPROVED). */
  const seedListing = async (seller: string, over: Record<string, unknown> = {}): Promise<string> => {
    const animalId = await newAnimal(seller);
    const l = await prisma.listings.create({
      data: {
        animal_id: animalId, seller_id: seller, listing_type: 'sale', market: 'pet',
        title_localized: { en: 'L', ru: 'Л' }, description_localized: { en: '', ru: '' },
        price_cents: 5000, currency: 'RUB', quantity: 1,
        status: 'ACTIVE', moderation_status: 'APPROVED', is_active: true, ...over,
      },
    });
    listings.push(l.id);
    return l.id;
  };

  const addFav = (tok: string, listingId: string, key = randomUUID()) =>
    request(server()).post(`/api/v1/listings/${listingId}/favorite`).set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', key).send();
  const listFav = (tok: string) =>
    request(server()).get('/api/v1/favorites?limit=100').set('Authorization', `Bearer ${tok}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    applyGlobalApiPrefix(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = app.get(PrismaService);

    aliceId = await mkUser('FavAlice', 'USER');
    bobId = await mkUser('FavBob', 'USER');
    vetId = await mkUser('FavVet', 'VETERINARIAN'); // "USER + extra" — inherits the favorites capability
    modId = await mkUser('FavMod', 'MODERATOR');
    [aliceTok, bobTok, vetTok, modTok] = await Promise.all([devToken(aliceId), devToken(bobId), devToken(vetId), devToken(modId)]);

    const sp = await prisma.species.create({ data: { code: `fav_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `fav_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    await prisma.favorites.deleteMany({ where: { user_id: { in: users } } }).catch(() => undefined);
    for (const id of listings) await prisma.listings.delete({ where: { id } }).catch(() => undefined);
    for (const id of animalsCreated) await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    await prisma.breeds.deleteMany({ where: { id: breedId } }).catch(() => undefined);
    await prisma.species.deleteMany({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of users) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── auth gate ─────────────────────────────────────────────────────────────────────────────────
  it('an unauthenticated request → 401 on list, add, remove', async () => {
    const anyListing = randomUUID();
    await request(server()).get('/api/v1/favorites').expect(401);
    await request(server()).post(`/api/v1/listings/${anyListing}/favorite`).set('Idempotency-Key', randomUUID()).send().expect(401);
    await request(server()).delete(`/api/v1/listings/${anyListing}/favorite`).expect(401);
  });

  // ── add → 201 with OfferingRef write; idempotent add ────────────────────────────────────────────
  it('add → 201 writing offeringType=ANIMAL_LISTING, offeringId==listingId, deprecated listingId alias', async () => {
    const listing = await seedListing(bobId); // ACTIVE, public
    const res = await addFav(aliceTok, listing).expect(201);
    expect(res.body.offeringType).toBe('ANIMAL_LISTING');
    expect(res.body.offeringId).toBe(listing);
    expect(res.body.listingId).toBe(listing); // deprecated alias == offeringId
    // Persisted with the server-derived owner + truthful NOT-NULL offering_id.
    const dbRow = await prisma.favorites.findFirst({ where: { user_id: aliceId, listing_id: listing } });
    expect(dbRow).not.toBeNull();
    expect(dbRow!.offering_type).toBe('ANIMAL_LISTING');
    expect(dbRow!.offering_id).toBe(listing);
  });

  it('idempotent add: favoriting the same listing twice (different keys) → 201 both, the SAME row, no duplicate', async () => {
    const listing = await seedListing(bobId);
    const first = await addFav(aliceTok, listing).expect(201);
    const second = await addFav(aliceTok, listing).expect(201); // different Idempotency-Key → DB UNIQUE dedup
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.favorites.count({ where: { user_id: aliceId, listing_id: listing } })).toBe(1);
  });

  it('Idempotency-Key replay: same key + same request → the stored 201 (same id)', async () => {
    const listing = await seedListing(bobId);
    const key = randomUUID();
    const first = await addFav(aliceTok, listing, key).expect(201);
    const replay = await addFav(aliceTok, listing, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
  });

  // ── own-scope list ──────────────────────────────────────────────────────────────────────────────
  it('own-scope list with the {items, meta: PageMeta} envelope; a MODERATOR is NOT widened', async () => {
    const listing = await seedListing(bobId);
    await addFav(bobTok, listing).expect(201); // Bob favorites his own listing

    const bobList = await listFav(bobTok).expect(200);
    expect(Array.isArray(bobList.body.items)).toBe(true);
    expect(bobList.body.meta).toMatchObject({ page: 1, limit: 100 });
    expect((bobList.body.items as { listingId: string }[]).map((r) => r.listingId)).toContain(listing);

    // Alice never sees Bob's favorite; a MODERATOR sees only their OWN (here: none of Bob's).
    const aliceIds = (await listFav(aliceTok).expect(200)).body.items as { listingId: string }[];
    expect(aliceIds.map((r) => r.listingId)).not.toContain(listing);
    const modItems = (await listFav(modTok).expect(200)).body.items as { listingId: string }[];
    expect(modItems.map((r) => r.listingId)).not.toContain(listing);
  });

  it('a VETERINARIAN ("USER + extra", rbac drift-fix) can add + list their own favorites', async () => {
    const listing = await seedListing(bobId);
    await addFav(vetTok, listing).expect(201);
    const vetItems = (await listFav(vetTok).expect(200)).body.items as { listingId: string }[];
    expect(vetItems.map((r) => r.listingId)).toContain(listing);
  });

  // ── remove → idempotent, leak-free 204 ──────────────────────────────────────────────────────────
  it('remove → 204 and the row is gone; a repeat remove (now absent) → identical 204 (idempotent)', async () => {
    const listing = await seedListing(bobId);
    await addFav(aliceTok, listing).expect(201);
    await request(server()).delete(`/api/v1/listings/${listing}/favorite`).set('Authorization', `Bearer ${aliceTok}`).expect(204);
    expect(await prisma.favorites.findFirst({ where: { user_id: aliceId, listing_id: listing } })).toBeNull();
    // Repeat: now absent → still 204 (no 404).
    await request(server()).delete(`/api/v1/listings/${listing}/favorite`).set('Authorization', `Bearer ${aliceTok}`).expect(204);
  });

  it('leak-free remove: Bob removing Alice’s favorite → identical 204, and Alice’s favorite SURVIVES (no 403)', async () => {
    const listing = await seedListing(bobId);
    await addFav(aliceTok, listing).expect(201);
    // Bob targets the same listing id, but scoped to Bob → deletes 0 rows, still 204 (no existence/ownership leak).
    await request(server()).delete(`/api/v1/listings/${listing}/favorite`).set('Authorization', `Bearer ${bobTok}`).expect(204);
    expect(await prisma.favorites.findFirst({ where: { user_id: aliceId, listing_id: listing } })).not.toBeNull();
  });

  // ── visibility gate (404 no-leak) ───────────────────────────────────────────────────────────────
  it('favoriting another user’s non-ACTIVE (DRAFT) listing → 404 no-leak, and nothing is written', async () => {
    const draft = await seedListing(bobId, { status: 'DRAFT', moderation_status: 'PENDING' });
    const res = await addFav(aliceTok, draft).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(await prisma.favorites.findFirst({ where: { user_id: aliceId, listing_id: draft } })).toBeNull();
    // Same body as a truly non-existent listing → no existence leak.
    const missing = await addFav(aliceTok, randomUUID()).expect(404);
    expect(missing.body.code).toBe(res.body.code);
    // The owner CAN favorite their own DRAFT (visible to them).
    await addFav(bobTok, draft).expect(201);
  });
});
