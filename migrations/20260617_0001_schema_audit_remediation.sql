-- Migration: 20260617_0001_schema_audit_remediation
-- Purpose: bring an existing pre-audit baseline up to the corrected database_schema.sql.
-- Source: DATABASE_SCHEMA_AUDIT.md (2026-06-16). Idempotent where practical (IF [NOT] EXISTS guards).
-- Scope: executable-blocking fixes (P0), integrity fixes (P1), and the previously-missing
--        Payment / Moderation / Notification / Ownership-Transfer domains.

BEGIN;

-- ========== P0: make DDL executable ==========
-- Broken CHECK referencing non-existent column `breed_text` (XOR already enforced by chk_animals_breed_dep).
ALTER TABLE animals DROP CONSTRAINT IF EXISTS chk_animals_breed;

-- ========== P1: integrity / FK semantics ==========
-- breed deletion must not orphan animals into a state that violates chk_animals_breed_dep.
ALTER TABLE animals DROP CONSTRAINT IF EXISTS animals_breed_id_fkey;
ALTER TABLE animals
    ADD CONSTRAINT animals_breed_id_fkey FOREIGN KEY (breed_id) REFERENCES breeds(id) ON DELETE RESTRICT;

-- preserve ownership trail (regulatory/traceability).
ALTER TABLE animal_ownership_history DROP CONSTRAINT IF EXISTS animal_ownership_history_animal_id_fkey;
ALTER TABLE animal_ownership_history
    ADD CONSTRAINT animal_ownership_history_animal_id_fkey FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE RESTRICT;

-- prevent duplicate organization membership (M:N integrity).
ALTER TABLE organization_users DROP CONSTRAINT IF EXISTS uq_organization_user;
ALTER TABLE organization_users ADD CONSTRAINT uq_organization_user UNIQUE (organization_id, user_id);

-- ========== P1-9: Matching Domain breeding attributes on animals ==========
ALTER TABLE animals ADD COLUMN IF NOT EXISTS pedigree_id VARCHAR(100);
ALTER TABLE animals ADD COLUMN IF NOT EXISTS health_test_results JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS show_titles JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS is_visible_in_breeding_search BOOLEAN NOT NULL DEFAULT TRUE;
CREATE INDEX IF NOT EXISTS idx_animals_breeding_visible ON animals(is_visible_in_breeding_search) WHERE is_visible_in_breeding_search = true;

-- ========== P0-5 / P0-6: users & listings lifecycle + moderation status ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(25) NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (status IN ('UNVERIFIED','PENDING_VERIFICATION','VERIFIED','ACTIVE','SUSPENDED','DEACTIVATED'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{"email": true, "sms": true, "promo": false}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);

ALTER TABLE listings ALTER COLUMN price_cents TYPE BIGINT;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_MODERATION','ACTIVE','EXPIRED','SOLD','DEACTIVATED'));
ALTER TABLE listings ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED'));
ALTER TABLE listings ADD COLUMN IF NOT EXISTS published_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS sold_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS transaction_id UUID;
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_moderation_status ON listings(moderation_status);
-- At most one ACTIVE listing of a given type per animal
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_listing_per_type ON listings(animal_id, listing_type) WHERE status = 'ACTIVE';

-- ========== P0-4: geo lat/lng fallback (MVP primary), optional PostGIS ==========
ALTER TABLE listings ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;
ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_latlng;
ALTER TABLE listings ADD CONSTRAINT chk_listings_latlng CHECK (
    (lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS idx_listings_latlng ON listings(lat, lng) WHERE lat IS NOT NULL;
-- fix invalid partial index predicate (NOW() is not IMMUTABLE)
DROP INDEX IF EXISTS idx_listings_expires;
CREATE INDEX idx_listings_expires ON listings(expires_at) WHERE expires_at IS NOT NULL;

-- ========== P0-6: Moderation Domain ==========
CREATE TABLE IF NOT EXISTS moderation_reasons (
    code VARCHAR(50) PRIMARY KEY,
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    applies_to VARCHAR(20) NOT NULL DEFAULT 'ANY' CHECK (applies_to IN ('LISTING','ANIMAL','ANY')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS moderation_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('LISTING','ANIMAL')),
    entity_id UUID NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED','REJECTED','CHANGES_REQUESTED')),
    reason VARCHAR(50) REFERENCES moderation_reasons(code) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moddec_entity ON moderation_decisions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_moddec_moderator ON moderation_decisions(moderator_id, created_at);

CREATE OR REPLACE FUNCTION trg_block_modify_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; UPDATE/DELETE is not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_moderation_decisions_immutable ON moderation_decisions;
CREATE TRIGGER trg_moderation_decisions_immutable
BEFORE UPDATE OR DELETE ON moderation_decisions
FOR EACH ROW EXECUTE FUNCTION trg_block_modify_append_only();

-- ========== P0-7: Payment Domain ==========
CREATE TABLE IF NOT EXISTS payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    gateway_transaction_id VARCHAR(255),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','COMPLETED','FAILED','REFUNDED','DISPUTED')),
    purpose_type VARCHAR(40) NOT NULL,
    purpose_id UUID,
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_paytx_user ON payment_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_paytx_purpose ON payment_transactions(purpose_type, purpose_id);
CREATE INDEX IF NOT EXISTS idx_paytx_status ON payment_transactions(status);

CREATE TABLE IF NOT EXISTS refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_transaction_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
    gateway_refund_id VARCHAR(255),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','COMPLETED','FAILED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refunds_paytx ON refunds(payment_transaction_id);

-- listings.transaction_id -> payment_transactions(id)
ALTER TABLE listings DROP CONSTRAINT IF EXISTS fk_listings_transaction;
ALTER TABLE listings ADD CONSTRAINT fk_listings_transaction
    FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL;

-- ========== P0-8: Notification Domain ==========
CREATE TABLE IF NOT EXISTS notification_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('EMAIL','SMS')),
    subject_template TEXT,
    body_template TEXT NOT NULL,
    language CHAR(2) NOT NULL REFERENCES supported_languages(code) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (name, type, language)
);
CREATE TABLE IF NOT EXISTS notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('EMAIL','SMS')),
    template_id UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
    recipient VARCHAR(255) NOT NULL,
    content TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SENT' CHECK (status IN ('SENT','DELIVERED','FAILED','BOUNCED')),
    provider_response JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notiflog_user ON notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notiflog_status ON notification_logs(status);

-- ========== P1-5: Ownership Transfer process entity ==========
CREATE TABLE IF NOT EXISTS ownership_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    from_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    to_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','IN_PROGRESS','COMPLETED','FAILED')),
    from_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    to_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    payment_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    failure_reason TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_owntransfer_animal ON ownership_transfers(animal_id);
CREATE INDEX IF NOT EXISTS idx_owntransfer_status ON ownership_transfers(status);

-- ========== updated_at triggers for new tables ==========
DO $$
DECLARE tbl text;
BEGIN
    FOR tbl IN SELECT unnest(ARRAY['payment_transactions','refunds','notification_templates','notification_logs','ownership_transfers'])
    LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_'||tbl||'_updated_at') THEN
            EXECUTE format('CREATE TRIGGER update_%I_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();', tbl, tbl);
        END IF;
    END LOOP;
END $$;

-- ========== Feature toggle: payments gated off (Payment tables defined, inactive until post-MVP) ==========
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('payments', 'Внутриплатёжные платежи (продвижение, premium и т.п.) — таблицы Payment-домена определены, но выключены до пост-MVP', false, 0)
ON CONFLICT (key) DO NOTHING;

COMMIT;
