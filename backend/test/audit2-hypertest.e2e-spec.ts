/**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * AUDIT2 — Phase-3 HYPER-TEST proof suite (reviewer-qa + backend-engineer)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * These are DELIBERATE PROOF tests for the confirmed AUDIT2 findings. They drive the REAL HTTP
 * stack (host PG + Redis). Each test's assertion polarity is documented inline:
 *
 *   • RED (expected-to-FAIL today) — asserts the DESIRED behaviour; failing = the bug is real.
 *       Owner rule "нет теста → не done": the test exists and stays red until the fix lands.
 *   • GREEN=finding-confirmed — asserts the CURRENT (buggy) reality; passing = the finding holds.
 *
 * Findings proven here:
 *   1. BLOCKER (active-user #1 / backend §1 / masking) — a REAL registered user (real OTP flow,
 *      NOT a fixture that pre-seeds contact_phone) reveals EMPTY channels. Dead marketplace.
 *   2. ABUSE — reveal-quota Sybil reset (new account resets the per-(market,viewer) cap).
 *   3. ABUSE — per-user listing flood (no creation quota).
 *   4. HIDDEN-COST — reveal quota + reveal-row burned even when channels resolve empty.
 *   5. SECURITY (security §headline break) — animal getById is an EXISTENCE ORACLE: 403 for an
 *      existing non-owned id vs 404 for a missing id (violates the 404-no-leak invariant).
 *
 * Run: `npx jest --config test/jest-e2e.json --runInBand --forceExit -t AUDIT2` (flush Redis first).
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
import { SMS_PROVIDER } from '../src/lib/providers';
import type { SmsMessage, SmsSendResult } from '../src/lib/providers';
import { PrismaService } from '../src/lib/db/prisma.service';
import { RedisService } from '../src/lib/redis/redis.service';
import { resetThrottle } from './throttle-reset.util';

describe('AUDIT2 hyper-test proofs (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;

  const sentCodes: string[] = [];
  const users: string[] = [];
  const animalsCreated: string[] = [];
  const listings: string[] = [];
  const suffix = Math.random().toString(36).slice(2, 8);
  let speciesId: number;
  let breedId: number;

  const server = (): Server => app.getHttpServer() as Server;

  const capturingSms = {
    sendSms: (msg: SmsMessage): Promise<SmsSendResult> => {
      const m = /(\d{6})/.exec(msg.text);
      if (m) sentCodes.push(m[1]);
      return Promise.resolve({ accepted: true, providerMessageId: null });
    },
  };

  /** Register + verify a REAL user through the actual phone-OTP flow (OTP captured via the SMS spy). */
  const registerVerify = async (fullName: string): Promise<{ userId: string; token: string }> => {
    const phone = `+7999${Math.floor(1000000 + Math.random() * 8999999)}`;
    await request(server()).post('/v1/auth/register/phone').send({ phone, fullName }).expect(202);
    const code = sentCodes[sentCodes.length - 1];
    const res = await request(server()).post('/v1/auth/verify-phone').send({ phone, code }).expect(200);
    const userId = res.body.user.id as string;
    users.push(userId);
    return { userId, token: res.body.accessToken as string };
  };

  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const mkUser = async (name: string, role: string): Promise<string> => {
    const u = await prisma.users.create({
      data: { full_name: name, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true },
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
        nickname_localized: { en: 'A2', ru: 'А2' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animalsCreated.push(a.id);
    return a.id;
  };

  /** Real seller creates a listing via the public API, adds a photo, submits, then a moderator APPROVEs → ACTIVE. */
  const createActiveListingViaApi = async (sellerTok: string, modTok: string): Promise<string> => {
    // seller is a real registered USER (in WRITE_ROLES); the animal owner is that same real seller.
    const meId = (await request(server()).get('/v1/me').set('Authorization', `Bearer ${sellerTok}`).expect(200)).body.id as string;
    const animalId = await newAnimal(meId);
    const created = await request(server())
      .post('/v1/listings')
      .set('Authorization', `Bearer ${sellerTok}`)
      .set('Idempotency-Key', randomUUID())
      .send({ animalId, listingType: 'sale', titleLocalized: { en: 'Kitten', ru: 'Котёнок' }, priceCents: 5000 })
      .expect(201);
    const id = created.body.id as string;
    listings.push(id);
    await request(server())
      .post(`/v1/listings/${id}/photos`)
      .set('Authorization', `Bearer ${sellerTok}`)
      .set('Idempotency-Key', randomUUID())
      .send({ url: `http://x/${randomUUID()}.jpg` })
      .expect(201);
    const etag = (await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200)).headers['etag'];
    await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    await request(server()).post(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);
    await request(server()).post('/v1/moderation/action').set('Authorization', `Bearer ${modTok}`).send({ listingId: id, action: 'APPROVE' }).expect(200);
    return id;
  };

  let seller: { userId: string; token: string };
  let modTok: string;
  let buyerTok: string;
  let buyerId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_PROVIDER)
      .useValue(capturingSms)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService);

    const sp = await prisma.species.create({ data: { code: `a2_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `a2_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;

    seller = await registerVerify('A2 RealSeller'); // ← the crux: a REAL registered seller, no pre-seeded contact_phone
    const modId = await mkUser('A2 Mod', 'MODERATOR');
    modTok = await devToken(modId);
    buyerId = await mkUser('A2 Buyer', 'USER');
    buyerTok = await devToken(buyerId);
  });

  afterAll(async () => {
    for (const id of listings) {
      await prisma.moderation_decisions.deleteMany({ where: { entity_id: id } }).catch(() => undefined);
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
    for (const id of users) {
      await prisma.audit_log.deleteMany({ where: { actor_id: id } }).catch(() => undefined);
      await prisma.refresh_tokens.deleteMany({ where: { user_id: id } }).catch(() => undefined);
      await prisma.users.delete({ where: { id } }).catch(() => undefined);
    }
    await app.close();
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 1. BLOCKER — the dead marketplace (real registered seller reveals empty channels)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe('BLOCKER: contact-reveal for a REAL registered seller', () => {
    it('AUDIT2 root-cause (GREEN=confirmed): PATCH /v1/me CANNOT set contactPhone/contactTelegram/showPhone (400 forbidNonWhitelisted)', async () => {
      // forbidNonWhitelisted fires in the ValidationPipe before the handler → no If-Match needed.
      const res = await request(server())
        .patch('/v1/me')
        .set('Authorization', `Bearer ${seller.token}`)
        .send({ contactPhone: '+79990001122', contactTelegram: 'realseller', showPhone: true })
        .expect(400);
      // The body carries ONLY non-whitelisted props, so a 400 can ONLY be forbidNonWhitelisted →
      // proves there is genuinely no DTO path to set contact channels for a real user.
      expect(String(res.body.detail ?? res.body.message ?? res.body.title ?? '')).toMatch(/validation|should not exist|contactPhone/i);
      // And the profile still exposes no contact channel afterwards.
      const me = await request(server()).get('/v1/me').set('Authorization', `Bearer ${seller.token}`).expect(200);
      expect(me.body.contactPhone).toBeUndefined();
      expect(me.body.contactTelegram).toBeUndefined();
    });

    it('AUDIT2 reality-lock (GREEN=confirmed): a REAL seller listing → buyer reveal returns EMPTY channels', async () => {
      const id = await createActiveListingViaApi(seller.token, modTok);
      const res = await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${buyerTok}`).expect(200);
      expect(res.body.sellerId).toBe(seller.userId);
      expect(res.body.channels).toEqual({}); // ← the dead marketplace, in one assertion
    });

    it('AUDIT2 BLOCKER PROOF (RED=expected-to-fail): a real buyer SHOULD receive at least one usable channel', async () => {
      const id = await createActiveListingViaApi(seller.token, modTok);
      const res = await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${buyerTok}`).expect(200);
      // DESIRED behaviour — fails today because no writer/editor exists for contact_phone/telegram/prefs.
      expect(Object.keys(res.body.channels as Record<string, unknown>).length).toBeGreaterThan(0);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 4. HIDDEN-COST — quota + reveal-row burned even when channels resolve empty
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe('HIDDEN-COST: reveal burns quota + writes a row before returning empty channels', () => {
    it('AUDIT2 (GREEN=confirmed): an empty-channel reveal still INCRements the Redis quota AND inserts a contact_reveals row', async () => {
      const hcBuyerId = await mkUser('A2 HcBuyer', 'USER');
      const hcTok = await devToken(hcBuyerId);
      await redis.client.del(`contact-reveal:pet:${hcBuyerId}`);
      const id = await createActiveListingViaApi(seller.token, modTok);
      const res = await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${hcTok}`).expect(200);
      expect(res.body.channels).toEqual({}); // nothing useful returned...
      // ...yet the buyer paid for it: quota consumed + a meaningless reveal row that inflates analytics.contactReveals.
      const quota = await redis.client.get(`contact-reveal:pet:${hcBuyerId}`);
      expect(Number(quota)).toBe(1);
      const rows = await prisma.contact_reveals.count({ where: { listing_id: id, viewer_id: hcBuyerId } });
      expect(rows).toBe(1);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 2. ABUSE — reveal-quota Sybil reset (a fresh account resets the per-(market,viewer) cap)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe('ABUSE: contact-reveal Sybil / cap bypass', () => {
    it('AUDIT2 (GREEN=abuse-confirmed): account B hits the pet cap (11th → 429); a NEW account C reveals the same listing → 200', async () => {
      const id = await createActiveListingViaApi(seller.token, modTok);
      const bId = await mkUser('A2 SybilB', 'USER');
      const bTok = await devToken(bId);
      await redis.client.del(`contact-reveal:pet:${bId}`);
      for (let i = 0; i < 10; i++) {
        await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${bTok}`).expect(200);
      }
      const capped = await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${bTok}`).expect(429);
      expect(capped.body.code).toBe('RATE_LIMITED');

      // Sybil: a cheap fresh account C resets the entire quota — no per-seller/per-listing/account-age cap bites.
      const cId = await mkUser('A2 SybilC', 'USER');
      const cTok = await devToken(cId);
      await redis.client.del(`contact-reveal:pet:${cId}`);
      await request(server()).post(`/v1/listings/${id}/contact-reveal`).set('Authorization', `Bearer ${cTok}`).expect(200);
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 3. ABUSE — per-user listing flood (no creation quota)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe('ABUSE: per-user listing flood', () => {
    it('AUDIT2 (GREEN=abuse-confirmed): one user creates 12 animals → 12 listings, ALL 201 — no per-user creation quota', async () => {
      const meId = (await request(server()).get('/v1/me').set('Authorization', `Bearer ${seller.token}`).expect(200)).body.id as string;
      let created = 0;
      for (let i = 0; i < 12; i++) {
        const animalId = await newAnimal(meId);
        const r = await request(server())
          .post('/v1/listings')
          .set('Authorization', `Bearer ${seller.token}`)
          .set('Idempotency-Key', randomUUID())
          .send({ animalId, listingType: 'sale', titleLocalized: { en: `Flood ${i}`, ru: `Флуд ${i}` }, priceCents: 5000 });
        if (r.status === 201) {
          created++;
          listings.push(r.body.id as string);
        }
      }
      expect(created).toBe(12); // DESIRED: a 429/QUOTA_EXCEEDED after a threshold — none exists today.
    });
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 5. SECURITY — animal getById existence oracle (403 existing non-owned vs 404 missing)
  // ════════════════════════════════════════════════════════════════════════════════════════════
  describe('SECURITY: animal getById existence oracle (404-no-leak invariant break)', () => {
    it('AUDIT2 (GREEN=finding-confirmed): existing non-owned animal → 403, missing id → 404 (distinguishable = oracle)', async () => {
      const meId = (await request(server()).get('/v1/me').set('Authorization', `Bearer ${seller.token}`).expect(200)).body.id as string;
      const ownedByseller = await newAnimal(meId);
      const attackerTok = buyerTok; // a different, non-owning principal

      const existing = await request(server()).get(`/v1/animals/${ownedByseller}`).set('Authorization', `Bearer ${attackerTok}`);
      const missing = await request(server()).get(`/v1/animals/${randomUUID()}`).set('Authorization', `Bearer ${attackerTok}`);

      expect(existing.status).toBe(403); // existence leaked
      expect(missing.status).toBe(404);
      // DESIRED (the invariant listing/saved-search honour): BOTH should be 404 — no existence oracle.
      expect(existing.status).not.toBe(missing.status); // proves the oracle: the two are distinguishable
    });
  });
});
