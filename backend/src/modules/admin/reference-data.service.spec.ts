import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReferenceDataService } from './reference-data.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import { weakEtag } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';

const admin: AuthPrincipal = { userId: 'admin-1', role: 'ADMIN', principalType: 'HUMAN' };

const speciesRow = {
  id: 1,
  code: 'dog',
  name_ru: 'Собака',
  name_en: 'Dog',
  market: 'pet',
  is_active: true,
  created_at: new Date('2026-06-22T00:00:00Z'),
  updated_at: new Date('2026-06-22T00:00:00Z'),
};
const breedRow = {
  id: 5,
  species_id: 1,
  code: 'akita',
  name_ru: 'Акита',
  name_en: 'Akita',
  is_active: true,
  created_at: new Date('2026-06-22T00:00:00Z'),
  updated_at: new Date('2026-06-22T00:00:00Z'),
};
const cityRow = {
  id: 9,
  name_ru: 'Москва',
  name_en: 'Moscow',
  is_active: true,
  created_at: new Date('2026-06-22T00:00:00Z'),
  updated_at: new Date('2026-06-22T00:00:00Z'),
};

function delegateMock(row: Record<string, unknown> | null) {
  return {
    findMany: jest.fn().mockResolvedValue(row ? [row] : []),
    count: jest.fn().mockResolvedValue(row ? 1 : 0),
    findUnique: jest.fn().mockResolvedValue(row),
    create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: 100, ...data })),
    update: jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...row, ...data })),
  };
}

function setup(opts: {
  species?: Record<string, unknown> | null;
  breeds?: Record<string, unknown> | null;
  cities?: Record<string, unknown> | null;
  speciesParent?: Record<string, unknown> | null;
} = {}) {
  const pick = <T>(key: keyof typeof opts, fallback: T): T =>
    key in opts ? (opts[key] as T) : fallback;
  const species = delegateMock(pick('species', speciesRow));
  const breeds = delegateMock(pick('breeds', breedRow));
  const cities = delegateMock(pick('cities', cityRow));
  // For breed→species integrity, the service calls prisma.species.findUnique directly.
  // Only override when the test exercises that path (so a `species: null` getById test still 404s).
  if ('speciesParent' in opts) {
    species.findUnique = jest.fn().mockResolvedValue(opts.speciesParent);
  }
  const record = jest.fn().mockResolvedValue(undefined);
  const prisma = { species, breeds, cities } as unknown as PrismaService;
  const audit = { record } as unknown as AuditLogService;
  return { svc: new ReferenceDataService(prisma, audit), species, breeds, cities, record };
}

