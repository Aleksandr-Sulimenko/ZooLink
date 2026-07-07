import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service';
import { ESCALATE_FACTOR, SLA_TARGET_SECONDS } from '../moderation/sla.const';
import { OutboxService } from '../outbox/outbox.service';

interface OverdueRow {
  id: string;
  market: string;
  waiting_seconds: number;
}

/**
 * Slice 4c (A) SLA-escalation behaviour, executed by ModerationEscalationJob under the advisory lock.
 * Mirrors RetentionService's split (service = behaviour, job = scheduling) and depends only on
 * worker-available primitives (PrismaService + OutboxService) so it can live in the worker without the
 * HTTP-coupled module graph.
 *
 * Per tick: scan PENDING_MODERATION items whose `escalated_at IS NULL` and whose `waitingSeconds`
 * exceeds the market threshold (the `ESCALATED` slaState boundary, M-13). For each, in ONE transaction,
 * publish a `Moderation.Escalated` outbox event AND set `escalated_at = now()` — so emission is exactly
 * once per item (SLA-1) and the item's lifecycle state is NEVER mutated (SLA-3 / M-13). The admin
 * fan-out is the outbox consumer's job (notification); this service is emit-only.
 */
@Injectable()
export class ModerationEscalationService {
  private readonly logger = new Logger(ModerationEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Run one escalation pass. Returns the number of items escalated (observability/tests). */
  async runOnce(): Promise<number> {
    const overdue = await this.findOverdue();
    let escalated = 0;
    for (const item of overdue) {
      const did = await this.escalateOne(item);
      if (did) escalated += 1;
    }
    if (escalated > 0) {
      this.logger.log(`Escalated ${escalated} overdue moderation item(s) (Moderation.Escalated)`);
    }
    return escalated;
  }

  /**
   * Overdue scan (SLA-1/SLA-5): PENDING_MODERATION, not yet escalated, and `waitingSeconds` past the
   * per-market threshold (escalate iff `> target`, the ESCALATED boundary). Parameterized raw SQL; the
   * threshold compares the queue clock (`moderation_enqueued_at`) against `now()` per market.
   * Uses idx_listings_escalation_scan (partial on the status + escalated_at IS NULL predicate).
   *
   * Market (ADR-0002 pet vs livestock) is read from the derived `listings.market` cache (D3, NOT NULL) —
   * NOT re-derived via a raw `animals ⋈ species` join. This is the ADR-0018 Part-2 (D8) de-coupling:
   * every market reader reads the cache, so the scan touches only `listings` (byte-parity, since D3 keeps
   * the cache == species.market). Enforced by scripts/check-no-raw-market-join.sh (now covers lib/scheduler).
   */
  private async findOverdue(): Promise<OverdueRow[]> {
    const petTarget = SLA_TARGET_SECONDS.pet * ESCALATE_FACTOR;
    const liveTarget = SLA_TARGET_SECONDS.livestock * ESCALATE_FACTOR;
    return this.prisma.$queryRaw<OverdueRow[]>`
      SELECT l.id,
             l.market AS market,
             FLOOR(EXTRACT(EPOCH FROM (now() - l.moderation_enqueued_at)))::int AS waiting_seconds
      FROM listings l
      WHERE l.status = 'PENDING_MODERATION'
        AND l.escalated_at IS NULL
        AND l.moderation_enqueued_at IS NOT NULL
        AND EXTRACT(EPOCH FROM (now() - l.moderation_enqueued_at)) >
            (CASE WHEN l.market = 'livestock' THEN ${liveTarget} ELSE ${petTarget} END)
      ORDER BY l.moderation_enqueued_at ASC`;
  }

  /**
   * Escalate one item (SLA-1 idempotent, SLA-3 no-mutation). The `escalated_at IS NULL` guard inside
   * the same transaction as the outbox write makes a concurrent/duplicate tick a no-op: only the first
   * writer flips escalated_at (count===1) and emits; a second tick (or a racing instance that slipped
   * past the advisory lock) sees count 0 and skips — exactly one outbox row per item. Returns whether
   * this call emitted.
   */
  private async escalateOne(item: OverdueRow): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claim = await tx.listings.updateMany({
        where: { id: item.id, escalated_at: null, status: 'PENDING_MODERATION' },
        data: { escalated_at: new Date() }, // NEVER touches status/moderation_status (SLA-3 / M-13)
      });
      if (claim.count !== 1) return false; // already escalated (or no longer pending) — idempotent skip
      await this.outbox.publish(tx, {
        aggregateType: 'Listing',
        aggregateId: item.id,
        eventType: 'Moderation.Escalated',
        schemaVersion: 1,
        market: item.market === 'livestock' ? 'livestock' : 'pet',
        payload: {
          entityId: item.id,
          waitingSeconds: item.waiting_seconds,
          slaState: 'ESCALATED',
        },
      });
      return true;
    });
  }
}
