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
  const photoCreate = jest.fn().mockResolvedValue({ id: 'photo-1', listing_id: LISTING, url: 'http://x/a.jpg', order_index: 0, created_at: new Date() });
  const listing_photos = {
    count: jest.fn().mockResolvedValue(opts.photoCount ?? 0),
    findMany: jest.fn().mockResolvedValue([]),
    findUnique: jest.fn().mockResolvedValue(null),
    create: photoCreate,
    delete: jest.fn().mockResolvedValue({}),
  };
  const orgFindFirst = jest.fn().mockResolvedValue(opts.orgAdmin ? { id: 'm' } : null);
  const orgFindMany = jest.fn().mockResolvedValue([]);
  // Discovery path uses $queryRaw (data rows then a count row). Default: empty page.
  const queryRaw = jest
    .fn()
    .mockResolvedValueOnce([]) // data rows
    .mockResolvedValueOnce([{ count: 0n }]); // count
  const tx = { listings, animals, listing_photos };
  const prisma = {
    listings,
    animals,
    listing_photos,
    organization_users: { findFirst: orgFindFirst, findMany: orgFindMany },
    $queryRaw: queryRaw,
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  // Slice-4c embed: a stub ModerationService.latestEffectiveResult (null = never moderated by default).
  const latestEffectiveResult = jest.fn().mockResolvedValue(null);
  const moderation = { latestEffectiveResult } as unknown as ModerationService;
  const svc = new ListingService(prisma, audit, moderation);
  return { svc, listings, animals, listing_photos, record, orgFindFirst, orgFindMany, queryRaw, latestEffectiveResult };
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
    it('L-14: adding an 11th photo → 422', async () => {
      const { svc } = setup({ photoCount: 10 });
      await expect(svc.addPhoto(LISTING, { url: 'http://x/a.jpg' }, p(SELLER))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('adds a photo to a listing the actor owns', async () => {
      const { svc, listing_photos } = setup({ photoCount: 2 });
      const photo = await svc.addPhoto(LISTING, { url: 'http://x/a.jpg' }, p(SELLER));
      expect(photo.id).toBe('photo-1');
      expect(listing_photos.create).toHaveBeenCalled();
    });

    it('L-3: a non-owner adding a photo → 403', async () => {
      const { svc } = setup({ photoCount: 0 });
      await expect(svc.addPhoto(LISTING, { url: 'http://x/a.jpg' }, p(OTHER))).rejects.toBeInstanceOf(ForbiddenException);
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
});
