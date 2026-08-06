/**
 * AUDIT4 P1-4 — per-user listing-creation quota (listings-api.yaml POST /listings; API_CONVENTIONS §8).
 * Proves the Redis-backed per-user 24h creation cap end-to-end against the real stack (host PG + Redis):
 *   • under quota → all 201
 *   • exceeding the quota → 429 RATE_LIMITED (application/problem+json) + Retry-After + X-RateLimit-* headers
 *   • the quota is PER-USER, never global — a capped user does not block a different user
 *
 * The quota (`LISTING_CREATION_QUOTA_PER_DAY`) is set to 3 for this suite (env override BEFORE the module
 * boots) so the test is fast & deterministic regardless of the shipped default. e2e hits HOST redis; the
 * per-user counter key `listing-create:{userId}` is cleared in beforeAll so a re-run starts clean.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });
// Override BEFORE AppModule (env.validation) loads — the quota is read from validated config.
process.env.LISTING_CREATION_QUOTA_PER_DAY = '3';

import { ValidationPipe, VersioningType } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ProblemExceptionFilter } from '../src/lib/http/problem.filter';
import { PrismaService } from '../src/lib/db/prisma.service';
import { RedisService } from '../src/lib/redis/redis.service';
import { resetThrottle } from './throttle-reset.util';
import { applyGlobalApiPrefix } from '../src/config/api-base';

const QUOTA = 3;

describe('Listing-creation quota (AUDIT4 P1-4, e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService;
  const listings: string[] = [];
  const animalsCreated: string[] = [];
  const extraUserIds: string[] = []; // users minted inside a test; dropped in afterAll after their rows
  let sellerId: string;
  let otherId: string;
  let sellerTok: string;
  let otherTok: string;
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
        nickname_localized: { en: 'Q', ru: 'К' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animalsCreated.push(a.id);
    return a.id;
  };

  // Returns the supertest Test (thenable) so the caller chains `.expect(code)` — NOT async, to avoid the
  // double-thenable collapse that would unwrap it straight to a Response.
  const postListing = (tok: string, animalId: string): request.Test =>
    request(server())
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${tok}`)
      .set('Idempotency-Key', randomUUID())
      .send({ animalId, listingType: 'sale', titleLocalized: { en: 'Q', ru: 'К' }, priceCents: 5000 });

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
    redis = app.get(RedisService);

    const mk = (n: string) =>
      prisma.users.create({ data: { full_name: n, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    sellerId = (await mk('QSeller')).id;
    otherId = (await mk('QOther')).id;
    [sellerTok, otherTok] = await Promise.all([devToken(sellerId), devToken(otherId)]);
    // Start from a clean per-user counter so a suite re-run within the 24h window is deterministic.
    await redis.client.del(`listing-create:${sellerId}`, `listing-create:${otherId}`);

    const sp = await prisma.species.create({ data: { code: `q_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `q_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    for (const id of listings) await prisma.listings.delete({ where: { id } }).catch(() => undefined);
    for (const id of animalsCreated) {
      await prisma.listings.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    }
    await redis.client.del(`listing-create:${sellerId}`, `listing-create:${otherId}`).catch(() => undefined);
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of [sellerId, otherId, ...extraUserIds]) if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  it(`allows up to the quota (${QUOTA}) then rejects the next create with 429 RATE_LIMITED + rate-limit headers`, async () => {
    for (let i = 0; i < QUOTA; i++) {
      const animalId = await newAnimal(sellerId);
      const r = await postListing(sellerTok, animalId).expect(201);
      listings.push(r.body.id as string);
    }
    const overAnimal = await newAnimal(sellerId);
    const over = await postListing(sellerTok, overAnimal).expect(429);
    expect(over.headers['content-type']).toContain('application/problem+json');
    expect(over.body.code).toBe('RATE_LIMITED');
    expect(over.body.status).toBe(429);
    expect(over.headers['retry-after']).toBeDefined();
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    expect(over.headers['x-ratelimit-limit']).toBe(String(QUOTA));
    expect(over.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('the quota is PER-USER, not global — a different user can still create after the first is capped', async () => {
    // sellerId is already capped from the previous test; a fresh user must be unaffected.
    const animalId = await newAnimal(otherId);
    const r = await postListing(otherTok, animalId).expect(201);
    listings.push(r.body.id as string);
  });

  it('a create that 404s (missing animal) does NOT consume a quota unit — only resolvable creates charge', async () => {
    const chargeId = (await prisma.users.create({ data: { full_name: 'QCharge', role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } })).id;
    extraUserIds.push(chargeId);
    const chargeTok = await devToken(chargeId);
    await redis.client.del(`listing-create:${chargeId}`);
    // Burn quota-1 resolvable creates.
    for (let i = 0; i < QUOTA - 1; i++) {
      const a = await newAnimal(chargeId);
      listings.push((await postListing(chargeTok, a).expect(201)).body.id as string);
    }
    // A create against a non-existent animal → 404, and must NOT charge the last unit.
    await postListing(chargeTok, randomUUID()).expect(404);
    // The final resolvable unit is therefore still available → 201.
    const a = await newAnimal(chargeId);
    listings.push((await postListing(chargeTok, a).expect(201)).body.id as string);
    // Now the quota is genuinely exhausted → the next resolvable create is 429.
    const over = await newAnimal(chargeId);
    await postListing(chargeTok, over).expect(429);
  });
});
