import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { AuditMetrics } from './audit.metrics';
import type { AuditEntry, AuditLogQuery, AuditLogRow, AuditQueryResult } from './audit.types';
import type { PrincipalType } from '../auth/principal';

/** Map an arbitrary value to a Prisma JSON input, distinguishing "absent" from SQL NULL. */
function jsonInput(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value;
}

/**
 * Append-only audit trail for privileged actions (config flips, moderation, admin ops).
 * Inserts only — the DB enforces immutability via the `trg_audit_log_append_only` trigger.
 * Pass a transaction client to record atomically with the action being audited.
 */
@Injectable()
export class AuditLogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: AuditMetrics,
  ) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    // Snapshot the principal type as-of-the-action (ADR-0011 §1); DB defaults 'HUMAN' if omitted.
    const principalType: PrincipalType = entry.actorPrincipalType ?? 'HUMAN';
    await db.audit_log.create({
      data: {
        actor_id: entry.actorId ?? null,
        actor_role: entry.actorRole ?? null,
        actor_principal_type: principalType,
        action: entry.action,
        entity_type: entry.entityType ?? null,
        entity_id: entry.entityId ?? null,
        entity_id_int: entry.entityIdInt ?? null,
        before_data: jsonInput(entry.beforeData),
        after_data: jsonInput(entry.afterData),
        ip_address: entry.ipAddress ?? null,
        user_agent: entry.userAgent ?? null,
      },
    });
    // B8 observability: human-vs-agent action split (no PII in labels — only principal type + verb).
    this.metrics.record(entry.action, principalType);
  }

  /**
   * Read/query the append-only ledger for the admin audit viewer (admin-api.yaml getAuditLog,
   * Admin Slice 2). Parameterized SQL only (Prisma.sql fragments — ESLint-guarded, no interpolation).
   * Returns the raw rows + total; the controller/service maps each to the AuditLogEntry wire shape.
   *
   * `entityType=reference-data` matches BOTH the bare value and the suffixed form
   * `reference-data:{dataset}`; `feature-toggle` maps to the stored `feature_toggle`. A
   * `entityTypeExact` narrows to one concrete stored entity_type (e.g. `reference-data:species`).
   * Date bounds are inclusive calendar days: startDate ≥ 00:00:00 of the day, endDate < next midnight.
   */
  async query(q: AuditLogQuery): Promise<AuditQueryResult> {
    const conditions: Prisma.Sql[] = [];

    if (q.entityTypeExact !== undefined) {
      conditions.push(Prisma.sql`entity_type = ${q.entityTypeExact}`);
    } else if (q.entityType === 'reference-data') {
      // Reference-data writes the suffixed form `reference-data:{dataset}`; also accept the bare value.
      conditions.push(
        Prisma.sql`(entity_type = 'reference-data' OR entity_type LIKE 'reference-data:%')`,
      );
    } else if (q.entityType === 'feature-toggle') {
      // FeatureToggleService stores the underscore form; the contract uses the hyphen form.
      conditions.push(Prisma.sql`entity_type = 'feature_toggle'`);
    } else if (q.entityType !== undefined) {
      conditions.push(Prisma.sql`entity_type = ${q.entityType}`);
    }
    if (q.entityId !== undefined) {
      conditions.push(Prisma.sql`entity_id = ${q.entityId}::uuid`);
    }
    if (q.entityIdInt !== undefined) {
      conditions.push(Prisma.sql`entity_id_int = ${q.entityIdInt}`);
    }
    if (q.actorId !== undefined) {
      conditions.push(Prisma.sql`actor_id = ${q.actorId}::uuid`);
    }
    if (q.action !== undefined) {
      // Reconciled vocabulary: exact-equality on the stored {domain}.{verb} verb (no LIKE remap).
      conditions.push(Prisma.sql`action = ${q.action}`);
    }
    if (q.startDate !== undefined) {
      conditions.push(Prisma.sql`created_at >= ${q.startDate}::date`);
    }
    if (q.endDate !== undefined) {
      // inclusive end-of-day: strictly before the following midnight.
      conditions.push(Prisma.sql`created_at < (${q.endDate}::date + INTERVAL '1 day')`);
    }

    const whereSql = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const orderSql = q.sortDir === 'asc'
      ? Prisma.sql`ORDER BY created_at ASC, id ASC`
      : Prisma.sql`ORDER BY created_at DESC, id DESC`;

    const [rows, countRows] = await Promise.all([
      this.prisma.$queryRaw<AuditLogRow[]>`
        SELECT id, entity_type, entity_id, entity_id_int, action,
               actor_id, actor_role, actor_principal_type,
               after_data, ip_address::text AS ip_address, user_agent, created_at
        FROM audit_log
        ${whereSql}
        ${orderSql}
        LIMIT ${q.limit} OFFSET ${q.offset}`,
      this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(*)::bigint AS count FROM audit_log ${whereSql}`,
    ]);

    return { rows, total: Number(countRows[0]?.count ?? 0n) };
  }
}
