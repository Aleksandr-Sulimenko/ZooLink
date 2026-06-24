import { AuditLogService } from './audit-log.service';
import type { PrismaService } from '../db/prisma.service';
import type { AuditMetrics } from './audit.metrics';

describe('AuditLogService', () => {
  function make() {
    const create = jest.fn().mockResolvedValue(undefined);
    const prisma = { audit_log: { create } } as unknown as PrismaService;
    const record = jest.fn();
    const metrics = { record } as unknown as AuditMetrics;
    return { service: new AuditLogService(prisma, metrics), create, record };
  }

  it('defaults actor_principal_type to HUMAN and records the metric', async () => {
    const { service, create, record } = make();

    await service.record({ actorId: 'u1', action: 'feature_toggle.flip' });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actor_principal_type: 'HUMAN', action: 'feature_toggle.flip' }),
      }),
    );
    expect(record).toHaveBeenCalledWith('feature_toggle.flip', 'HUMAN');
  });

  it('snapshots an AGENT principal type when supplied', async () => {
    const { service, create, record } = make();

    await service.record({
      actorId: 'agent-1',
      actorPrincipalType: 'AGENT',
      action: 'listing.reject',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actor_principal_type: 'AGENT' }),
      }),
    );
    expect(record).toHaveBeenCalledWith('listing.reject', 'AGENT');
  });
});
