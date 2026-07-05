-- Migration: 20260705_0032_offering_ref_seam
-- Wave D / D2 — OfferingRef form-now seam (ADR-0014 §Amendment 2026-07-04 rule 11; ECOSYSTEM_ADR_PLAN §Wave D).
--
-- WHAT
--   Lay the polymorphic offering reference `(offering_type, offering_id)` onto the two tables that
--   accumulate un-retrofittable rows now — `favorites` and `saved_searches` — so future species-less
--   offerings (services, goods) need NO rewrite of these tables or their public contract:
--     * both tables gain `offering_type VARCHAR NOT NULL DEFAULT 'ANIMAL_LISTING'` with the
--       (deliberately additive) `CHECK (offering_type IN ('ANIMAL_LISTING'))` — a later migration widens
--       the CHECK vocabulary when a subtype ships; behaviour today is listing-only.
--     * `favorites.offering_id UUID` — the truthful polymorphic pointer; backfilled from the existing
--       `listing_id` and made NOT NULL (every favorite points at exactly one offering). NO FK: the
--       target is polymorphic across subtype tables (anti-god-table, ADR-0014), so referential integrity
--       for the ANIMAL_LISTING case rides the existing `listing_id` FK (offering_id == listing_id today).
--     * `saved_searches.offering_id UUID` NULLABLE — a saved search is a QUERY, not a reference to one
--       offering, so offering_id stays NULL; `offering_type` is the discriminator that lets a future
--       "saved search over services" be distinguished from one over animal listings.
--   Composite index `idx_favorites_offering (offering_type, offering_id)` for the future
--   "who favorited this offering" lookup. No such index on saved_searches (offering_id is always NULL
--   there — a partial/composite index over a constant discriminator + NULL adds no selectivity).
--   NO table added or removed (36 tables unchanged). Behaviour is IDENTICAL to today (ANIMAL_LISTING only).
--
-- WHY
--   ADR-0014 rule 11 (form-now, irreversible-if-deferred): a favorites row or contract committed against a
--   listing-only `listingId` (favorites-api.yaml:58) CANNOT be retrofitted truthfully once real rows and a
--   public v1 contract exist — it becomes a breaking v1 change. This seam MUST precede the favorites
--   controller (D11). saved_searches is included for the same reason (its rows accumulate now and its
--   contract ships now). Everything born WITH a future subtype (service_offerings, read-model, polymorphic
--   moderation queue, monetization_type, market_scope) is correctly DEFERRED — not pulled into MVP here.
--
-- WHY-BETTER-for-the-whole-project
--   - The polymorphic (type,id) pair is the anti-EAV / anti-god-table shape ADR-0014 mandates: no single
--     FK, subtype tables built only when their side ships. This migration adds the reference, not the
--     subtypes — the cheapest possible forward-compatible seam.
--   - `favorites.offering_id NOT NULL` turns "every favorite carries a truthful polymorphic pointer" into a
--     DB guarantee (negative test below), so the D11 controller physically cannot write a half-formed row.
--   - `saved_searches.offering_id` stays NULLABLE because a search spans many offerings; forcing a value
--     would be a lie. The discriminator (`offering_type`) is what future discovery needs, and it is present.
--   - The extensible CHECK (single value now) keeps the door open additively: widening `IN (...)` is a
--     forward-only DDL change, never a data rewrite.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + DROP-then-ADD named CHECKs/index inside DO blocks; the backfill
-- is `WHERE offering_id IS NULL` (no-op on re-run); `SET NOT NULL` is a no-op once already NOT NULL. Safe
-- to run twice (proven on live PG — двойной прогон).
-- Negative tests (invariants):
--   (1) INSERT/UPDATE favorites|saved_searches with offering_type = 'SERVICE' is rejected by the
--       chk_*_offering_type CHECK (23514) — only 'ANIMAL_LISTING' is admissible today.
--   (2) favorites.offering_type / saved_searches.offering_type are NOT NULL DEFAULT 'ANIMAL_LISTING' —
--       a row inserted without them lands 'ANIMAL_LISTING', never NULL.
--   (3) favorites.offering_id is NOT NULL — an INSERT omitting it is rejected (23502).
--   (4) saved_searches.offering_id is NULLABLE — an INSERT omitting it succeeds with NULL.

-- ── favorites ────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS offering_type VARCHAR(30) NOT NULL DEFAULT 'ANIMAL_LISTING';
ALTER TABLE favorites ADD COLUMN IF NOT EXISTS offering_id UUID;

-- Backfill the polymorphic pointer from the current listing reference (no-op once populated).
UPDATE favorites SET offering_id = listing_id WHERE offering_id IS NULL;

DO $$
BEGIN
  ALTER TABLE favorites ALTER COLUMN offering_id SET NOT NULL;

  ALTER TABLE favorites DROP CONSTRAINT IF EXISTS chk_favorites_offering_type;
  ALTER TABLE favorites ADD  CONSTRAINT chk_favorites_offering_type CHECK (offering_type IN ('ANIMAL_LISTING'));
END $$;

CREATE INDEX IF NOT EXISTS idx_favorites_offering ON favorites(offering_type, offering_id);

-- ── saved_searches ───────────────────────────────────────────────────────────────────────────────────
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS offering_type VARCHAR(30) NOT NULL DEFAULT 'ANIMAL_LISTING';
ALTER TABLE saved_searches ADD COLUMN IF NOT EXISTS offering_id UUID; -- NULLABLE: a search is not one offering

DO $$
BEGIN
  ALTER TABLE saved_searches DROP CONSTRAINT IF EXISTS chk_saved_searches_offering_type;
  ALTER TABLE saved_searches ADD  CONSTRAINT chk_saved_searches_offering_type CHECK (offering_type IN ('ANIMAL_LISTING'));
END $$;
