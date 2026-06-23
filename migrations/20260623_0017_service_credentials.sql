-- Migration 0017 — ADR-0011 §5.3 (Agent-Principal Actor Model): A0b agent service-credential store.
--
-- ============================================================================
-- ЧТО:
--   + table service_credentials — rotatable/revocable, hashed-secret store keyed to an AGENT principal
--     (agent_user_id FK users(id) ON DELETE RESTRICT). Columns: id, agent_user_id, label, secret_hash,
--     is_active, created_at, revoked_at, rotated_from (self-FK = rotation chain). + partial index on
--     live credentials per agent. FORM ONLY — not populated in MVP (AGENT gate off).
--
-- ПОЧЕМУ:
--   ADR-0011 §5 lays the agent service-auth FORM now so activating it later (ADR-0006 phased autonomy
--   P-A…P-D) needs NO schema/contract/authz rewrite — exactly the phasing rule (cost-of-change). Agent
--   credentials must live in-monolith (ADR-0009: no separate auth service) and be rotatable + revocable
--   + hashed-never-plaintext (ADR-0006 least-privilege scoped-credentials non-negotiable). The table
--   encodes those non-negotiables in its shape: secret_hash only, is_active/revoked_at for revoke,
--   rotated_from for rotation (issue-new + revoke-old).
--
-- ПОЧЕМУ ТАК ЛУЧШЕ для проекта:
--   The authz subject is already agent-agnostic (cross-check C4) — the only real gap is WHERE agent
--   credentials live; laying the store now (one table) vs a schema rewrite at P-A is the cheap moment.
--   ON DELETE RESTRICT mirrors agent-lifecycle = deactivate-not-delete (ADR-0011 §4) so credentials
--   cannot orphan. Zero MVP behaviour change: the gate is off, no row is created, no secret is verified;
--   the AgentServiceTokenAuthenticator stub is NOT in the chain and always returns null.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / COMMENT (re-runnable no-op).
-- Validated on live PostgreSQL 14/16 (run twice — second run is a clean no-op) + negative tests:
--   (1) plaintext-only is impossible — secret_hash is NOT NULL (insert without it is rejected);
--   (2) agent FK integrity — agent_user_id referencing a non-existent users.id is rejected;
--   (3) ON DELETE RESTRICT — deleting a users row that has a credential is rejected (no orphan).
-- ============================================================================

CREATE TABLE IF NOT EXISTS service_credentials (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    label         VARCHAR(120),
    secret_hash   VARCHAR(255) NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    revoked_at    TIMESTAMP WITH TIME ZONE,
    rotated_from  UUID REFERENCES service_credentials(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_service_credentials_agent_active
    ON service_credentials(agent_user_id) WHERE is_active = TRUE;

COMMENT ON TABLE service_credentials IS
  'ADR-0011 §5.3: rotatable/revocable hashed-secret store for AGENT-principal service-auth. FORM ONLY in MVP (gate off; not populated). In-monolith, never plaintext.';
COMMENT ON COLUMN service_credentials.agent_user_id IS
  'AGENT principal (users.id) this credential authenticates. ON DELETE RESTRICT (ADR-0011 §4: agents are deactivated, not deleted).';
COMMENT ON COLUMN service_credentials.secret_hash IS
  'Hashed secret ONLY — plaintext is never stored at rest (ADR-0011 §C non-negotiable).';
COMMENT ON COLUMN service_credentials.rotated_from IS
  'Rotation chain: a freshly issued credential links to the one it supersedes (issue-new + revoke-old).';
