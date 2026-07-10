/**
 * ADR-0039 reputation FORM-slice #2 — dormant `reviews` + `reputation_aggregates` storage, proven against
 * the real stack (host PG). This is a DORMANT form slice: there are NO endpoints, NO recompute, NO consumer —
 * so the tests exercise the STORAGE INVARIANTS directly (the project bar is a negative test per invariant).
 *
 *  reviews (m2): append-only UPDATE+DELETE rejected · one-CURRENT-per-(sale,direction) partial-unique ·
 *    FK confirmed_sale_id · every named CHECK (direction / market / rating 0 & 6 grani / moderation_status /
 *    actor_principal_type) · GENERATED `seq` rejects a direct value · positive controls (defaults, AGENT actor).
 *  reputation_aggregates (m3): PK(subject,market) duplicate · GENERATED `rating_avg` rejects a direct value +
 *    derives correctly (sum/count, NULL at 0) · nonneg CHECK · market CHECK · the cache IS mutable (NOT
 *    append-only — the recompute path UPDATEs it and the generated avg follows).
 *
 * Bad values are LITERAL text in the tagged-template SQL (not interpolated variables), so parameterized-SQL
 * discipline holds. reviews is append-only → cleanup disables the trigger (the consents/confirmed_sales idiom).
 * e2e hits HOST pg (localhost). Run: `npm run test:e2e`.
 */
import { join } from 'node:path';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/lib/db/prisma.service';

