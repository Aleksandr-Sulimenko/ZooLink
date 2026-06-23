-- Migration: 20260624_0021_listing_type_leasing
-- Phase B3 (ADMIN_PHASE_ACTION_PLAN.md, GAP-TRACE-005) — add 'leasing' to listings.listing_type.
--
-- WHAT
--   Extend the listings.listing_type CHECK with 'leasing' (now: sale, breeding, show, adoption,
--   stud_service, leasing). FORM only — leasing-specific behaviour/rules are gated to Фаза 2.
--
-- WHY
--   livestock-marketplace BR §6 describes LEASING as a working listing type, but the enum had no such
--   value — the type was unrealizable ("phantom"). Adding an enum value later = a CHECK swap + possible
--   data migration; the value itself is the irreversible form (rewrite-test, §5). Form-now / behaviour-later.
--
-- WHY BETTER (whole-project)
--   - Honest contract: a leasing listing can be represented now; behaviour (lease terms/pricing rules)
--     ships in Фаза 2 without a schema change.
--   - Constraint named explicitly (listings_listing_type_check) so future swaps are deterministic.
--   - listings triggers (approval-gate, deactivation cascade) do not hardcode the type set — unaffected.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS then ADD. Safe to run twice.

BEGIN;

ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_listing_type_check;
ALTER TABLE listings ADD  CONSTRAINT listings_listing_type_check
    CHECK (listing_type IN ('sale', 'breeding', 'show', 'adoption', 'stud_service', 'leasing'));

COMMIT;
