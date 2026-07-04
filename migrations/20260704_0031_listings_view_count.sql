-- Migration: 20260704_0031_listings_view_count
-- Wave D / D1 views-capture (GAP-TRACE-006 · AUDIT3 data-analyst — the ONE irreversibly-lost signal).
--
-- WHAT
--   Add `listings.view_count BIGINT NOT NULL DEFAULT 0` + `CHECK (view_count >= 0)`. A denormalized,
--   monotonic detail-view counter, best-effort incremented on the public `GET /v1/listings/{id}` read
--   (SET view_count = view_count + 1), deduped per (viewer, listing) in Redis (an F5 refresh does not
--   inflate it), with the seller's own views excluded. No table added or removed (36 tables unchanged).
--   NOT added: a denormalized `contact_shown_count`. Contact-show is already durably sourced from the
--   `contact_reveals` table (getAnalytics counts it), so a second counter would only invite drift.
--
-- WHY
--   AUDIT3 (data-analyst, [SEV-CHG MAJOR→CRITICAL][measurability]/[forward-compat]): views are the funnel
--   TOP and the ONE analytics signal whose history CANNOT be backfilled — an impression not captured on
--   an already-live surface is gone forever. Every other analytics gap is additive-later; this one is
--   irreversible, so it is reserved FIRST. Until now `getAnalytics.views` was hard-0 (listing.service.ts,
--   GAP-TRACE-006 — "there is no page-view capture source: no listings.view_count column, no Listing.Viewed
--   event"). This migration supplies the durable capture source.
--
-- WHY-BETTER-for-the-whole-project
--   - A BIGINT counter column is the cheapest durable capture available today: the event-sourced
--     alternative (a `Listing.Viewed` event) needs an outbox CONSUMER/projection that does not exist
--     yet (AUDIT3: ZERO registered OUTBOX_CONSUMERS). Form now, minimal, no new infrastructure.
--   - BIGINT (not INT) mirrors the `price_cents` BIGINT precedent — a hot pet/livestock listing can
--     exceed 2^31 lifetime impressions, so INT would force a later widening rewrite. Avoided now.
--   - `CHECK (view_count >= 0)` turns the monotonic-counter invariant into a DB guarantee (negative
--     test below), not a service-only assumption.
--   - Redis dedup (not a per-view row) keeps the write path O(1) and privacy-light (no per-view PII row
--     or log; ФЗ-152 data-minimisation) — the counter is an aggregate, never a per-viewer trail.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + DROP-then-ADD the named CHECK inside a DO block. Safe to run
-- twice (proven on live PG — двойной прогон).
-- Negative tests (invariants):
--   (1) UPDATE/INSERT with view_count = -1 is rejected by chk_listings_view_count_nonneg (23514).
--   (2) The column is NOT NULL DEFAULT 0 — a row inserted without it lands 0, never NULL.

ALTER TABLE listings ADD COLUMN IF NOT EXISTS view_count BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_view_count_nonneg;
  ALTER TABLE listings ADD CONSTRAINT chk_listings_view_count_nonneg CHECK (view_count >= 0);
END $$;
