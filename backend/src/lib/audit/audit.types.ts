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
  /** Stable verb, e.g. `feature_toggle.flip`, `listing.approve`. */
  action: string;
  /** Logical entity name (not necessarily a table), e.g. `feature_toggle`, `listing`. */
  entityType?: string | null;
  /** UUID of the affected entity when it has one (audit_log.entity_id is UUID/nullable). */
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}
