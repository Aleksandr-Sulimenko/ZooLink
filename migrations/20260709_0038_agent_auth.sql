-- Migration 0038 — agent-auth (ADR-0036 credential issuance + ADR-0037 scoped-ability).
--
-- ============================================================================
-- ЧТО:
--   §A  Extend `service_credentials` (migration 0017 form) with accountability/operability columns
--       (ADR-0036 §7, all additive/nullable/idempotent):
--         · issued_by UUID FK users ON DELETE RESTRICT — the accountable human issuer-of-record
--           (ADR-0006 #5), on the row itself (not only via an audit_log join).
--         · last_used_at TIMESTAMPTZ — best-effort stale-credential detection (never on the hot path).
--         · expires_at TIMESTAMPTZ — optional time-boxing; NULL = no expiry (verify checks it, §3).
--         · capability_profile_id INT FK agent_capability_profiles ON DELETE RESTRICT — the named
--           least-privilege scope the exchange embeds in the AGENT JWT (ADR-0037 §2, owner Option B).
--           NULL = deny-by-default (no abilities).
--   §B  New table `agent_capability_profiles` — a named, reusable {action,subject} least-privilege
--       ability set (ADR-0037 §2 owner decision 2026-07-09: named profiles from the start). Scope
--       vocabulary is the RBAC {action,subject} set MINUS `manage`/`all` (a service-layer validator
--       rejects them — wildcard authority is structurally impossible for an AGENT, AUDIT4 P1-6).
--   §C  Seed `feature_toggles.agent_service_auth` = OFF (master gate, ADR-0036 §6 — same shape as
--       payments / goods_marketplace / ownership_transfer_verification).
--   §D  Seed the reference `moderation-agent` profile (ADR-0037 §3) — the READY moderation scope.
--
-- ПОЧЕМУ:
--   ADR-0011 §5 shipped the `service_credentials` FORM but inert: no endpoint issues a credential and
--   `AgentServiceTokenAuthenticator` returns null for every request — the single structural blocker to
--   the North-Star (ADR-0006, operator roles performed by AI agents). ADR-0036 supplies the issuance +
--   exchange; ADR-0037 supplies the scope. This migration lays the additive schema both need.
--
-- ПОЧЕМУ ТАК ЛУЧШЕ для проекта:
--   Additive + reversible + ZERO MVP behaviour change (master gate OFF, no agent provisioned, no secret
--   issued). Mirrors the proven form-now/behaviour-gated pattern (payments toggle, migration 0034 dormant
--   junction). N-1 rolling-deploy safe: every new column is additive/nullable so an old pod that ignores
--   them still INSERTs fine (heeds AUDIT4 P1-5). Named constraints avoid schema↔migration drift (0026 lesson).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS + named constraints + INSERT …
-- ON CONFLICT DO NOTHING + DROP TRIGGER IF EXISTS. Validated on live PostgreSQL (run TWICE — second run
-- is a clean no-op) + negative tests (scope-vocabulary/FK RESTRICT/unique-code invariants).
-- tables +1 → 38.
-- ============================================================================

BEGIN;

-- ----- §B agent_capability_profiles (must precede the §A FK that references it) ---------------
CREATE TABLE IF NOT EXISTS agent_capability_profiles (
    id          SERIAL PRIMARY KEY,
    code        VARCHAR(50) NOT NULL,
    -- The {action, subject} grant list, e.g.
    --   [{"action":"read","subject":"ModerationQueue"}, {"action":"create","subject":"ModerationDecision"}].
    -- NEVER "manage"/"all" — the service-layer validator rejects those so wildcard authority is
    -- structurally impossible for an AGENT (ADR-0037 §2, AUDIT4 P1-6).
    scope       JSONB NOT NULL,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- Named constraint (drift-gate: avoid auto-generated names that diverge schema↔migration).
    CONSTRAINT uq_agent_capability_profiles_code UNIQUE (code)
);

COMMENT ON TABLE agent_capability_profiles IS
  'ADR-0037 §2 (owner Option B, 2026-07-09): named, reusable least-privilege {action,subject} ability set referenced by service_credentials.capability_profile_id and resolved into the AGENT JWT scope claim at exchange. DORMANT in MVP (no agent provisioned; master gate off). Scope never contains manage/all (validator-enforced).';
COMMENT ON COLUMN agent_capability_profiles.scope IS
  'ADR-0037: [{ "action": "read|create|update|delete", "subject": "<Subject>" }] — the effective AGENT ability = matrix(role) ∩ this scope, deny-by-default. NEVER "manage"/"all".';

-- updated_at trigger (update_updated_at_column() defined at the top of database_schema.sql; naming
-- matches the update_<tbl>_updated_at convention / migration 0013). Idempotent (DROP IF EXISTS).
DROP TRIGGER IF EXISTS update_agent_capability_profiles_updated_at ON agent_capability_profiles;
CREATE TRIGGER update_agent_capability_profiles_updated_at BEFORE UPDATE ON agent_capability_profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----- §A service_credentials accountability/operability + scope-profile FK --------------------
ALTER TABLE service_credentials
    ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE service_credentials
    ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE service_credentials
    ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE service_credentials
    ADD COLUMN IF NOT EXISTS capability_profile_id INT
        REFERENCES agent_capability_profiles(id) ON DELETE RESTRICT;

COMMENT ON COLUMN service_credentials.issued_by IS
  'ADR-0036 §7: the accountable human ADMIN who issued this credential (issuer-of-record on the row, ADR-0006 #5). ON DELETE RESTRICT — an issuer with live credentials cannot be hard-deleted.';
COMMENT ON COLUMN service_credentials.last_used_at IS
  'ADR-0036 §7: last successful token-exchange time (best-effort, never on the hot path). Detects stale/unused credentials.';
COMMENT ON COLUMN service_credentials.expires_at IS
  'ADR-0036 §7: optional auto-expiry. NULL = no expiry; verify rejects when now() > expires_at (§3). ~90-day max default fixed with security/devops at activation.';
COMMENT ON COLUMN service_credentials.capability_profile_id IS
  'ADR-0037 §2: the named least-privilege scope profile this credential resolves to at exchange. NULL / inactive profile / empty scope = deny-by-default (JWT carries no scope → no abilities).';

-- ----- §C master gate: agent_service_auth (OFF in MVP) -----------------------------------------
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('agent_service_auth',
        'Гейт агент-сервис-авторизации (ADR-0036): обмен человеко-выданного секрета service_credentials на короткоживущий AGENT JWT на POST /v1/auth/agent/token. Форма заведена, поведение отложено — в MVP ВЫКЛЮЧЕНО (ни один агент не выдан, ни один секрет не проверяется).',
        FALSE, 0)
ON CONFLICT (key) DO NOTHING;

-- ----- §D reference scope profile: moderation-agent (ADR-0037 §3) ------------------------------
-- The READY moderation scope: an AGENT-MODERATOR holding it may moderate and NOTHING else (narrower
-- than the human MODERATOR role ceiling — least-privilege demonstrated). Never touches manage/all.
INSERT INTO agent_capability_profiles (code, scope, is_active)
VALUES ('moderation-agent',
        '[{"action":"read","subject":"ModerationQueue"},{"action":"create","subject":"ModerationDecision"},{"action":"read","subject":"Listing"},{"action":"read","subject":"ContentReport"}]'::jsonb,
        TRUE)
ON CONFLICT ON CONSTRAINT uq_agent_capability_profiles_code DO NOTHING;

COMMIT;