describe('ADR-0039 reputation storage — dormant reviews + reputation_aggregates (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const suffix = Math.random().toString(36).slice(2, 8);
  const sales: string[] = []; // confirmed_sales ids to clean
  const subjects: string[] = []; // aggregate subject user ids to clean
  let subjectId: string; // reusable review subject
  let reviewerId: string;

  /** A fresh confirmed_sales row (INSERT allowed; append-only only blocks UPDATE/DELETE). Tracked for cleanup. */
  const mkSale = async (): Promise<string> => {
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO confirmed_sales(anchor_type, market, status) VALUES('LISTING_MARK_SOLD','pet','PENDING_CONFIRMATION') RETURNING id`;
    const id = rows[0].id;
    sales.push(id);
    return id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const mk = (n: string) =>
      prisma.users.create({ data: { full_name: n, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    subjectId = (await mk(`RepSubject_${suffix}`)).id;
    reviewerId = (await mk(`RepReviewer_${suffix}`)).id;
    subjects.push(subjectId);
  });

  afterAll(async () => {
    // reviews is append-only (trg_reviews_immutable) — disable the trigger for cleanup only (consents idiom).
    await prisma.$executeRaw`ALTER TABLE reviews DISABLE TRIGGER trg_reviews_immutable`.catch(() => undefined);
    for (const id of sales) await prisma.reviews.deleteMany({ where: { confirmed_sale_id: id } }).catch(() => undefined);
    await prisma.$executeRaw`ALTER TABLE reviews ENABLE TRIGGER trg_reviews_immutable`.catch(() => undefined);

    await prisma.$executeRaw`ALTER TABLE confirmed_sales DISABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    for (const id of sales) await prisma.confirmed_sales.deleteMany({ where: { id } }).catch(() => undefined);
    await prisma.$executeRaw`ALTER TABLE confirmed_sales ENABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);

    for (const id of subjects) await prisma.reputation_aggregates.deleteMany({ where: { subject_user_id: id } }).catch(() => undefined);
    for (const id of [subjectId, reviewerId, ...subjects]) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
  });

  // ── m2: reviews storage invariants ──────────────────────────────────────────────────────────────
  describe('reviews (m2)', () => {
    it('positive control: a valid review inserts with seq populated + double-blind/pending defaults', async () => {
      const saleId = await mkSale();
      await prisma.$executeRaw`
        INSERT INTO reviews(confirmed_sale_id, direction, market, rating, subject_user_id, reviewer_user_id)
        VALUES(${saleId}::uuid, 'BUYER_ON_SELLER', 'pet', 5, ${subjectId}::uuid, ${reviewerId}::uuid)`;
      const row = await prisma.reviews.findFirstOrThrow({ where: { confirmed_sale_id: saleId } });
      expect(row.rating).toBe(5);
      expect(row.is_visible).toBe(false); // double-blind gate defaults FALSE (fork 2)
      expect(row.moderation_status).toBe('PENDING');
      expect(row.actor_principal_type).toBe('HUMAN');
      expect(typeof row.seq).toBe('bigint'); // GENERATED ALWAYS AS IDENTITY populated
      expect(row.seq).toBeGreaterThan(0n);
    });

    it('append-only: UPDATE and DELETE of a review are both rejected by the trigger', async () => {
      const saleId = await mkSale();
      await prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',4)`;
      const row = await prisma.reviews.findFirstOrThrow({ where: { confirmed_sale_id: saleId } });
      await expect(prisma.$executeRaw`UPDATE reviews SET rating = 1 WHERE id = ${row.id}::uuid`).rejects.toThrow(/append-only/i);
      await expect(prisma.$executeRaw`DELETE FROM reviews WHERE id = ${row.id}::uuid`).rejects.toThrow(/append-only/i);
    });

    it('one-CURRENT-per-(sale,direction): a second head (superseded_by_id NULL) is rejected (transfer INV-4 shape)', async () => {
      const saleId = await mkSale();
      await prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'SELLER_ON_BUYER','pet',5)`;
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'SELLER_ON_BUYER','pet',3)`,
      ).rejects.toThrow(/already exists|unique|23505/i);
    });

    it('FK confirmed_sale_id: a review with no confirmed sale is rejected (proof-of-transaction root)', async () => {
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(gen_random_uuid(),'BUYER_ON_SELLER','pet',4)`,
      ).rejects.toThrow(/foreign key|violates|23503/i);
    });

    it('CHECK chk_reviews_direction: a bogus direction is rejected', async () => {
      const saleId = await mkSale();
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'MUTUAL','pet',4)`,
      ).rejects.toThrow(/chk_reviews_direction/i);
    });

    it('CHECK chk_reviews_rating: rating 0 and rating 6 are both rejected (1..5 grani)', async () => {
      const saleId = await mkSale();
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',0)`,
      ).rejects.toThrow(/chk_reviews_rating/i);
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',6)`,
      ).rejects.toThrow(/chk_reviews_rating/i);
    });

    it('CHECK chk_reviews_market: a bogus market is rejected (ADR-0002 domain)', async () => {
      const saleId = await mkSale();
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','fish',4)`,
      ).rejects.toThrow(/chk_reviews_market/i);
    });

    it('CHECK chk_reviews_moderation_status: a bogus moderation_status is rejected', async () => {
      const saleId = await mkSale();
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating, moderation_status) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',4,'SHRUG')`,
      ).rejects.toThrow(/chk_reviews_moderation_status/i);
    });

    it('CHECK chk_reviews_actor_ptype: a bogus actor_principal_type is rejected; AGENT is accepted (agent-as-principal)', async () => {
      const saleBad = await mkSale();
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating, actor_principal_type) VALUES(${saleBad}::uuid,'BUYER_ON_SELLER','pet',4,'ROBOT')`,
      ).rejects.toThrow(/chk_reviews_actor_ptype/i);
      // positive control: the AGENT value is reserved (ADR-0040 §3 — authoring stays off, but the value is valid).
      const saleOk = await mkSale();
      await prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating, actor_principal_type) VALUES(${saleOk}::uuid,'SELLER_ON_BUYER','livestock',4,'AGENT')`;
      const row = await prisma.reviews.findFirstOrThrow({ where: { confirmed_sale_id: saleOk } });
      expect(row.actor_principal_type).toBe('AGENT');
    });

    it('GENERATED seq: a direct value into `seq` is rejected (monotonic order is DB-assigned, never app-written)', async () => {
      const saleId = await mkSale();
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating, seq) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',4,1)`,
      ).rejects.toThrow(/generated column|cannot insert/i);
    });
  });

  // ── m3: reputation_aggregates storage invariants ────────────────────────────────────────────────
  describe('reputation_aggregates (m3)', () => {
    const mkSubject = async (): Promise<string> => {
      const u = await prisma.users.create({ data: { full_name: `Agg_${suffix}_${subjects.length}`, role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
      subjects.push(u.id);
      return u.id;
    };

    it('derived rating_avg: ROUND(sum/count) with NULL at zero reviews (GENERATED, never written)', async () => {
      const s = await mkSubject();
      await prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market, review_count, rating_sum) VALUES(${s}::uuid,'pet',2,9)`;
      await prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market, review_count, rating_sum) VALUES(${s}::uuid,'livestock',0,0)`;
      const pet = await prisma.reputation_aggregates.findUniqueOrThrow({ where: { subject_user_id_market: { subject_user_id: s, market: 'pet' } } });
      const live = await prisma.reputation_aggregates.findUniqueOrThrow({ where: { subject_user_id_market: { subject_user_id: s, market: 'livestock' } } });
      expect(Number(pet.rating_avg)).toBeCloseTo(4.5, 2);
      expect(live.rating_avg).toBeNull(); // no reviews → NULL, never a misleading 0
    });

    it('GENERATED rating_avg: a direct INSERT of rating_avg is rejected (unpurchasable/unforgeable — fork 7)', async () => {
      const s = await mkSubject();
      await expect(
        prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market, review_count, rating_sum, rating_avg) VALUES(${s}::uuid,'pet',1,5,5.00)`,
      ).rejects.toThrow(/generated column|cannot insert/i);
    });

    it('PK(subject_user_id, market): a duplicate (subject, market) row is rejected (one aggregate per market)', async () => {
      const s = await mkSubject();
      await prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market) VALUES(${s}::uuid,'pet')`;
      await expect(
        prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market) VALUES(${s}::uuid,'pet')`,
      ).rejects.toThrow(/already exists|unique|23505/i);
    });

    it('CHECK chk_reputation_aggregates_nonneg: a negative review_count is rejected', async () => {
      const s = await mkSubject();
      await expect(
        prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market, review_count) VALUES(${s}::uuid,'pet',-1)`,
      ).rejects.toThrow(/chk_reputation_aggregates_nonneg/i);
    });

    it('CHECK chk_reputation_aggregates_market: a bogus market is rejected (ADR-0002)', async () => {
      const s = await mkSubject();
      await expect(
        prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market) VALUES(${s}::uuid,'fish')`,
      ).rejects.toThrow(/chk_reputation_aggregates_market/i);
    });

    it('the cache IS mutable (NOT append-only): UPDATE of count/sum is allowed and the generated avg follows', async () => {
      const s = await mkSubject();
      await prisma.$executeRaw`INSERT INTO reputation_aggregates(subject_user_id, market, review_count, rating_sum) VALUES(${s}::uuid,'pet',1,5)`;
      // recompute path incrementally updates the cache — must succeed (distinct from append-only reviews).
      await prisma.$executeRaw`UPDATE reputation_aggregates SET review_count = 2, rating_sum = 8, recomputed_at = NOW() WHERE subject_user_id = ${s}::uuid AND market = 'pet'`;
      const row = await prisma.reputation_aggregates.findUniqueOrThrow({ where: { subject_user_id_market: { subject_user_id: s, market: 'pet' } } });
      expect(row.review_count).toBe(2);
      expect(Number(row.rating_avg)).toBeCloseTo(4.0, 2); // 8/2 → generated avg followed the UPDATE
    });
  });
});
