-- ============================================================================================
-- Migration 0023 — Animal Slice 2: MVP ownership transfer (ADR-0013)
--
-- WHAT: Reshape ownership_transfers + animal_ownership_history for the simplified direct-transfer
--       MVP flow, and relax the owner-lock trigger to a controlled GUC path.
-- WHY:  ADR-0013 ratifies ownership transfer as in-MVP (apex BR GAP-TRACE-007). The existing table
--       was shaped for the heavy verified flow and lacked org-transfer columns, the actor snapshot,
--       completed_at, transfer_reason, the CANCELLED state, and the single-active-PENDING guard.
--       The owner-lock trigger physically blocked the apex requirement.
-- WHY-BETTER: Reuses the existing tables + their Phase-2 columns (no throwaway), adds only what MVP
--       needs, makes the exactly-one-of-user/org and single-active-PENDING invariants DB-enforced,
--       and relaxes the safety invariant by the smallest possible amount (one transaction-local GUC
--       branch — leak-proof outside the transfer txn). Consistent with ADR-0011 (actor snapshot)
--       and ADR-0007 (integrity in triggers, orchestration in the service).
--
-- Idempotent (safe to run twice): all DDL uses IF [NOT] EXISTS / DROP-then-ADD / CREATE OR REPLACE.
-- ============================================================================================

BEGIN;

-- ── ownership_transfers: status CHECK widen (+CANCELLED) ─────────────────────────────────────
-- CANCELLED = decline / cancel-by-initiator / expiry (separates "parties stopped" from the
-- Phase-2 "a verification gate FAILED"). IN_PROGRESS/FAILED stay reserved for the gated flow.
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS ownership_transfers_status_check;
ALTER TABLE ownership_transfers ADD CONSTRAINT ownership_transfers_status_check
    CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'));

-- ── ownership_transfers: org-transfer columns (transfer to/from a user OR an organization) ────
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS from_organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS to_organization_id   UUID REFERENCES organizations(id) ON DELETE RESTRICT;

-- ── ownership_transfers: exactly-one-of(user, org) on BOTH sides (mirrors chk_animal_ownership) ─
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS chk_owntransfer_from_party;
ALTER TABLE ownership_transfers ADD  CONSTRAINT chk_owntransfer_from_party CHECK (
    (from_user_id IS NOT NULL AND from_organization_id IS NULL) OR
    (from_user_id IS NULL AND from_organization_id IS NOT NULL)
);
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS chk_owntransfer_to_party;
ALTER TABLE ownership_transfers ADD  CONSTRAINT chk_owntransfer_to_party CHECK (
    (to_user_id IS NOT NULL AND to_organization_id IS NULL) OR
    (to_user_id IS NULL AND to_organization_id IS NOT NULL)
);

-- ── ownership_transfers: finalize timestamp + actor-type snapshots + free-text reason ─────────
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS transfer_reason TEXT;
-- ADR-0011 §1/§6 principal-type snapshot for each act (who-kind, not who). DEFAULT 'HUMAN' = MVP truth.
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS initiated_by_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN';
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS responded_by_principal_type VARCHAR(10);
-- WHICH user performed each act. from_user_id is the from-PARTY (NULL for org-from), so it cannot
-- serve as the initiator actor for an org-initiated transfer — record the acting user explicitly so
-- the contract's required `initiatedBy.actorId` is always satisfiable (ADR-0011 §6 actor identity).
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS initiated_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ownership_transfers ADD COLUMN IF NOT EXISTS responded_by_user_id UUID REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS chk_owntransfer_initiated_ptype;
ALTER TABLE ownership_transfers ADD  CONSTRAINT chk_owntransfer_initiated_ptype
    CHECK (initiated_by_principal_type IN ('HUMAN', 'AGENT'));
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS chk_owntransfer_responded_ptype;
ALTER TABLE ownership_transfers ADD  CONSTRAINT chk_owntransfer_responded_ptype
    CHECK (responded_by_principal_type IS NULL OR responded_by_principal_type IN ('HUMAN', 'AGENT'));

-- ── ownership_transfers: single active PENDING per animal (INV-4) ─────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_owntransfer_one_pending
    ON ownership_transfers(animal_id) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_owntransfer_from_org ON ownership_transfers(from_organization_id) WHERE from_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owntransfer_to_org   ON ownership_transfers(to_organization_id)   WHERE to_organization_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_owntransfer_to_user  ON ownership_transfers(to_user_id)           WHERE to_user_id IS NOT NULL;

COMMENT ON COLUMN ownership_transfers.completed_at IS 'Когда передача финализирована в COMPLETED (отлично от updated_at).';
COMMENT ON COLUMN ownership_transfers.transfer_reason IS 'Свободный текст-причина инициатора; копируется в animal_ownership_history.transfer_reason при завершении.';
COMMENT ON COLUMN ownership_transfers.initiated_by_principal_type IS 'ADR-0011 снимок типа принципала инициатора (HUMAN|AGENT).';

-- ── animal_ownership_history: OQ-1 org-owned intervals (owner_id nullable + organization_id) ──
ALTER TABLE animal_ownership_history ALTER COLUMN owner_id DROP NOT NULL;
ALTER TABLE animal_ownership_history ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE animal_ownership_history DROP CONSTRAINT IF EXISTS chk_aoh_owner_party;
ALTER TABLE animal_ownership_history ADD  CONSTRAINT chk_aoh_owner_party CHECK (
    (owner_id IS NOT NULL AND organization_id IS NULL) OR
    (owner_id IS NULL AND organization_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_aoh_org ON animal_ownership_history(organization_id) WHERE organization_id IS NOT NULL;

-- ── Owner-lock trigger: "block all" → "controlled transfer path only" (ADR-0013 §2, Option A) ─
-- The owner_id/organization_id change branch now raises UNLESS the transfer service has set the
-- transaction-local GUC app.ownership_transfer='on' in the same txn. Immutable species/sex/DoB/breed
-- checks are UNCHANGED. CREATE OR REPLACE makes this the single canonical body (the duplicate def
-- in database_schema.sql is removed in the same change so the file defines this function exactly once).
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
        IF OLD.breed_id IS NOT NULL AND OLD.breed_id IS DISTINCT FROM NEW.breed_id THEN
            RAISE EXCEPTION 'breed_id cannot be changed after creation (only custom->directory normalization is allowed).';
        END IF;
        -- Controlled owner/org change: allowed ONLY through the ownership-transfer workflow, which
        -- sets app.ownership_transfer='on' (SET LOCAL / set_config(...,true)) in the same transaction.
        IF (OLD.owner_id IS DISTINCT FROM NEW.owner_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)
           AND current_setting('app.ownership_transfer', true) IS DISTINCT FROM 'on' THEN
            RAISE EXCEPTION 'Changing ownership is only allowed through the ownership-transfer workflow.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Gate form: ownership_transfer_verification toggle (default off; backend reads it, MVP ships off) ─
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('ownership_transfer_verification',
        'Phase-2 verified transfer flow (IN_PROGRESS/payment/vet/legal/two-sided ack). Off in MVP (ADR-0013 §1).',
        FALSE, 0)
ON CONFLICT (key) DO NOTHING;

COMMIT;
