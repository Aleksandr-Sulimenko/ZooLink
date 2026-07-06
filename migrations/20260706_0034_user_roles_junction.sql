-- Migration 0034 — ADR-0022 (Multi-role user): `user_roles` junction, form-now / DORMANT.
--
-- ============================================================================
-- ЧТО:
--   §A  New table `user_roles(user_id, role, actor snapshot, created_at)` — the reserved
--       many-to-many seam letting one account hold multiple roles (owner + groomer + seller…).
--       role vocabulary = the 7-role canon (identical to users.role CHECK).
--       UNIQUE(user_id, role); FK user_id -> users(id) ON DELETE CASCADE; index on user_id;
--       actor_id + actor_principal_type snapshot (ADR-0006/0011 — a grant may be made by an AGENT).
--   §B  Idempotent backfill: seed one row per user from the current users.role, so the junction
--       is consistent with the authoritative primary role at form-time (ON CONFLICT DO NOTHING).
--
-- ПОЧЕМУ:
--   The ecosystem comfort BR (future-features §B) requires one account to be a pet owner AND a
--   groomer AND a goods seller AND a buyer without re-registration. users.role is single-valued
--   today (database_schema.sql:115). Once role-gated offering features (ADR-0014/0016) multiply,
--   retrofitting multi-role means back-filling a junction from a single column AND rewiring every
--   authz read at once — cheaper to reserve the junction now while it is dormant (ADR-0022 §5,
--   anti-rewrite). Backfilling from users.role makes the reservation truthful from row zero.
--
-- ПОЧЕМУ ТАК ЛУЧШЕ для проекта:
--   Additive + reversible + ZERO behaviour change: MVP authz keeps reading users.role unchanged
--   (ADR-0022 rule 2) — the junction is DORMANT, no authz code reads it, a row here grants nothing.
--   Role stays orthogonal to principal_type (ADR-0011) — an AGENT may hold operator roles — hence
--   the actor snapshot rather than a cross-column CHECK. Self-claim + revoke + authz-read semantics
--   are deliberately deferred to the first role-gated offering slice (ADR-0022 rule 5); MVP only
--   maintains the junction on the existing admin role-change path (sync-on-write, additive).
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS + named constraints + INSERT … ON CONFLICT DO NOTHING.
-- Validated on live PostgreSQL 14 (run TWICE — second run is a clean no-op) + negative tests
-- (invalid role rejected, duplicate (user,role) rejected, FK CASCADE on user delete, backfill
-- consistency, authz-parity: a junction row does NOT confer rights).
-- tables +1 → 37.
-- ============================================================================

-- ----- §A user_roles junction (dormant multi-role seam) ---------------------
CREATE TABLE IF NOT EXISTS user_roles (
    id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                 VARCHAR(20) NOT NULL,
    -- ADR-0006/0011: who granted this role (may be an AI agent). NULL actor = system/backfill grant.
    actor_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN',
    created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Named constraints (drift-gate: avoid auto-generated names that diverge schema↔migration).
    CONSTRAINT chk_user_roles_role CHECK (role IN ('USER', 'MODERATOR', 'ADMIN', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER')),
    CONSTRAINT chk_user_roles_actor_ptype CHECK (actor_principal_type IN ('HUMAN', 'AGENT')),
    CONSTRAINT uq_user_roles_user_role UNIQUE (user_id, role)
);

COMMENT ON TABLE user_roles IS
  'ADR-0022: multi-role junction (one account, many roles). DORMANT in MVP — users.role stays the primary/authoritative authz source (rule 2); no authz code reads this table. A row grants nothing until the first role-gated offering slice (rule 5).';
COMMENT ON COLUMN user_roles.role IS
  'ADR-0022: an additional role held by the user (7-role canon, same vocabulary as users.role). The primary/default-active role remains users.role.';
COMMENT ON COLUMN user_roles.actor_principal_type IS
  'ADR-0006/0011: principal_type (HUMAN|AGENT) of whoever granted the role, snapshot at grant time. DEFAULT HUMAN = MVP truth.';

CREATE INDEX IF NOT EXISTS idx_user_roles_user ON user_roles(user_id);

-- ----- §B backfill: mirror the current primary role into the junction -------
-- One row per existing user from users.role, so the dormant junction is consistent with the
-- authoritative primary role from row zero. Idempotent via the UNIQUE(user_id, role) key.
INSERT INTO user_roles (user_id, role, actor_id, actor_principal_type)
SELECT id, role, NULL, 'HUMAN'
FROM users
ON CONFLICT ON CONSTRAINT uq_user_roles_user_role DO NOTHING;
