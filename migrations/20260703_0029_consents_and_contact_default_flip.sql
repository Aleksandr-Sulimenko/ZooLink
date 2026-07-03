-- Migration: 20260703_0029_consents_and_contact_default_flip
-- ADR-0020 (versioned consent-record model) — append-only `consents` log + gate contact-distribution.
--
-- WHAT
--   1. New append-only, versioned `consents` table (ADR-0011 supersede shape: a new row supersedes the
--      previous; current consent = latest row by (user_id, consent_type)). `consent_type` enum has
--      CONTACT_DISTRIBUTION LIVE now; MARKETING / ANALYTICS_PROFILING / NONESSENTIAL_COOKIES reserved
--      form-now (behaviour deferred). Actor snapshot (actor_id + actor_principal_type HUMAN|AGENT,
--      ADR-0006/0011). BEFORE UPDATE OR DELETE immutability trigger (reuses trg_block_modify_append_only).
--   2. Flip the `users.contact_prefs` column DEFAULT: show_phone:true → false (all-OFF) — ст.10.1 default-OFF.
--   3. De-duplicate `contact_reveals` and add a UNIQUE(viewer_id, listing_id) index so a repeat reveal of
--      the same (viewer, listing) can never double-charge quota / double-write a lead row (billing-unit fix,
--      AUDIT3/finance.md). The app checks first (return existing without burning quota); this index is the
--      DB backstop against a concurrent race.
--   No table removed; +1 table (35 → 36).
--
-- WHY
--   Contact-reveal is LIVE and distributes the seller phone. ст.10.1 ФЗ-152 requires a SEPARATE,
--   affirmative, default-OFF consent for распространение, and ст.9 ч.1 requires the operator to be able to
--   PROVE it (text version + timestamp + action). A mutable JSONB prefs flag is not proof (unversioned,
--   overwritten on erase/reset). An append-only versioned log is the statutory proof — exactly the shape
--   ADR-0011 already ratified for moderation/audit actor-snapshots. Closes go-live legal blocker A5 while
--   it is still free (no real seller phone distributed by a real writer yet).
--
-- WHY BETTER (whole-project)
--   - Reuses a ratified pattern (append-only supersede + actor snapshot) — one coherent consent/actor idiom,
--     invents nothing new. Reuses the existing trg_block_modify_append_only() immutability function.
--   - Forward-compat / anti-rewrite: the other three consent kinds land later as DATA only, zero schema change
--     (same "form now, behaviour deferred" rule as feature_toggles.payments).
--   - Agent-ready (actor_principal_type) + subject-scoped (user_id, not offering) — survives ADR-0006 and the
--     ADR-0014/0015 ecosystem expansion without retrofit.
--
-- Idempotent: CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS · CREATE OR REPLACE FUNCTION · ALTER COLUMN SET DEFAULT
--   (no-op when already set) · dedup DELETE is a no-op on a second run. Safe to run twice (proves idempotency).
-- Validated on live PostgreSQL 14 (run twice — idempotent) + negative tests for the append-only invariant.

BEGIN;

-- 1. Append-only, versioned consent log (ADR-0020 §1 / ADR-0011 shape).
CREATE TABLE IF NOT EXISTS consents (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- The DATA SUBJECT whose personal data the consent concerns (ст.10.1: whose contacts are distributed).
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- Consent kind. CONTACT_DISTRIBUTION is live (ст.10.1); the other three are FORM-NOW / behaviour-deferred
    -- (MARKETING = ст.9 + ФЗ-38 ст.18 prior opt-in; ANALYTICS_PROFILING = ст.9; NONESSENTIAL_COOKIES = ст.9).
    consent_type  VARCHAR(40) NOT NULL CHECK (consent_type IN
                     ('CONTACT_DISTRIBUTION','MARKETING','ANALYTICS_PROFILING','NONESSENTIAL_COOKIES')),
    -- true = grant, false = withdrawal. Withdrawal is a NEW superseding row (ст.9 ч.2: as easy as the grant).
    granted       BOOLEAN NOT NULL,
    -- The version of the consent text the subject agreed to — proof under ст.9 ч.1.
    policy_version VARCHAR(20) NOT NULL,
    -- Origin of the affirmative UI action, e.g. 'PROFILE_SETTINGS','REGISTRATION','ADMIN','AGENT'.
    source        VARCHAR(30) NOT NULL,
    -- ADR-0011/0006 actor snapshot: WHO recorded this action. Normally == user_id (self-service opt-in),
    -- but differs when an operator/AGENT records on the subject's behalf. Subject (user_id) always
    -- distinct from acting principal (actor_id).
    actor_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN'
                            CHECK (actor_principal_type IN ('HUMAN','AGENT')),
    -- Append-only: rows are immutable; no updated_at. A change = a new superseding row.
    created_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE consents IS
  'ADR-0020: append-only, versioned consent log (ст.9 ч.1 proof). Current consent = latest row by '
  '(user_id, consent_type). Immutable (trg_consents_immutable). CONTACT_DISTRIBUTION live (ст.10.1); '
  'MARKETING/ANALYTICS_PROFILING/NONESSENTIAL_COOKIES reserved form-now.';

-- Current-consent lookup: latest row per (subject, kind).
CREATE INDEX IF NOT EXISTS idx_consents_current ON consents(user_id, consent_type, created_at DESC);
-- Agent-recorded consents (ADR-0006 observability), mirrors idx_users_agents.
CREATE INDEX IF NOT EXISTS idx_consents_agent_actor
    ON consents(actor_principal_type) WHERE actor_principal_type = 'AGENT';

-- Append-only enforcement: reuse the shared immutability function (moderation_decisions precedent).
CREATE OR REPLACE FUNCTION trg_block_modify_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; UPDATE/DELETE is not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_consents_immutable ON consents;
CREATE TRIGGER trg_consents_immutable
BEFORE UPDATE OR DELETE ON consents
FOR EACH ROW EXECUTE FUNCTION trg_block_modify_append_only();

-- 2. Flip the contact_prefs column DEFAULT to all-OFF (ст.10.1 default-OFF; the two code copies
--    DEFAULT_CONTACT_PREFS in admin-user.service.ts + retention.service.ts flip in the same change).
ALTER TABLE users ALTER COLUMN contact_prefs SET DEFAULT '{"show_phone": false, "show_telegram": false}'::jsonb;
COMMENT ON COLUMN users.contact_prefs IS
  'Per-channel contact selector (which channels to distribute). Default all-OFF (ADR-0020, ст.10.1). '
  'The LAWFUL BASIS to distribute at all lives in the consents log (CONTACT_DISTRIBUTION), NOT here.';

-- 3. contact_reveals dedup: remove any pre-existing duplicate (viewer_id, listing_id) rows (keep the
--    earliest), then add the UNIQUE backstop index. Idempotent (a second run finds no duplicates).
DELETE FROM contact_reveals a
 USING contact_reveals b
 WHERE a.viewer_id = b.viewer_id
   AND a.listing_id = b.listing_id
   AND (a.created_at, a.id) > (b.created_at, b.id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_reveals_viewer_listing
    ON contact_reveals(viewer_id, listing_id);
COMMENT ON INDEX uq_contact_reveals_viewer_listing IS
  'ADR-0020: one reveal row per (viewer, listing) — a repeat reveal returns the existing row without '
  'burning quota / re-writing a lead (billing-unit fix). DB backstop; the app checks first.';

COMMIT;
