/**
 * ADR-0035 / Slice H2 — listing ETag decoupled from `updated_at` (view-count off the concurrency path).
 *
 * Regression gate for P0-2: a public read (which increments `view_count` and, via the generic trigger,
 * moves `updated_at`) must NOT rotate the listing's ETag, and must NOT cause a subsequent `If-Match`
 * PATCH to 412. The ETag is now derived from `listings.content_updated_at`, bumped only on genuine
 * content/state writes. Covers ADR-0035 acceptance tests 1-8.
 *
 * Self-contained fixtures (own seller/mod/viewers/species) so nothing disturbs other suites. e2e hits
 * the HOST pg/redis (localhost). Distinct AUTHENTICATED viewer users drive `captureView` (keyed
 * `u:<userId>`), so the increment is robust regardless of the anon-IP `trust proxy` setting.
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

describe('Listing ETag content-version (ADR-0035, e2e)', () => {
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
    (await request(server()).post('/v1/auth/dev-token').send({ userId: uid }).expect(201)).body.accessToken as string;

  const mkUser = async (n: string, role = 'USER'): Promise<string> => {
    const u = await prisma.users.create({ data: { full_name: n, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    userIds.push(u.id);
    return u.id;
  };
  /** A fresh authenticated viewer (distinct userId → counts once in captureView). */
  const freshViewerTok = async (): Promise<string> => devToken(await mkUser(`Viewer_${randomUUID().slice(0, 8)}`));

  const newAnimal = async (owner: string): Promise<string> => {
    const a = await prisma.animals.create({
      data: {
        owner_id: owner,
        species_id: speciesId,
        breed_id: breedId,
        nickname_localized: { en: 'Ecv', ru: 'Экв' },
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
    request(server()).post('/v1/listings').set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', key).send(body);
  const addPhoto = (tok: string, id: string) =>
    request(server()).post(`/v1/listings/${id}/photos`).set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', randomUUID()).send({ url: `http://localhost:9000/${randomUUID()}.jpg` });
  /** GET as the seller (excluded from view-count) so the read does NOT itself increment. */
  const sellerGet = async (id: string): Promise<{ etag: string; body: Record<string, unknown> }> => {
    const r = await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    return { etag: r.headers['etag'], body: r.body as Record<string, unknown> };
  };
  /** A distinct viewer GETs the listing → increments view_count once. */
  const viewOnce = async (id: string): Promise<void> => {
    const tok = await freshViewerTok();
    await request(server()).get(`/v1/listings/${id}`).set('Authorization', `Bearer ${tok}`).expect(200);
  };
  const viewCountOf = async (id: string): Promise<bigint> =>
    (await prisma.listings.findUnique({ where: { id }, select: { view_count: true } }))!.view_count;
  const contentUpdatedAt = async (id: string): Promise<Date> =>
    (await prisma.listings.findUnique({ where: { id }, select: { content_updated_at: true } }))!.content_updated_at;

  /** Drive a fresh listing to ACTIVE (submit → claim → APPROVE). Returns the listing id. */
  const makeActive = async (listingType = 'sale'): Promise<string> => {
    const animalId = await newAnimal(sellerId);
    const id = (await create(sellerTok, baseBody({ animalId, listingType })).expect(201)).body.id as string;
    await addPhoto(sellerTok, id).expect(201);
    const { etag } = await sellerGet(id);
    await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    await request(server()).post(`/v1/moderation/queue/${id}/claim`).set('Authorization', `Bearer ${modTok}`).expect(200);
    await request(server()).post('/v1/moderation/action').set('Authorization', `Bearer ${modTok}`).send({ listingId: id, action: 'APPROVE' }).expect(200);
    expect((await prisma.listings.findUnique({ where: { id } }))?.status).toBe('ACTIVE');
    return id;
  };
  /** A DRAFT listing with one photo (submittable). */
  const makeDraft = async (): Promise<string> => {
    const animalId = await newAnimal(sellerId);
    const id = (await create(sellerTok, baseBody({ animalId })).expect(201)).body.id as string;
    await addPhoto(sellerTok, id).expect(201);
    return id;
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

    sellerId = await mkUser('EcvSeller', 'USER');
    modId = await mkUser('EcvMod', 'MODERATOR');
    [sellerTok, modTok] = await Promise.all([devToken(sellerId), devToken(modId)]);

    const sp = await prisma.species.create({ data: { code: `ecv_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `ecv_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    // Clean up outbox events our APPROVE/mark-sold flips emit (would starve the outbox relay suite).
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

  // ── Test 1 (MANDATORY) — public read does not bust the ETag / does not 412 a later PATCH ────────
  it('a public read does NOT change the ETag; a later If-Match PATCH with the pre-view ETag → 200', async () => {
    const id = await makeActive();
    const { etag: e1 } = await sellerGet(id);
    const before = await viewCountOf(id);

    // Several distinct viewers increment view_count (moves updated_at via the generic trigger).
    await viewOnce(id);
    await viewOnce(id);
    await viewOnce(id);
    expect(await viewCountOf(id)).toBeGreaterThan(before); // views really landed

    // The ETag is unchanged by the view traffic (derived from content_updated_at, not updated_at).
    const { etag: e2 } = await sellerGet(id);
    expect(e2).toBe(e1);

    // The seller's If-Match PATCH with the pre-view ETag succeeds — NO spurious 412.
    await request(server())
      .patch(`/v1/listings/${id}`)
      .set('Authorization', `Bearer ${sellerTok}`)
      .set('If-Match', e1)
      .send({ priceCents: 9000 })
      .expect(200);
  });

  // ── Test 2 — view-flood griefing is neutralised (trash-lens) ────────────────────────────────────
  it('a flood of anonymous/other views does NOT lock the seller out of editing (pre-flood ETag still valid)', async () => {
    const id = await makeActive();
    const { etag: preFlood } = await sellerGet(id);

    for (let i = 0; i < 12; i++) await viewOnce(id); // flood
    expect(await viewCountOf(id)).toBeGreaterThanOrEqual(1n);

    // The seller still holds a VALID validator — the edit-lockout lever is closed.
    await request(server())
      .patch(`/v1/listings/${id}`)
      .set('Authorization', `Bearer ${sellerTok}`)
      .set('If-Match', preFlood)
      .send({ priceCents: 12000 })
      .expect(200);
  });

  // ── Test 3 — a genuine content edit rotates the ETag; optimistic concurrency still works ────────
  it('a content PATCH rotates the ETag; a second PATCH with the stale ETag → 412 STALE_RESOURCE', async () => {
    const id = await makeActive();
    const { etag: e1 } = await sellerGet(id);

    const patch1 = await request(server())
      .patch(`/v1/listings/${id}`)
      .set('Authorization', `Bearer ${sellerTok}`)
      .set('If-Match', e1)
      .send({ titleLocalized: { en: 'Renamed', ru: 'Переименовано' } })
      .expect(200);
    const e2 = patch1.headers['etag'];
    expect(e2).not.toBe(e1); // real content change → validator rotated

    // A second PATCH with the now-stale e1 correctly 412s.
    const stale = await request(server())
      .patch(`/v1/listings/${id}`)
      .set('Authorization', `Bearer ${sellerTok}`)
      .set('If-Match', e1)
      .send({ priceCents: 15000 })
      .expect(412);
    expect(stale.body.code).toBe('STALE_RESOURCE');
  });

  // ── Test 4 — state transitions bump the validator (submit / withdraw / mark-sold) ──────────────
  it('submit changes the ETag', async () => {
    const id = await makeDraft();
    const { etag: e1 } = await sellerGet(id);
    await request(server()).post(`/v1/listings/${id}/submit`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', e1).expect(200);
    const { etag: e2 } = await sellerGet(id);
    expect(e2).not.toBe(e1);
  });

  it('withdraw changes the ETag', async () => {
    const id = await makeActive();
    const { etag: e1 } = await sellerGet(id);
    await request(server()).delete(`/v1/listings/${id}`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    const { etag: e2 } = await sellerGet(id); // seller can still read a DEACTIVATED listing
    expect(e2).not.toBe(e1);
  });

  it('mark-sold changes the ETag', async () => {
    const id = await makeActive();
    const { etag: e1 } = await sellerGet(id);
    await request(server()).post(`/v1/listings/${id}/mark-sold`).set('Authorization', `Bearer ${sellerTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', e1).expect(200);
    const { etag: e2 } = await sellerGet(id);
    expect(e2).not.toBe(e1);
  });

  // ── Test 5 — system/derived writes do NOT bump content_updated_at ──────────────────────────────
  it('view_count increment does NOT move content_updated_at', async () => {
    const id = await makeActive();
    const cua0 = await contentUpdatedAt(id);
    await viewOnce(id);
    await viewOnce(id);
    expect((await contentUpdatedAt(id)).getTime()).toBe(cua0.getTime());
  });

  it('an escalated_at write does NOT move content_updated_at', async () => {
    const id = await makeActive();
    const cua0 = await contentUpdatedAt(id);
    // Mirror the SLA-escalation job's system write (it never sets content_updated_at).
    await prisma.listings.update({ where: { id }, data: { escalated_at: new Date() } });
    expect((await contentUpdatedAt(id)).getTime()).toBe(cua0.getTime());
  });

  it('a market-cache recompute (market-only updateMany) does NOT move content_updated_at', async () => {
    const id = await makeActive();
    const cua0 = await contentUpdatedAt(id);
    // Mirror recomputeMarketForSpecies (updateMany writing only `market`).
    await prisma.listings.updateMany({ where: { id }, data: { market: 'livestock' } });
    expect((await contentUpdatedAt(id)).getTime()).toBe(cua0.getTime());
    await prisma.listings.updateMany({ where: { id }, data: { market: 'pet' } }); // restore
  });

  // ── Test 6 — cascade-deactivation bumps content_updated_at ─────────────────────────────────────
  it('cascade-deactivation (deactivating the animal) bumps content_updated_at', async () => {
    const id = await makeActive();
    const animalId = (await prisma.listings.findUnique({ where: { id }, select: { animal_id: true } }))!.animal_id;
    const cua0 = await contentUpdatedAt(id);
    await new Promise((r) => setTimeout(r, 5)); // ensure now() is strictly later than cua0
    await request(server()).patch(`/v1/animals/${animalId}/deactivate`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect((await prisma.listings.findUnique({ where: { id } }))?.status).toBe('DEACTIVATED');
    expect((await contentUpdatedAt(id)).getTime()).toBeGreaterThan(cua0.getTime());
  });

  // ── Test 7 — migration idempotency + N-1 write-compat ──────────────────────────────────────────
  it('re-running the 0035 backfill block does NOT clobber an app-written content_updated_at', async () => {
    const id = await makeActive();
    const appTs = new Date('2020-01-01T00:00:00Z');
    await prisma.listings.update({ where: { id }, data: { updated_at: new Date(), content_updated_at: appTs } });
    // The migration guards the backfill behind "column does not exist" — it exists, so this is a no-op.
    await prisma.$executeRaw`
      DO $do$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name='listings' AND column_name='content_updated_at') THEN
          UPDATE listings SET content_updated_at = updated_at;
        END IF;
      END $do$;`;
    expect((await contentUpdatedAt(id)).getTime()).toBe(appTs.getTime());
  });

  it('N-1 write-compat: INSERT a listing WITHOUT content_updated_at succeeds via DEFAULT now()', async () => {
    const animalId = await newAnimal(sellerId);
    const rows = await prisma.$queryRaw<{ id: string; content_updated_at: Date }[]>`
      INSERT INTO listings (animal_id, seller_id, listing_type, market, status, moderation_status)
      VALUES (${animalId}::uuid, ${sellerId}::uuid, 'sale', 'pet', 'DRAFT', 'PENDING')
      RETURNING id, content_updated_at`;
    expect(rows[0].content_updated_at).not.toBeNull();
    await prisma.listings.delete({ where: { id: rows[0].id } });
  });

  // ── Test 8 — no analytics regression: getAnalytics.views reflects view_count ───────────────────
  it('getAnalytics.views still reflects the view_count increments (no regression)', async () => {
    const id = await makeActive();
    await viewOnce(id);
    await viewOnce(id);
    const analytics = await request(server()).get(`/v1/listings/${id}/analytics`).set('Authorization', `Bearer ${sellerTok}`).expect(200);
    expect(analytics.body.views).toBe(Number(await viewCountOf(id)));
    expect(analytics.body.views).toBeGreaterThanOrEqual(2);
  });
});
