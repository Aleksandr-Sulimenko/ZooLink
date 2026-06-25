import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import type { AuditLogQuery, AuditLogRow } from '../../lib/audit/audit.types';
import {
  type AuditLogEntry,
  type ListAuditLogQueryDto,
} from './dto/audit-log.dto';

const REF_PREFIX = 'reference-data:';

/**
 * Normalise the stored `audit_log.entity_type` to the bare contract `entityType` (admin-api.yaml):
 * `reference-data:{dataset}` → `reference-data`; `feature_toggle` (underscore, the FeatureToggleService
 * write form) → `feature-toggle` (the contract hyphen form). All other values pass through verbatim.
 */
function toEntityType(entityType: string | null): string {
  if (entityType === null) return '';
  if (entityType.startsWith(REF_PREFIX)) return 'reference-data';
  if (entityType === 'feature_toggle') return 'feature-toggle';
  return entityType;
}

/** Parse the `{dataset}` suffix out of a stored `reference-data:{dataset}` entity_type; null otherwise. */
function toReferenceDataset(entityType: string | null): string | null {
  if (entityType !== null && entityType.startsWith(REF_PREFIX)) {
    return entityType.slice(REF_PREFIX.length) || null;
  }
  return null;
}

/**
 * Admin audit-log viewer (admin-api.yaml getAuditLog, Admin Slice 2). Reads the append-only ledger
 * via AuditLogService.query (parameterized SQL) and maps each row to the AuditLogEntry wire shape with
 * the {actorId, principalType} agent-badge (ADR-0011 §6 / ADR-0006). The audit verb (`actionType`) is
 * returned **verbatim** ({domain}.{verb}) — the reconciled vocabulary contract treats it as an open
 * namespaced string, never collapsed to a coarse category. Enforces the entityId XOR entityIdInt mutual
 * exclusion (both → 400 VALIDATION_ERROR, mirrors the schema's one-key-per-row rule).
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
  ) {}

  async list(query: ListAuditLogQueryDto): Promise<Paginated<AuditLogEntry>> {
    if (query.entityId !== undefined && query.entityIdInt !== undefined) {
      throw new BadRequestException({
        message: 'entityId and entityIdInt are mutually exclusive',
        code: 'VALIDATION_ERROR',
      });
    }
    if (query.endDate !== undefined && query.startDate !== undefined && query.endDate < query.startDate) {
      throw new BadRequestException({
        message: 'endDate must not be before startDate',
        code: 'VALIDATION_ERROR',
      });
    }

    const sortDir = query.sort.trim().toLowerCase().endsWith(':asc') ? 'asc' : 'desc';
    // referenceDataset narrows to the stored suffixed form; it takes precedence over the bare
    // entityType=reference-data match (a single concrete entity_type equality).
    const entityTypeExact = query.referenceDataset
      ? `${REF_PREFIX}${query.referenceDataset}`
      : undefined;
    const dbQuery: AuditLogQuery = {
      entityType: entityTypeExact ? undefined : query.entityType,
      entityTypeExact,
      entityId: query.entityId,
      entityIdInt: query.entityIdInt,
      actorId: query.actorId,
      // Reconciled vocabulary: exact-equality match on the stored verb (no LIKE remap).
      action: query.actionType,
      startDate: query.startDate,
      endDate: query.endDate,
      sortDir,
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    };

    const { rows, total } = await this.audit.query(dbQuery);
    const names = await this.resolveActorNames(rows);
    const items = rows.map((r) => this.toEntry(r, names));
    return paginate(items, total, query.page, query.limit);
  }

  /** Batch-resolve actor display names (single query, no N+1). Erased users keep their tombstone name. */
  private async resolveActorNames(rows: AuditLogRow[]): Promise<Map<string, string>> {
    const ids = [...new Set(rows.map((r) => r.actor_id).filter((id): id is string => id !== null))];
    if (ids.length === 0) return new Map();
    const users = await this.prisma.users.findMany({
      where: { id: { in: ids } },
      select: { id: true, full_name: true },
    });
    return new Map(users.map((u) => [u.id, u.full_name]));
  }

  private toEntry(row: AuditLogRow, names: Map<string, string>): AuditLogEntry {
    const details = row.after_data == null ? null : JSON.stringify(row.after_data);
    return {
      id: row.id,
      entityType: toEntityType(row.entity_type),
      referenceDataset: toReferenceDataset(row.entity_type),
      entityId: row.entity_id, // exactly one of entityId/entityIdInt is populated per row
      entityIdInt: row.entity_id_int,
      actionType: row.action, // verbatim — reconciled vocabulary preserves the {domain}.{verb} namespace
      actor: {
        actorId: row.actor_id,
        principalType: row.actor_principal_type,
        actorDisplayName: row.actor_id ? (names.get(row.actor_id) ?? null) : null,
      },
      details: details && details.length > 1000 ? `${details.slice(0, 997)}...` : details,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    };
  }
}
