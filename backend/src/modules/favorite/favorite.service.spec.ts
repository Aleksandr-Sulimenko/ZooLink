import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { FavoriteService } from './favorite.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { ListingService } from '../listing/listing.service';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { FavoriteListQueryDto } from './dto/favorite.dto';

const ACTOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const FAV_ID = '33333333-3333-3333-3333-333333333333';
const LISTING = '44444444-4444-4444-4444-444444444444';

const p = (id: string, role: AuthPrincipal['role'] = 'USER'): AuthPrincipal => ({ userId: id, role, principalType: 'HUMAN' });

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: FAV_ID,
    user_id: ACTOR,
    listing_id: LISTING,
    offering_type: 'ANIMAL_LISTING',
    offering_id: LISTING,
    created_at: new Date('2026-07-07T00:00:00Z'),
    ...over,
  };
}

interface SetupOpts {
  rows?: Record<string, unknown>[];
  total?: number;
  createThrows?: Error; // simulate a UNIQUE (P2002) collision on add
  existing?: Record<string, unknown> | null; // the row returned by the post-collision findFirst
  visible?: boolean; // ListingService.assertVisibleToActor: true = pass, false = 404
}

function setup(opts: SetupOpts = {}) {
  const rows = opts.rows ?? [row()];
  const create = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) =>
    opts.createThrows ? Promise.reject(opts.createThrows) : Promise.resolve(row(args.data)),
  );
  const findFirst = jest.fn().mockResolvedValue(opts.existing ?? null);
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(opts.total ?? rows.length);
  const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
  const favorites = { create, findFirst, findMany, count, deleteMany };
  const prisma = { favorites } as unknown as PrismaService;

  const assertVisibleToActor = jest.fn().mockImplementation(() =>
    (opts.visible ?? true)
      ? Promise.resolve()
      : Promise.reject(new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' })),
  );
  const listings = { assertVisibleToActor } as unknown as ListingService;

  const svc = new FavoriteService(prisma, listings);
  return { svc, create, findFirst, findMany, count, deleteMany, assertVisibleToActor };
}

const query = (over: Partial<FavoriteListQueryDto> = {}): FavoriteListQueryDto =>
  ({ page: 1, limit: 20, skip: 0, ...over });

const p2002 = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6',
    meta: { target: ['user_id', 'listing_id'] },
  });

describe('FavoriteService', () => {
  // ── add: OfferingRef write + visibility gate ─────────────────────────────────────────────────────
  describe('add', () => {
    it('writes offering_type=ANIMAL_LISTING and offering_id=listingId with the server-derived owner; → 201 view', async () => {
      const { svc, create, assertVisibleToActor } = setup();
      const view = await svc.add(LISTING, p(ACTOR));
      expect(assertVisibleToActor).toHaveBeenCalledWith(LISTING, p(ACTOR)); // visibility gate runs first
      expect(create).toHaveBeenCalledWith({
        data: {
          user_id: ACTOR, // owner is the actor, never client-supplied (IDOR)
          listing_id: LISTING,
          offering_type: 'ANIMAL_LISTING',
          offering_id: LISTING, // OfferingRef: truthful pointer == listingId (NOT NULL, D2)
        },
      });
      expect(view).toMatchObject({ offeringType: 'ANIMAL_LISTING', offeringId: LISTING, listingId: LISTING });
    });

    it('dedup: a UNIQUE (P2002) collision returns the EXISTING favorite (idempotent 201), never a duplicate/throw', async () => {
      const existing = row({ id: OTHER });
      const { svc, create, findFirst } = setup({ createThrows: p2002(), existing });
      const view = await svc.add(LISTING, p(ACTOR));
      expect(create).toHaveBeenCalledTimes(1);
      expect(findFirst).toHaveBeenCalledWith({ where: { user_id: ACTOR, listing_id: LISTING } });
      expect(view.id).toBe(OTHER); // the pre-existing row, not a new one
    });

    it('rejects favoriting a listing that is not visible to the actor → 404 (no-leak), and never writes', async () => {
      const { svc, create } = setup({ visible: false });
      await expect(svc.add(LISTING, p(ACTOR))).rejects.toBeInstanceOf(NotFoundException);
      expect(create).not.toHaveBeenCalled(); // gate precedes the write
    });

    it('re-throws a non-P2002 DB error (no silent swallow)', async () => {
      const boom = new Prisma.PrismaClientKnownRequestError('fk', { code: 'P2003', clientVersion: '6' });
      const { svc, findFirst } = setup({ createThrows: boom });
      await expect(svc.add(LISTING, p(ACTOR))).rejects.toBe(boom);
      expect(findFirst).not.toHaveBeenCalled();
    });
  });

  // ── list: own-scope envelope ─────────────────────────────────────────────────────────────────────
  describe('list', () => {
    it('lists with WHERE user_id = actor and the {items, meta} envelope', async () => {
      const { svc, findMany, count } = setup({ rows: [row(), row({ id: OTHER })], total: 2 });
      const res = await svc.list(query(), p(ACTOR));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: ACTOR } }));
      expect(count).toHaveBeenCalledWith({ where: { user_id: ACTOR } });
      expect(res.items).toHaveLength(2);
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(res.items[0]).toMatchObject({ offeringType: 'ANIMAL_LISTING', offeringId: LISTING, listingId: LISTING });
    });

    it('negative: a MODERATOR is NOT widened — the scope is still user_id = the operator’s own id', async () => {
      const { svc, findMany, count } = setup();
      await svc.list(query(), p(ACTOR, 'MODERATOR'));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: ACTOR } }));
      expect(count).toHaveBeenCalledWith({ where: { user_id: ACTOR } });
    });
  });

  // ── remove: guarded, idempotent, leak-free ───────────────────────────────────────────────────────
  describe('remove', () => {
    it('deletes guarded by (listing_id AND user_id) and resolves 204 regardless of the row count', async () => {
      const { svc, deleteMany } = setup();
      await expect(svc.remove(LISTING, p(ACTOR))).resolves.toBeUndefined();
      expect(deleteMany).toHaveBeenCalledWith({ where: { listing_id: LISTING, user_id: ACTOR } });
    });

    it('leak-free: another user’s favorite deletes 0 rows but still resolves 204 (no 404/403, no existence leak)', async () => {
      const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const prisma = { favorites: { deleteMany } } as unknown as PrismaService;
      const listings = {} as unknown as ListingService;
      const svc = new FavoriteService(prisma, listings);
      await expect(svc.remove(LISTING, p(OTHER))).resolves.toBeUndefined();
      expect(deleteMany).toHaveBeenCalledWith({ where: { listing_id: LISTING, user_id: OTHER } });
    });
  });
});
