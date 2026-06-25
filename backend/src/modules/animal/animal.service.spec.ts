import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AnimalService } from './animal.service';
import { AbilityFactory } from '../../lib/auth/ability.factory';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import { weakEtag } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { AnimalCreateDto } from './dto/animal.dto';

const OWNER = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const ORG = '33333333-3333-3333-3333-333333333333';
const ANIMAL = '44444444-4444-4444-4444-444444444444';

const user = (id = OWNER): AuthPrincipal => ({ userId: id, role: 'USER', principalType: 'HUMAN' });
const admin: AuthPrincipal = { userId: 'admin-1', role: 'ADMIN', principalType: 'HUMAN' };
const moderator: AuthPrincipal = { userId: 'mod-1', role: 'MODERATOR', principalType: 'HUMAN' };
const agent: AuthPrincipal = { userId: 'agent-1', role: 'ADMIN', principalType: 'AGENT' };

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ANIMAL,
    owner_id: OWNER,
    organization_id: null,
    species_id: 1,
    breed_id: 7,
    breed_text_localized: null,
    nickname_localized: { en: 'Rex', ru: '' },
    sex: 'Male',
    date_of_birth: new Date('2020-01-01T00:00:00Z'),
    color_coat: null,
    description_localized: { en: '', ru: '' },
    microchip_id: null,
    tattoo_brand_id: null,
    is_active: true,
    owned_since: null,
    mother_id: null,
    father_id: null,
    health_records: [],
    reproductive_data: [],
    created_at: new Date('2026-06-25T00:00:00Z'),
    updated_at: new Date('2026-06-25T00:00:00Z'),
    deactivated_at: null,
    ...overrides,
  };
}

function setup(opts: { animal?: Record<string, unknown> | null; orgAdmin?: boolean } = {}) {
  const current = 'animal' in opts ? opts.animal : row();
  const create = jest
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve(row(args.data)));
  const update = jest
    .fn()
    .mockImplementation((args: { data: Record<string, unknown> }) =>
      Promise.resolve(row({ ...(current ?? {}), ...args.data })),
    );
  const animals = {
    findUnique: jest.fn().mockResolvedValue(current),
    findMany: jest.fn().mockResolvedValue(current ? [current] : []),
    count: jest.fn().mockResolvedValue(current ? 1 : 0),
    create,
    update,
  };
  // findFirst backs isOrgAdmin (create/mutate authz); findMany (= orgFind) backs listScope.
  const orgFindFirst = jest.fn().mockResolvedValue(opts.orgAdmin ? { id: 'm1' } : null);
  const orgFind = jest.fn().mockResolvedValue([]);
  const tx = { animals };
  const prisma = {
    animals,
    organization_users: { findFirst: orgFindFirst, findMany: orgFind },
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const svc = new AnimalService(prisma, audit, new AbilityFactory());
  return { svc, animals, create, update, record, orgFind };
}

const validCreate = (over: Partial<AnimalCreateDto> = {}): AnimalCreateDto => ({
  ownerId: OWNER,
  speciesId: 1,
  breedId: 7,
  nicknameLocalized: { en: 'Rex' },
  sex: 'Male',
  dateOfBirth: '2020-01-01',
  ...over,
});

