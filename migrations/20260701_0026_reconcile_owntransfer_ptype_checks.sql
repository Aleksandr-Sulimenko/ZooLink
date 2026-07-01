-- ============================================================================================
-- Migration 0026 — reconcile ownership_transfers principal_type CHECK names (fix-wave 1.1)
--
-- WHAT: converge the two principal-type CHECK constraints on ownership_transfers to a SINGLE
--       canonical pair of NAMED constraints (chk_owntransfer_initiated_ptype /
--       chk_owntransfer_responded_ptype), dropping the auto-named inline duplicates
--       (ownership_transfers_initiated_by_principal_type_check / *_responded_by_principal_type_check)
--       that older fresh-from-schema bootstraps produced.
-- WHY:  AUDIT_2026-06-30 migration-drift (advisory CI): the canonical database_schema.sql used INLINE
--       column CHECKs (auto-named) while migration 0023 ADDed identically-typed but EXPLICITLY-named
--       constraints. So a DB built fresh-from-schema vs schema+replay-migrations diverged in constraint
--       NAMES (and a schema-then-migrations DB ended up with BOTH = a double CHECK). pg_dump-diff of the
--       two bootstrap paths was therefore non-empty.
-- WHY-BETTER: database_schema.sql is now aligned to the SAME named constraints as migration 0023, so the
--       two bootstrap paths are byte-identical going forward; this migration retro-cleans any DB that was
--       built from the OLD inline-CHECK schema (drops the auto-named duplicates, asserts the canonical
--       named pair). Net result: exactly one CHECK per column, one name on every path — the advisory
--       migration-drift gate can be promoted to blocking. No data change, no behavior change (the CHECK
--       predicate is identical; only its identity/name is normalized).
--
-- Idempotent (safe to run twice): DROP CONSTRAINT IF EXISTS for every name + re-ADD the canonical pair.
--   - Fresh-from-NEW-schema DB: the auto-named drops are no-ops; the named pair already exists → dropped
--     and re-added (still idempotent).
--   - schema+replay-migrations DB: same — converges to the canonical pair regardless of start state.
-- ============================================================================================

BEGIN;

-- 1. Drop the legacy auto-named inline CHECKs (present only on DBs bootstrapped from the OLD schema).
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS ownership_transfers_initiated_by_principal_type_check;
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS ownership_transfers_responded_by_principal_type_check;

-- 2. Assert the canonical NAMED pair (matches database_schema.sql + migration 0023 verbatim).
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS chk_owntransfer_initiated_ptype;
ALTER TABLE ownership_transfers ADD  CONSTRAINT chk_owntransfer_initiated_ptype
    CHECK (initiated_by_principal_type IN ('HUMAN', 'AGENT'));
ALTER TABLE ownership_transfers DROP CONSTRAINT IF EXISTS chk_owntransfer_responded_ptype;
ALTER TABLE ownership_transfers ADD  CONSTRAINT chk_owntransfer_responded_ptype
    CHECK (responded_by_principal_type IS NULL OR responded_by_principal_type IN ('HUMAN', 'AGENT'));

COMMIT;
