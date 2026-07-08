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
  /** Slice 4c (A) SLA-escalation tick (Moderation.Escalated emission). Distinct from retention. */
  MODERATION_ESCALATION_TICK: 4202n,
  /** Slice H3 (P2-6) ownership-transfer 72h-expiry sweep (OwnershipTransfer.Expired emission). */
  TRANSFER_EXPIRY_TICK: 4203n,
} as const;

export type AdvisoryLockKey = (typeof AdvisoryLockKeys)[keyof typeof AdvisoryLockKeys];

/**
 * Upper bound on how long a single tick may hold the lock transaction open. A scheduled pass is
 * normally sub-second; this ceiling only guards against a pathologically slow pass wedging the
 * connection. It MUST exceed the worst-case tick duration (the whole `work()` runs inside the lock
 * transaction) — set generously since ticks are infrequent (cron-driven).
 */
const LOCK_TX_TIMEOUT_MS = 120_000;
/** How long to wait for a free pool connection to start the lock transaction before giving up. */
const LOCK_TX_MAX_WAIT_MS = 10_000;

/**
 * Single-instance coordination for scheduled jobs across a future scaled-out worker fleet.
 *
 * Why advisory locks (not a row lock / Redis lock): when the worker scales to N instances
 * (ADR-0009 keeps a monolith now, but the scheduler form must be forward-compatible), every
 * instance fires the same cron tick. A Postgres advisory lock lets exactly one instance win the
 * tick; `pg_try_advisory_xact_lock` is non-blocking — losers simply skip rather than queue.
 *
 * P2-2 fix (AUDIT4 devops): the lock is now **transaction-scoped** (`pg_try_advisory_xact_lock`)
 * acquired inside a single Prisma interactive transaction that wraps the whole `work()`. The prior
 * design took a *session-level* lock with three SEPARATE `$queryRaw` calls (acquire → work → unlock);
 * Prisma's connection pool routes each call to an ARBITRARY backend, so the unlock could land on a
 * different connection (a no-op) while the lock stayed held on the acquiring connection until that
 * pool member was recycled — at worker scale the tick could wedge (false "held by another instance"
 * skips) and the lock count drift. A transaction-scoped lock is bound to the one connection that runs
 * the transaction and is **auto-released when that transaction ends** (commit, rollback, OR the
 * session dying on crash) — there is no manual unlock and therefore no cross-connection hazard.
 *
 * Pool-size assumption: `work()` may open its OWN short Prisma transactions on OTHER pool connections
 * while this lock transaction is held idle-in-transaction. That needs the effective Prisma connection
 * limit to be > 1 (the default is `num_cpus*2 + 1` ≥ 3), so the outer lock connection and the inner
 * work connections never starve each other. Do not drive the pool to 1 in the worker.
 */
@Injectable()
export class AdvisoryLockService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Run `work` iff this instance acquires the transaction-scoped advisory lock for `key`; otherwise
   * no-op. Acquire + `work()` run inside ONE interactive transaction on a single connection, so the
   * lock is guaranteed to release at transaction end (no manual unlock, no cross-connection wedge).
   * Returns whether this instance held the lock and ran the work.
   */
  async runExclusive(key: AdvisoryLockKey, work: () => Promise<void>): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${key}) AS locked`;
        if (rows[0]?.locked !== true) return false; // another instance holds it — skip this tick
        await work();
        return true; // lock auto-released when this transaction commits
      },
      { timeout: LOCK_TX_TIMEOUT_MS, maxWait: LOCK_TX_MAX_WAIT_MS },
    );
  }
}
