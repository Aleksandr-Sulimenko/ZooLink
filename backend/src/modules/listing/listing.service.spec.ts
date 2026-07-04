import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ListingService } from './listing.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { ModerationService } from '../moderation/moderation.service';
import type { AnimalService } from '../animal/animal.service';
import type { ConsentService } from '../identity/consent.service';
import type { OrgMembershipService } from '../../lib/org/org-membership.service';
import type { CryptoService } from '../../lib/crypto/crypto.service';
import type { OutboxService } from '../../lib/outbox/outbox.service';
import type { RedisService } from '../../lib/redis/redis.service';
import type { AppConfigService } from '../../config/app-config.service';
import { weakEtag } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { ListingCreateDto } from './dto/listing.dto';

const SELLER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ORG = '33333333-3333-3333-3333-333333333333';
const ANIMAL = '44444444-4444-4444-4444-444444444444';
const LISTING = '55555555-5555-5555-5555-555555555555';
const UPDATED = new Date('2026-06-26T00:00:00Z');

const p = (id: string, role: AuthPrincipal['role'] = 'USER', pt: AuthPrincipal['principalType'] = 'HUMAN'): AuthPrincipal => ({
  userId: id,
  role,
  principalType: pt,
});

function listingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LISTING,
    animal_id: ANIMAL,
    seller_id: SELLER,
    organization_id: null,
    branch_id: null,
    metadata: {},
    listing_type: 'sale',
    title_localized: { en: 'Pup', ru: '' },
    description_localized: { en: '', ru: '' },
    price_cents: 5000n,
    currency: 'RUB',
    quantity: 1,
    view_count: 0n,
    status: 'DRAFT',
    moderation_status: 'PENDING',
    published_at: null,
    sold_at: null,
    transaction_id: null,
    lat: null,
    lng: null,
    is_active: true,
    expires_at: null,
    created_at: new Date('2026-06-26T00:00:00Z'),
    updated_at: UPDATED,
    ...over,
  };
}

const animalRow = (over: Record<string, unknown> = {}) => ({ id: ANIMAL, owner_id: SELLER, organization_id: null, ...over });

interface SetupOpts {
  listing?: Record<string, unknown> | null;
  animal?: Record<string, unknown> | null;
  orgAdmin?: boolean;
  photoCount?: number;
  /** Seller users row returned for a contact reveal (null = seller not found). */
  seller?: Record<string, unknown> | null;
  /** Starting value for the Redis reveal counter — incr returns start+1, +2, … per call. */
  revealCounterStart?: number;
  /** contact_reveals.count() result (analytics). */
  revealCount?: number;
  /** contact_reveals.findFirst() result (analytics lastActivityAt). */
  lastReveal?: Record<string, unknown> | null;
  /** ADR-0020: seller's current CONTACT_DISTRIBUTION consent (default granted so reveal returns channels). */
  consentGranted?: boolean;
  /** ADR-0020 dedup: an existing contact_reveals row for (viewer, listing) → reveal returns it, no quota. */
  existingReveal?: Record<string, unknown> | null;
}