describe('AnimalService', () => {
  describe('create — positive', () => {
    it('creates a personal-owned animal and audits with the acting principal', async () => {
      const { svc, create, record } = setup();
      const out = await svc.create(validCreate(), user());
      expect(out.id).toBe(ANIMAL);
      expect(create).toHaveBeenCalledTimes(1);
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'animal.created', entityType: 'animal', actorId: OWNER }),
        expect.anything(),
      );
    });

    it('snapshots an AGENT principal in the audit entry (ADR-0006)', async () => {
      const { svc, record } = setup();
      await svc.create(validCreate({ ownerId: undefined, organizationId: ORG }), { ...agent });
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({ actorPrincipalType: 'AGENT' }),
        expect.anything(),
      );
    });

    it('accepts a custom breed text when breedId is absent', async () => {
      const { svc } = setup();
      await expect(
        svc.create(validCreate({ breedId: undefined, breedTextLocalized: { en: 'Mixed' } }), user()),
      ).resolves.toBeDefined();
    });
  });

  describe('create — negative invariants', () => {
    it('XOR ownership: rejects both ownerId and organizationId (422)', async () => {
      const { svc } = setup({ orgAdmin: true });
      await expect(svc.create(validCreate({ organizationId: ORG }), admin)).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('XOR ownership: rejects neither ownerId nor organizationId (422)', async () => {
      const { svc } = setup();
      await expect(
        svc.create(validCreate({ ownerId: undefined }), admin),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('XOR breed: rejects both breedId and breedTextLocalized (422)', async () => {
      const { svc } = setup();
      await expect(
        svc.create(validCreate({ breedTextLocalized: { en: 'Mixed' } }), user()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('XOR breed: rejects neither breedId nor breedTextLocalized (422)', async () => {
      const { svc } = setup();
      await expect(svc.create(validCreate({ breedId: undefined }), user())).rejects.toBeInstanceOf(
        UnprocessableEntityException,
      );
    });

    it('nickname: rejects an all-empty nicknameLocalized (422)', async () => {
      const { svc } = setup();
      await expect(
        svc.create(validCreate({ nicknameLocalized: { en: '', ru: '' } }), user()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('microchip: rejects a non-15-digit chip (422)', async () => {
      const { svc } = setup();
      await expect(
        svc.create(validCreate({ microchipId: '12345' }), user()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('JSONB: rejects a health record with an unknown key (422)', async () => {
      const { svc } = setup();
      await expect(
        svc.create(validCreate({ healthRecords: [{ type: 'vaccination', date: '2024-01-01', bogus: 1 } as never] }), user()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('JSONB: rejects a reproductive item missing its required event (422)', async () => {
      const { svc } = setup();
      await expect(
        svc.create(validCreate({ reproductiveData: [{ date: '2024-01-01' } as never] }), user()),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('maps a unique-violation (23505) on microchip to a clean 409 — never a 500', async () => {
      const { svc, create } = setup();
      create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6', meta: { target: 'uq_animals_microchip' } }),
      );
      await expect(
        svc.create(validCreate({ microchipId: '123456789012345' }), user()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('maps the pedigree trigger RAISE EXCEPTION to a clean 422 (PEDIGREE_INVALID)', async () => {
      const { svc, create } = setup();
      create.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError('mother_id must reference a Female of the same species', { clientVersion: '6' }),
      );
      const err = await svc.create(validCreate({ motherId: OTHER }), user()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'PEDIGREE_INVALID' });
    });
  });

  describe('create — authz', () => {
    it('rejects a USER creating an animal owned by someone else (403)', async () => {
      const { svc } = setup();
      await expect(svc.create(validCreate({ ownerId: OTHER }), user())).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects a USER creating an org-owned animal they do not org-admin (403)', async () => {
      const { svc } = setup({ orgAdmin: false });
      await expect(
        svc.create(validCreate({ ownerId: undefined, organizationId: ORG }), user()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows an org-admin USER to create an org-owned animal', async () => {
      const { svc } = setup({ orgAdmin: true });
      await expect(
        svc.create(validCreate({ ownerId: undefined, organizationId: ORG }), user()),
      ).resolves.toBeDefined();
    });
  });

  describe('getById', () => {
    it('returns the animal + a weak ETag matching updated_at', async () => {
      const { svc } = setup();
      const { animal, etag } = await svc.getById(ANIMAL, user());
      expect(animal.id).toBe(ANIMAL);
      expect(etag).toBe(weakEtag(`animal:${ANIMAL}`, new Date('2026-06-25T00:00:00Z')));
    });

    it('404s when absent', async () => {
      const { svc } = setup({ animal: null });
      await expect(svc.getById(ANIMAL, user())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lets a MODERATOR read any animal (matrix R any)', async () => {
      const { svc } = setup();
      await expect(svc.getById(ANIMAL, moderator)).resolves.toBeDefined();
    });
  });

  describe('update', () => {
    it('updates mutable fields when If-Match matches', async () => {
      const { svc, update } = setup();
      const etag = weakEtag(`animal:${ANIMAL}`, new Date('2026-06-25T00:00:00Z'));
      const { animal } = await svc.update(ANIMAL, { colorCoat: 'black' }, etag, user());
      expect(update).toHaveBeenCalled();
      expect(animal.colorCoat).toBe('black');
    });

    it('428 when If-Match is missing', async () => {
      const { svc } = setup();
      const err = await svc.update(ANIMAL, { colorCoat: 'x' }, undefined, user()).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(428);
    });

    it('412 when If-Match is stale', async () => {
      const { svc } = setup();
      const err = await svc.update(ANIMAL, { colorCoat: 'x' }, 'W/"stale"', user()).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(412);
    });

    it('rejects an update from a non-owner USER (403)', async () => {
      const { svc } = setup();
      const etag = weakEtag(`animal:${ANIMAL}`, new Date('2026-06-25T00:00:00Z'));
      await expect(svc.update(ANIMAL, { colorCoat: 'x' }, etag, user(OTHER))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('rejects a MODERATOR update — R-only on Animals (403)', async () => {
      const { svc } = setup();
      const etag = weakEtag(`animal:${ANIMAL}`, new Date('2026-06-25T00:00:00Z'));
      await expect(svc.update(ANIMAL, { colorCoat: 'x' }, etag, moderator)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('deactivate / reactivate', () => {
    it('deactivates an active animal', async () => {
      const { svc, update } = setup();
      const out = await svc.deactivate(ANIMAL, user());
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ is_active: false }) }),
      );
      expect(out.isActive).toBe(false);
    });

    it('409 when deactivating an already-deactivated animal', async () => {
      const { svc } = setup({ animal: row({ is_active: false }) });
      await expect(svc.deactivate(ANIMAL, user())).rejects.toBeInstanceOf(ConflictException);
    });

    it('409 when reactivating an already-active animal', async () => {
      const { svc } = setup();
      await expect(svc.reactivate(ANIMAL, user())).rejects.toBeInstanceOf(ConflictException);
    });

    it('reactivates a deactivated animal and clears deactivated_at', async () => {
      const { svc, update } = setup({ animal: row({ is_active: false, deactivated_at: new Date() }) });
      await svc.reactivate(ANIMAL, user());
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ is_active: true, deactivated_at: null }) }),
      );
    });
  });

  describe('list — scoping (IDOR guard, rbac-matrix.md:62/81)', () => {
    const q = (over: Record<string, unknown> = {}) =>
      ({ page: 1, limit: 20, skip: 0, ...over }) as never;

    it('a USER is scoped to own + org-admin animals (filters AND-intersected with scope)', async () => {
      const { svc, animals } = setup();
      await svc.list(q({ species_id: 1 }), user());
      const arg = animals.findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
      // The query filter and the ownership scope are AND-composed (scope cannot be widened away).
      expect(arg.where.AND).toEqual([
        expect.objectContaining({ species_id: 1 }),
        { OR: [{ owner_id: OWNER }] },
      ]);
    });

    it('a user-supplied owner_id is INTERSECTED, never widening (own scope still ANDed)', async () => {
      const { svc, animals } = setup();
      await svc.list(q({ owner_id: OTHER }), user());
      const arg = animals.findMany.mock.calls[0][0] as { where: { AND: unknown[] } };
      // owner_id=OTHER stays in the filter, but the scope OR forces owner_id==actor → empty result set.
      expect(arg.where.AND).toEqual([
        expect.objectContaining({ owner_id: OTHER }),
        { OR: [{ owner_id: OWNER }] },
      ]);
    });

    it('includes org-owned animals for an org-admin USER', async () => {
      const { svc, animals, orgFind } = setup();
      orgFind.mockResolvedValueOnce([{ organization_id: ORG }]);
      await svc.list(q(), user());
      const arg = animals.findMany.mock.calls[0][0] as { where: { OR?: unknown[]; AND?: unknown[] } };
      const scope = arg.where.AND ? (arg.where.AND[1] as { OR: unknown[] }) : (arg.where as { OR: unknown[] });
      expect(scope.OR).toEqual([{ owner_id: OWNER }, { organization_id: { in: [ORG] } }]);
    });

    it('MODERATOR is unrestricted (no scope clause)', async () => {
      const { svc, animals } = setup();
      await svc.list(q({ species_id: 1 }), moderator);
      const arg = animals.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where.AND).toBeUndefined();
      expect(arg.where).toEqual(expect.objectContaining({ species_id: 1 }));
    });

    it('ADMIN is unrestricted (no scope clause)', async () => {
      const { svc, animals } = setup();
      await svc.list(q(), admin);
      const arg = animals.findMany.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(arg.where.AND).toBeUndefined();
    });

    it('returns the standard page envelope', async () => {
      const { svc } = setup();
      const res = await svc.list(q(), user());
      expect(res.meta).toEqual(expect.objectContaining({ page: 1, limit: 20, total: 1 }));
    });
  });

  describe('runWrite DB-error mapping', () => {
    it('maps a duplicate tattoo (23505 on uq_animals_tattoo) to a clean 409', async () => {
      const { svc, create } = setup();
      create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6', meta: { target: 'uq_animals_tattoo' } }),
      );
      const err = await svc.create(validCreate({ tattooBrandId: 'BRAND-1' }), user()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'DUPLICATE_IDENTIFIER' });
    });

    it('maps the immutable/ownership-lock trigger (P0001) to a clean 422 IMMUTABLE_FIELD', async () => {
      const { svc, update } = setup();
      update.mockRejectedValueOnce(
        new Prisma.PrismaClientUnknownRequestError('species_id cannot be changed after creation.', { clientVersion: '6' }),
      );
      const etag = weakEtag(`animal:${ANIMAL}`, new Date('2026-06-25T00:00:00Z'));
      const err = await svc.update(ANIMAL, { colorCoat: 'x' }, etag, user()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'IMMUTABLE_FIELD' });
    });
  });
});
