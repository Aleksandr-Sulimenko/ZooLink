-- Migration 0016 — ADR-0011 (Agent-Principal Actor Model): A0a schema-form + role_in_org hygiene (A1).
--
-- ============================================================================
-- ЧТО:
--   §A audit_log            : + actor_principal_type (VARCHAR(10) NOT NULL DEFAULT 'HUMAN', CHECK HUMAN|AGENT).
--   §B moderation_decisions : + actor_principal_type (same), + actor_role (VARCHAR(20) nullable snapshot, no enum CHECK),
--                             + supersedes_decision_id (UUID FK -> moderation_decisions ON DELETE RESTRICT),
--                             + is_human_override (BOOLEAN NOT NULL DEFAULT FALSE),
--                             + biconditional CHECK chk_moddec_override, + partial index idx_moddec_supersedes.
--   §D role_in_org          : confirm 4-value named constraint chk_org_user_role (no MODERATOR). The inline-CHECK and
--                             COMMENT fixes are source-file edits in database_schema.sql (no runtime change — the named
--                             constraint already runs after the inline one and is the effective canon).
--
-- ПОЧЕМУ:
--   audit_log/moderation_decisions are APPEND-ONLY (immutability triggers). A missing actor attribute on an immutable
--   row can never be backfilled truthfully — once a single AGENT acts, all prior un-attributed rows are ambiguous.
--   The ledger must record actor state AS OF THE ACTION (snapshot), not joined-now from mutable users.principal_type/role.
--   human-override must preserve the agent's original decision: a new append-only row links back via supersedes_decision_id
--   instead of mutating/erasing the original (ADR-0006 immutable-audit + reversible-agent-action, both true together).
--
-- ПОЧЕМУ ТАК ЛУЧШЕ для проекта:
--   Satisfies ADR-0006 "immutable audit" + "avoid painful retrofits" + ФЗ-152 reconstructability at the latest cheap
--   moment; costs snapshot columns now vs a permanent hole in history later. DEFAULT 'HUMAN' => zero MVP behaviour change
--   (no agent active). principal_type stays orthogonal to role (no brittle cross-column CHECK — ADR-0011 §7 invariant).
--   role_in_org canon (4 values) removes a live self-contradiction before Admin authz is built on top of it.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / DROP CONSTRAINT IF EXISTS then ADD / CREATE INDEX IF NOT EXISTS.
-- Validated on live PostgreSQL 14/16 (run twice — second run is a clean no-op) + negative tests (ADR-0011 §E).
-- Append-only trigger is UNCHANGED and now automatically protects the new columns (it blocks any UPDATE/DELETE).
-- ============================================================================

-- ----- §A audit_log: actor principal_type snapshot --------------------------
ALTER TABLE audit_log
    ADD COLUMN IF NOT EXISTS actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN'
        CHECK (actor_principal_type IN ('HUMAN', 'AGENT'));

COMMENT ON COLUMN audit_log.actor_principal_type IS
  'ADR-0011 §1: principal_type (HUMAN|AGENT) snapshot at write time; append-only, never updated. DEFAULT HUMAN = MVP truth.';

-- ----- §B moderation_decisions: actor snapshot + human-override form --------
ALTER TABLE moderation_decisions
    ADD COLUMN IF NOT EXISTS actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN'
        CHECK (actor_principal_type IN ('HUMAN', 'AGENT'));

ALTER TABLE moderation_decisions
    ADD COLUMN IF NOT EXISTS actor_role VARCHAR(20); -- nullable snapshot; NO enum CHECK (role enum may evolve — ADR-0011 §2)

ALTER TABLE moderation_decisions
    ADD COLUMN IF NOT EXISTS supersedes_decision_id UUID REFERENCES moderation_decisions(id) ON DELETE RESTRICT;

ALTER TABLE moderation_decisions
    ADD COLUMN IF NOT EXISTS is_human_override BOOLEAN NOT NULL DEFAULT FALSE;

-- ADR-0011 §3 biconditional invariant: override TRUE <=> supersedes set; FALSE <=> supersedes NULL.
ALTER TABLE moderation_decisions DROP CONSTRAINT IF EXISTS chk_moddec_override;
ALTER TABLE moderation_decisions ADD  CONSTRAINT chk_moddec_override CHECK (
    (is_human_override = TRUE  AND supersedes_decision_id IS NOT NULL) OR
    (is_human_override = FALSE AND supersedes_decision_id IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_moddec_supersedes
    ON moderation_decisions(supersedes_decision_id) WHERE supersedes_decision_id IS NOT NULL;

COMMENT ON COLUMN moderation_decisions.actor_principal_type IS
  'ADR-0011 §1: principal_type (HUMAN|AGENT) snapshot at write time; append-only. DEFAULT HUMAN = MVP truth.';
COMMENT ON COLUMN moderation_decisions.actor_role IS
  'ADR-0011 §2: role the actor held when deciding (free snapshot, no enum CHECK; users.role is mutable).';
COMMENT ON COLUMN moderation_decisions.supersedes_decision_id IS
  'ADR-0011 §3: human-override points to the superseded decision on the same (entity_type, entity_id). Set <=> is_human_override.';
COMMENT ON COLUMN moderation_decisions.is_human_override IS
  'ADR-0011 §3: TRUE only on a human-override row (actor_principal_type MUST be HUMAN — enforced in service layer).';

-- ----- §D role_in_org canon hygiene (4 values, no MODERATOR) -----------------
-- Confirm the named constraint = the 4-value canon. Idempotent (drop-if-exists + add).
-- (The inline CREATE TABLE CHECK and COMMENT in database_schema.sql were edited to match — source-file fix, no runtime delta.)
ALTER TABLE organization_users DROP CONSTRAINT IF EXISTS chk_org_user_role;
ALTER TABLE organization_users ADD  CONSTRAINT chk_org_user_role
    CHECK (role_in_org IN ('OWNER', 'ADMIN', 'STAFF', 'VET'));
