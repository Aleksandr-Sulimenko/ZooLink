import { AdvisoryLockKeys, AdvisoryLockService } from './advisory-lock';
import type { PrismaService } from '../db/prisma.service';

/**
 * P2-2 (AUDIT4): the lock is transaction-scoped. `runExclusive` opens ONE interactive
 * `$transaction`, acquires `pg_try_advisory_xact_lock` on that transaction's connection, runs the
 * work inside it, and returns — the lock auto-releases at transaction end (no manual unlock, so no
 * cross-connection hazard). The mock below drives the real `$transaction` callback with a `tx` whose
 * `$queryRaw` records the SQL so we can assert the xact-scoped primitive is used on the SAME handle.
 */
describe('AdvisoryLockService', () => {
  function make(lockResult: boolean) {
    const calls: string[] = [];
    const tx = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        calls.push(sql);
        if (sql.includes('pg_try_advisory_xact_lock')) {
          return Promise.resolve([{ locked: lockResult }]);
        }
        return Promise.resolve([]);
      }),
    };
    // Faithfully run the interactive-transaction callback with our tx handle.
    const transaction = jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx));
    const prisma = { $transaction: transaction } as unknown as PrismaService;
    return { service: new AdvisoryLockService(prisma), calls, transaction, tx };
  }

  it('runs work inside the lock transaction when the xact-lock is acquired', async () => {
    const { service, calls } = make(true);
    const work = jest.fn().mockResolvedValue(undefined);

    const ran = await service.runExclusive(AdvisoryLockKeys.RETENTION_EXPIRE_TICK, work);

    expect(ran).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    // Transaction-scoped primitive on the tx connection; NO session-level unlock (auto-released).
    expect(calls.some((s) => s.includes('pg_try_advisory_xact_lock'))).toBe(true);
    expect(calls.some((s) => s.includes('pg_advisory_unlock'))).toBe(false);
  });

  it('skips work when the lock is held by another instance', async () => {
    const { service, calls } = make(false);
    const work = jest.fn().mockResolvedValue(undefined);

    const ran = await service.runExclusive(AdvisoryLockKeys.MODERATION_ESCALATION_TICK, work);

    expect(ran).toBe(false);
    expect(work).not.toHaveBeenCalled();
    // Only the acquire attempt ran; nothing else on the connection.
    expect(calls).toHaveLength(1);
  });

  it('acquires and runs the work on the SAME connection (single interactive transaction)', async () => {
    const { service, transaction, calls } = make(true);
    let acquiredBeforeWork = false;
    const work = jest.fn(() => {
      // The acquire must already have run on the tx handle by the time work executes.
      acquiredBeforeWork = calls.length === 1 && calls[0].includes('pg_try_advisory_xact_lock');
      return Promise.resolve();
    });

    await service.runExclusive(AdvisoryLockKeys.TRANSFER_EXPIRY_TICK, work);

    expect(transaction).toHaveBeenCalledTimes(1); // exactly one tx wraps acquire+work
    expect(acquiredBeforeWork).toBe(true);
  });

  it('propagates a work() error (the transaction rolls back and releases the lock)', async () => {
    const { service } = make(true);
    const work = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      service.runExclusive(AdvisoryLockKeys.RETENTION_EXPIRE_TICK, work),
    ).rejects.toThrow('boom');
  });
});
