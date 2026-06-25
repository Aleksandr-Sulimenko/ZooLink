import { BadRequestException, NotFoundException, PreconditionFailedException, HttpException } from '@nestjs/common';
import { SystemSettingService } from './system-setting.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { FeatureToggleService } from '../../lib/feature-toggle/feature-toggle.service';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { weakEtag } from '../../lib/http/etag.util';

const admin: AuthPrincipal = { userId: 'admin-1', role: 'ADMIN', principalType: 'HUMAN' };
const UPDATED_AT = new Date('2026-06-24T00:00:00Z');

const toggleRow = (over: Record<string, unknown> = {}) => ({
  key: 'payments',
  description: 'Payments gate',
  is_enabled: false,
  rollout_percentage: 0,
  updated_at: UPDATED_AT,
  updated_by: 'admin-1',
  ...over,
});

function setup(row: Record<string, unknown> | null = toggleRow(), afterFlip = toggleRow({ is_enabled: true, rollout_percentage: 100, updated_at: new Date('2026-06-25T00:00:00Z') })) {
  const findUnique = jest.fn().mockResolvedValueOnce(row).mockResolvedValue(afterFlip);
  const findMany = jest.fn().mockResolvedValue(row ? [row] : []);
  const usersFindMany = jest.fn().mockResolvedValue([{ id: 'admin-1', principal_type: 'HUMAN' }]);
  const prisma = {
    feature_toggles: { findUnique, findMany },
    users: { findMany: usersFindMany },
  } as unknown as PrismaService;
  const flip = jest.fn().mockResolvedValue({ isEnabled: true, rolloutPercentage: 100 });
  const toggles = { flip } as unknown as FeatureToggleService;
  return { svc: new SystemSettingService(prisma, toggles), findUnique, findMany, usersFindMany, flip };
}

const etagFor = (row: { key: string; updated_at: Date }) => weakEtag(`system-setting:${row.key}`, row.updated_at);

describe('SystemSettingService.getAll', () => {
  it('returns an object MAP of SystemSetting keyed by key (not a page), with toggle value JSON + actor badge', async () => {
    const { svc } = setup();
    const all = await svc.getAll();
    expect(Array.isArray(all)).toBe(false);
    expect(Object.keys(all)).toEqual(['payments']);
    const s = all.payments;
    expect(s.key).toBe('payments');
    expect(JSON.parse(s.value)).toEqual({ isEnabled: false, rolloutPercentage: 0 });
    expect(s.description).toBe('Payments gate');
    expect(s.updatedBy).toEqual({ actorId: 'admin-1', principalType: 'HUMAN', actorDisplayName: null });
  });

  it('emits updatedBy: null when the toggle was never updated', async () => {
    const { svc } = setup(toggleRow({ updated_by: null }));
    const all = await svc.getAll();
    expect(all.payments.updatedBy).toBeNull();
  });
});

describe('SystemSettingService.update', () => {
  const body = { value: JSON.stringify({ isEnabled: true, rolloutPercentage: 100 }) };

  it('404s for an unknown setting key', async () => {
    const { svc } = setup(null);
    await expect(svc.update('nope', body, etagFor(toggleRow()), admin)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('428s when If-Match is missing (precondition required)', async () => {
    const { svc, flip } = setup();
    await expect(svc.update('payments', body, undefined, admin)).rejects.toBeInstanceOf(HttpException);
    expect(flip).not.toHaveBeenCalled();
  });

  it('412s when If-Match is stale', async () => {
    const { svc, flip } = setup();
    await expect(svc.update('payments', body, 'W/"deadbeef"', admin)).rejects.toBeInstanceOf(PreconditionFailedException);
    expect(flip).not.toHaveBeenCalled();
  });

  it('delegates to FeatureToggleService.flip and returns the new setting + fresh ETag on a valid If-Match', async () => {
    const after = toggleRow({ is_enabled: true, rollout_percentage: 100, updated_at: new Date('2026-06-25T00:00:00Z') });
    const { svc, flip } = setup(toggleRow(), after);
    const res = await svc.update('payments', body, etagFor(toggleRow()), admin, { ipAddress: '1.2.3.4', userAgent: 'jest' });
    expect(flip).toHaveBeenCalledWith(
      'payments',
      expect.objectContaining({ isEnabled: true, rolloutPercentage: 100 }),
      admin,
      { ipAddress: '1.2.3.4', userAgent: 'jest' },
    );
    expect(JSON.parse(res.setting.value)).toEqual({ isEnabled: true, rolloutPercentage: 100 });
    expect(res.etag).toBe(etagFor(after));
  });

  it('400s on a non-JSON value', async () => {
    const { svc, flip } = setup();
    await expect(svc.update('payments', { value: 'not json' }, etagFor(toggleRow()), admin)).rejects.toBeInstanceOf(BadRequestException);
    expect(flip).not.toHaveBeenCalled();
  });

  it('400s when value.isEnabled is not a boolean', async () => {
    const { svc } = setup();
    await expect(
      svc.update('payments', { value: JSON.stringify({ rolloutPercentage: 50 }) }, etagFor(toggleRow()), admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s when rolloutPercentage is out of 0..100', async () => {
    const { svc } = setup();
    await expect(
      svc.update('payments', { value: JSON.stringify({ isEnabled: true, rolloutPercentage: 150 }) }, etagFor(toggleRow()), admin),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
