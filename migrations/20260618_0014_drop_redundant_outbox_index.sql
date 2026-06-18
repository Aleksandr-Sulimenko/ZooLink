-- Migration 0014 — Drop the now-redundant outbox index
--
-- WHAT: drop idx_outbox_unprocessed.
-- WHY:  the relay claim filters on (processed_at IS NULL AND dead_lettered_at IS NULL) ordered by
--       next_attempt_at, which is served by idx_outbox_ready (migration 0012). The older
--       idx_outbox_unprocessed (processed_at WHERE processed_at IS NULL) has no remaining reader.
-- WHY BETTER: removes dead write-amplification on a hot, append-heavy table without losing any
--       query coverage. Idempotent (IF EXISTS).

DROP INDEX IF EXISTS idx_outbox_unprocessed;