function setup(opts: SetupOpts = {}) {
  let current: Record<string, unknown> | null = 'listing' in opts ? opts.listing! : listingRow();
  const lCreate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
    current = listingRow(args.data);
    return Promise.resolve(current);
  });
  const lUpdate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
    current = { ...(current ?? {}), ...args.data };
    return Promise.resolve(current);
  });
  const lUpdateMany = jest.fn().mockImplementation((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const st = args.where.status;
    const matches = st === undefined || (current && (typeof st === 'object' ? (st as { in: string[] }).in.includes(current.status as string) : current.status === st));
    if (current && matches) {
      current = { ...current, ...args.data };
      return Promise.resolve({ count: 1 });
    }
    return Promise.resolve({ count: 0 });
  });
  const listings = {
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(current)),
    findMany: jest.fn().mockResolvedValue(current ? [current] : []),
    count: jest.fn().mockResolvedValue(current ? 1 : 0),
    create: lCreate,
    update: lUpdate,
    updateMany: lUpdateMany,
  };
  const animals = { findUnique: jest.fn().mockResolvedValue('animal' in opts ? opts.animal : animalRow()) };
  const photoCreate = jest.fn().mockResolvedValue({ id: 'photo-1', listing_id: LISTING, url: 'http://localhost:9000/a.jpg', order_index: 0, created_at: new Date() });
  const listing_photos = {
    count: jest.fn().mockResolvedValue(opts.photoCount ?? 0),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    create: photoCreate,
    delete: jest.fn().mockResolvedValue({}),
  };
  // Discovery path uses $queryRaw (data rows then a count row). Default: empty page.
  const queryRaw = jest
    .fn()
    .mockResolvedValueOnce([]) // data rows
    .mockResolvedValueOnce([{ count: 0n }]); // count
  // Contact-exchange (reveal) + analytics mocks.
  const seller =
    'seller' in opts
      ? opts.seller
      : { full_name: 'Seller Name', contact_phone: '+79990001122', contact_telegram: 'sellertg', contact_prefs: { show_phone: true, show_telegram: true } };
  const usersFindUnique = jest.fn().mockResolvedValue(seller);
  const users = { findUnique: usersFindUnique };
  const crCreate = jest.fn().mockResolvedValue({ id: 'reveal-1' });
  const crCount = jest.fn().mockResolvedValue(opts.revealCount ?? 0);
  // findFirst serves two paths: reveal dedup (where has viewer_id → existingReveal) and analytics
  // lastActivityAt (orderBy, no viewer_id → lastReveal). Branch on the args so both coexist.
  const existingReveal = 'existingReveal' in opts ? opts.existingReveal : null;
  const lastReveal = 'lastReveal' in opts ? opts.lastReveal : null;
  const crFindFirst = jest.fn().mockImplementation((args?: { where?: Record<string, unknown> }) =>
    Promise.resolve(args?.where?.viewer_id !== undefined ? existingReveal : lastReveal),
  );
  const contact_reveals = { create: crCreate, count: crCount, findFirst: crFindFirst };
  const tx = { listings, animals, listing_photos, contact_reveals };
  const prisma = {
    listings,
    animals,
    listing_photos,
    users,
    contact_reveals,
    $queryRaw: queryRaw,
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  // Slice-4c embed: a stub ModerationService.latestEffectiveResult (null = never moderated by default).
  const latestEffectiveResult = jest.fn().mockResolvedValue(null);
  const moderation = { latestEffectiveResult } as unknown as ModerationService;
  // isOrgAdmin backs create/mutate authz; orgAdminIds backs listScope.
  const isOrgAdmin = jest.fn().mockResolvedValue(opts.orgAdmin ?? false);
  const orgAdminIds = jest.fn().mockResolvedValue([] as string[]);
  const orgMembership = { isOrgAdmin, orgAdminIds } as unknown as OrgMembershipService;
  // ADR-0018: ListingService now obtains the animal + ownership decision from AnimalService.
  // The mock replays the real owner/org-admin/ADMIN predicate (parity with the removed
  // loadAnimal/assertOwnsAnimal) so the L-2 behaviour tests exercise the delegation end-to-end.
  const getOwnedAnimalForActor = jest.fn().mockImplementation(async (actor: AuthPrincipal) => {
    const animal = 'animal' in opts ? opts.animal : animalRow();
    if (!animal) throw new NotFoundException({ message: 'Animal not found', code: 'NOT_FOUND' });
    if (actor.role === 'ADMIN') return animal;
    if (animal.owner_id && animal.owner_id === actor.userId) return animal;
    if (animal.organization_id && (await isOrgAdmin(actor.userId, animal.organization_id))) return animal;
    throw new ForbiddenException({ message: 'You do not own this animal', code: 'FORBIDDEN' });
  });
  const animalService = { getOwnedAnimalForActor } as unknown as AnimalService;
  // Contact-exchange collaborators: crypto (decrypt = plaintext passthrough by default), outbox (publish),
  // redis (a stateful incr counter so repeated reveals in one test cross the per-market limit).
  const decrypt = jest.fn().mockImplementation((v: string | null) => v);
  const crypto = { decrypt } as unknown as CryptoService;
  const publish = jest.fn().mockResolvedValue(undefined);
  const outbox = { publish } as unknown as OutboxService;
  let revealCounter = opts.revealCounterStart ?? 0;
  const incr = jest.fn().mockImplementation(() => Promise.resolve(++revealCounter));
  const expire = jest.fn().mockResolvedValue(1);
  const ttl = jest.fn().mockResolvedValue(3600);
  // D1 views-capture dedup: SET NX EX returns 'OK' when the key was fresh (→ count) or null when it
  // already existed within the window (→ skip). Default 'OK' so a first view increments.
  const set = jest.fn().mockResolvedValue('OK');
  const redis = { client: { incr, expire, ttl, set } } as unknown as RedisService;
  // AUDIT3: media-host allowlist derives from S3_ENDPOINT — dev/test host is localhost:9000.
  const config = { get: (k: string) => (k === 'S3_ENDPOINT' ? 'http://localhost:9000' : undefined) } as unknown as AppConfigService;
  // ADR-0020: ConsentService stub — currentlyGranted defaults to true so existing reveal tests return channels.
  const currentlyGranted = jest.fn().mockResolvedValue(opts.consentGranted ?? true);
  const consent = { currentlyGranted, record: jest.fn() } as unknown as ConsentService;
  const svc = new ListingService(prisma, audit, moderation, orgMembership, animalService, crypto, outbox, redis, config, consent);
  return {
    svc,
    listings,
    animals,
    listing_photos,
    users,
    contact_reveals,
    record,
    isOrgAdmin,
    orgAdminIds,
    getOwnedAnimalForActor,
    queryRaw,
    latestEffectiveResult,
    usersFindUnique,
    crCreate,
    crCount,
    crFindFirst,
    decrypt,
    publish,
    incr,
    set,
    currentlyGranted,
  };
}

const validCreate = (over: Partial<ListingCreateDto> = {}): ListingCreateDto => ({
  animalId: ANIMAL,
  listingType: 'sale',
  titleLocalized: { en: 'Pup' },
  priceCents: 5000,
  ...over,
});

