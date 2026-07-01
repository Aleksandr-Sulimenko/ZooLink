/**
 * Impl-wave C / Q3 — contact-exchange (spec 16, no-chat MVP), mark-sold (ACTIVE→SOLD), and the
 * seller analytics source — end-to-end against the real stack (PG + Redis). Exercises the reveal
 * gating (auth / ACTIVE-only / self-reveal), the seller-enabled channel filter, `contact_phone`
 * decryption at reveal (ADR-0019), the per-market Redis rate limit (pet 10/h → 429 + Retry-After),
 * the guarded ACTIVE→SOLD transition (+ `Listing.Sold` / `ContactReveal.Created` outbox rows), and the
 * owner-scoped analytics read (contactReveals sourced from `contact_reveals`; views 0 in MVP).
 * e2e hits HOST pg/redis (localhost); flush host redis if stale 429s.
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
import { CryptoService } from '../src/lib/crypto/crypto.service';
import { RedisService } from '../src/lib/redis/redis.service';
import { resetThrottle } from './throttle-reset.util';

describe('Contact reveal + mark-sold + analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let crypto: CryptoService;
  let redis: RedisService;
  const listings: string[] = [];
  const animalsCreated: string[] = [];
  const users: string[] = [];
  let sellerId: string;
  let buyerId: string;
  let modId: string;
  let sellerTok: string;
  let buyerTok: string;
  let modTok: string;
  const suffix = Math.random().toString(36).slice(2, 8);
  let speciesId: number;
  let breedId: number;

  const SELLER_PHONE = '+79991234567';
  const SELLER_TG = 'sellertg';

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const mkUser = async (name: string, role: string, extra: Record<string, unknown> = {}): Promise<string> => {
    const u = await prisma.users.create({
      data: { full_name: name, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true, ...extra },
    });
    users.push(u.id);
    return u.id;
  };

  const newAnimal = async (owner: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: {
        owner_id: owner,
        species_id: speciesId,
        breed_id: breedId,
        nickname_localized: { en: 'Sold', ru: 'Прод' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animalsCreated.push(a.id);
    return a.id;
  };

  /** Seed an ACTIVE + APPROVED listing owned by `sellerId` (moderator approval is out of this slice). */
  const activeListing = async (over: Record<string, unknown> = {}): Promise<string> => {
    const animalId = await newAnimal(sellerId);
    const l = await prisma.listings.create({
      data: {
        animal_id: animalId,
        seller_id: sellerId,
        listing_type: 'sale',
        title_localized: { en: 'Puppy', ru: 'Щенок' },
        description_localized: { en: '', ru: '' },
        price_cents: 5000,
        currency: 'RUB',
        quantity: 1,
        status: 'ACTIVE',
        moderation_status: 'APPROVED',
        is_active: true,
        ...over,
      },
    });
    listings.push(l.id);
    return l.id;
  };

  const getEtag = async (tok: string, id: string): Promise<string> => {
    const r = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${tok}`).expect(200);
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
    crypto = app.get(CryptoService);
    redis = app.get(RedisService);

    // Seller's contact_phone is stored field-encrypted (ADR-0019); telegram is plaintext; both channels on.
    sellerId = await mkUser('CSeller', 'USER', {
      contact_phone: crypto.encrypt(SELLER_PHONE),
      contact_telegram: SELLER_TG,
      contact_prefs: { show_phone: true, show_telegram: true },
    });
    buyerId = await mkUser('CBuyer', 'USER');
    modId = await mkUser('CMod', 'MODERATOR');
    [sellerTok, buyerTok, modTok] = await Promise.all([devToken(sellerId), devToken(buyerId), devToken(modId)]);

    const sp = await prisma.species.create({ data: { code: `cs_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `cs_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    for (const id of listings) {
      await prisma.outbox_events.deleteMany({ where: { aggregate_id: id } }).catch(() => undefined);
      await prisma.contact_reveals.deleteMany({ where: { listing_id: id } }).catch(() => undefined);
      await prisma.listing_photos.deleteMany({ where: { listing_id: id } }).catch(() => undefined);
      await prisma.listings.delete({ where: { id } }).catch(() => undefined);
    }
    for (const id of animalsCreated) {
      await prisma.listings.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    }
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of users) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── Contact reveal ─────────────────────────────────────────────────────────────────────────
  describe('POST /v1/listings/{id}/contact-reveal', () => {
    it('requires auth (401)', async () => {
      const id = await activeListing();
      await request(server()).post(`/v1/listings/${id}/contact-reveal`).expect(401);
    });

    it('reveals the seller-enabled channels (phone decrypted at reveal, ADR-0019) and logs a row', async () => {
      const id = await activeListing();
      const res = await request(server())
        .post(`/v1/listings/${id}/contact-reveal`)
        .set('Authorization', `Bearer ${buyerTok}`)
        .expect(200);
      expect(res.body).toMatchObject({ listingId: id, sellerId, sellerName: 'CSeller' });
      expect(res.body.channels).toEqual({ phone: SELLER_PHONE, telegram: SELLER_TG });
      const row = await prisma.contact_reveals.findFirst({ where: { listing_id: id, viewer_id: buyerId } });
      expect(row).not.toBeNull();
      const evt = await prisma.outbox_events.findFirst({ where: { aggregate_id: id, event_type: 'ContactReveal.Created' } });
      expect(evt).not.toBeNull();
      expect((evt!.payload as Record<string, unknown>).market).toBe('pet'); // envelope (ADR-0002)
    });

    it('self-reveal → 422 SELF_REVEAL (nothing logged)', async () => {
      const id = await activeListing();
      const res = await request(server())
        .post(`/v1/listings/${id}/contact-reveal`)
        .set('Authorization', `Bearer ${sellerTok}`)
        .expect(422);
      expect(res.body.code).toBe('SELF_REVEAL');
      const count = await prisma.contact_reveals.count({ where: { listing_id: id } });
      expect(count).toBe(0);
    });

    it('a non-ACTIVE (DRAFT) listing → 404 (no existence leak)', async () => {
      const id = await activeListing({ status: 'DRAFT', moderation_status: 'PENDING', is_active: false });
      await request(server())
        .post(`/v1/listings/${id}/contact-reveal`)
        .set('Authorization', `Bearer ${buyerTok}`)
        .expect(404);
    });

    it('returns only the seller-enabled channels (a seller with telegram off → phone only)', async () => {
      const phoneOnlySeller = await mkUser('PhoneOnly', 'USER', {
        contact_phone: crypto.encrypt('+70001112233'),
        contact_telegram: 'hidden',
        contact_prefs: { show_phone: true, show_telegram: false },
      });
      const animalId = await prisma.animals
        .create({ data: { owner_id: phoneOnlySeller, species_id: speciesId, breed_id: breedId, nickname_localized: { en: 'P', ru: 'П' }, sex: 'Male', date_of_birth: new Date('2021-01-01T00:00:00Z') } })
        .then((a) => {
          animalsCreated.push(a.id);
          return a.id;
        });
      const l = await prisma.listings.create({
        data: { animal_id: animalId, seller_id: phoneOnlySeller, listing_type: 'sale', title_localized: { en: 'X', ru: 'X' }, price_cents: 5000, status: 'ACTIVE', moderation_status: 'APPROVED', is_active: true },
      });
      listings.push(l.id);
      const res = await request(server()).post(`/v1/listings/${l.id}/contact-reveal`).set('Authorization', `Bearer ${buyerTok}`).expect(200);
      expect(res.body.channels).toEqual({ phone: '+70001112233' });
    });

    it('pet market: the 11th reveal within the hour → 429 with Retry-After (spec 16)', async () => {
      // A dedicated fresh buyer so this test owns the whole hourly budget.
      const limitBuyer = await mkUser('LimitBuyer', 'USER');
      const limitTok = await devToken(limitBuyer);
      await redis.client.del(`contact-reveal:pet:${limitBuyer}`);
      const id = await activeListing();
      for (let i = 0; i < 10; i++) {
        await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${limitTok}`).expect(200);
      }
      const res = await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${limitTok}`).expect(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
      // Exactly the 10 successful reveals are logged; the 11th (over-limit) logged nothing.
      const count = await prisma.contact_reveals.count({ where: { listing_id: id, viewer_id: limitBuyer } });
      expect(count).toBe(10);
    });

    it('Idempotency-Key replay returns the cached reveal without consuming quota', async () => {
      const idemBuyer = await mkUser('IdemBuyer', 'USER');
      const idemTok = await devToken(idemBuyer);
      await redis.client.del(`contact-reveal:pet:${idemBuyer}`);
      const id = await activeListing();
      const key = randomUUID();
      await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${idemTok}`).set('Idempotency-Key', key).expect(200);
      await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${idemTok}`).set('Idempotency-Key', key).expect(200);
      const count = await prisma.contact_reveals.count({ where: { listing_id: id, viewer_id: idemBuyer } });
      expect(count).toBe(1); // the replay did not execute a second reveal
    });
  });

  // ── Mark sold ──────────────────────────────────────────────────────────────────────────────
  describe('POST /v1/listings/{id}/mark-sold', () => {
    it('owner marks an ACTIVE listing SOLD: sold_at set, removed from search, Listing.Sold emitted', async () => {
      const id = await activeListing();
      const etag = await getEtag(sellerTok, id);
      const res = await request(server())
        .post(`/v1/listings/${id}/mark-sold`)
        .set('Authorization', `Bearer ${sellerTok}`)
        .set('If-Match', etag)
        .expect(200);
      expect(res.body.status).toBe('SOLD');
      expect(res.body.isActive).toBe(false);
      expect(res.body.soldAt).not.toBeNull();
      const row = await prisma.listings.findUnique({ where: { id } });
      expect(row!.sold_at).not.toBeNull();
      const evt = await prisma.outbox_events.findFirst({ where: { aggregate_id: id, event_type: 'Listing.Sold' } });
      expect(evt).not.toBeNull();
    });

    it('SOLD does NOT auto-initiate ownership transfer (ADR-0013)', async () => {
      const id = await activeListing();
      const animal = (await prisma.listings.findUnique({ where: { id } }))!.animal_id;
      const etag = await getEtag(sellerTok, id);
      await request(server()).post(`/v1/listings/${id}/mark-sold`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).expect(200);
      const transfers = await prisma.ownership_transfers.count({ where: { animal_id: animal } });
      expect(transfers).toBe(0);
    });

    it('owner-only: a non-owner → 403', async () => {
      const id = await activeListing();
      const etag = await getEtag(sellerTok, id);
      await request(server()).post(`/v1/listings/${id}/mark-sold`).set('Authorization', `Bearer ${buyerTok}`).set('If-Match', etag).expect(403);
    });

    it('missing If-Match → 428', async () => {
      const id = await activeListing();
      await request(server()).post(`/v1/listings/${id}/mark-sold`).set('Authorization', `Bearer ${sellerTok}`).expect(428);
    });

    it('a repeat mark-sold on an already-SOLD listing → 409 LISTING_NOT_ACTIVE', async () => {
      const id = await activeListing();
      const etag = await getEtag(sellerTok, id);
      await request(server()).post(`/v1/listings/${id}/mark-sold`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag).expect(200);
      const etag2 = await getEtag(sellerTok, id);
      const res = await request(server()).post(`/v1/listings/${id}/mark-sold`).set('Authorization', `Bearer ${sellerTok}`).set('If-Match', etag2).expect(409);
      expect(res.body.code).toBe('LISTING_NOT_ACTIVE');
    });
  });

  // ── Analytics ──────────────────────────────────────────────────────────────────────────────
  describe('GET /v1/listings/{id}/analytics', () => {
    it('owner sees contactReveals sourced from the table; views is 0 in MVP; ETag + Cache-Control set', async () => {
      const id = await activeListing();
      await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${buyerTok}`).expect(200);
      const res = await request(server()).get(`/v1/listings/${id}/analytics`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
      expect(res.body).toMatchObject({ listingId: id, views: 0, contactReveals: 1 });
      expect(res.body.lastActivityAt).not.toBeNull();
      expect(res.headers['etag']).toBeDefined();
      expect(res.headers['cache-control']).toContain('private');
    });

    it('a non-owner → 404 (no-leak), even on a public ACTIVE listing', async () => {
      const id = await activeListing();
      await request(server()).get(`/v1/listings/${id}/analytics`).set('Authorization', `Bearer ${buyerTok}`).expect(404);
    });

    it('a MODERATOR (operator) may read analytics', async () => {
      const id = await activeListing();
      await request(server()).get(`/v1/listings/${id}/analytics`).set('Authorization', `Bearer ${modTok}`).expect(200);
    });

    it('requires auth (401)', async () => {
      const id = await activeListing();
      await request(server()).get(`/v1/listings/${id}/analytics`).expect(401);
    });
  });
});
