-- ============================================================================================
-- Migration 0025 — cascade deactivation also clears is_active (fix-wave 1.1)
--
-- WHAT: redefine cascade_animal_deactivation() / cascade_user_deactivation() so the AFTER-UPDATE
--       cascade to live listings sets is_active = false alongside status = 'DEACTIVATED'.
-- WHY:  AUDIT_2026-06-30 (reviewer-qa) found both triggers set status only, leaving is_active=true
--       on a cascade-DEACTIVATED listing — drift from the app-level paths (listing.service.ts:293/393)
--       that always pair is_active=false with DEACTIVATED. No visibility leak (reads gate on
--       status='ACTIVE'), but the flag is misleading and would break any future is_active filter.
-- WHY-BETTER: is_active is documented (data-model.md §"derived from status") as DERIVED from the
--       lifecycle status; making the cascade honor that keeps trigger-path and app-path bit-identical,
--       so the derived flag is trustworthy everywhere (one less invariant to reason about).
--
-- Idempotent (safe to run twice): CREATE OR REPLACE FUNCTION is declarative; no DDL state to clash.
-- ============================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION cascade_animal_deactivation() RETURNS trigger AS $$
BEGIN
    IF NEW.deactivated_at IS NOT NULL AND OLD.deactivated_at IS NULL THEN
        UPDATE listings SET status = 'DEACTIVATED', is_active = false, updated_at = now()
         WHERE animal_id = NEW.id AND status NOT IN ('DEACTIVATED', 'SOLD', 'EXPIRED');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cascade_user_deactivation() RETURNS trigger AS $$
BEGIN
    IF NEW.deactivated_at IS NOT NULL AND OLD.deactivated_at IS NULL THEN
        UPDATE listings SET status = 'DEACTIVATED', is_active = false, updated_at = now()
         WHERE seller_id = NEW.id AND status NOT IN ('DEACTIVATED', 'SOLD', 'EXPIRED');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMIT;
