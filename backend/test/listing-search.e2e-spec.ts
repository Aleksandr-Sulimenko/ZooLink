/**
 * Listings Slice 2 — search/filter (geo + market + species/breed + sort) end-to-end against the
 * real stack (PG + Redis), invariants L2-1..L2-16. Proves market no-leak (L2-1), Haversine boundary
 * (L2-7), bbox loss-lessness (L2-8), NULL-coords exclusion (L2-9), antimeridian (L2-10), the
 * conditional-required market (L2-2), all-or-none geo (L2-3), radius bounds (L2-4), sort whitelist
 * (L2-11/12), deterministic order (L2-13), and distanceM only-on-geo (L2-14). ACTIVE listings are
 * seeded directly (ACTIVE requires moderation APPROVED — moderator approval is Admin Slice 4).
 * e2e hits HOST pg/redis (localhost); flush host redis if stale 429s.
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

const C_LAT = 55.7558; // Moscow center
const C_LNG = 37.6173;

describe('Listings Slice 2 — search (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const animals: string[] = [];
  const listingIds: string[] = [];
  let sellerId: string;
  let sellerTok: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  let petSp: number;
  let liveSp: number;
  let petBreed: number;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  /** Seed an ACTIVE+APPROVED listing for `speciesId` at the given coords (null = no coords). */
  const seedActive = async (
    speciesId: number,
    opts: { lat?: number | null; lng?: number | null; priceCents?: number; titleEn?: string; searchRadiusM?: number } = {},
  ): Promise<string> => {
    const animal = await prisma.animals.create({
      data: {
        owner_id: sellerId,
        species_id: speciesId,
        nickname_localized: { en: 'GeoA', ru: 'Гео' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
        breed_text_localized: { en: 'mix', ru: 'микс' },
      },
    });
    animals.push(animal.id);
    const listing = await prisma.listings.create({
      data: {
        animal_id: animal.id,
        seller_id: sellerId,
        listing_type: 'sale',
        title_localized: { en: opts.titleEn ?? 'GeoListing', ru: 'Объявление' },
        status: 'ACTIVE',
        moderation_status: 'APPROVED',
        is_active: true,
        price_cents: opts.priceCents ?? 5000,
        lat: opts.lat === undefined ? C_LAT : opts.lat,
        lng: opts.lng === undefined ? C_LNG : opts.lng,
        ...(opts.searchRadiusM !== undefined ? { search_radius_m: opts.searchRadiusM } : {}),
      },
    });
    listingIds.push(listing.id);
    return listing.id;
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

    sellerId = (await prisma.users.create({ data: { full_name: 'GeoSeller', role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } })).id;
    sellerTok = await devToken(sellerId);

    petSp = (await prisma.species.create({ data: { code: `geo_pet_${suffix}`, name_localized: { en: 'Dog', ru: 'Пёс' }, market: 'pet' } })).id;
    liveSp = (await prisma.species.create({ data: { code: `geo_live_${suffix}`, name_localized: { en: 'Cow', ru: 'Корова' }, market: 'livestock' } })).id;
    petBreed = (await prisma.breeds.create({ data: { code: `geo_br_${suffix}`, species_id: petSp, name_localized: { en: 'Akita', ru: 'Акита' } } })).id;
  });

  afterAll(async () => {
    for (const id of listingIds) await prisma.listings.delete({ where: { id } }).catch(() => undefined);
    for (const id of animals) {
      await prisma.listings.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    }
    if (petBreed) await prisma.breeds.delete({ where: { id: petBreed } }).catch(() => undefined);
    for (const sp of [petSp, liveSp]) if (sp) await prisma.species.delete({ where: { id: sp } }).catch(() => undefined);
    if (sellerId) await prisma.users.delete({ where: { id: sellerId } }).catch(() => undefined);
    await app.close();
  });

  const ids = (res: { body: { items: { id: string }[] } }): string[] => res.body.items.map((i) => i.id);

  // ── L2-2 conditional-required market ──────────────────────────────────────────────────────────
  it('L2-2: an anonymous read with no market → 422 MARKET_REQUIRED', async () => {
    const res = await request(server()).get('/v1/listings').expect(422);
    expect(res.body.code).toBe('MARKET_REQUIRED');
  });

  it('L2-2: an authenticated owner-scoped read without market is allowed', async () => {
    await request(server()).get('/v1/listings').set('Authorization', `Bearer ${sellerTok}`).expect(200);
  });

  // ── L2-1 market no-leak ───────────────────────────────────────────────────────────────────────
  it('L2-1: market=pet never returns a livestock listing, even with a crafted livestock species_id', async () => {
    const petL = await seedActive(petSp, { titleEn: 'PetOne' });
    const liveL = await seedActive(liveSp, { titleEn: 'LiveOne' });

    const pet = await request(server()).get(`/v1/listings?market=pet&limit=100`).expect(200);
    expect(ids(pet)).toContain(petL);
    expect(ids(pet)).not.toContain(liveL);

    // Crafted: ask for market=pet but pass the LIVESTOCK species_id → AND-intersect → empty, never a leak.
    const crafted = await request(server()).get(`/v1/listings?market=pet&species_id=${liveSp}&limit=100`).expect(200);
    expect(ids(crafted)).not.toContain(liveL);
    expect(ids(crafted)).not.toContain(petL);

    // And the inverse holds.
    const live = await request(server()).get(`/v1/listings?market=livestock&limit=100`).expect(200);
    expect(ids(live)).toContain(liveL);
    expect(ids(live)).not.toContain(petL);
  });

  it('species_id + breed_id narrow within the market', async () => {
    const withBreed = await prisma.animals.create({
      data: { owner_id: sellerId, species_id: petSp, breed_id: petBreed, nickname_localized: { en: 'B', ru: 'Б' }, sex: 'Male', date_of_birth: new Date('2021-01-01T00:00:00Z') },
    });
    animals.push(withBreed.id);
    const l = await prisma.listings.create({
      data: { animal_id: withBreed.id, seller_id: sellerId, listing_type: 'sale', title_localized: { en: 'Breed', ru: 'П' }, status: 'ACTIVE', moderation_status: 'APPROVED', is_active: true, price_cents: 5000, lat: C_LAT, lng: C_LNG },
    });
    listingIds.push(l.id);
    const res = await request(server()).get(`/v1/listings?market=pet&species_id=${petSp}&breed_id=${petBreed}&limit=100`).expect(200);
    expect(ids(res)).toContain(l.id);
  });

  // ── L2-7 Haversine boundary + L2-14 distanceM ─────────────────────────────────────────────────
  it('L2-7/L2-14: 10km radius — just-inside included, at-radius included (±100m), just-outside excluded; distanceM set', async () => {
    const inside = await seedActive(petSp, { lat: C_LAT + 9000 / 111320, lng: C_LNG, titleEn: 'inside9' }); // ~8990m
    const atRadius = await seedActive(petSp, { lat: C_LAT + 10000 / 111320, lng: C_LNG, titleEn: 'at10' }); // ~9989m
    const outside = await seedActive(petSp, { lat: C_LAT + 11000 / 111320, lng: C_LNG, titleEn: 'out11' }); // ~10988m

    const res = await request(server()).get(`/v1/listings?market=pet&lat=${C_LAT}&lng=${C_LNG}&radius_km=10&limit=100`).expect(200);
    const got = ids(res);
    expect(got).toContain(inside);
    expect(got).toContain(atRadius); // within ±100m tolerance
    expect(got).not.toContain(outside);

    // distanceM present, rounded meters, and monotonic with the seeded distances.
    const items = res.body.items as { id: string; distanceM: number | null }[];
    const byId = new Map(items.map((i) => [i.id, i.distanceM]));
    expect(byId.get(inside)).toBeGreaterThan(8000);
    expect(byId.get(inside)).toBeLessThan(9500);
    expect(byId.get(atRadius)).toBeGreaterThan(9500);
  });

  it('L2-14: distanceM is null off the geo path', async () => {
    const res = await request(server()).get(`/v1/listings?market=pet&limit=5`).expect(200);
    for (const it of res.body.items as { distanceM: number | null }[]) {
      expect(it.distanceM).toBeNull();
    }
  });

  // ── L2-8 bbox loss-less + L2-9 NULL-coords excluded ───────────────────────────────────────────
  it('L2-9: a NULL-coords listing is excluded from a geo search', async () => {
    const noCoords = await seedActive(petSp, { lat: null, lng: null, titleEn: 'nocoords' });
    const res = await request(server()).get(`/v1/listings?market=pet&lat=${C_LAT}&lng=${C_LNG}&radius_km=50&limit=100`).expect(200);
    expect(ids(res)).not.toContain(noCoords);
    // But it IS returned by a non-geo market search.
    const nogeo = await request(server()).get(`/v1/listings?market=pet&limit=100`).expect(200);
    expect(ids(nogeo)).toContain(noCoords);
  });

  it('L2-8: a point near the bbox corner (NE diagonal) that is in-circle is still returned', async () => {
    // ~6.3km E + ~6.3km N ≈ 8.9km diagonal (inside a 10km circle) but near the bbox corner.
    const dLat = 6300 / 111320;
    const dLng = 6300 / (111320 * Math.cos((C_LAT * Math.PI) / 180));
    const corner = await seedActive(petSp, { lat: C_LAT + dLat, lng: C_LNG + dLng, titleEn: 'corner' });
    const res = await request(server()).get(`/v1/listings?market=pet&lat=${C_LAT}&lng=${C_LNG}&radius_km=10&limit=100`).expect(200);
    expect(ids(res)).toContain(corner);
  });

  // ── L2-10 antimeridian ────────────────────────────────────────────────────────────────────────
  it('L2-10: an antimeridian-crossing bbox still returns an in-radius point on the wrapped side (RF far-east)', async () => {
    const acLat = 66.0;
    const acLng = 179.9; // search center just west of +180
    const wrapped = await seedActive(petSp, { lat: acLat, lng: -179.95, titleEn: 'wrapped' }); // ~6.8km across ±180
    const res = await request(server()).get(`/v1/listings?market=pet&lat=${acLat}&lng=${acLng}&radius_km=10&limit=100`).expect(200);
    expect(ids(res)).toContain(wrapped);
  });

  // ── L2-16 search_radius_m is NOT the search radius ────────────────────────────────────────────
  it('L2-16: a listing inside radius_km with a tiny search_radius_m is STILL returned (query radius is authoritative)', async () => {
    // ~5km from center, well inside a 10km query, but its own search_radius_m is 1 m. If the geo query
    // wrongly used the row's search_radius_m as the radius, this listing would be excluded.
    const tinyOwnRadius = await seedActive(petSp, {
      lat: C_LAT + 5000 / 111320,
      lng: C_LNG,
      titleEn: 'tinyradius',
      searchRadiusM: 1,
    });
    const res = await request(server())
      .get(`/v1/listings?market=pet&lat=${C_LAT}&lng=${C_LNG}&radius_km=10&limit=100`)
      .expect(200);
    expect(ids(res)).toContain(tinyOwnRadius);
  });

  // ── L2-13 deterministic order + sort ──────────────────────────────────────────────────────────
  it('L2-13: sort=distance:asc orders nearest-first', async () => {
    const res = await request(server()).get(`/v1/listings?market=pet&lat=${C_LAT}&lng=${C_LNG}&radius_km=100&sort=distance:asc&limit=100`).expect(200);
    const dists = (res.body.items as { distanceM: number | null }[]).map((i) => i.distanceM ?? Infinity);
    for (let i = 1; i < dists.length; i++) expect(dists[i]).toBeGreaterThanOrEqual(dists[i - 1]);
  });

  it('sort=price:asc orders cheapest-first within the market', async () => {
    const res = await request(server()).get(`/v1/listings?market=pet&sort=price:asc&limit=100`).expect(200);
    const prices = (res.body.items as { priceCents: number | null }[]).map((i) => i.priceCents ?? Infinity);
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
  });

  // ── validation: 400 / 422 ─────────────────────────────────────────────────────────────────────
  it('L2-3: a partial geo set → 422 GEO_PARAMS_INCOMPLETE', async () => {
    const res = await request(server()).get(`/v1/listings?market=pet&lat=${C_LAT}&lng=${C_LNG}`).expect(422);
    expect(res.body.code).toBe('GEO_PARAMS_INCOMPLETE');
  });

  it('L2-4: radius out of range → 422 RADIUS_OUT_OF_RANGE', async () => {
    const res = await request(server()).get(`/v1/listings?market=pet&lat=${C_LAT}&lng=${C_LNG}&radius_km=200`).expect(422);
    expect(res.body.code).toBe('RADIUS_OUT_OF_RANGE');
  });

  it('L2-11: unknown sort → 400; L2-12: sort=distance without coords → 400', async () => {
    await request(server()).get(`/v1/listings?market=pet&sort=bogus:asc`).expect(400);
    await request(server()).get(`/v1/listings?market=pet&sort=distance:asc`).expect(400);
  });
});
