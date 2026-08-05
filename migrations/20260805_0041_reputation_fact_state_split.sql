-- Migration 0041 — reputation reform: split immutable FACT from mutable STATE (ADR-0038 §4 Amendment,
-- ADR-0039 §3 Amendment). Reputation-pack COMMIT-1 (schema). DORMANT — feature_toggles reputation_reviews /
-- sale_buyer_confirmation stay OFF; HUMAN behaviour byte-identical.
--
-- ============================================================================
-- ЧТО:
--   §A  confirmed_sales becomes a CONFIRMED-ONLY FACT: drop the negotiation columns
--       (nominated_buyer_user_id/seller_confirmed_at/buyer_confirmed_at/expires_at), drop the status DEFAULT,
--       narrow chk_confirmed_sales_status to CHECK(status='CONFIRMED') (Q2 gravestone — narrowed, not dropped),
--       drop the now-meaningless idx_confirmed_sales_confirm_scan. KEEP the FULL uq_confirmed_sales_transfer
--       (Q1 — a confirmed transfer-sale is permanent) and confirmed_at.
--   §B  NEW mutable companion sale_confirmations — the markSold PENDING→CONFIRMED/EXPIRED/CANCELLED/DISPUTED
--       lifecycle that the append-only fact table could not carry (append-only blocks 6 of the 7 edges). The
--       "mutable state" half of the project pattern "immutable fact + mutable state". Biconditional
--       chk_sale_conf_confirmed_link (mirror of chk_moddec_override): CONFIRMED ⇔ produced its fact row.
--   §C  reviews: FORWARD superseded_by_id → BACKWARD supersedes_review_id (ADR-0039 §3 Amendment — the
--       moderation_decisions model; the NEW row names its predecessor, written at INSERT about SELF, so it is
--       append-only-safe). Drop uq_reviews_current_per_direction (unreachable — the forward pointer could never
--       be set under append-only). ADD uq_reviews_supersedes (≤1 successor per predecessor = LINEAR edit chain,
--       DELIBERATELY stricter than moderation_decisions — Q5) + uq_reviews_root_per_direction (one root chain per
--       (sale,direction) ⇒ one head ⇒ "one current" stays a DB invariant — Q6). Move mutable moderation_status/
--       is_visible OUT to review_states (§D). CREATE VIEW reviews_current = the single named "current" resolver.
--   §D  NEW mutable companion review_states — moderation_status + is_visible (both change by design → cannot live
--       on the append-only reviews). Symmetric with sale_confirmations. reviews.id stays stable; reads join.
--
-- ПОЧЕМУ:
--   AUDIT5 gate-pass (держатель 2026-08-04, m-20260804-234834): the FORM slices (mig 0039/0040) modelled a state
--   MACHINE on APPEND-ONLY tables — a self-contradiction (confirmed_sales had a 5-value status but append-only
--   allowed only born-CONFIRMED; reviews had a FORWARD superseded_by_id that append-only could never set, and a
--   partial-unique on it that therefore covered ALL rows). This migration resolves the contradiction structurally
--   by separating the immutable FACT from the mutable STATE, reform-on-empties (0 markSold rows, all transfer
--   rows already CONFIRMED) → cheapest now.
--
-- ПОЧЕМУ ТАК ЛУЧШЕ для проекта:
--   One canon-wide pattern (immutable fact + mutable companion) now covers sales AND reviews (confirmed_sales/
--   sale_confirmations, reviews/review_states) — symmetric with the existing moderation_decisions (decision) and
--   reputation_aggregates (cache). The backward supersede pointer + linear-chain UNIQUE + reviews_current view
--   make "the current review" a DB invariant resolved in ONE named place, not re-implemented per reader. Every
--   change is additive/guarded → N-1 rolling-deploy safe; DORMANT → zero MVP behaviour change.
--
-- Idempotent: DROP … IF EXISTS / ADD … guarded / CREATE … IF NOT EXISTS / CREATE OR REPLACE VIEW. Validated on
-- live PostgreSQL run TWICE (second run = clean no-op) + a negative test per invariant against a throwaway DB
-- built from database_schema.sql (append-only holds on confirmed_sales/reviews; sale_confirmations/review_states
-- ARE mutable; uq_reviews_supersedes / uq_reviews_root_per_direction / uq_confirmed_sales_transfer /
-- chk_sale_conf_confirmed_link / chk_confirmed_sales_status='CONFIRMED' reject their violations). tables +2 → 43.
-- ============================================================================

