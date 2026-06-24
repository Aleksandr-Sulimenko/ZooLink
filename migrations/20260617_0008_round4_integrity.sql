-- Migration: 20260617_0008_round4_integrity
-- Purpose: close schema-enforceable P0/P1 from deep audit round 4 (org, identity, animal pedigree, governance).
-- Idempotent.

BEGIN;

-- ===================== Organization / B2B =====================
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status VARCHAR(25) NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verified_at  TIMESTAMP WITH TIME ZONE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMP WITH TIME ZONE;
DROP INDEX IF EXISTS idx_organizations_inn;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_inn ON organizations(inn) WHERE inn IS NOT NULL;
-- exactly-one headquarters per organization
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_one_hq ON branches(organization_id) WHERE is_headquarters;
-- membership invite flow + canonical org-internal roles + single primary org
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING_INVITE', 'ACTIVE', 'REVOKED', 'EXPIRED'));
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS invitation_token      VARCHAR(100);
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS invited_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_users DROP CONSTRAINT IF EXISTS chk_org_user_role;
ALTER TABLE organization_users ADD  CONSTRAINT chk_org_user_role CHECK (role_in_org IN ('OWNER', 'ADMIN', 'STAFF', 'VET'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_user_primary ON organization_users(user_id) WHERE is_primary;

-- ===================== Identity =====================
-- phone_hash MUST be a deterministic keyed hash (HMAC-SHA256 + server pepper), NOT bcrypt, so it can be unique/looked-up.
DROP INDEX IF EXISTS idx_users_phone_hash;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_hash    ON users(phone_hash)      WHERE phone_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_google  ON users(oauth_google_id) WHERE oauth_google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_apple   ON users(oauth_apple_id)  WHERE oauth_apple_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_telegram ON users(oauth_telegram_id) WHERE oauth_telegram_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_vk      ON users(oauth_vk_id)     WHERE oauth_vk_id IS NOT NULL;
COMMENT ON COLUMN users.phone_hash IS 'Deterministic HMAC-SHA256(phone, server_pepper) for unique lookup — NOT bcrypt (per-row salt would defeat uniqueness).';

-- Refresh-token / session model (rotation + reuse-detection + revoke-all + session listing)
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,
    family_id    UUID NOT NULL,                -- rotation chain; reuse of a rotated token revokes the whole family
    device_label VARCHAR(120),
    issued_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    rotated_from UUID,
    revoked_at   TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- ===================== Animal: pedigree integrity + breed normalization + org-ownership lock =====================
-- Replace the immutability trigger: allow breed_id NULL->value (custom->directory normalization, one-way),
-- and also lock organization_id during MVP (close the org->org rehome bypass).
CREATE OR REPLACE FUNCTION trg_animals_immutable_and_owner()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.species_id IS DISTINCT FROM NEW.species_id THEN
            RAISE EXCEPTION 'species_id cannot be changed after creation.';
        END IF;
        IF OLD.sex IS DISTINCT FROM NEW.sex THEN
            RAISE EXCEPTION 'sex cannot be changed after creation.';
        END IF;
        IF OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth THEN
            RAISE EXCEPTION 'date_of_birth cannot be changed after creation.';
        END IF;
        -- breed_id immutable EXCEPT one-way normalization NULL(custom) -> directory id
        IF OLD.breed_id IS NOT NULL AND OLD.breed_id IS DISTINCT FROM NEW.breed_id THEN
            RAISE EXCEPTION 'breed_id cannot be changed after creation (only custom->directory normalization is allowed).';
        END IF;
        -- MVP ownership lock (both individual and organizational ownership)
        IF OLD.owner_id IS DISTINCT FROM NEW.owner_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
            RAISE EXCEPTION 'Changing ownership is not allowed during MVP phase.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION enforce_pedigree_integrity()
RETURNS TRIGGER AS $$
DECLARE v_sex text; v_species int; v_dob date; has_cycle boolean;
BEGIN
    IF NEW.mother_id = NEW.id OR NEW.father_id = NEW.id THEN
        RAISE EXCEPTION 'An animal cannot be its own parent.';
    END IF;
    IF NEW.mother_id IS NOT NULL THEN
        SELECT sex, species_id, date_of_birth INTO v_sex, v_species, v_dob FROM animals WHERE id = NEW.mother_id;
        IF v_sex IS DISTINCT FROM 'Female' THEN RAISE EXCEPTION 'mother_id must reference a Female animal.'; END IF;
        IF v_species IS DISTINCT FROM NEW.species_id THEN RAISE EXCEPTION 'mother must be the same species as the offspring.'; END IF;
        IF v_dob IS NOT NULL AND NEW.date_of_birth IS NOT NULL AND v_dob >= NEW.date_of_birth THEN
            RAISE EXCEPTION 'mother must be born before the offspring.'; END IF;
    END IF;
    IF NEW.father_id IS NOT NULL THEN
        SELECT sex, species_id, date_of_birth INTO v_sex, v_species, v_dob FROM animals WHERE id = NEW.father_id;
        IF v_sex IS DISTINCT FROM 'Male' THEN RAISE EXCEPTION 'father_id must reference a Male animal.'; END IF;
        IF v_species IS DISTINCT FROM NEW.species_id THEN RAISE EXCEPTION 'father must be the same species as the offspring.'; END IF;
        IF v_dob IS NOT NULL AND NEW.date_of_birth IS NOT NULL AND v_dob >= NEW.date_of_birth THEN
            RAISE EXCEPTION 'father must be born before the offspring.'; END IF;
    END IF;
    -- cycle: is NEW.id an ancestor of either declared parent? (bounded depth guards against pre-existing bad data)
    IF NEW.mother_id IS NOT NULL OR NEW.father_id IS NOT NULL THEN
        WITH RECURSIVE anc(id, depth) AS (
            SELECT id, 1 FROM animals WHERE id IN (NEW.mother_id, NEW.father_id)
            UNION ALL
            SELECT p.pid, anc.depth + 1
            FROM anc
            JOIN animals a ON a.id = anc.id
            CROSS JOIN LATERAL (VALUES (a.mother_id), (a.father_id)) AS p(pid)
            WHERE p.pid IS NOT NULL AND anc.depth < 64
        )
        SELECT EXISTS (SELECT 1 FROM anc WHERE id = NEW.id) INTO has_cycle;
        IF has_cycle THEN RAISE EXCEPTION 'Pedigree cycle detected (animal would be its own ancestor).'; END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_enforce_pedigree_integrity ON animals;
CREATE TRIGGER trg_enforce_pedigree_integrity
    BEFORE INSERT OR UPDATE OF mother_id, father_id ON animals
    FOR EACH ROW EXECUTE FUNCTION enforce_pedigree_integrity();

-- ===================== Governance: audit log + reference-data lifecycle =====================
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role  VARCHAR(20),
    action      VARCHAR(100) NOT NULL,         -- e.g. 'role.changed', 'toggle.flipped', 'refdata.updated', 'user.erased'
    entity_type VARCHAR(40),
    entity_id   UUID,
    before_data JSONB,
    after_data  JSONB,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log(actor_id, created_at);
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log;
CREATE TRIGGER trg_audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

-- reference data: soft-deactivate + provenance
ALTER TABLE species ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE breeds  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE cities  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE feature_toggles ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

COMMIT;
