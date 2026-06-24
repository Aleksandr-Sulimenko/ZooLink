import { ForbiddenException } from '@nestjs/common';
import { FeatureToggleService } from './feature-toggle.service';
import { rolloutBucket } from './rollout';
import type { PrismaService } from '../db/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';
import type { AuthPrincipal } from '../auth/principal';

type ToggleRow = {
  key: string;
  is_enabled: boolean;
  rollout_percentage: number | null;
};

const admin: AuthPrincipal = { userId: 'admin-1', role: 'ADMIN', principalType: 'HUMAN' };

function makeService(row: ToggleRow | null) {
  const findUnique = jest.fn().mockResolvedValue(row);
  const prisma = { feature_toggles: { findUnique } } as unknown as PrismaService;
  const audit = { record: jest.fn() } as unknown as AuditLogService;
  return { service: new FeatureToggleService(prisma, audit), findUnique, audit };
}

describe('FeatureToggleService.isEnabled', () => {
  it('returns false for an unknown toggle', async () => {
    const { service } = makeService(null);
    expect(await service.isEnabled('payments', 'u1')).toBe(false);
  });

  it('returns false when disabled regardless of rollout', async () => {
    const { service } = makeService({ key: 'payments', is_enabled: false, rollout_percentage: 100 });
    expect(await service.isEnabled('payments', 'u1')).toBe(false);
  });

  it('returns true when enabled at 100%', async () => {
    const { service } = makeService({ key: 'payments', is_enabled: true, rollout_percentage: 100 });
    expect(await service.isEnabled('payments', 'u1')).toBe(true);
  });

  it('partial rollout requires a subject and is deterministic', async () => {
    const subject = 'subject-7';
    const pct = rolloutBucket('payments', subject) + 1; // guarantees subject is inside
    const { service } = makeService({ key: 'payments', is_enabled: true, rollout_percentage: pct });
    expect(await service.isEnabled('payments', subject)).toBe(true);
    expect(await service.isEnabled('payments')).toBe(false); // no subject → only fully-on leaks
  });

  it('caches reads within the TTL (single DB hit)', async () => {
    const { service, findUnique } = makeService({
      key: 'payments',
      is_enabled: true,
      rollout_percentage: 100,
    });
    await service.isEnabled('payments', 'u1');
    await service.isEnabled('payments', 'u2');
    expect(findUnique).toHaveBeenCalledTimes(1);
  });
});

describe('FeatureToggleService.flip', () => {
  it('rejects non-admin actors', async () => {
    const { service } = makeService(null);
    const user: AuthPrincipal = { userId: 'u1', role: 'USER', principalType: 'HUMAN' };
    await expect(service.flip('payments', { isEnabled: true }, user)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('updates the toggle and writes an audit entry atomically', async () => {
    const before: ToggleRow = { key: 'payments', is_enabled: false, rollout_percentage: 0 };
    const after: ToggleRow = { key: 'payments', is_enabled: true, rollout_percentage: 0 };
    const tx = {
      feature_toggles: {
        findUnique: jest.fn().mockResolvedValue(before),
        upsert: jest.fn().mockResolvedValue(after),
      },
    };
    const record = jest.fn();
    const prisma = {
      $transaction: jest.fn((cb: (t: typeof tx) => unknown) => cb(tx)),
    } as unknown as PrismaService;
    const audit = { record } as unknown as AuditLogService;
    const service = new FeatureToggleService(prisma, audit);

    const result = await service.flip('payments', { isEnabled: true }, admin, {
      ipAddress: '10.0.0.1',
    });

    expect(result).toEqual({ isEnabled: true, rolloutPercentage: 0 });
    expect(tx.feature_toggles.upsert).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0][0] as { action: string; actorId: string; afterData: unknown };
    expect(entry.action).toBe('feature_toggle.flip');
    expect(entry.actorId).toBe('admin-1');
    expect(entry.afterData).toMatchObject({ key: 'payments', is_enabled: true });
    // audit must be written through the SAME transaction client
    expect(record.mock.calls[0][1]).toBe(tx);
  });
});