const etagOf = (): string => weakEtag(`listing:${LISTING}`, UPDATED);

describe('ListingService', () => {
  describe('create (→ DRAFT)', () => {
    it('creates a DRAFT with server-derived seller (L-1) and audits the actor (L-15)', async () => {
      const { svc, listings, record } = setup({ listing: null });
      const { listing } = await svc.create(validCreate(), p(SELLER));
      expect(listing.status).toBe('DRAFT');
      expect(listings.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ seller_id: SELLER, status: 'DRAFT' }) }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'listing.created' }), expect.anything());
    });

    it('L-2: creating for an animal the actor does not own → 403', async () => {
      const { svc } = setup({ listing: null, animal: animalRow({ owner_id: OTHER }) });
      await expect(svc.create(validCreate(), p(SELLER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('L-2: an org-admin may create for an org-owned animal', async () => {
      const { svc } = setup({ listing: null, animal: animalRow({ owner_id: null, organization_id: ORG }), orgAdmin: true });
      await expect(svc.create(validCreate({ organizationId: ORG }), p(OTHER))).resolves.toBeDefined();
    });

    it('L-4: branchId without organizationId → 422', async () => {
      const { svc } = setup({ listing: null });
      const err = await svc.create(validCreate({ branchId: ORG }), p(SELLER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
    });

    it('L-9: half-set lat/lng → 422', async () => {
      const { svc } = setup({ listing: null });
      await expect(svc.create(validCreate({ lat: 10 }), p(SELLER))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('L-P0: a forced ACTIVE while not APPROVED (trigger RAISE) → clean 422, never 500', async () => {
      const { svc, listings } = setup({ listing: null });
      listings.create.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError('Listing x cannot be ACTIVE unless moderation_status = APPROVED (got PENDING)', { clientVersion: '6' }),
      );
      const err = await svc.create(validCreate(), p(SELLER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('L-4 DB net: chk_listing_ownership RAISE → 422 not 500', async () => {
      const { svc, listings } = setup({ listing: null });
      listings.create.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError('new row violates check constraint "chk_listing_ownership"', { clientVersion: '6' }),
      );
      await expect(svc.create(validCreate(), p(SELLER))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('L-11: leasing is accepted with no special behaviour', async () => {
      const { svc } = setup({ listing: null });
      await expect(svc.create(validCreate({ listingType: 'leasing', priceCents: undefined }), p(SELLER))).resolves.toBeDefined();
    });

    it('rejects an all-empty title → 422', async () => {
      const { svc } = setup({ listing: null });
      await expect(svc.create(validCreate({ titleLocalized: { en: '', ru: '' } }), p(SELLER))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('getById — L-5 visibility', () => {
    it('a DRAFT is 404 for a non-owner (no existence leak)', async () => {
      const { svc } = setup();
      await expect(svc.getById(LISTING, p(OTHER))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a DRAFT is 404 for an anonymous caller', async () => {
      const { svc } = setup();
      await expect(svc.getById(LISTING, undefined)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('the owner sees their own DRAFT', async () => {
      const { svc } = setup();
      await expect(svc.getById(LISTING, p(SELLER))).resolves.toBeDefined();
    });

    it('an ACTIVE listing is public (anonymous OK)', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'ACTIVE', moderation_status: 'APPROVED' }) });
      await expect(svc.getById(LISTING, undefined)).resolves.toBeDefined();
    });

    it('MODERATOR may read a non-active listing', async () => {
      const { svc } = setup();
      await expect(svc.getById(LISTING, p(OTHER, 'MODERATOR'))).resolves.toBeDefined();
    });
  });

  // ── D1 views-capture (GAP-TRACE-006 · AUDIT3) ────────────────────────────────────────────────
  describe('getById — view capture (D1)', () => {
    const active = (over: Record<string, unknown> = {}) => listingRow({ status: 'ACTIVE', moderation_status: 'APPROVED', ...over });

    it('an ACTIVE detail read by a non-seller USER increments view_count once (deduped in Redis)', async () => {
      const { svc, listings, set } = setup({ listing: active() });
      const { listing } = await svc.getById(LISTING, p(OTHER));
      expect(set).toHaveBeenCalledWith(`listing-view:${LISTING}:u:${OTHER}`, '1', 'EX', 1800, 'NX');
      expect(listings.update).toHaveBeenCalledWith({ where: { id: LISTING }, data: { view_count: { increment: 1 } } });
      // The returned count reflects the pre-increment value (this reader is not counted in their own number).
      expect(listing.viewCount).toBe(0);
    });

    it('an anonymous detail read is deduped by client IP (F5 guard)', async () => {
      const { svc, listings, set } = setup({ listing: active() });
      await svc.getById(LISTING, undefined, '203.0.113.7');
      expect(set).toHaveBeenCalledWith(`listing-view:${LISTING}:ip:203.0.113.7`, '1', 'EX', 1800, 'NX');
      expect(listings.update).toHaveBeenCalledTimes(1);
    });

    it('a repeat view inside the dedup window (SET NX → null) does NOT re-increment', async () => {
      const { svc, listings, set } = setup({ listing: active() });
      set.mockResolvedValueOnce(null); // key already present → within window
      await svc.getById(LISTING, p(OTHER));
      expect(listings.update).not.toHaveBeenCalled();
    });

    it('the seller viewing their own ACTIVE listing is NOT counted (demand signal, not owner activity)', async () => {
      const { svc, listings, set } = setup({ listing: active() });
      await svc.getById(LISTING, p(SELLER));
      expect(set).not.toHaveBeenCalled();
      expect(listings.update).not.toHaveBeenCalled();
    });

    it('a non-ACTIVE listing is never counted (owner-visible DRAFT → no increment)', async () => {
      const { svc, listings, set } = setup({ listing: listingRow({ status: 'DRAFT' }) });
      await svc.getById(LISTING, p(SELLER));
      expect(set).not.toHaveBeenCalled();
      expect(listings.update).not.toHaveBeenCalled();
    });

    it('an anonymous read with no resolvable IP is skipped rather than over-counted', async () => {
      const { svc, listings, set } = setup({ listing: active() });
      await svc.getById(LISTING, undefined, null);
      expect(set).not.toHaveBeenCalled();
      expect(listings.update).not.toHaveBeenCalled();
    });

    it('best-effort: a Redis failure never fails the read (capture is additive, not critical)', async () => {
      const { svc, set } = setup({ listing: active() });
      set.mockRejectedValueOnce(new Error('redis down'));
      await expect(svc.getById(LISTING, p(OTHER))).resolves.toMatchObject({ listing: expect.objectContaining({ status: 'ACTIVE' }) });
    });
  });

  describe('update — L-3/L-12/L-13', () => {
    it('updates mutable fields on a DRAFT with a matching If-Match', async () => {
      const { svc } = setup();
      const { listing } = await svc.update(LISTING, { priceCents: 9000 }, etagOf(), p(SELLER));
      expect(listing.priceCents).toBe(9000);
    });

    it('L-3: a non-owner update → 403', async () => {
      const { svc } = setup();
      await expect(svc.update(LISTING, { priceCents: 1 }, etagOf(), p(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('L-3: a MODERATOR update → 403 (R-only on listings)', async () => {
      const { svc } = setup();
      await expect(svc.update(LISTING, { priceCents: 1 }, etagOf(), p(OTHER, 'MODERATOR'))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('L-13: missing If-Match → 428; stale → 412', async () => {
      const { svc } = setup();
      expect((await svc.update(LISTING, { priceCents: 1 }, undefined, p(SELLER)).catch((e: unknown) => e) as HttpException).getStatus()).toBe(428);
      expect((await svc.update(LISTING, { priceCents: 1 }, 'W/"x"', p(SELLER)).catch((e: unknown) => e) as HttpException).getStatus()).toBe(412);
    });

    it('M14-7: editing a non-editable source (PENDING_MODERATION) → 409 LISTING_NOT_EDITABLE', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'PENDING_MODERATION' }) });
      const err = await svc.update(LISTING, { priceCents: 1 }, etagOf(), p(SELLER)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'LISTING_NOT_EDITABLE' });
    });

    it('M14-7: SOLD / DEACTIVATED / EXPIRED sources are not editable → 409 LISTING_NOT_EDITABLE', async () => {
      for (const status of ['SOLD', 'DEACTIVATED', 'EXPIRED']) {
        const { svc } = setup({ listing: listingRow({ status }) });
        const err = await svc.update(LISTING, { priceCents: 1 }, etagOf(), p(SELLER)).catch((e: unknown) => e);
        expect((err as HttpException).getResponse()).toMatchObject({ code: 'LISTING_NOT_EDITABLE' });
      }
    });

    it('M14-6: a DRAFT edit stays DRAFT, no re-enqueue (plain update, not updateMany)', async () => {
      const { svc, listings } = setup();
      const { listing } = await svc.update(LISTING, { priceCents: 9000 }, etagOf(), p(SELLER));
      expect(listing.status).toBe('DRAFT');
      expect(listings.update).toHaveBeenCalled(); // DRAFT path uses update()
    });
  });

  describe('update — M-14 re-moderation on ACTIVE edit', () => {
    const active = (over: Record<string, unknown> = {}) =>
      listingRow({ status: 'ACTIVE', moderation_status: 'APPROVED', is_active: true, ...over });

    it('M14-1/M14-5: an ACTIVE edit re-enqueues (PENDING_MODERATION + PENDING) via a status-guarded updateMany; lock + escalated_at cleared; audited', async () => {
      const { svc, listings, record } = setup({ listing: active() });
      const { listing } = await svc.update(LISTING, { priceCents: 9000 }, etagOf(), p(SELLER));
      expect(listing.status).toBe('PENDING_MODERATION');
      expect(listings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: LISTING, status: 'ACTIVE' },
          data: expect.objectContaining({
            status: 'PENDING_MODERATION',
            moderation_status: 'PENDING',
            moderation_enqueued_at: expect.any(Date),
            is_active: false,
            assigned_to: null,
            locked_at: null,
            lock_expires_at: null,
            escalated_at: null,
          }),
        }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'listing.re_moderation_requested' }), expect.anything());
    });

    it('M14-1: each material field edit on an ACTIVE listing re-enqueues', async () => {
      for (const patch of [
        { titleLocalized: { en: 'New title' } },
        { descriptionLocalized: { en: 'New desc' } },
        { priceCents: 12345 },
      ]) {
        const { svc } = setup({ listing: active() });
        const { listing } = await svc.update(LISTING, patch, etagOf(), p(SELLER));
        expect(listing.status).toBe('PENDING_MODERATION');
      }
    });

    it('M14-3 TOCTOU loser: the guarded re-enqueue updateMany returns count 0 → 409 LISTING_NOT_EDITABLE, no audit', async () => {
      const { svc, listings, record } = setup({ listing: active() });
      listings.updateMany.mockResolvedValueOnce({ count: 0 });
      const err = await svc.update(LISTING, { priceCents: 1 }, etagOf(), p(SELLER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'LISTING_NOT_EDITABLE' });
      expect(record).not.toHaveBeenCalled(); // loser writes nothing
    });

    it('M14-4: a non-owner USER editing an ACTIVE listing → 403; a MODERATOR → 403 (R-only)', async () => {
      const { svc } = setup({ listing: active() });
      await expect(svc.update(LISTING, { priceCents: 1 }, etagOf(), p(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
      await expect(svc.update(LISTING, { priceCents: 1 }, etagOf(), p(OTHER, 'MODERATOR'))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('M14-2: a P0-trigger RAISE on the re-enqueue is mapped to a clean 422 (never 500)', async () => {
      const { svc, listings } = setup({ listing: active() });
      listings.updateMany.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError('Listing x cannot be ACTIVE unless moderation_status = APPROVED', { clientVersion: '6' }),
      );
      await expect(svc.update(LISTING, { priceCents: 1 }, etagOf(), p(SELLER))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  describe('submit — L-6/L-7', () => {
    it('L-6: submit with no photo → 422', async () => {
      const { svc } = setup({ photoCount: 0 });
      const err = await svc.submit(LISTING, etagOf(), p(SELLER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
    });

    it('L-6: a sale with price below MIN → 422', async () => {
      const { svc } = setup({ listing: listingRow({ price_cents: null }), photoCount: 1 });
      await expect(svc.submit(LISTING, etagOf(), p(SELLER))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('submits a valid DRAFT → PENDING_MODERATION (status-guarded, audited)', async () => {
      const { svc, listings, record } = setup({ photoCount: 1 });
      const { listing } = await svc.submit(LISTING, etagOf(), p(SELLER));
      expect(listing.status).toBe('PENDING_MODERATION');
      expect(listings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LISTING, status: 'DRAFT' }, data: expect.objectContaining({ status: 'PENDING_MODERATION', moderation_status: 'PENDING' }) }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'listing.submitted' }), expect.anything());
    });

    it('L-7: submit on a non-DRAFT → 409 LISTING_NOT_DRAFT', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'PENDING_MODERATION' }), photoCount: 1 });
      const err = await svc.submit(LISTING, etagOf(), p(SELLER)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'LISTING_NOT_DRAFT' });
    });

    it('a non-sale (breeding) with no price still submits if it has a photo', async () => {
      const { svc } = setup({ listing: listingRow({ listing_type: 'breeding', price_cents: null }), photoCount: 1 });
      await expect(svc.submit(LISTING, etagOf(), p(SELLER))).resolves.toBeDefined();
    });

    it('TOCTOU loser: guarded claim returns count 0 → 409 LISTING_NOT_DRAFT, no audit, no state change', async () => {
      const { svc, listings, record } = setup({ photoCount: 1 });
      // Pre-checks pass, but a concurrent submit already moved it off DRAFT → the inner guarded claim finds 0.
      listings.updateMany.mockResolvedValueOnce({ count: 0 });
      const err = await svc.submit(LISTING, etagOf(), p(SELLER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'LISTING_NOT_DRAFT' });
      expect(record).not.toHaveBeenCalled(); // loser writes nothing (no audit, tx rolls back)
    });
  });

  describe('withdraw — L-8', () => {
    it('soft-withdraws a DRAFT → DEACTIVATED', async () => {
      const { svc, listings } = setup();
      const out = await svc.withdraw(LISTING, p(SELLER));
      expect(out.status).toBe('DEACTIVATED');
      expect(out.isActive).toBe(false);
      expect(listings.updateMany).toHaveBeenCalled();
    });

    it('L-8: withdraw on a terminal SOLD → 409', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'SOLD' }) });
      await expect(svc.withdraw(LISTING, p(SELLER))).rejects.toBeInstanceOf(ConflictException);
    });

    it('L-8: withdraw on an already-DEACTIVATED → 409', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'DEACTIVATED' }) });
      await expect(svc.withdraw(LISTING, p(SELLER))).rejects.toBeInstanceOf(ConflictException);
    });

    it('TOCTOU loser: guarded claim returns count 0 → 409 terminal, no audit, no state change', async () => {
      const { svc, listings, record } = setup(); // pre-check passes (DRAFT is withdrawable)
      // A concurrent withdraw already moved it to a non-withdrawable state → the inner guarded claim finds 0.
      listings.updateMany.mockResolvedValueOnce({ count: 0 });
      const err = await svc.withdraw(LISTING, p(SELLER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'INVALID_STATE' });
      expect(record).not.toHaveBeenCalled(); // loser writes nothing
    });
  });

  describe('photos — L-14/L-3', () => {
    const OWN_URL = 'http://localhost:9000/zoolink-media/a.jpg'; // our S3/MinIO host (allowed)

    it('L-14: adding an 11th photo → 422', async () => {
      const { svc } = setup({ photoCount: 10 });
      await expect(svc.addPhoto(LISTING, { url: OWN_URL }, p(SELLER))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('adds a photo to a listing the actor owns', async () => {
      const { svc, listing_photos } = setup({ photoCount: 2 });
      const photo = await svc.addPhoto(LISTING, { url: OWN_URL }, p(SELLER));
      expect(photo.id).toBe('photo-1');
      expect(listing_photos.create).toHaveBeenCalled();
    });

    it('L-3: a non-owner adding a photo → 403', async () => {
      const { svc } = setup({ photoCount: 0 });
      await expect(svc.addPhoto(LISTING, { url: OWN_URL }, p(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    // AUDIT3: a photo URL on a foreign host is rejected (moderation-swap + SSRF defence). The owner
    // passes the L-3 gate, so this proves the host-allowlist (not authz) does the rejecting.
    it('rejects a photo URL on a non-S3 host → 422 (own-media allowlist)', async () => {
      const { svc, listing_photos } = setup({ photoCount: 0 });
      await expect(svc.addPhoto(LISTING, { url: 'http://evil.example.com/x.jpg' }, p(SELLER))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      // internal-target SSRF host also rejected
      await expect(svc.addPhoto(LISTING, { url: 'http://169.254.169.254/latest/meta-data' }, p(SELLER))).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
      expect(listing_photos.create).not.toHaveBeenCalled();
    });
  });

  describe('list — L-5 scoping (Slice-1 simple path: authenticated, no discovery params)', () => {
    const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, skip: 0, ...over }) as never;

    it('an authenticated USER (no market/geo) sees ACTIVE + their own listings (AND-intersected, Prisma path)', async () => {
      const { svc, listings } = setup();
      await svc.list(q({ listing_type: 'sale' }), p(SELLER));
      const arg = listings.findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
      expect(arg.where.AND[1]).toEqual({ OR: [{ status: 'ACTIVE' }, { seller_id: SELLER }] });
    });

    it('ADMIN/MODERATOR (no market/geo) are unrestricted (no scope clause)', async () => {
      const { svc, listings } = setup();
      await svc.list(q(), p(OTHER, 'MODERATOR'));
      const arg = listings.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where.AND).toBeUndefined();
    });
  });

  describe('list — Slice 2 discovery validation (L2-2/3/4/11/12)', () => {
    const q = (over: Record<string, unknown> = {}) => ({ page: 1, limit: 20, skip: 0, ...over }) as never;

    it('L2-2: an anonymous public read with no market → 422 MARKET_REQUIRED', async () => {
      const { svc } = setup();
      const err = await svc.list(q(), undefined).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'MARKET_REQUIRED' });
    });

    it('L2-2: an authenticated USER without market is allowed (owner-scoped)', async () => {
      const { svc } = setup();
      await expect(svc.list(q(), p(SELLER))).resolves.toBeDefined();
    });

    it('L2-2: a geo request without market → 422 MARKET_REQUIRED even when authenticated', async () => {
      const { svc } = setup();
      const err = await svc.list(q({ lat: 55, lng: 37, radius_km: 10 }), p(SELLER)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'MARKET_REQUIRED' });
    });

    it('L2-2: ADMIN/MODERATOR are market-exempt (cross-market operator scope)', async () => {
      const { svc } = setup();
      await expect(svc.list(q(), p(OTHER, 'ADMIN'))).resolves.toBeDefined();
    });

    it('a market-only anonymous search goes through the discovery ($queryRaw) path', async () => {
      const { svc, queryRaw } = setup();
      await svc.list(q({ market: 'pet' }), undefined);
      expect(queryRaw).toHaveBeenCalled();
    });

    it('L2-3: a partial geo set (lat+lng, no radius) → 422 GEO_PARAMS_INCOMPLETE', async () => {
      const { svc } = setup();
      const err = await svc.list(q({ market: 'pet', lat: 55, lng: 37 }), undefined).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'GEO_PARAMS_INCOMPLETE' });
    });

    it('L2-4: radius_km out of 1–100 → 422 RADIUS_OUT_OF_RANGE', async () => {
      const { svc } = setup();
      const lo = await svc.list(q({ market: 'pet', lat: 55, lng: 37, radius_km: 0 }), undefined).catch((e: unknown) => e);
      expect((lo as HttpException).getResponse()).toMatchObject({ code: 'RADIUS_OUT_OF_RANGE' });
      const hi = await svc.list(q({ market: 'pet', lat: 55, lng: 37, radius_km: 101 }), undefined).catch((e: unknown) => e);
      expect((hi as HttpException).getResponse()).toMatchObject({ code: 'RADIUS_OUT_OF_RANGE' });
    });

    it('L2-11: an unknown sort field → 400', async () => {
      const { svc } = setup();
      const err = await svc.list(q({ market: 'pet', sort: 'bogus:asc' }), undefined).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(400);
    });

    it('L2-11: an invalid sort direction → 400', async () => {
      const { svc } = setup();
      const err = await svc.list(q({ market: 'pet', sort: 'price:sideways' }), undefined).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(400);
    });

    it('L2-12: sort=distance without coords → 400', async () => {
      const { svc } = setup();
      const err = await svc.list(q({ market: 'pet', sort: 'distance:asc' }), undefined).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(400);
    });
  });

  // ── Contact reveal (spec 16, no-chat MVP) ────────────────────────────────────────────────────
  describe('revealContact', () => {
    const active = (over: Record<string, unknown> = {}) => listingRow({ status: 'ACTIVE', moderation_status: 'APPROVED', ...over });

    it('reveals the seller-enabled channels, logs a contact_reveals row, emits ContactReveal.Created', async () => {
      const { svc, crCreate, publish, decrypt } = setup({ listing: active() });
      const res = await svc.revealContact(LISTING, p(OTHER));
      expect(res).toMatchObject({ listingId: LISTING, sellerId: SELLER, sellerName: 'Seller Name' });
      expect(res.channels).toEqual({ phone: '+79990001122', telegram: 'sellertg' });
      expect(res.revealedAt).toBeInstanceOf(Date);
      expect(crCreate).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ listing_id: LISTING, viewer_id: OTHER, seller_id: SELLER }) }),
      );
      expect(decrypt).toHaveBeenCalledWith('+79990001122'); // ADR-0019: decrypt at reveal
      expect(publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: 'ContactReveal.Created', payload: expect.objectContaining({ viewerId: OTHER, sellerId: SELLER }) }),
      );
    });

    it('self-reveal → 422 SELF_REVEAL and logs nothing', async () => {
      const { svc, crCreate } = setup({ listing: active() });
      const err = await svc.revealContact(LISTING, p(SELLER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'SELF_REVEAL' });
      expect(crCreate).not.toHaveBeenCalled();
    });

    it('a non-ACTIVE listing → 404 (no existence leak)', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'DRAFT' }) });
      await expect(svc.revealContact(LISTING, p(OTHER))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns only the seller-enabled channels (show_telegram off → phone only)', async () => {
      const { svc } = setup({
        listing: active(),
        seller: { full_name: 'S', contact_phone: '+70000000000', contact_telegram: 'tg', contact_prefs: { show_phone: true, show_telegram: false } },
      });
      const res = await svc.revealContact(LISTING, p(OTHER));
      expect(res.channels).toEqual({ phone: '+70000000000' });
    });

    it('both channels off → NO_CHANNELS, nothing charged/written/emitted (ADR-0020 billing-unit fix)', async () => {
      const { svc, crCreate, incr, publish } = setup({
        listing: active(),
        seller: { full_name: 'S', contact_phone: '+7', contact_telegram: 'tg', contact_prefs: { show_phone: false, show_telegram: false } },
      });
      const res = await svc.revealContact(LISTING, p(OTHER));
      expect(res.channels).toEqual({});
      expect(res.status).toBe('NO_CHANNELS');
      expect(res.revealedAt).toBeNull();
      expect(crCreate).not.toHaveBeenCalled(); // no reveal row
      expect(incr).not.toHaveBeenCalled(); // no quota burned
      expect(publish).not.toHaveBeenCalled(); // no lead event
    });

    it('no CONTACT_DISTRIBUTION consent → NO_CHANNELS even when show_phone is on (ADR-0020 gate)', async () => {
      const { svc, crCreate, incr, currentlyGranted } = setup({
        listing: active(),
        consentGranted: false,
        seller: { full_name: 'S', contact_phone: '+79990001122', contact_telegram: 'tg', contact_prefs: { show_phone: true, show_telegram: true } },
      });
      const res = await svc.revealContact(LISTING, p(OTHER));
      expect(currentlyGranted).toHaveBeenCalledWith(SELLER, 'CONTACT_DISTRIBUTION');
      expect(res.channels).toEqual({});
      expect(res.status).toBe('NO_CHANNELS');
      expect(crCreate).not.toHaveBeenCalled();
      expect(incr).not.toHaveBeenCalled();
    });

    it('dedup: a repeat reveal of the same (viewer, listing) returns the existing row, no quota/row/event', async () => {
      const when = new Date('2026-07-01T00:00:00Z');
      const { svc, crCreate, incr, publish } = setup({ listing: active(), existingReveal: { created_at: when } });
      const res = await svc.revealContact(LISTING, p(OTHER));
      expect(res.status).toBe('REVEALED');
      expect(res.channels).toEqual({ phone: '+79990001122', telegram: 'sellertg' });
      expect(res.revealedAt).toEqual(when); // from the existing row
      expect(crCreate).not.toHaveBeenCalled(); // not re-written
      expect(incr).not.toHaveBeenCalled(); // not re-charged
      expect(publish).not.toHaveBeenCalled(); // not re-emitted
    });

    it('pet market: the 11th reveal within the hour → 429 + Retry-After (spec 16); the over-limit attempt logs nothing', async () => {
      const { svc, queryRaw, crCreate } = setup({ listing: active() });
      queryRaw.mockReset();
      queryRaw.mockResolvedValue([{ market: 'pet' }]); // marketOf → pet on every call
      for (let i = 0; i < 10; i++) await svc.revealContact(LISTING, p(OTHER));
      const err = await svc.revealContact(LISTING, p(OTHER)).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(429);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'RATE_LIMITED', retryAfter: 3600 });
      expect(crCreate).toHaveBeenCalledTimes(10);
    });

    it('livestock market: the 6th reveal within the hour → 429 (stricter 5/h limit, ADR-0002)', async () => {
      const { svc, queryRaw } = setup({ listing: active() });
      queryRaw.mockReset();
      queryRaw.mockResolvedValue([{ market: 'livestock' }]);
      for (let i = 0; i < 5; i++) await svc.revealContact(LISTING, p(OTHER));
      const err = await svc.revealContact(LISTING, p(OTHER)).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(429);
    });
  });

  // ── Mark sold (ACTIVE → SOLD, MVP) ───────────────────────────────────────────────────────────
  describe('markSold', () => {
    const active = (over: Record<string, unknown> = {}) => listingRow({ status: 'ACTIVE', moderation_status: 'APPROVED', ...over });

    it('marks an ACTIVE listing SOLD: sold_at set, is_active=false, emits Listing.Sold + audit', async () => {
      const { svc, listings, publish, record } = setup({ listing: active() });
      const { listing } = await svc.markSold(LISTING, etagOf(), p(SELLER));
      expect(listing.status).toBe('SOLD');
      expect(listing.isActive).toBe(false);
      expect(listing.soldAt).toBeInstanceOf(Date);
      expect(listings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: LISTING, status: 'ACTIVE' }, data: expect.objectContaining({ status: 'SOLD', is_active: false }) }),
      );
      expect(publish).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ eventType: 'Listing.Sold', payload: expect.objectContaining({ listingId: LISTING, sellerId: SELLER }) }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'listing.marked_sold' }), expect.anything());
    });

    it('owner-only: a non-owner → 403', async () => {
      const { svc } = setup({ listing: active() });
      await expect(svc.markSold(LISTING, etagOf(), p(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('a non-ACTIVE listing → 409 LISTING_NOT_ACTIVE', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'DRAFT' }) });
      const err = await svc.markSold(LISTING, etagOf(), p(SELLER)).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(409);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'LISTING_NOT_ACTIVE' });
    });

    it('missing If-Match → 428; stale → 412', async () => {
      const { svc } = setup({ listing: active() });
      expect((await svc.markSold(LISTING, undefined, p(SELLER)).catch((e: unknown) => e) as HttpException).getStatus()).toBe(428);
      expect((await svc.markSold(LISTING, 'W/"x"', p(SELLER)).catch((e: unknown) => e) as HttpException).getStatus()).toBe(412);
    });

    it('guarded single-winner: a lost ACTIVE→SOLD race → 409, writes nothing (no event/audit)', async () => {
      const { svc, listings, publish, record } = setup({ listing: active() });
      listings.updateMany.mockResolvedValueOnce({ count: 0 }); // a concurrent transition already left ACTIVE
      const err = await svc.markSold(LISTING, etagOf(), p(SELLER)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'LISTING_NOT_ACTIVE' });
      expect(publish).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });
  });

  // ── Analytics (listings-api ListingAnalytics) ────────────────────────────────────────────────
  describe('getAnalytics', () => {
    const active = (over: Record<string, unknown> = {}) => listingRow({ status: 'ACTIVE', moderation_status: 'APPROVED', ...over });

    it('owner sees contactReveals (sourced) + lastActivityAt; views is sourced from view_count (D1)', async () => {
      const when = new Date('2026-06-28T10:00:00Z');
      const { svc } = setup({ listing: active({ view_count: 42n }), revealCount: 3, lastReveal: { created_at: when } });
      const { analytics } = await svc.getAnalytics(LISTING, p(SELLER));
      expect(analytics).toMatchObject({ listingId: LISTING, views: 42, contactReveals: 3, lastActivityAt: when });
    });

    it('no reveals → contactReveals 0, lastActivityAt null', async () => {
      const { svc } = setup({ listing: active(), revealCount: 0, lastReveal: null });
      const { analytics } = await svc.getAnalytics(LISTING, p(SELLER));
      expect(analytics).toMatchObject({ contactReveals: 0, lastActivityAt: null });
    });

    it('a non-owner → 404 (no-leak), even on a public ACTIVE listing', async () => {
      const { svc } = setup({ listing: active() });
      await expect(svc.getAnalytics(LISTING, p(OTHER))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a MODERATOR (operator) may read analytics', async () => {
      const { svc } = setup({ listing: active(), revealCount: 1 });
      const { analytics } = await svc.getAnalytics(LISTING, p(OTHER, 'MODERATOR'));
      expect(analytics.listingId).toBe(LISTING);
    });
  });
});