describe('ReferenceDataService.list', () => {
  it('forces is_active=true for an anonymous caller (public read)', async () => {
    const { svc, species } = setup();
    await svc.list('species', { includeInactive: true, page: 1, limit: 20, skip: 0 }, undefined);
    expect(species.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { is_active: true } }));
  });

  it('honours includeInactive only for ADMIN', async () => {
    const { svc, species } = setup();
    await svc.list('species', { includeInactive: true, page: 1, limit: 20, skip: 0 }, admin);
    expect(species.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('searches code only for datasets that have a code column', async () => {
    const { svc, cities } = setup();
    await svc.list('cities', { includeInactive: false, page: 1, limit: 20, skip: 0, search: 'mos' }, undefined);
    const call = cities.findMany.mock.calls[0][0] as { where: { OR: unknown[] } };
    expect(call.where.OR).toHaveLength(2); // name_ru + name_en, no code
  });
});

describe('ReferenceDataService.getById', () => {
  it('404s when missing', async () => {
    const { svc } = setup({ species: null });
    await expect(svc.getById('species', 999)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the entry with a weak ETag derived from updated_at', async () => {
    const { svc } = setup();
    const { entry, etag } = await svc.getById('species', 1);
    expect(entry.id).toBe(1);
    expect(etag).toBe(weakEtag('species:1', speciesRow.updated_at));
  });
});

describe('ReferenceDataService.create', () => {
  it('creates a species and audit-logs with the acting principal', async () => {
    const { svc, species, record } = setup();
    await svc.create('species', { code: 'cat', name_ru: 'Кошка', name_en: 'Cat', market: 'pet' }, admin);
    expect(species.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'cat', market: 'pet', is_active: true }) }),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'reference_data.created', actorId: 'admin-1', actorRole: 'ADMIN' }),
    );
  });

  it('rejects a code on cities (field not applicable)', async () => {
    const { svc } = setup();
    await expect(
      svc.create('cities', { code: 'msk', name_ru: 'Москва', name_en: 'Moscow' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('requires speciesId for breeds', async () => {
    const { svc } = setup();
    await expect(
      svc.create('breeds', { code: 'akita', name_ru: 'Акита', name_en: 'Akita' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a breed whose speciesId does not exist (referential integrity)', async () => {
    const { svc } = setup({ speciesParent: null });
    await expect(
      svc.create('breeds', { code: 'akita', speciesId: 42, name_ru: 'Акита', name_en: 'Akita' }, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps a unique-violation to 409 Conflict', async () => {
    const { svc, species } = setup();
    species.create = jest.fn().mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }),
    );
    await expect(
      svc.create('species', { code: 'dog', name_ru: 'Собака', name_en: 'Dog' }, admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects market on a breed (not applicable)', async () => {
    const { svc } = setup();
    await expect(
      svc.create('breeds', { code: 'x', speciesId: 1, name_ru: 'X', name_en: 'X', market: 'pet' } as never, admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ReferenceDataService.update', () => {
  it('428s when If-Match is missing', async () => {
    const { svc } = setup();
    await expect(svc.update('species', 1, { name_en: 'Doggo' }, undefined, admin)).rejects.toMatchObject({
      status: 428,
    });
  });

  it('412s when If-Match is stale', async () => {
    const { svc } = setup();
    await expect(svc.update('species', 1, { name_en: 'Doggo' }, 'W/"stale"', admin)).rejects.toMatchObject({
      status: 412,
    });
  });

  it('updates with a valid If-Match and audits before/after', async () => {
    const { svc, species, record } = setup();
    const etag = weakEtag('species:1', speciesRow.updated_at);
    const { entry } = await svc.update('species', 1, { name_en: 'Doggo' }, etag, admin);
    expect(entry.name_en).toBe('Doggo');
    expect(species.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name_en: 'Doggo' } }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'reference_data.updated' }));
  });

  it('400s when no updatable fields are provided', async () => {
    const { svc } = setup();
    const etag = weakEtag('species:1', speciesRow.updated_at);
    await expect(svc.update('species', 1, {}, etag, admin)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ReferenceDataService.toggleActive', () => {
  it('flips is_active and audits a deactivation', async () => {
    const { svc, species, record } = setup({ species: { ...speciesRow, is_active: true } });
    const entry = await svc.toggleActive('species', 1, admin);
    expect(entry.isActive).toBe(false);
    expect(species.update).toHaveBeenCalledWith(expect.objectContaining({ data: { is_active: false } }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'reference_data.deactivated' }));
  });

  it('404s when the entry is missing', async () => {
    const { svc } = setup({ breeds: null });
    await expect(svc.toggleActive('breeds', 999, admin)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ReferenceDataService.form', () => {
  it('includes code+market for species, code+speciesId for breeds, neither for cities', () => {
    const { svc } = setup();
    expect(Object.keys(svc.form('species').fields)).toEqual(['code', 'name_ru', 'name_en', 'market', 'isActive']);
    expect(Object.keys(svc.form('breeds').fields)).toEqual(['code', 'speciesId', 'name_ru', 'name_en', 'isActive']);
    expect(Object.keys(svc.form('cities').fields)).toEqual(['name_ru', 'name_en', 'isActive']);
  });
});
