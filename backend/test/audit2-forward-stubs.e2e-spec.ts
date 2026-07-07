/**
 * AUDIT2 — Phase-3 FORWARD test stubs (laid AHEAD of the unbuilt ecosystem surfaces, per the owner's
 * "нет теста → не done, tests ahead for the unbuilt"). The unbuilt surfaces remain `it.todo`
 * placeholders so the ecosystem seams have a target and cannot regress silently when they land.
 * Anchors: future-features.md (OfferingRef seam :210, find-nearby :194, reviews :174/:177),
 * ADR-0014/0015 (polymorphic Offering + market_scope), 0027 goods_marketplace toggle.
 *
 * Wave G revival: two of the original stubs have since been BUILT — favorites (D11) + the OfferingRef
 * seam (D2, migration 0032) and views-capture (D1, migration 0031). Their `it.todo`s are promoted here
 * to REAL passing tests that drive the live stack, so the forward-ledger flips green when the seam lands
 * (owner rule "нет теста → не done"). Deep/canonical coverage lives in `favorite.e2e-spec.ts` and
 * `listing-contact-sold.e2e-spec.ts`; these are the lean seam-reached tripwires in the forward ledger.
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

describe('AUDIT2 forward stubs — NOW BUILT (revived to real passing tests)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);

  let sellerId: string;
  let buyerId: string;
  let sellerTok: string;
  let buyerTok: string;
  let speciesId: number;
  let breedId: number;
  const users: string[] = [];
  const animalsCreated: string[] = [];
  const listings: string[] = [];

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const mkUser = async (name: string): Promise<string> => {
    const u = await prisma.users.create({ data: { full_name: name, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    users.push(u.id);
    return u.id;
  };

  /** Seed an ACTIVE+APPROVED listing owned by `seller` (public), returning its id. */
  const seedActiveListing = async (seller: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: { owner_id: seller, species_id: speciesId, breed_id: breedId, nickname_localized: { en: 'F', ru: 'И' }, sex: 'Male', date_of_birth: new Date('2021-01-01T00:00:00Z') },
    });
    animalsCreated.push(a.id);
    const l = await prisma.listings.create({
      data: {
        animal_id: a.id, seller_id: seller, listing_type: 'sale', market: 'pet',
        title_localized: { en: 'L', ru: 'Л' }, description_localized: { en: '', ru: '' },
        price_cents: 5000, currency: 'RUB', quantity: 1,
        status: 'ACTIVE', moderation_status: 'APPROVED', is_active: true,
      },
    });
    listings.push(l.id);
    return l.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    prisma = app.get(PrismaService);

    sellerId = await mkUser('FwdSeller');
    buyerId = await mkUser('FwdBuyer');
    [sellerTok, buyerTok] = await Promise.all([devToken(sellerId), devToken(buyerId)]);
    const sp = await prisma.species.create({ data: { code: `fwd_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `fwd_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    await prisma.favorites.deleteMany({ where: { user_id: { in: users } } }).catch(() => undefined);
    for (const id of listings) await prisma.listings.delete({ where: { id } }).catch(() => undefined);
    for (const id of animalsCreated) await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of users) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── Favorites (D11) + OfferingRef{type,id} seam (D2, migration 0032) — was it.todo L22 ──────────
  it('favorites: favorite is idempotent, own-scoped, and carries the OfferingRef{type,id} pair (D11 + D2)', async () => {
    const listing = await seedActiveListing(sellerId);
    const add = await request(server())
      .post(`/v1/listings/${listing}/favorite`)
      .set('Authorization', `Bearer ${buyerTok}`)
      .set('Idempotency-Key', randomUUID())
      .send()
      .expect(201);
    // OfferingRef seam reached: offeringType/offeringId written (== listingId today; polymorphic-ready).
    expect(add.body.offeringType).toBe('ANIMAL_LISTING');
    expect(add.body.offeringId).toBe(listing);
    expect(add.body.listingId).toBe(listing); // deprecated read-only alias == offeringId

    // Idempotent add (distinct key) → same row, no duplicate.
    const again = await request(server())
      .post(`/v1/listings/${listing}/favorite`)
      .set('Authorization', `Bearer ${buyerTok}`)
      .set('Idempotency-Key', randomUUID())
      .send()
      .expect(201);
    expect(again.body.id).toBe(add.body.id);

    // Own-scoped list: the buyer sees it; the seller (a different principal) does not.
    const mine = (await request(server()).get('/v1/favorites?limit=100').set('Authorization', `Bearer ${buyerTok}`).expect(200)).body.items as { listingId: string }[];
    expect(mine.map((r) => r.listingId)).toContain(listing);
    const sellersFavs = (await request(server()).get('/v1/favorites?limit=100').set('Authorization', `Bearer ${sellerTok}`).expect(200)).body.items as { listingId: string }[];
    expect(sellersFavs.map((r) => r.listingId)).not.toContain(listing);
  });

  // ── View-capture funnel (D1, migration 0031) — analytics.views no longer hard-0 — was it.todo L34 ─
  it('view-capture: a buyer detail-GET increments listings.view_count → owner analytics.views ≥ 1 (D1)', async () => {
    const listing = await seedActiveListing(sellerId);
    // A buyer (not the seller) reads the public detail → best-effort deduped +1 on view_count.
    const get = await request(server()).get(`/v1/listings/${listing}`).set('Authorization', `Bearer ${buyerTok}`).expect(200);
    expect(get.body.viewCount).toBe(0); // pre-increment value returned to this reader
    const analytics = await request(server()).get(`/v1/listings/${listing}/analytics`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect(analytics.body.views).toBeGreaterThanOrEqual(1); // the day-1 funnel signal is live (was hard-0)
  });
});

describe('AUDIT2 forward stubs — unbuilt ecosystem surfaces (it.todo)', () => {
  // ── Polymorphic Offering (ADR-0014/0015) — undo the animal-bound coupling (listing.service.ts:146) ──
  it.todo('Offering: POST an Offering with NO animalId → 201 (species-less; market from market_scope, not marketOf)');
  it.todo('Offering: market_scope ∈ {pet,livestock,both} drives discovery/moderation instead of species');

  // ── find-nearby provider directory (future-features.md:194) — reuse Haversine fixture ──
  it.todo('find-nearby: returns species-less providers within radius, sorted by distanceM ascending');

  // ── Reviews / reputation / verification (future-features.md:174,177; ADR-E) ──
  it.todo('reviews: a buyer can review only AFTER a completed transaction');
  it.todo('reviews: exactly one review per (reviewer, subject); reputation aggregates');
  it.todo('verification: provider-verification badge gate (regulated categories: vet/livestock)');

  // ── Booking (ServiceOffering/consultation) ──
  it.todo('booking: book a service slot; double-book → 409; cancel state machine');

  // ── goods_marketplace toggle (migration 0027) — default OFF; no code reads it yet (behaviour deferred) ──
  it.todo('goods toggle: goods listings gated OFF by default; explicit flip-on path exercised');

  // ── Progressive / multi-role acquisition (active-user #3; ADR-0022 user_roles junction is DORMANT) ──
  it.todo('progressive-role: a USER self-requests BREEDER/FARMER via a self-service claim seam (not ADMIN-only)');
});
