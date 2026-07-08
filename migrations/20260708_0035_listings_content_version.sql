-- Migration: 20260708_0035_listings_content_version
-- Slice H2 / ADR-0035 — Listing ETag / optimistic-concurrency basis decoupled from `updated_at`
-- (view-count off the concurrency path). Fixes P0-2 (spurious 412 edit-lockout / view-flood griefing).
--
-- WHAT
--   Add `listings.content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` — a dedicated CONTENT/state
--   validator. The listing ETag is derived from this column (not `updated_at`), so read-path writes
--   (`view_count` increment) and the generic `updated_at` trigger no longer bust the ETag. Backfilled
--   ONCE from `updated_at` (the best historical approximation of "last real change"). Also: the two
--   cascade-deactivation functions (`cascade_animal_deactivation` / `cascade_user_deactivation`) now
--   set `content_updated_at = now()` beside their existing `status/is_active/updated_at` writes, so a
--   DB-driven state change stays truthful. No table added or removed (37 tables unchanged).
--
-- WHY
--   ADR-0035 finding #1 (AUDIT4 architect / trash-lens): the ETag is the optimistic-concurrency
--   validator (`assertIfMatch` → 412 STALE_RESOURCE) but was derived from `updated_at`, a physical
--   row-mtime that the generic `update_updated_at_column()` trigger (migration 0013) moves on EVERY
--   UPDATE — including the best-effort `view_count` increment on the public `GET /listings/{id}` read.
--   So every counted view rotated the listing's ETag → a seller/operator (or AI operator, ADR-0006)
--   holding the pre-view ETag got a spurious 412 on their next `If-Match` PATCH. On a popular listing
--   this is a perpetual edit-lockout and a trivial view-flood griefing lever. The defect is a CLASS,
--   not view-count-specific: `escalated_at` (mig 0024), the D3 `market` recompute (mig 0033) and
--   `moderation_enqueued_at` bust the ETag the same way. The root cause is conflating a content
--   validator with a physical row-mtime.
--
-- WHY-BETTER-for-the-whole-project (ADR-0035 Option A, chosen over B/C)
--   - Fixes the WHOLE class: only genuine content/state changes bump the validator, so `view_count`,
--     `escalated_at` and the market recompute all stop rotating the ETag. Optimistic concurrency still
--     works for real edits (a content change bumps it → a stale If-Match correctly 412s).
--   - Semantically correct + permanent: the ETag becomes a true content validator, the right basis
--     REGARDLESS of scale — it is not thrown away by a later off-row counter (Option C), it composes
--     with it. `updated_at` keeps its meaning (physical mtime); the generic trigger stays generic
--     (no column-awareness leaked into shared infra, unlike Option B).
--   - Cheap now: one column + a one-time backfill; the service threads `content_updated_at` beside the
--     `updated_at: new Date()` it already sets on every content/state write.
--   - No analytics regression: `view_count` and its increment path are untouched (the ONE
--     irreversible signal, mig 0031).
--
-- N-1 rolling-deploy write-compat: `DEFAULT now()` is retained PERMANENTLY, so an N-1 pod that INSERTs
-- a listing without the column lands a sensible "created now" value (the mig-0033 lesson).
--
-- Idempotent: `IF NOT EXISTS` column guard in a DO block — the backfill fires ONLY on first create, so
-- a re-run never clobbers app-written values with the view-polluted `updated_at`. The two cascade
-- functions ship via CREATE OR REPLACE (idempotent). Safe to run twice (proven on live PG — двойной прогон).
-- Negative / N-1 tests (invariants):
--   (1) Re-running the migration is a no-op: the column already exists → the DO block skips the backfill,
--       so app-written content_updated_at values are NOT reset to updated_at.
--   (2) INSERT a listing WITHOUT content_updated_at (simulating an N-1 pod) → succeeds via DEFAULT now(),
--       lands NOT NULL.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'listings' AND column_name = 'content_updated_at'
  ) THEN
    ALTER TABLE listings ADD COLUMN content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
    -- One-time historical approximation: the best available "last real change" is the current
    -- updated_at. Guarded by IF NOT EXISTS so a re-run never re-runs this over app-written values.
    UPDATE listings SET content_updated_at = updated_at;
  END IF;
END $$;

-- Cascade functions: a DB-driven DEACTIVATED state change must bump the content validator too, so a
-- client holding the pre-cascade ETag correctly 412s (the state they were editing changed). CREATE OR
-- REPLACE = idempotent; the only change vs migration 0025 is the added `content_updated_at = now()`.
CREATE OR REPLACE FUNCTION cascade_animal_deactivation() RETURNS trigger AS $$
BEGIN
    IF NEW.deactivated_at IS NOT NULL AND OLD.deactivated_at IS NULL THEN
        UPDATE listings SET status = 'DEACTIVATED', is_active = false, updated_at = now(), content_updated_at = now()
         WHERE animal_id = NEW.id AND status NOT IN ('DEACTIVATED', 'SOLD', 'EXPIRED');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cascade_user_deactivation() RETURNS trigger AS $$
BEGIN
    IF NEW.deactivated_at IS NOT NULL AND OLD.deactivated_at IS NULL THEN
        UPDATE listings SET status = 'DEACTIVATED', is_active = false, updated_at = now(), content_updated_at = now()
         WHERE seller_id = NEW.id AND status NOT IN ('DEACTIVATED', 'SOLD', 'EXPIRED');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
