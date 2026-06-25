import type { PrincipalType } from '../auth/principal';

/**
 * One privileged action to append to `audit_log`. The actor is identified by `actorId`
 * + `actorRole`; per ADR-0006 (agent-as-principal) the actor may be an AI-agent user, so
 * callers must always pass the *real* acting principal — never substitute a system id for
 * an agent decision.
 */
export interface AuditEntry {
  /** users.id of the acting principal (HUMAN or AGENT), or null for an anonymous/system action. */
  actorId: string | null;
  actorRole?: string | null;
  /**
   * Principal-type snapshot at write time (ADR-0011 §1, B8 observability). 'HUMAN' | 'AGENT'.
   * Defaults to 'HUMAN' at the DB level when omitted (MVP truth); pass the *real* acting principal
   * type so an AI-agent action is attributable. Never join users.principal_type after the fact —
   * this is an as-of-the-action snapshot on the append-only ledger.
   */
  actorPrincipalType?: PrincipalType | null;
  /** Stable verb, e.g. `feature_toggle.flip`, `listing.approve`. */
  action: string;
  /** Logical entity name (not necessarily a table), e.g. `feature_toggle`, `listing`. */
  entityType?: string | null;
  /** UUID of the affected entity when it has one (audit_log.entity_id is UUID/nullable). */
  entityId?: string | null;
  /**
   * Integer id of the affected entity for INT-keyed lookup entities (species/breeds/cities),
   * which cannot use the UUID entity_id (audit_log.entity_id_int, migration 0018). Set exactly
   * one of entityId / entityIdInt per row.
   */
  entityIdInt?: number | null;
  beforeData?: unknown;
  afterData?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Filters for the admin audit-log read path (AuditLogService.query). All filters are optional; the
 * caller is responsible for the mutual-exclusion check (entityId XOR entityIdInt). `action` is an
 * exact-equality match on the stored verb (reconciled vocabulary — no LIKE remap). Pagination is
 * offset-based.
 */
export interface AuditLogQuery {
  /** Bare entity-type match: `reference-data` matches every `reference-data:%`; `feature-toggle` → `feature_toggle`. */
  entityType?: string;
  /** Exact entity_type equality (e.g. `reference-data:species` when a referenceDataset is given). Takes precedence. */
  entityTypeExact?: string;
  entityId?: string;
  entityIdInt?: number;
  actorId?: string;
  /** Exact match against the stored `audit_log.action` verb (e.g. `identity.role_changed`). */
  action?: string;
  /** Inclusive lower bound (YYYY-MM-DD). */
  startDate?: string;
  /** Inclusive upper bound (YYYY-MM-DD); matched as < next-midnight. */
  endDate?: string;
  sortDir?: 'asc' | 'desc';
  limit: number;
  offset: number;
}

/** A raw audit_log row as the read query returns it (snake_case columns). */
export interface AuditLogRow {
  id: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_id_int: number | null;
  action: string;
  actor_id: string | null;
  actor_role: string | null;
  actor_principal_type: PrincipalType;
  after_data: unknown;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
}

export interface AuditQueryResult {
  rows: AuditLogRow[];
  total: number;
}
