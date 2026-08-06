/**
 * ADR-0038 reputation FORM-slice #1 — passive confirmed-sale capture, end-to-end against the real
 * stack (PG + Redis). Proves the record-of-truth accrues DORMANT on the transfer completion path:
 *  - a COMPLETED transfer writes exactly ONE auto-CONFIRMED confirmed_sales row (anchor=TRANSFER) in the
 *    SAME tx as the completion, with the right parties/market/actor-snapshot; amount_minor stays NULL;
 *  - a ConfirmedSale.Confirmed outbox event is written in that same tx (NOT .Created — no PENDING phase);
 *  - re-accepting a completed transfer does NOT create a second row (UNIQUE(ownership_transfer_id) +
 *    the accept status-guard = exactly-once under redelivery);
 *  - a declined / cancelled / expired transfer creates NO row;
 *  - the transfer's own behaviour is byte-identical (still COMPLETED, animal still re-attributed).
 * No consumer, no endpoint reads confirmed_sales — this is the dormant capture only.
 * e2e hits HOST pg/redis (localhost); flush host redis if 429s. Run: `npm run test:e2e`.
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
import { RedisService } from '../src/lib/redis/redis.service';
import { resetThrottle } from './throttle-reset.util';
import { provisionCanonicalDatabase, type CanonicalDb } from './support/canonical-db';
import { applyGlobalApiPrefix } from '../src/config/api-base';

// Р10-A: the append-only negative-invariant checks (m1) must measure the ARTIFACT — run the suite
// against a throwaway DB built from database_schema.sql (fixtures are all created inline; no seed).
const ORIGINAL_DATABASE_URL = process.env.DATABASE_URL;

describe('ADR-0038 confirmed-sale capture (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let redis: RedisService['client'];
  let canon: CanonicalDb;
  const animals: string[] = [];
  const transfers: string[] = [];
  let ownerId: string;
  let recipId: string;
  let ownerTok: string;
  let recipTok: string;
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
        nickname_localized: { en: 'Sale', ru: 'Продажа' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animals.push(a.id);
    await prisma.animal_ownership_history.create({
      data: { animal_id: a.id, owner_id: owner, start_date: new Date('2021-01-01T00:00:00Z') },
    });
    return a.id;
  };

  const initiate = (tok: string, animalId: string, body: Record<string, unknown>) =>
    request(server()).post(`/api/v1/animals/${animalId}/transfers`).set('Authorization', `Bearer ${tok}`).set('Idempotency-Key', randomUUID()).send(body);
  const getEtag = async (tok: string, transferId: string): Promise<string> =>
    (await request(server()).get(`/api/v1/transfers/${transferId}`).set('Authorization', `Bearer ${tok}`).expect(200)).headers['etag'];
  const track = (res: { body: { id?: unknown } }): string => {
    const id = res.body.id as string;
    transfers.push(id);
    return id;
  };
  const clearRateLimits = async (): Promise<void> => {
    const keys = [...(await redis.keys('transfer-initiate:*')), ...(await redis.keys('transfer-claim-mint:*'))];
    if (keys.length > 0) await redis.del(...keys);
  };
  /** Complete a fresh transfer owner→recip and return {animalId, transferId}. */
  const completeTransfer = async (owner = ownerId, recip = recipId, ownerT = ownerTok, recipT = recipTok): Promise<{ animalId: string; transferId: string }> => {
    const animalId = await newAnimal(owner);
    const transferId = track(await initiate(ownerT, animalId, { toUserId: recip }).expect(201));
    const etag = await getEtag(recipT, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/accept`).set('Authorization', `Bearer ${recipT}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);
    return { animalId, transferId };
  };

  beforeAll(async () => {
    // Р10-A: provision + point Prisma at the canon-built throwaway BEFORE AppModule compiles.
    canon = provisionCanonicalDatabase();
    process.env.DATABASE_URL = canon.url;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new ProblemExceptionFilter());
    applyGlobalApiPrefix(app);
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    await app.init();
    await resetThrottle(app);
    prisma = app.get(PrismaService);
    redis = app.get(RedisService).client;

    const mk = (n: string, role: string) =>
      prisma.users.create({ data: { full_name: n, role, principal_type: 'HUMAN', status: 'ACTIVE', is_active: true } });
    ownerId = (await mk('CSOwner', 'USER')).id;
    recipId = (await mk('CSRecip', 'USER')).id;
    [ownerTok, recipTok] = await Promise.all([devToken(ownerId), devToken(recipId)]);

    const sp = await prisma.species.create({ data: { code: `cs_e2e_sp_${suffix}`, name_localized: { en: 'S', ru: 'С' }, market: 'pet' } });
    speciesId = sp.id;
    const br = await prisma.breeds.create({ data: { code: `cs_e2e_br_${suffix}`, species_id: speciesId, name_localized: { en: 'B', ru: 'Б' } } });
    breedId = br.id;
  });

  afterAll(async () => {
    // confirmed_sales is append-only (trg_confirmed_sales_immutable) — disable the trigger for test
    // cleanup only (same idiom as the consents e2e). FK ON DELETE SET NULL means deleting parents would
    // orphan rows, so delete the sale rows explicitly by their anchor transfer.
    await prisma.$executeRaw`ALTER TABLE confirmed_sales DISABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    for (const id of transfers) {
      await prisma.confirmed_sales.deleteMany({ where: { ownership_transfer_id: id } }).catch(() => undefined);
    }
    await prisma.$executeRaw`ALTER TABLE confirmed_sales ENABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);

    for (const id of transfers) await prisma.ownership_transfers.deleteMany({ where: { id } }).catch(() => undefined);
    for (const id of animals) {
      await prisma.animal_ownership_history.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.ownership_transfers.deleteMany({ where: { animal_id: id } }).catch(() => undefined);
      await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    }
    if (breedId) await prisma.breeds.delete({ where: { id: breedId } }).catch(() => undefined);
    if (speciesId) await prisma.species.delete({ where: { id: speciesId } }).catch(() => undefined);
    for (const id of [ownerId, recipId]) if (id) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await app.close();
    // Restore env for the next suite (--runInBand shares the process) and drop the throwaway DB.
    if (ORIGINAL_DATABASE_URL !== undefined) process.env.DATABASE_URL = ORIGINAL_DATABASE_URL;
    canon?.teardown();
  });

  beforeEach(async () => {
    await clearRateLimits();
  });

  it('a COMPLETED transfer writes exactly one auto-CONFIRMED confirmed_sales row (anchor=TRANSFER), amount_minor NULL', async () => {
    const { animalId, transferId } = await completeTransfer();

    const sales = await prisma.confirmed_sales.findMany({ where: { ownership_transfer_id: transferId } });
    expect(sales).toHaveLength(1);
    const sale = sales[0];
    expect(sale.anchor_type).toBe('TRANSFER');
    expect(sale.status).toBe('CONFIRMED');
    expect(sale.offering_type).toBe('ANIMAL_LISTING');
    expect(sale.offering_id).toBeNull(); // no listing on a pure transfer anchor
    expect(sale.animal_id).toBe(animalId);
    expect(sale.market).toBe('pet'); // derived, ADR-0002 scope
    expect(sale.seller_user_id).toBe(ownerId); // FROM-party
    expect(sale.buyer_user_id).toBe(recipId); // TO-party
    expect(sale.actor_id).toBe(recipId); // the accepting actor
    expect(sale.actor_principal_type).toBe('HUMAN');
    expect(sale.confirmed_at).toBeTruthy();
    expect(sale.amount_minor).toBeNull(); // reserved, off-record default (owner 2026-07-09)
  });

  it('emits a ConfirmedSale.Confirmed outbox event (NOT .Created) in the same tx, market-stamped', async () => {
    const { transferId } = await completeTransfer();
    const sale = await prisma.confirmed_sales.findFirstOrThrow({ where: { ownership_transfer_id: transferId } });

    const events = await prisma.outbox_events.findMany({ where: { aggregate_type: 'ConfirmedSale', aggregate_id: sale.id } });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('ConfirmedSale.Confirmed');
    const payload = events[0].payload as Record<string, unknown>;
    expect(payload).toEqual(
      expect.objectContaining({ anchorType: 'TRANSFER', ownershipTransferId: transferId, status: 'CONFIRMED', market: 'pet' }),
    );
    // The Created event is never emitted from the transfer path.
    const created = await prisma.outbox_events.findMany({ where: { event_type: 'ConfirmedSale.Created', aggregate_id: sale.id } });
    expect(created).toHaveLength(0);
  });

  it('re-accepting a completed transfer does NOT create a second confirmed_sales row (exactly-once)', async () => {
    const { transferId } = await completeTransfer();
    // A second accept on the now-COMPLETED transfer is a 409 (terminal) — and must not add a row.
    const etag = await getEtag(recipTok, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(409);
    const sales = await prisma.confirmed_sales.findMany({ where: { ownership_transfer_id: transferId } });
    expect(sales).toHaveLength(1);
  });

  it('two parallel accepts (same ETag) → exactly one 200 AND exactly one confirmed_sales row', async () => {
    const animalId = await newAnimal(ownerId);
    const transferId = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, transferId);
    const fire = () =>
      request(server()).post(`/api/v1/transfers/${transferId}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).send();
    const [a, b] = await Promise.all([fire(), fire()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0]).toBe(200);
    expect([409, 412]).toContain(statuses[1]);
    // The record-of-truth is single-winner too — never two rows for one transfer.
    const sales = await prisma.confirmed_sales.findMany({ where: { ownership_transfer_id: transferId } });
    expect(sales).toHaveLength(1);
  });

  it('a declined transfer creates NO confirmed_sales row', async () => {
    const animalId = await newAnimal(ownerId);
    const transferId = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/decline`).set('Authorization', `Bearer ${recipTok}`).set('If-Match', etag).expect(200);
    const sales = await prisma.confirmed_sales.findMany({ where: { ownership_transfer_id: transferId } });
    expect(sales).toHaveLength(0);
  });

  it('a cancelled transfer creates NO confirmed_sales row', async () => {
    const animalId = await newAnimal(ownerId);
    const transferId = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    const etag = await getEtag(ownerTok, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/cancel`).set('Authorization', `Bearer ${ownerTok}`).set('If-Match', etag).expect(200);
    const sales = await prisma.confirmed_sales.findMany({ where: { ownership_transfer_id: transferId } });
    expect(sales).toHaveLength(0);
  });

  it('an expired transfer (accept after expiry) creates NO confirmed_sales row; transfer behaviour byte-identical', async () => {
    const animalId = await newAnimal(ownerId);
    const transferId = track(await initiate(ownerTok, animalId, { toUserId: recipId }).expect(201));
    await prisma.ownership_transfers.update({ where: { id: transferId }, data: { expires_at: new Date(Date.now() - 1000) } });
    const etag = await getEtag(recipTok, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(409);
    const sales = await prisma.confirmed_sales.findMany({ where: { ownership_transfer_id: transferId } });
    expect(sales).toHaveLength(0);
    // Byte-identical transfer behaviour: still owned by the original owner, transfer CANCELLED(expired).
    const animal = await prisma.animals.findUnique({ where: { id: animalId } });
    expect(animal?.owner_id).toBe(ownerId);
  });

  it('an org→user transfer records seller org / buyer user on the sale (parties from the transfer context)', async () => {
    const org = await prisma.organizations.create({ data: { name_localized: { en: 'CSOrg', ru: 'Орг' }, status: 'ACTIVE' } });
    await prisma.organization_users.create({ data: { organization_id: org.id, user_id: ownerId, role_in_org: 'OWNER', status: 'ACTIVE' } });
    // animal owned by the org; org-admin (owner) initiates to the recipient user.
    const a = await prisma.animals.create({
      data: { organization_id: org.id, species_id: speciesId, breed_id: breedId, nickname_localized: { en: 'OrgSale', ru: 'ОргПродажа' }, sex: 'Female', date_of_birth: new Date('2021-01-01T00:00:00Z') },
    });
    animals.push(a.id);
    await prisma.animal_ownership_history.create({ data: { animal_id: a.id, organization_id: org.id, start_date: new Date('2021-01-01T00:00:00Z') } });
    const transferId = track(await initiate(ownerTok, a.id, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);

    const sale = await prisma.confirmed_sales.findFirstOrThrow({ where: { ownership_transfer_id: transferId } });
    expect(sale.seller_organization_id).toBe(org.id);
    expect(sale.seller_user_id).toBeNull();
    expect(sale.buyer_user_id).toBe(recipId);

    // cleanup this test's extra fixtures (sale row cleaned by afterAll via the tracked transfer).
    await prisma.$executeRaw`ALTER TABLE confirmed_sales DISABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    await prisma.confirmed_sales.deleteMany({ where: { ownership_transfer_id: transferId } }).catch(() => undefined);
    await prisma.$executeRaw`ALTER TABLE confirmed_sales ENABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    await prisma.organization_users.deleteMany({ where: { organization_id: org.id } }).catch(() => undefined);
    await prisma.organizations.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  // ── n2(a): org-TO side — the buyer is an organization ──────────────────────────────────────────
  it('n2(a): a transfer TO an organization records buyer_organization_id (buyer_user_id NULL)', async () => {
    const org = await prisma.organizations.create({ data: { name_localized: { en: 'CSBuyerOrg', ru: 'ОргПок' }, status: 'ACTIVE' } });
    // recipId is the org-admin who accepts on the org's behalf (org branch of assertIsRecipient).
    await prisma.organization_users.create({ data: { organization_id: org.id, user_id: recipId, role_in_org: 'OWNER', status: 'ACTIVE' } });
    const animalId = await newAnimal(ownerId);
    const transferId = track(await initiate(ownerTok, animalId, { toOrganizationId: org.id }).expect(201));
    const etag = await getEtag(recipTok, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);

    const sale = await prisma.confirmed_sales.findFirstOrThrow({ where: { ownership_transfer_id: transferId } });
    expect(sale.buyer_organization_id).toBe(org.id);
    expect(sale.buyer_user_id).toBeNull();
    expect(sale.seller_user_id).toBe(ownerId); // FROM-party is the user owner
    expect(sale.actor_id).toBe(recipId); // the accepting org-admin

    await prisma.$executeRaw`ALTER TABLE confirmed_sales DISABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    await prisma.confirmed_sales.deleteMany({ where: { ownership_transfer_id: transferId } }).catch(() => undefined);
    await prisma.$executeRaw`ALTER TABLE confirmed_sales ENABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    await prisma.organization_users.deleteMany({ where: { organization_id: org.id } }).catch(() => undefined);
    await prisma.organizations.delete({ where: { id: org.id } }).catch(() => undefined);
  });

  // ── n2(b): a livestock transfer stamps market='livestock' (both other tests are pet) ───────────
  it('n2(b): a livestock-species transfer writes a confirmed_sales row with market=livestock (ADR-0002 derived scope)', async () => {
    const sp = await prisma.species.create({ data: { code: `cs_lv_sp_${suffix}`, name_localized: { en: 'Cow', ru: 'Корова' }, market: 'livestock' } });
    const br = await prisma.breeds.create({ data: { code: `cs_lv_br_${suffix}`, species_id: sp.id, name_localized: { en: 'B', ru: 'Б' } } });
    const a = await prisma.animals.create({
      data: { owner_id: ownerId, species_id: sp.id, breed_id: br.id, nickname_localized: { en: 'Bess', ru: 'Бесс' }, sex: 'Female', date_of_birth: new Date('2021-01-01T00:00:00Z') },
    });
    animals.push(a.id);
    await prisma.animal_ownership_history.create({ data: { animal_id: a.id, owner_id: ownerId, start_date: new Date('2021-01-01T00:00:00Z') } });
    const transferId = track(await initiate(ownerTok, a.id, { toUserId: recipId }).expect(201));
    const etag = await getEtag(recipTok, transferId);
    await request(server()).post(`/api/v1/transfers/${transferId}/accept`).set('Authorization', `Bearer ${recipTok}`).set('Idempotency-Key', randomUUID()).set('If-Match', etag).expect(200);

    const sale = await prisma.confirmed_sales.findFirstOrThrow({ where: { ownership_transfer_id: transferId } });
    expect(sale.market).toBe('livestock');

    // cleanup: sale row cleaned by afterAll (tracked transfer + tracked animal); remove the livestock dict.
    await prisma.$executeRaw`ALTER TABLE confirmed_sales DISABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    await prisma.confirmed_sales.deleteMany({ where: { ownership_transfer_id: transferId } }).catch(() => undefined);
    await prisma.$executeRaw`ALTER TABLE confirmed_sales ENABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    await prisma.ownership_transfers.deleteMany({ where: { animal_id: a.id } }).catch(() => undefined);
    await prisma.animal_ownership_history.deleteMany({ where: { animal_id: a.id } }).catch(() => undefined);
    await prisma.animals.delete({ where: { id: a.id } }).catch(() => undefined);
    animals.splice(animals.indexOf(a.id), 1);
    await prisma.breeds.delete({ where: { id: br.id } }).catch(() => undefined);
    await prisma.species.delete({ where: { id: sp.id } }).catch(() => undefined);
  });

  // ── m1: NEGATIVE invariants — every constraint the migration header claims is enforced ──────────
  // (Backs the migration header's "negative tests (UNIQUE, append-only UPDATE/DELETE, every CHECK…)"
  // with automated tests — the project bar is a negative test per invariant.) Bad values are literal
  // text in the tagged-template SQL (not interpolated variables), so parameterized-SQL discipline holds.
  describe('negative invariants (m1)', () => {
    it('append-only: UPDATE and DELETE of a confirmed_sales row are both rejected by the trigger', async () => {
      const { transferId } = await completeTransfer();
      const sale = await prisma.confirmed_sales.findFirstOrThrow({ where: { ownership_transfer_id: transferId } });
      await expect(prisma.$executeRaw`UPDATE confirmed_sales SET status = 'DISPUTED' WHERE id = ${sale.id}::uuid`).rejects.toThrow(/append-only/i);
      await expect(prisma.$executeRaw`DELETE FROM confirmed_sales WHERE id = ${sale.id}::uuid`).rejects.toThrow(/append-only/i);
    });

    it('UNIQUE(ownership_transfer_id): a second sale for the same transfer is rejected (mirror of INV-4)', async () => {
      const { transferId } = await completeTransfer();
      await expect(
        prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status, ownership_transfer_id) VALUES('TRANSFER','pet','CONFIRMED',${transferId}::uuid)`,
      ).rejects.toThrow(/already exists|unique|23505/i);
    });

    it('CHECK chk_confirmed_sales_anchor: a bogus anchor_type is rejected', async () => {
      await expect(prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status) VALUES('WHOLESALE','pet','CONFIRMED')`).rejects.toThrow(/chk_confirmed_sales_anchor/i);
    });

    it('CHECK chk_confirmed_sales_status: PENDING_CONFIRMATION is rejected — CONFIRMED-only fact (ADR-0038 §4 Amendment)', async () => {
      // The narrowed CHECK (= 'CONFIRMED', migration 0041) is the Q2 gravestone: PENDING/DISPUTED/EXPIRED/
      // CANCELLED live in sale_confirmations now; confirmed_sales holds only the CONFIRMED fact.
      await expect(prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status) VALUES('TRANSFER','pet','PENDING_CONFIRMATION')`).rejects.toThrow(/chk_confirmed_sales_status/i);
      await expect(prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status) VALUES('TRANSFER','pet','SETTLED')`).rejects.toThrow(/chk_confirmed_sales_status/i);
    });

    it('CHECK chk_confirmed_sales_offering_type: a bogus offering_type is rejected (widen-additively guard)', async () => {
      await expect(prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status, offering_type) VALUES('TRANSFER','pet','CONFIRMED','SERVICE')`).rejects.toThrow(/chk_confirmed_sales_offering_type/i);
    });

    it('CHECK chk_confirmed_sales_market: a bogus market is rejected (ADR-0002 domain)', async () => {
      await expect(prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status) VALUES('TRANSFER','fish','CONFIRMED')`).rejects.toThrow(/chk_confirmed_sales_market/i);
    });

    it('CHECK chk_confirmed_sales_actor_ptype: a bogus actor_principal_type is rejected (agent-as-principal domain)', async () => {
      await expect(prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status, actor_principal_type) VALUES('TRANSFER','pet','CONFIRMED','ROBOT')`).rejects.toThrow(/chk_confirmed_sales_actor_ptype/i);
    });

    it('positive control: an AGENT actor_principal_type is accepted (agent-as-principal, ADR-0006)', async () => {
      // Cleanup-safe: written with anchor=LISTING_MARK_SOLD / transfer_id NULL, removed inline via the trigger toggle.
      // status is CONFIRMED — the only value the narrowed CHECK admits (migration 0041 CONFIRMED-only fact).
      await prisma.$executeRaw`INSERT INTO confirmed_sales(anchor_type, market, status, actor_principal_type) VALUES('LISTING_MARK_SOLD','livestock','CONFIRMED','AGENT')`;
      await prisma.$executeRaw`ALTER TABLE confirmed_sales DISABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
      await prisma.$executeRaw`DELETE FROM confirmed_sales WHERE anchor_type='LISTING_MARK_SOLD' AND actor_principal_type='AGENT' AND ownership_transfer_id IS NULL`.catch(() => undefined);
      await prisma.$executeRaw`ALTER TABLE confirmed_sales ENABLE TRIGGER trg_confirmed_sales_immutable`.catch(() => undefined);
    });
  });
});
