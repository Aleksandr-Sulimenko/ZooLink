-- Migration: 20260624_0020_refresh_token_session_fields
-- Phase B2 (ADMIN_PHASE_ACTION_PLAN.md, GAP-TRACE-013) — session/login-history form on refresh_tokens.
--
-- WHAT
--   Add four nullable columns to refresh_tokens: ip_address (INET), user_agent (TEXT),
--   last_used_at (TIMESTAMPTZ), revoked_reason (VARCHAR(40)). FORM only — population is partial now
--   (last_used_at on rotate) / later (ip/ua capture). NO MFA placeholder column (IMPLEMENTATION_PLAYBOOK
--   §5 forbids placeholder-for-rewrite; the false "MFA infrastructure prepared" claim is a doc fix).
--
-- WHY
--   UC-ID-05 (login history / terminate session) and theft-forensics need per-token device/location +
--   a last-use timestamp + a machine-readable revoke reason. Adding these later to a live sessions
--   table = migration + backfill churn; the irreversible artifact is the column form (rewrite-test, §5).
--
-- WHY BETTER (whole-project)
--   - Nullable + additive: zero behaviour change for the shipped refresh-rotation; existing rows valid.
--   - revoked_reason as a short controlled string (LOGOUT, ROTATED, REUSE_DETECTED, ROLE_CHANGE,
--     ADMIN_TERMINATE) makes audit/observability of session termination queryable.
--   - last_used_at powers the future "active sessions" view without a new table.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. Safe to run twice.

BEGIN;

ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS ip_address     INET;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS user_agent     TEXT;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at   TIMESTAMP WITH TIME ZONE;
ALTER TABLE refresh_tokens ADD COLUMN IF NOT EXISTS revoked_reason VARCHAR(40);

COMMIT;
