import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import { AuditMetrics } from './audit.metrics';
import type { AuditEntry } from './audit.types';
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
}
