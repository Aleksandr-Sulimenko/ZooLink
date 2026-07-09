/**
 * RBAC round-9 additive-model closure (rbac-matrix.md §round-9) end-to-end against the real stack
 * (PG + Redis). Pins — in the D11 style — the invariant `USER ∈ x-required-roles ⟹ {VETERINARIAN,
 * GROOMER} ⊆ x-required-roles`: VETERINARIAN and GROOMER (both "USER + extra", inheriting every USER
 * surface) receive a non-403 on the basic USER surfaces that grant USER, exactly where a plain USER
 * passes. Covered live contracts: listings (WRITE + ANALYTICS), moderation:291 (owner-result),
 * notification (own inbox). The other USER-bearing contracts swept in round-9 (branch, matching,
 * organization, payment) have no live controller yet (Phase 2) — pinned by the contract grep gate.
 *
 * Negative (no over-widening): MODERATOR — NOT a USER-tier role — is still 403 on a USER-write surface
 * (listing create; L-3 R-only), proving the additive rule granted nothing beyond USER-tier.
 *
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
import { resetThrottle } from './throttle-reset.util';

describe('RBAC round-9 additive-model closure (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = randomUUID().slice(0, 8);

  const users: string[] = [];
  const animalsCreated: string[] = [];
  const listings: string[] = [];

  let userId: string;
  let vetId: string;
  let groomerId: string;
  let modId: string;
  let userTok: string;
  let vetTok: string;
  let groomerTok: string;
  let modTok: string;
  let speciesId: number;
  let breedId: number;

  const server = (): Server => app.getHttpServer() as Server;
  const devToken = async (uid: string): Promise<string> =>
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const mkUser = async (name: string, role: string): Promise<string> => {
    const u = await prisma.users.create({ data: { full_name: name, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    users.push(u.id);
    return u.id;
  };

  const newAnimal = async (owner: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: { owner_id: owner, species_id: speciesId, breed_id: breedId, nickname_localized: { en: 'R9', ru: 'Р9' }, sex: 'Male', date_of_birth: new Date('2021-01-01T00:00:00Z') },
    });
    animalsCreated.push(a.id);
    return a.id;
  };

  const track = (res: { body: { id?: unknown } }): string => {
    const id = res.body.id as string;
    listings.push(id);
    return id;
  };

  /** Build a DRAFT-listing POST as `tok` for a freshly-owned animal (WRITE_ROLES gate). */
  const postListing = (tok: string, animalId: string) =>
    request(server())
      .post('/v1/listings')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', randomUUID())
      .send({ animalId, listingType: 'sale', titleLocalized: { en: 'R9', ru: 'Р9' }, priceCents: 5000 });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);

    userId = await mkUser('R9User', 'USER');
    vetId = await mkUser('R9Vet', 'VETERINARIAN');
    groomerId = await mkUser('R9Groomer', 'GROOMER');
    modId = await mkUser('R9Mod', 'MODERATOR');
    [userTok, vetTok, groomerTok, modTok] = await Promise.all([
      devToken(userId),
      devToken(vetId),
      devToken(groomerId),
      devToken(modId),
    ]);

    const sp = await prisma.species.create({ data: { code: `r9_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `r9_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
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
    for (const id of users) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── Listings WRITE_ROLES (listings-api.yaml :181/267/313/344/448/513/557/579 — form A) ──────────
  it('listing create: USER passes (201) — baseline for the USER-write surface', async () => {
    track(await postListing(userTok, await newAnimal(userId)).expect(201));
  });

  it('listing create: VETERINARIAN passes exactly where USER does (201, not 403)', async () => {
    track(await postListing(vetTok, await newAnimal(vetId)).expect(201));
  });

  it('listing create: GROOMER passes exactly where USER does (201, not 403)', async () => {
    track(await postListing(groomerTok, await newAnimal(groomerId)).expect(201));
  });

  it('NEGATIVE: MODERATOR — not a USER-tier role — is still 403 on the USER-write surface (no over-widening)', async () => {
    await postListing(modTok, await newAnimal(userId)).expect(403); // WRITE_ROLES excludes MODERATOR (L-3, R-only on listings)
  });

  // ── Listings ANALYTICS_ROLES (listings-api.yaml :607/639 — form B, owner-scoped) ────────────────
  it('listing analytics: VETERINARIAN owner gets 200 (role gate passes, not 403)', async () => {
    const id = track(await postListing(vetTok, await newAnimal(vetId)).expect(201));
    await request(server()).get(`/v1/listings/${id}/analytics`).set('Authorization', `Bearer ${vetTok}`).expect(200);
  });

  it('listing analytics: GROOMER owner gets 200 (role gate passes, not 403)', async () => {
    const id = track(await postListing(groomerTok, await newAnimal(groomerId)).expect(201));
    await request(server()).get(`/v1/listings/${id}/analytics`).set('Authorization', `Bearer ${groomerTok}`).expect(200);
  });

  // ── Moderation owner-result (moderation-api.yaml :291 — form B, owner-scoped) ────────────────────
  it('moderation-result: VETERINARIAN owner gets a non-403 (204 no-decision-yet)', async () => {
    const id = track(await postListing(vetTok, await newAnimal(vetId)).expect(201));
    const res = await request(server()).get(`/v1/listings/${id}/moderation-result`).set('Authorization', `Bearer ${vetTok}`);
    expect(res.status).not.toBe(403);
    expect([200, 204]).toContain(res.status);
  });

  it('moderation-result: GROOMER owner gets a non-403 (204 no-decision-yet)', async () => {
    const id = track(await postListing(groomerTok, await newAnimal(groomerId)).expect(201));
    const res = await request(server()).get(`/v1/listings/${id}/moderation-result`).set('Authorization', `Bearer ${groomerTok}`);
    expect(res.status).not.toBe(403);
    expect([200, 204]).toContain(res.status);
  });

  // ── Notification own inbox (notification-api.yaml :69/155/167 — form B) ──────────────────────────
  it('notifications inbox: USER passes (200) — baseline', async () => {
    await request(server()).get('/v1/me/notifications?limit=10').set('Authorization', `Bearer ${userTok}`).expect(200);
  });

  it('notifications inbox: VETERINARIAN passes exactly where USER does (200, not 403)', async () => {
    await request(server()).get('/v1/me/notifications?limit=10').set('Authorization', `Bearer ${vetTok}`).expect(200);
  });

  it('notifications inbox: GROOMER passes exactly where USER does (200, not 403)', async () => {
    await request(server()).get('/v1/me/notifications?limit=10').set('Authorization', `Bearer ${groomerTok}`).expect(200);
  });
});
