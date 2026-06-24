import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';

/**
 * Stable, hand-assigned advisory-lock keys (bigint). One per periodic job. Keep them unique and
 * documented here so two different jobs never collide on the same key. Postgres session-level
 * advisory locks live in a single global namespace per `pg_try_advisory_lock(bigint)`.
 *
 * NOTE: these are arbitrary but fixed integers — never derive them from a hash at runtime (that
 * would make collisions silent). Add a new constant when you add a new locked job.
 */
export const AdvisoryLockKeys = {
  /** B7 scheduler skeleton tick (retention/expire placeholder — behaviour is D2). */
  RETENTION_EXPIRE_TICK: 4201n,
} as const;

export type AdvisoryLockKey = (typeof AdvisoryLockKeys)[keyof typeof AdvisoryLockKeys];

/**
 * Single-instance coordination for scheduled jobs across a future scaled-out worker fleet.
 *
 * Why advisory locks (not a row lock / Redis lock): when the worker scales to N instances
 * (ADR-0009 keeps a monolith now, but the scheduler form must be forward-compatible), every
 * instance fires the same cron tick. A Postgres *session-level* advisory lock lets exactly one
 * instance win the tick; the lock is auto-released if that instance crashes (the session dies),
 * so there is no stuck lock to clean up. `pg_try_advisory_lock` is non-blocking — losers simply
 * skip the tick rather than queueing behind the winner.
 */
@Injectable()
export class AdvisoryLockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `work` iff this instance acquires the session advisory lock for `key`; otherwise no-op.
   * The lock is always released in `finally` (even if `work` throws), so the next tick is free.
   * Returns whether this instance held the lock and ran the work.
   */
  async runExclusive(key: AdvisoryLockKey, work: () => Promise<void>): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_lock(${key}) AS locked`;
    const acquired = rows[0]?.locked === true;
    if (!acquired) return false;

    try {
      await work();
      return true;
    } finally {
      await this.prisma.$queryRaw`SELECT pg_advisory_unlock(${key})`;
    }
  }
}
