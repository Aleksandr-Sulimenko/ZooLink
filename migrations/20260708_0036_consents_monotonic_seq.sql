-- Migration: 20260708_0036_consents_monotonic_seq
-- Slice H2-B / AUDIT4 P1-2 — consent "current row" tie-break made MONOTONIC (fail-safe under same-timestamp writes).
--
-- WHAT
--   Add `consents.seq BIGINT GENERATED ALWAYS AS IDENTITY` — a strictly-increasing, DB-assigned insertion
--   order. `ConsentService.currentlyGranted` now orders by `seq DESC` (was `created_at DESC, id DESC`), so
--   the latest consent for a (subject, kind) is decided by causal insertion order, never by a random UUID.
--   A companion index `idx_consents_seq_current (user_id, consent_type, seq DESC)` keeps the ordered lookup
--   index-only. No table added/removed (37 tables unchanged). The append-only immutability trigger
--   (`trg_consents_immutable`, mig 0029) is UNTOUCHED and still fires on any UPDATE/DELETE — this is a pure
--   additive DDL column, not a row mutation, so it does not trip the trigger.
--
-- WHY
--   `consents` is append-only (mig 0029): a grant and a superseding withdrawal are two rows; the current
--   state is the LATEST row. The old order key was `[created_at DESC, id DESC]`, and `id` is a random
--   uuid_generate_v4(). `created_at` is `TIMESTAMPTZ DEFAULT now()` at microsecond precision, so two rows
--   written in the same microsecond (a batched/on-behalf grant→withdraw, an AGENT sequence, or a
--   concurrent grant+withdraw) TIE on `created_at` and the winner is decided by RANDOM UUID comparison —
--   NOT causal order. A withdrawal (`granted=false`) can lose the tie to the grant it supersedes and the
--   state resolves to `granted=true` after the subject withdrew. That FAILS OPEN (toward distribution) and
--   breaks ст.9 ч.2 ФЗ-152 ("a withdrawal must take effect"). The tie-break must be deterministic and
--   fail-safe. (AUDIT4 security.md / backend-engineer.md, P1-2 ⇊converged.)
--
-- WHY-BETTER-for-the-whole-project
--   - Monotonic `seq` is a TOTAL order on insertion — no ties are possible, so the resolution is
--     deterministic regardless of clock resolution, batching, or concurrency. It fails safe by causality,
--     not by "deny-wins", so it is also correct for a re-grant AFTER a withdrawal (grant wins, as intended).
--   - Reuses the pattern the DB already trusts for ordering (identity sequence) and keeps `created_at` for
--     its real meaning (the wall-clock proof timestamp under ст.9 ч.1). No semantics are overloaded.
--   - Cheap, additive, forward-compatible: the other three consent kinds (MARKETING / ANALYTICS_PROFILING /
--     NONESSENTIAL_COOKIES) inherit the correct tie-break for free when they go live. Agent-on-behalf
--     consent writes (ADR-0006) become safe to resolve — a precondition the security [NS] audit flagged.
--
-- N-1 rolling-deploy: SAFE. `seq` is `GENERATED ALWAYS AS IDENTITY` (DB-assigned, never written by app
--   code), so an N-1 pod that INSERTs a consent WITHOUT the column succeeds and the DB fills `seq`. Old
--   code orders by `created_at DESC, id DESC` (its previous, less-safe behaviour) — no break, just the old
--   tie-break until the new code rolls. New code orders by `seq DESC`. No stop-the-world needed.
--
-- Idempotent: DO-block `IF NOT EXISTS` column guard + `CREATE INDEX IF NOT EXISTS`. On a populated table,
--   ADD COLUMN GENERATED ALWAYS AS IDENTITY back-fills existing rows in physical (insertion) order and
--   advances the sequence past them — a re-run is skipped by the guard, so existing seq values are never
--   re-assigned. Safe to run twice (proven on live PG — двойной прогон).
-- Negative tests (invariants):
--   (1) Re-running the migration is a no-op: the column exists → the DO block skips → no seq re-assignment.
--   (2) INSERT two consents rows with IDENTICAL created_at → the second INSERT gets a strictly greater seq →
--       `ORDER BY seq DESC LIMIT 1` deterministically returns the later row (grant/withdraw written last wins).
--   (3) The append-only trigger still fires: UPDATE/DELETE on a consents row is rejected (unchanged by 0036).

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'consents' AND column_name = 'seq'
  ) THEN
    ALTER TABLE consents ADD COLUMN seq BIGINT GENERATED ALWAYS AS IDENTITY;
  END IF;
END $$;

-- Ordered-lookup index for `currentlyGranted` (user_id, consent_type, seq DESC) — the monotonic counterpart
-- of idx_consents_current. Kept alongside idx_consents_current (created_at DESC) which still serves the
-- ст.9 ч.1 timestamp-proof reads.
CREATE INDEX IF NOT EXISTS idx_consents_seq_current ON consents(user_id, consent_type, seq DESC);