BEGIN;

-- ----- §A confirmed_sales → CONFIRMED-ONLY FACT --------------------------------------------------------
ALTER TABLE confirmed_sales DROP COLUMN IF EXISTS nominated_buyer_user_id;
ALTER TABLE confirmed_sales DROP COLUMN IF EXISTS seller_confirmed_at;
ALTER TABLE confirmed_sales DROP COLUMN IF EXISTS buyer_confirmed_at;
ALTER TABLE confirmed_sales DROP COLUMN IF EXISTS expires_at;
ALTER TABLE confirmed_sales ALTER COLUMN status DROP DEFAULT;
-- Narrow the status vocabulary to the single terminal fact value (Q2 gravestone). Reform-on-empties: the only
-- rows ever written are transfer-anchored born-CONFIRMED rows, so no existing row violates the narrowed CHECK.
ALTER TABLE confirmed_sales DROP CONSTRAINT IF EXISTS chk_confirmed_sales_status;
ALTER TABLE confirmed_sales ADD  CONSTRAINT chk_confirmed_sales_status CHECK (status = 'CONFIRMED');
DROP INDEX IF EXISTS idx_confirmed_sales_confirm_scan;
COMMENT ON CONSTRAINT chk_confirmed_sales_status ON confirmed_sales IS 'Q2 gravestone (ADR-0038 §4 Amendment): PENDING/DISPUTED/EXPIRED/CANCELLED live in sale_confirmations — confirmed_sales holds only the CONFIRMED fact. Narrowed (not dropped) from the former 5-value machine so a future reader sees where PENDING went.';
COMMENT ON TABLE confirmed_sales IS 'ADR-0038: first-class, append-only, CONFIRMED-ONLY record-of-truth that a real deal happened (proof-of-transaction root for reputation, ADR-0039). A row EXISTS iff the sale is a confirmed fact (§4 Amendment / migration 0041); the PENDING/negotiation lifecycle lives in the mutable companion sale_confirmations. Anchored to a COMPLETED ownership_transfers (auto-CONFIRMED, in-tx) or a listing markSold CONFIRM (deferred). DORMANT capture in MVP.';

