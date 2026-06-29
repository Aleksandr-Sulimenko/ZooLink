import { BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { SavedSearchService } from './saved-search.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { SavedSearchCreateDto, SavedSearchListQueryDto } from './dto/saved-search.dto';

const ACTOR = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ROW_ID = '33333333-3333-3333-3333-333333333333';

const p = (id: string, role: AuthPrincipal['role'] = 'USER'): AuthPrincipal => ({ userId: id, role, principalType: 'HUMAN' });

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROW_ID,
    user_id: ACTOR,
    name: null,
    filters: {},
    lat: null,
    lng: null,
    radius_m: null,
    created_at: new Date('2026-06-30T00:00:00Z'),
    updated_at: new Date('2026-06-30T00:00:00Z'),
    ...over,
  };
}

interface SetupOpts {
  rows?: Record<string, unknown>[];
  total?: number;
  deleteCount?: number;
}

function setup(opts: SetupOpts = {}) {
  const rows = opts.rows ?? [row()];
  const create = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve(row(args.data)));
  const findMany = jest.fn().mockResolvedValue(rows);
  const count = jest.fn().mockResolvedValue(opts.total ?? rows.length);
  const deleteMany = jest.fn().mockResolvedValue({ count: opts.deleteCount ?? 1 });
  const saved_searches = { create, findMany, count, deleteMany };
  const prisma = { saved_searches } as unknown as PrismaService;
  const svc = new SavedSearchService(prisma);
  return { svc, create, findMany, count, deleteMany };
}

const make = (over: Partial<SavedSearchCreateDto> = {}): SavedSearchCreateDto => ({ filters: {}, ...over });
const query = (over: Partial<SavedSearchListQueryDto> = {}): SavedSearchListQueryDto =>
  ({ page: 1, limit: 20, skip: 0, ...over });

