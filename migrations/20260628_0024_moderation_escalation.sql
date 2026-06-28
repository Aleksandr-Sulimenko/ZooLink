-- ============================================================================================
-- Migration 0024 — Slice 4c (A): SLA-escalation marker on listings
--
-- WHAT: add listings.escalated_at TIMESTAMPTZ NULL — the idempotent-emission marker for the
--       Moderation.Escalated SLA job, plus a partial index on the job's scan predicate.
-- WHY:  ADR-0003 / spec-12 round-5: an overdue PENDING_MODERATION item escalates to ADMIN
--       (Moderation.Escalated) exactly ONCE; escalated_at, set in the SAME transaction as the
--       outbox write, makes emission idempotent (SLA-1) without ever mutating status (M-13).
-- WHY-BETTER: a dedicated marker column (not a status flip) keeps escalation orthogonal to the
--       listing lifecycle — the item stays PENDING_MODERATION, never auto-decided (M-P0/M-13);
--       the partial index keeps the per-tick scan cheap as the queue grows. Mirrors the retention
--       job's marker discipline (erased_at / idempotent set-based predicate).
--
-- Idempotent (safe to run twice): IF NOT EXISTS on the column + the index.
-- ============================================================================================

BEGIN;

ALTER TABLE listings ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN listings.escalated_at IS
  'SLA-escalation idempotent-emission marker (Slice 4c): set in the same tx as the Moderation.Escalated outbox write; a non-null value means the item was already escalated (skip it). Reset on ACTIVE→PENDING re-moderation is 4d''s job.';

-- The escalation job scans WHERE status='PENDING_MODERATION' AND escalated_at IS NULL — index that
-- exact predicate (FIFO by moderation_enqueued_at) so the per-tick scan stays cheap.
CREATE INDEX IF NOT EXISTS idx_listings_escalation_scan
    ON listings(moderation_enqueued_at)
    WHERE status = 'PENDING_MODERATION' AND escalated_at IS NULL;

COMMIT;
