import { AdvisoryLockKeys, AdvisoryLockService } from './advisory-lock';
import type { PrismaService } from '../db/prisma.service';

describe('AdvisoryLockService', () => {
  function make(lockResult: boolean) {
    const calls: string[] = [];
    const prisma = {
      $queryRaw: jest.fn((strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        calls.push(sql);
        if (sql.includes('pg_try_advisory_lock')) {
          return Promise.resolve([{ locked: lockResult }]);
        }
        return Promise.resolve([]); // pg_advisory_unlock
      }),
    } as unknown as PrismaService;
    return { service: new AdvisoryLockService(prisma), calls, prisma };
  }

  it('runs work and unlocks when the lock is acquired', async () => {
    const { service, calls } = make(true);
    const work = jest.fn().mockResolvedValue(undefined);

    const ran = await service.runExclusive(AdvisoryLockKeys.RETENTION_EXPIRE_TICK, work);

    expect(ran).toBe(true);
    expect(work).toHaveBeenCalledTimes(1);
    expect(calls.some((s) => s.includes('pg_try_advisory_lock'))).toBe(true);
    expect(calls.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
  });

  it('skips work and does not unlock when the lock is not acquired', async () => {
    const { service, calls } = make(false);
    const work = jest.fn().mockResolvedValue(undefined);

    const ran = await service.runExclusive(AdvisoryLockKeys.RETENTION_EXPIRE_TICK, work);

    expect(ran).toBe(false);
    expect(work).not.toHaveBeenCalled();
    expect(calls.filter((s) => s.includes('pg_advisory_unlock'))).toHaveLength(0);
  });

  it('always unlocks even when the work throws', async () => {
    const { service, calls } = make(true);
    const work = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(
      service.runExclusive(AdvisoryLockKeys.RETENTION_EXPIRE_TICK, work),
    ).rejects.toThrow('boom');

    expect(calls.some((s) => s.includes('pg_advisory_unlock'))).toBe(true);
  });
});