-- ----- §B sale_confirmations (MUTABLE negotiation companion) -------------------------------------------
CREATE TABLE IF NOT EXISTS sale_confirmations (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    offering_type           VARCHAR(30) NOT NULL DEFAULT 'ANIMAL_LISTING',
    offering_id             UUID,
    listing_id              UUID REFERENCES listings(id) ON DELETE SET NULL,
    animal_id               UUID REFERENCES animals(id)  ON DELETE SET NULL,
    market                  VARCHAR(9)  NOT NULL,
    seller_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    buyer_user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
    seller_organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
    buyer_organization_id   UUID REFERENCES organizations(id) ON DELETE SET NULL,
    nominated_buyer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    anchor_type             VARCHAR(20) NOT NULL DEFAULT 'LISTING_MARK_SOLD',
    status                  VARCHAR(24) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    seller_confirmed_at     TIMESTAMP WITH TIME ZONE,
    buyer_confirmed_at      TIMESTAMP WITH TIME ZONE,
    expires_at              TIMESTAMP WITH TIME ZONE,
    -- ON DELETE RESTRICT (not SET NULL): SET NULL would null this pointer on fact-deletion, violating
    -- chk_sale_conf_confirmed_link for a CONFIRMED row → an opaque CHECK error instead of an honest FK-restrict.
    -- RESTRICT matches the fact's append-only immutability + reviews.supersedes_review_id RESTRICT (holder 2026-08-05).
    confirmed_sale_id       UUID REFERENCES confirmed_sales(id) ON DELETE RESTRICT,
    actor_id                UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type    VARCHAR(10) NOT NULL DEFAULT 'HUMAN',
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_sale_conf_status      CHECK (status IN
        ('PENDING_CONFIRMATION','CONFIRMED','DISPUTED','EXPIRED','CANCELLED')),
    CONSTRAINT chk_sale_conf_anchor      CHECK (anchor_type IN ('LISTING_MARK_SOLD')),
    CONSTRAINT chk_sale_conf_actor_ptype CHECK (actor_principal_type IN ('HUMAN','AGENT')),
    CONSTRAINT chk_sale_conf_confirmed_link CHECK (
        (status =  'CONFIRMED' AND confirmed_sale_id IS NOT NULL) OR
        (status <> 'CONFIRMED' AND confirmed_sale_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sale_conf_live_per_listing ON sale_confirmations(listing_id)
    WHERE status IN ('PENDING_CONFIRMATION','DISPUTED');
CREATE INDEX IF NOT EXISTS idx_sale_conf_confirm_scan ON sale_confirmations(expires_at) WHERE status = 'PENDING_CONFIRMATION';
-- updated_at trigger (the migration path has no DO-block; name matches the derived DO-block in database_schema.sql).
DROP TRIGGER IF EXISTS update_sale_confirmations_updated_at ON sale_confirmations;
CREATE TRIGGER update_sale_confirmations_updated_at BEFORE UPDATE ON sale_confirmations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
COMMENT ON TABLE sale_confirmations IS 'ADR-0038 §4 Amendment (migration 0041): MUTABLE markSold buyer-counter-confirmation lifecycle (PENDING_CONFIRMATION→CONFIRMED/EXPIRED/CANCELLED/DISPUTED). The "mutable state" companion to the append-only confirmed_sales FACT (project pattern: immutable fact + mutable state). The TRANSFER path never writes here. FORM/DORMANT behind feature_toggles.sale_buyer_confirmation.';
COMMENT ON CONSTRAINT chk_sale_conf_confirmed_link ON sale_confirmations IS 'Biconditional (mirror of chk_moddec_override): status=CONFIRMED ⇔ confirmed_sale_id IS NOT NULL — a CONFIRMED negotiation has produced exactly one confirmed_sales fact row; a non-CONFIRMED one has produced none.';

-- ----- §D review_states (MUTABLE moderation + visibility companion) — created BEFORE dropping the reviews cols
--        so a populated table can be back-filled (empty in MVP → a no-op, but correct).
CREATE TABLE IF NOT EXISTS review_states (
    review_id            UUID PRIMARY KEY REFERENCES reviews(id) ON DELETE CASCADE,
    moderation_status    VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    is_visible           BOOLEAN     NOT NULL DEFAULT FALSE,
    moderated_at         TIMESTAMP WITH TIME ZONE,
    actor_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN',
    created_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_review_states_mod_status  CHECK (moderation_status IN
        ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED')),
    CONSTRAINT chk_review_states_actor_ptype CHECK (actor_principal_type IN ('HUMAN','AGENT'))
);
CREATE INDEX IF NOT EXISTS idx_review_states_visible ON review_states(review_id) WHERE moderation_status = 'APPROVED' AND is_visible = TRUE;
DROP TRIGGER IF EXISTS update_review_states_updated_at ON review_states;
CREATE TRIGGER update_review_states_updated_at BEFORE UPDATE ON review_states
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
COMMENT ON TABLE review_states IS 'ADR-0039 §3 Amendment β (migration 0041): MUTABLE per-review moderation state (PENDING→APPROVED/REJECTED/CHANGES_REQUESTED) + double-blind is_visible. The "mutable state" companion to the append-only reviews FACT (project pattern: immutable fact + mutable state, symmetric with sale_confirmations). reviews.id stays stable; reads join. FORM/DORMANT behind feature_toggles.reputation_reviews.';

-- Back-fill review_states from reviews IF the old mutable columns still exist (guarded → idempotent + N-1 safe;
-- reviews is empty in MVP so this is a structural no-op, but correct for a populated table).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name='reviews' AND column_name='moderation_status') THEN
        INSERT INTO review_states (review_id, moderation_status, is_visible)
        SELECT id, moderation_status, is_visible FROM reviews
        ON CONFLICT (review_id) DO NOTHING;
    END IF;
END $$;

-- ----- §C reviews: forward → backward supersede, move mutable state out, new current-model ----------------
-- Drop the mutable moderation columns (now in review_states) + their CHECK.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS chk_reviews_moderation_status;
ALTER TABLE reviews DROP COLUMN IF EXISTS moderation_status;
ALTER TABLE reviews DROP COLUMN IF EXISTS is_visible;
-- Forward → backward supersede pointer. Drop the old index that predicated on the departing column first.
DROP INDEX IF EXISTS uq_reviews_current_per_direction;
ALTER TABLE reviews DROP COLUMN IF EXISTS superseded_by_id;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS supersedes_review_id UUID REFERENCES reviews(id) ON DELETE RESTRICT;
-- New current-model: linear chain (≤1 successor) + one root per (sale,direction) ⇒ one head ⇒ one current.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_supersedes ON reviews(supersedes_review_id) WHERE supersedes_review_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_root_per_direction ON reviews(confirmed_sale_id, direction) WHERE supersedes_review_id IS NULL;
-- Rebuild idx_reviews_subject_market WITHOUT the departed predicate columns (visibility filter is a join to
-- review_states in the behaviour slice).
DROP INDEX IF EXISTS idx_reviews_subject_market;
CREATE INDEX IF NOT EXISTS idx_reviews_subject_market ON reviews(subject_user_id, market);
COMMENT ON INDEX uq_reviews_supersedes IS 'ADR-0039 §3 Amendment (Q5) — DELIBERATELY STRICTER than moderation_decisions.supersedes_decision_id (which has NO such UNIQUE): a review EDIT is LINEAR (each version replaces exactly one prior), whereas a moderation OVERRIDE may branch. This UNIQUE forbids a forked edit history (two rows superseding one predecessor). Do NOT drop it to "unify" with moderation_decisions — the two model different things.';
COMMENT ON TABLE reviews IS 'ADR-0039: append-only, one-current-per-(sale,direction) proof-of-transaction review (1..5 + optional body). Edit-in-grace = a NEW row naming its predecessor via BACKWARD supersedes_review_id (§3 Amendment / migration 0041 — moderation_decisions model). "Current" = head of the chain, resolved by the VIEW reviews_current. Moderation/visibility state lives in review_states (mutable companion, §3 β). Immutable (trg_reviews_immutable, reused). DORMANT — behaviour behind feature_toggles.reputation_reviews.';

-- The single named "current review" resolver = the head of each edit chain (a row nothing supersedes).
CREATE OR REPLACE VIEW reviews_current AS
    SELECT r.*
    FROM reviews r
    WHERE NOT EXISTS (SELECT 1 FROM reviews s WHERE s.supersedes_review_id = r.id);
COMMENT ON VIEW reviews_current IS 'ADR-0039 §3 Amendment: the one named resolver of "current review" = the head of each edit chain (a row nothing supersedes). Linearity (uq_reviews_supersedes) guarantees a single head per chain. Behaviour-slice readers query this, not a hand-rolled NOT EXISTS.';

COMMIT;