describe('SavedSearchService', () => {
  // ── SS-1 own-scope list ────────────────────────────────────────────────────────────────────────
  describe('SS-1 own-scope list', () => {
    it('lists with WHERE user_id = actor and the {items, meta} envelope', async () => {
      const { svc, findMany, count } = setup({ rows: [row(), row({ id: OTHER })], total: 2 });
      const res = await svc.list(query(), p(ACTOR));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: ACTOR } }));
      expect(count).toHaveBeenCalledWith({ where: { user_id: ACTOR } });
      expect(res.items).toHaveLength(2);
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    });

    it('SS-1 negative: a MODERATOR is NOT widened — the scope is still user_id = the operator’s own id', async () => {
      const { svc, findMany, count } = setup();
      await svc.list(query(), p(ACTOR, 'MODERATOR'));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: ACTOR } }));
      expect(count).toHaveBeenCalledWith({ where: { user_id: ACTOR } });
    });

    it('SS-1 negative: an ADMIN is NOT widened either (own/own/own)', async () => {
      const { svc, findMany } = setup();
      await svc.list(query(), p(ACTOR, 'ADMIN'));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: ACTOR } }));
    });

    it('SS-1 added role: a VETERINARIAN ("USER + extra") lists only their own — own-scope holds for inherited roles', async () => {
      const { svc, findMany, count } = setup();
      await svc.list(query(), p(ACTOR, 'VETERINARIAN'));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { user_id: ACTOR } }));
      expect(count).toHaveBeenCalledWith({ where: { user_id: ACTOR } });
    });

    it('maps a row to the camelCase view, returning filters verbatim', async () => {
      const { svc } = setup({ rows: [row({ name: 'near me', filters: { market: 'pet', species_id: 3 }, lat: 55.7, lng: 37.6, radius_m: 5000 })] });
      const res = await svc.list(query(), p(ACTOR));
      expect(res.items[0]).toMatchObject({ id: ROW_ID, userId: ACTOR, name: 'near me', filters: { market: 'pet', species_id: 3 }, lat: 55.7, lng: 37.6, radiusM: 5000 });
    });
  });

  // ── SS-2 404-no-leak delete ─────────────────────────────────────────────────────────────────────
  describe('SS-2 404-no-leak delete', () => {
    it('deletes own row (guarded by id AND user_id) → resolves (204 at the controller)', async () => {
      const { svc, deleteMany } = setup({ deleteCount: 1 });
      await expect(svc.delete(ROW_ID, p(ACTOR))).resolves.toBeUndefined();
      expect(deleteMany).toHaveBeenCalledWith({ where: { id: ROW_ID, user_id: ACTOR } });
    });

    it('SS-2 negative: a non-existent id → 404 SAVED_SEARCH_NOT_FOUND (0 rows)', async () => {
      const { svc } = setup({ deleteCount: 0 });
      await expect(svc.delete(ROW_ID, p(ACTOR))).rejects.toMatchObject({ response: { code: 'SAVED_SEARCH_NOT_FOUND' } });
    });

    it('SS-2 negative: deleting another user’s id → identical 404 (never 403); guard carries the actor id', async () => {
      const { svc, deleteMany } = setup({ deleteCount: 0 }); // user_id guard means B's id matches 0 rows for A
      const err = await svc.delete(ROW_ID, p(OTHER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NotFoundException);
      expect((err as { response: { code: string } }).response.code).toBe('SAVED_SEARCH_NOT_FOUND');
      expect(deleteMany).toHaveBeenCalledWith({ where: { id: ROW_ID, user_id: OTHER } });
    });
  });

  // ── SS-3 bounded filters ─────────────────────────────────────────────────────────────────────────
  describe('SS-3 bounded filters', () => {
    it('accepts a fully-populated whitelist and stores it verbatim with the server-derived owner', async () => {
      const { svc, create } = setup();
      const filters = { q: 'corgi', market: 'pet', species_id: 1, breed_id: 2, listing_type: 'sale', price_min: 1000, price_max: 5000 };
      await svc.create(make({ filters }), p(ACTOR));
      expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: ACTOR, filters }) });
    });

    it('accepts an empty filters object', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ filters: {} }), p(ACTOR))).resolves.toMatchObject({ userId: ACTOR });
    });

    it('SS-3 negative: an unknown key → 422 INVALID_FILTERS (additionalProperties:false; never persisted)', async () => {
      const { svc, create } = setup();
      await expect(svc.create(make({ filters: { color: 'red' } }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'INVALID_FILTERS' } });
      expect(create).not.toHaveBeenCalled();
    });

    it('SS-3 negative: a type mismatch (species_id as string) → 422 INVALID_FILTERS', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ filters: { species_id: 'dog' } }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'INVALID_FILTERS' } });
    });

    it('SS-3 negative: an out-of-enum market → 422 INVALID_FILTERS', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ filters: { market: 'fish' } }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'INVALID_FILTERS' } });
    });

    it('SS-3 negative: an oversized filters object (> 2048 bytes) → 422 INVALID_FILTERS', async () => {
      const { svc } = setup();
      const big = { q: 'x'.repeat(3000) }; // serialized JSON exceeds the cap
      await expect(svc.create(make({ filters: big }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'INVALID_FILTERS' } });
    });

    it('SS-3 negative: price_max < price_min → 422 INVALID_FILTERS', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ filters: { price_min: 5000, price_max: 1000 } }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'INVALID_FILTERS' } });
    });

    it('SS-3 negative: a non-object filters (array) → 422 INVALID_FILTERS', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ filters: [1, 2] as unknown as Record<string, unknown> }), p(ACTOR))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });
  });

  // ── SS-4 radius coherence ────────────────────────────────────────────────────────────────────────
  describe('SS-4 location coherence', () => {
    it('accepts a coherent point + radius', async () => {
      const { svc, create } = setup();
      await svc.create(make({ lat: 55.7, lng: 37.6, radiusM: 5000 }), p(ACTOR));
      expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ lat: 55.7, lng: 37.6, radius_m: 5000 }) });
    });

    it('accepts no point and no radius (a non-geo saved search)', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ filters: { market: 'pet' } }), p(ACTOR))).resolves.toMatchObject({ userId: ACTOR });
    });

    it('SS-4 negative: lat without lng → 422 GEO_PARAMS_INCOMPLETE', async () => {
      const { svc, create } = setup();
      await expect(svc.create(make({ lat: 55.7, radiusM: 5000 }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'GEO_PARAMS_INCOMPLETE' } });
      expect(create).not.toHaveBeenCalled();
    });

    it('SS-4 negative: a point without a radius → 422 GEO_PARAMS_INCOMPLETE', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ lat: 55.7, lng: 37.6 }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'GEO_PARAMS_INCOMPLETE' } });
    });

    it('SS-4 negative: a radius with no point → 422 GEO_PARAMS_INCOMPLETE', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ radiusM: 5000 }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'GEO_PARAMS_INCOMPLETE' } });
    });

    it('SS-4 negative: radius below 1000 → 422 RADIUS_OUT_OF_RANGE', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ lat: 55.7, lng: 37.6, radiusM: 500 }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'RADIUS_OUT_OF_RANGE' } });
    });

    it('SS-4 negative: radius above 100000 → 422 RADIUS_OUT_OF_RANGE', async () => {
      const { svc } = setup();
      await expect(svc.create(make({ lat: 55.7, lng: 37.6, radiusM: 200000 }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'RADIUS_OUT_OF_RANGE' } });
    });
  });

  // ── SS-5 list envelope + sort ────────────────────────────────────────────────────────────────────
  describe('SS-5 list envelope + sort', () => {
    it('defaults to created_at:desc', async () => {
      const { svc, findMany } = setup();
      await svc.list(query(), p(ACTOR));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ created_at: 'desc' }, { id: 'desc' }] }));
    });

    it('honours a whitelisted sort (updated_at:asc)', async () => {
      const { svc, findMany } = setup();
      await svc.list(query({ sort: 'updated_at:asc' }), p(ACTOR));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ updated_at: 'asc' }, { id: 'desc' }] }));
    });

    it('paginates with skip/take', async () => {
      const { svc, findMany } = setup();
      await svc.list(query({ page: 3, limit: 10, skip: 20 }), p(ACTOR));
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    });

    it('SS-5 negative: an unknown sort field → 400 INVALID_SORT', async () => {
      const { svc } = setup();
      await expect(svc.list(query({ sort: 'name:asc' }), p(ACTOR))).rejects.toMatchObject({ response: { code: 'INVALID_SORT' } });
    });

    it('SS-5 negative: an unknown sort direction → 400 INVALID_SORT', async () => {
      const { svc } = setup();
      const err = await svc.list(query({ sort: 'created_at:sideways' }), p(ACTOR)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as { response: { code: string } }).response.code).toBe('INVALID_SORT');
    });
  });
});
