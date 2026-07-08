import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { AuditLogService } from '../audit/audit-log.service';
import { OutboxService } from '../outbox/outbox.service';
import { type EventMarket } from '../outbox/outbox.types';

/**
 * One overdue PENDING transfer, narrowed to what the expiry write + event need. `market` is read via
 * a Prisma nested relation select (ownership_transfers → animals → species.market), NOT a raw
 * cross-aggregate join — so this stays inside the ADR-0018 D8/D8b grep-gate (which forbids only raw
 * animals⋈species SQL outside the animal aggregate; a Prisma relation traversal is the sanctioned way).
 */
interface OverdueTransferRow {
  id: string;
  animal_id: string;
  from_user_id: string | null;
  from_organization_id: string | null;
  to_user_id: string | null;
  to_organization_id: string | null;
  market: EventMarket;
}

/**
 * Audit actor label for the system-initiated expiry (no human actor) — MUST match the lazy-on-read
 * path in TransferService.expireIfDue exactly, so a sweeper expiry and a lazy expiry write an
 * IDENTICAL audit row. 'system' is the documented non-canon sentinel role; paired with principalType
 * AGENT (ADR-0006/0011 — a non-human principal performed it).
 */
const SYSTEM_ACTOR_ROLE = 'system';
/** Cap the per-tick scan so one pass can never load an unbounded backlog into memory. */
const SCAN_BATCH = 500;

/**
 * P2-6 (AUDIT4) — worker-side ownership-transfer 72h-expiry sweeper. Behaviour half of the scheduler
 * pair (mirrors ModerationEscalationService / RetentionService: service = behaviour, job = scheduling),
 * depending only on worker-available primitives (PrismaService + AuditLogService + OutboxService).
 *
 * WHY it exists: the transfer expiry was previously *lazy-on-read only* (TransferService.expireIfDue),
 * so a PENDING transfer that nobody opens after 72h never transitioned and its `OwnershipTransfer.Expired`
 * notification was starved — the built notification path (mig 0030) never fired. This sweeper proactively
 * expires overdue transfers and emits the event in-tx so the consumer notifies both parties. The lazy path
 * STAYS as belt-and-braces (a read still self-heals immediately, ahead of the next tick).
 *
 * The per-item transition is a byte-for-byte parity copy of TransferService.expireIfDue's in-tx body
 * (status-guarded updateMany PENDING→CANCELLED(expired) + system/AGENT audit + Expired event). Kept in
 * lock-step deliberately (documented duplication, like RetentionService mirrors AdminUserService.eraseUser)
 * because that flow lives in the HTTP-coupled animal module and must not be pulled into the worker graph.
 * Idempotent under concurrent ticks: the `status='PENDING'` guard means only the first writer emits.
 */
@Injectable()
export class TransferExpiryService {
  private readonly logger = new Logger(TransferExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly outbox: OutboxService,
  ) {}

  /** Run one expiry pass. Returns the number of transfers expired (observability/tests). */
  async runOnce(): Promise<number> {
    const overdue = await this.findOverdue();
    let expired = 0;
    for (const row of overdue) {
      const did = await this.expireOne(row);
      if (did) expired += 1;
    }
    if (expired > 0) {
      this.logger.log(`Expired ${expired} overdue PENDING transfer(s) (OwnershipTransfer.Expired)`);
    }
    return expired;
  }

  /**
   * Overdue scan: PENDING transfers whose `expires_at` has passed. `market` comes from the animal's
   * species via a Prisma nested select (relation traversal — gate-safe, not a raw join). Bounded by
   * SCAN_BATCH so one tick can never materialise an unbounded set.
   */
  private async findOverdue(): Promise<OverdueTransferRow[]> {
    const rows = await this.prisma.ownership_transfers.findMany({
      where: { status: 'PENDING', expires_at: { not: null, lt: new Date() } },
      orderBy: { expires_at: 'asc' },
      take: SCAN_BATCH,
      select: {
        id: true,
        animal_id: true,
        from_user_id: true,
        from_organization_id: true,
        to_user_id: true,
        to_organization_id: true,
        animals: { select: { species: { select: { market: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      animal_id: r.animal_id,
      from_user_id: r.from_user_id,
      from_organization_id: r.from_organization_id,
      to_user_id: r.to_user_id,
      to_organization_id: r.to_organization_id,
      market: this.toMarket(r.animals?.species?.market),
    }));
  }

  /**
   * Expire one transfer (idempotent, single-winner). The `status='PENDING'` guard inside the same
   * transaction as the audit + outbox write makes a concurrent/duplicate tick a no-op: only the first
   * writer flips it (count===1) and emits; a racer (or the lazy-on-read path that beat this tick) sees
   * count 0 and skips — so exactly one Expired event per transfer. Returns whether this call emitted.
   */
  private async expireOne(row: OverdueTransferRow): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.ownership_transfers.updateMany({
        where: { id: row.id, status: 'PENDING' },
        data: { status: 'CANCELLED', failure_reason: 'expired', updated_at: new Date() },
      });
      if (claim.count !== 1) return false; // already terminal (raced / lazily expired) — idempotent skip

      await this.audit.record(
        {
          actorId: null,
          actorRole: SYSTEM_ACTOR_ROLE,
          actorPrincipalType: 'AGENT',
          action: 'animal.transfer_expired',
          entityType: 'ownership_transfer',
          entityId: row.id,
          afterData: { status: 'CANCELLED', terminalReason: 'expired' },
        },
        tx,
      );

      // Notify BOTH parties (system expiry has no "other party"); atomic with the state change.
      await this.outbox.publish(tx, {
        aggregateType: 'OwnershipTransfer',
        aggregateId: row.id,
        eventType: 'OwnershipTransfer.Expired',
        schemaVersion: 1,
        market: row.market,
        payload: {
          transferId: row.id,
          animalId: row.animal_id,
          fromUserId: row.from_user_id,
          fromOrganizationId: row.from_organization_id,
          toUserId: row.to_user_id,
          toOrganizationId: row.to_organization_id,
        },
      });
      return true;
    });
  }

  private toMarket(m: string | null | undefined): EventMarket {
    return m === 'pet' || m === 'livestock' ? m : null;
  }
}
