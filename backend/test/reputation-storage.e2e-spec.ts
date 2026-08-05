/**
 * ADR-0039 reputation FORM-slice #2 — dormant `reviews` + `reputation_aggregates` storage, proven against
 * the real stack (host PG). This is a DORMANT form slice: there are NO endpoints, NO recompute, NO consumer —
 * so the tests exercise the STORAGE INVARIANTS directly (the project bar is a negative test per invariant).
 *
 *  reviews (m2): append-only UPDATE+DELETE rejected · the FACT/STATE split (ADR-0038/0039 Amendments, mig 0041) —
 *    BACKWARD supersedes_review_id, uq_reviews_root_per_direction [M-1] + uq_reviews_supersedes [M-3] (linear chain),
 *    the reviews_current VIEW resolves the head; moderation_status/is_visible moved to the MUTABLE review_states ·
 *    FK confirmed_sale_id · named CHECKs (direction / market / rating 0 & 6 grani / actor_principal_type) ·
 *    GENERATED `seq` rejects a direct value · confirmed_sales is CONFIRMED-only (mkSale writes CONFIRMED).
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
    // confirmed_sales is a CONFIRMED-only fact now (ADR-0038 §4 Amendment / migration 0041).
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO confirmed_sales(anchor_type, market, status) VALUES('LISTING_MARK_SOLD','pet','CONFIRMED') RETURNING id`;
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
    // supersedes_review_id is ON DELETE RESTRICT (migration 0041), so delete the superseding CHILDREN before their
    // ROOTS (review_states cascades off reviews). Two-pass covers the 1-level chains these tests create.
    await prisma.$executeRaw`ALTER TABLE reviews DISABLE TRIGGER trg_reviews_immutable`.catch(() => undefined);
    for (const id of sales) await prisma.reviews.deleteMany({ where: { confirmed_sale_id: id, NOT: { supersedes_review_id: null } } }).catch(() => undefined);
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
    it('positive control: a valid review inserts as a ROOT (supersedes nothing) with seq populated', async () => {
      const saleId = await mkSale();
      await prisma.$executeRaw`
        INSERT INTO reviews(confirmed_sale_id, direction, market, rating, subject_user_id, reviewer_user_id)
        VALUES(${saleId}::uuid, 'BUYER_ON_SELLER', 'pet', 5, ${subjectId}::uuid, ${reviewerId}::uuid)`;
      const row = await prisma.reviews.findFirstOrThrow({ where: { confirmed_sale_id: saleId } });
      expect(row.rating).toBe(5);
      expect(row.supersedes_review_id).toBeNull(); // a root supersedes nothing (mutable moderation/visibility → review_states now)
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

    it('[M-1] uq_reviews_root_per_direction: a second ROOT (supersedes nothing) per (sale,direction) is rejected', async () => {
      // The new "one current" mechanism (ADR-0039 §3 Amendment): one root chain per (sale,direction).
      const saleId = await mkSale();
      await prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'SELLER_ON_BUYER','pet',5)`;
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'SELLER_ON_BUYER','pet',3)`,
      ).rejects.toThrow(/already exists|unique|23505/i);
    });

    it('[M-3] uq_reviews_supersedes: a second successor of one predecessor is rejected (LINEAR edit chain, Q5)', async () => {
      // Backward supersede pointer (ADR-0039 §3 Amendment). A first edit (child) superseding the root is fine;
      // a second child of the same predecessor would FORK the history → rejected (stricter than moderation_decisions).
      const saleId = await mkSale();
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',5) RETURNING id`;
      const rootId = rows[0].id;
      await prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating, supersedes_review_id) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',4,${rootId}::uuid)`;
      await expect(
        prisma.$executeRaw`INSERT INTO reviews(confirmed_sale_id, direction, market, rating, supersedes_review_id) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',2,${rootId}::uuid)`,
      ).rejects.toThrow(/already exists|unique|23505/i);
    });

    it('reviews_current VIEW: the head of an edit chain is current, the superseded predecessor is not', async () => {
      const saleId = await mkSale();
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',5) RETURNING id`;
      const rootId = rows[0].id;
      const child = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO reviews(confirmed_sale_id, direction, market, rating, supersedes_review_id) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',4,${rootId}::uuid) RETURNING id`;
      const childId = child[0].id;
      const current = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM reviews_current WHERE confirmed_sale_id = ${saleId}::uuid AND direction = 'BUYER_ON_SELLER'`;
      expect(current).toHaveLength(1); // exactly one head
      expect(current[0].id).toBe(childId); // the edit is current, the root is superseded
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

    it('review_states: moderation_status/is_visible live in the mutable companion, NOT on the append-only reviews (ADR-0039 §3 β)', async () => {
      // The mutable state moved out of reviews (migration 0041). A row is created in review_states keyed on review_id;
      // its CHECK is chk_review_states_mod_status; and — being mutable — it accepts UPDATE (unlike append-only reviews).
      const saleId = await mkSale();
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO reviews(confirmed_sale_id, direction, market, rating) VALUES(${saleId}::uuid,'BUYER_ON_SELLER','pet',4) RETURNING id`;
      const reviewId = rows[0].id;
      await prisma.$executeRaw`INSERT INTO review_states(review_id) VALUES(${reviewId}::uuid)`;
      const st = await prisma.review_states.findUniqueOrThrow({ where: { review_id: reviewId } });
      expect(st.moderation_status).toBe('PENDING'); // default
      expect(st.is_visible).toBe(false); // double-blind default (fork 2)
      // bogus moderation_status is rejected by the companion's CHECK
      await expect(
        prisma.$executeRaw`INSERT INTO review_states(review_id, moderation_status) VALUES(gen_random_uuid(),'SHRUG')`,
      ).rejects.toThrow(/chk_review_states_mod_status|foreign key|23503/i);
      // MUTABLE: the moderation/visibility transition is a normal UPDATE (distinct from the append-only reviews)
      await prisma.$executeRaw`UPDATE review_states SET moderation_status='APPROVED', is_visible=TRUE, moderated_at=NOW() WHERE review_id=${reviewId}::uuid`;
      const after = await prisma.review_states.findUniqueOrThrow({ where: { review_id: reviewId } });
      expect(after.moderation_status).toBe('APPROVED');
      expect(after.is_visible).toBe(true);
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
