import { TransferExpiryService } from './transfer-expiry.service';
import type { PrismaService } from '../db/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';
import type { OutboxService } from '../outbox/outbox.service';

/** A findMany row shape (Prisma nested select: animals.species.market). */
const overdueRow = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  animal_id: 'a1',
  from_user_id: 'u-from',
  from_organization_id: null,
  to_user_id: 'u-to',
  to_organization_id: null,
  animals: { species: { market: 'pet' } },
  ...over,
});

function make(opts: { overdue?: Record<string, unknown>[]; claimCount?: number } = {}) {
  const findMany = jest.fn().mockResolvedValue(opts.overdue ?? []);
  const updateMany = jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 });
  const tx = { ownership_transfers: { updateMany } };
  const prisma = {
    ownership_transfers: { findMany },
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const publish = jest.fn().mockResolvedValue(undefined);
  const outbox = { publish } as unknown as OutboxService;
  const service = new TransferExpiryService(prisma, audit, outbox);
  return { service, findMany, updateMany, record, publish };
}

describe('TransferExpiryService', () => {
  it('expires an overdue PENDING transfer and emits OwnershipTransfer.Expired exactly once', async () => {
    const { service, updateMany, record, publish } = make({ overdue: [overdueRow()] });

    const n = await service.runOnce();

    expect(n).toBe(1);
    // Status-guarded single-winner claim.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 't1', status: 'PENDING' },
      data: { status: 'CANCELLED', failure_reason: 'expired', updated_at: expect.any(Date) },
    });
    // System/AGENT audit row — parity with TransferService.expireIfDue (lazy path).
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      actorId: null,
      actorRole: 'system',
      actorPrincipalType: 'AGENT',
      action: 'animal.transfer_expired',
      entityType: 'ownership_transfer',
      entityId: 't1',
    });
    // Exactly one Expired event, both parties in the payload, market stamped.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][1]).toMatchObject({
      aggregateType: 'OwnershipTransfer',
      eventType: 'OwnershipTransfer.Expired',
      schemaVersion: 1,
      market: 'pet',
      payload: {
        transferId: 't1',
        animalId: 'a1',
        fromUserId: 'u-from',
        toUserId: 'u-to',
      },
    });
  });

  it('does nothing when there are no overdue transfers (non-overdue untouched)', async () => {
    const { service, updateMany, record, publish } = make({ overdue: [] });

    const n = await service.runOnce();

    expect(n).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('is idempotent under a concurrent tick: a lost claim (count 0) neither audits nor emits', async () => {
    // The row was already expired by a racer / the lazy-on-read path between scan and write.
    const { service, record, publish } = make({ overdue: [overdueRow()], claimCount: 0 });

    const n = await service.runOnce();

    expect(n).toBe(0);
    expect(record).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('coerces an unknown species market to null (market-agnostic event, never a bad enum)', async () => {
    const { service, publish } = make({
      overdue: [overdueRow({ animals: { species: { market: 'bogus' } } })],
    });

    await service.runOnce();

    expect(publish.mock.calls[0][1]).toMatchObject({ market: null });
  });
});
