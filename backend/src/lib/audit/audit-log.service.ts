import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../db/prisma.service';
import type { AuditEntry } from './audit.types';

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
  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.audit_log.create({
      data: {
        actor_id: entry.actorId ?? null,
        actor_role: entry.actorRole ?? null,
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
  }
}
