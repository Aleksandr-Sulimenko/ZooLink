-- Migration 0012 — Outbox relay delivery state (Phase-1 cross-cutting)
--
-- WHAT: add delivery-tracking columns to outbox_events (attempts, last_error,
--       next_attempt_at, dead_lettered_at) + a "ready" partial index for the relay claim.
-- WHY:  the Phase-1 outbox relay needs at-least-once delivery with exponential backoff and
--       parking (dead-letter) of poison events; the original table only had processed_at,
--       which cannot express "retry later" or "give up".
-- WHY BETTER: keeps the proven transactional-outbox pattern (no broker in MVP — ADR-0009),
--       makes redelivery safe via a claim-with-lease (next_attempt_at as a visibility horizon),
--       and bounds blast radius of a bad consumer (parked, not infinitely retried). All changes
--       are additive + idempotent; existing rows default to immediately-deliverable.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS attempts         INTEGER NOT NULL DEFAULT 0;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS last_error       TEXT;
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS next_attempt_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW();
ALTER TABLE outbox_events ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_outbox_ready ON outbox_events(next_attempt_at)
    WHERE processed_at IS NULL AND dead_lettered_at IS NULL;

-- BUGFIX: a generic update_updated_at trigger was attached to outbox_events, but the table has
-- no updated_at column, so the relay's UPDATE (mark processed / reschedule) raised
-- "record \"new\" has no field \"updated_at\"". The trigger is wrong for this table — drop it.
-- WHY BETTER: outbox_events tracks its lifecycle via processed_at/next_attempt_at, not updated_at;
-- removing the misapplied trigger unblocks at-least-once delivery without adding a dead column.
DROP TRIGGER IF EXISTS update_outbox_events_updated_at ON outbox_events;
