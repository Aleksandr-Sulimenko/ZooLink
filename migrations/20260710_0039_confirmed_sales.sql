-- Migration 0039 — confirmed_sales record-of-truth (ADR-0038, reputation FORM-slice #1).
--
-- ============================================================================
-- ЧТО:
--   §A  New table `confirmed_sales` — a FIRST-CLASS, append-only record that a real deal happened
--       (ADR-0038 §1 Option 2), NOT a projection over ownership_transfers/markSold. Structural pins:
--         · append-only via the REUSED `trg_block_modify_append_only` trigger (ADR-0038 §5 — do NOT
--           invent a second immutability path); mirrors consents / moderation_decisions.
--         · anchor_type CHECK ('TRANSFER','LISTING_MARK_SOLD') + ownership_transfer_id FK with a
--           UNIQUE guard — one confirmed sale per transfer (mirror of ownership_transfers INV-4).
--         · parties seller/buyer (user OR org each side, reserved like ownership_transfers).
--         · derived `market` (ADR-0018/0033 discipline, ADR-0002 hard split) — cached from the animal's
--           species.market at capture, NEVER re-derived on read; NOT NULL CHECK pet|livestock.
--         · status machine (spec 18 §4): PENDING_CONFIRMATION/CONFIRMED/DISPUTED/EXPIRED/CANCELLED.
--         · actor-snapshot pair (actor_id + actor_principal_type HUMAN|AGENT, ADR-0006/0011).
--         · polymorphic offering_type DEFAULT 'ANIMAL_LISTING' (widen-additively CHECK, ADR-0014 seam /
--           migration 0032 dialect) + offering_id (the polymorphic listing pointer, NULL for a pure
--           transfer anchor which has no listing) + concrete listing_id/animal_id instance pointers.
--         · nominated_buyer_user_id — RESERVED form-now for the markSold buyer-counter-confirmation path
--           (so flipping `sale_buyer_confirmation` behaviour needs NO schema change; ADR-0038 §4 item 3).
--         · amount_minor BIGINT NULL — RESERVED, off-record default (owner decision 2026-07-09,
--           ADR-0038 Open-Q1): the column is free forward-compat; NO code path writes it in this slice.
--   §B  Seed `feature_toggles.sale_buyer_confirmation` = OFF/0% — the gate for the (deferred) listing
--       markSold buyer-counter-confirmation flow (same shape as ownership_transfer_verification /
--       payments). NOTE: `reputation_reviews` is NOT seeded here — it belongs to the reviews slice (ADR-0039).
--
-- ПОЧЕМУ:
--   AUDIT4 P3-1: the built marketplace is a one-way contact-reveal that leaks the whole relationship to
--   Telegram — no confirmed-sale signal, no reputation, so the platform captures none of the value it
--   creates. The strongest sale signal (a COMPLETED ownership_transfers, already two-sided per ADR-0013)
--   is lost forever if not recorded at the instant it happens. Same reserved-first logic that pulled
--   view_count forward (migration 0031, D1). Reviews/behaviour stay OFF; the record of truth starts accruing.
--
-- ПОЧЕМУ ТАК ЛУЧШЕ для проекта:
--   FORM-now / behaviour-gated (the proven pattern: view_count D1, dormant user_roles migration 0034).
--   The transfer completion path writes an auto-CONFIRMED row IN THE SAME TX as the transfer accept
--   (transactional-outbox, ADR-0021) so the signal is atomic and never lost between two writes; the
--   append-only immutable row is a durable proof-of-transaction root the reviews FK later anchors to
--   (ADR-0039). Additive + reversible + ZERO human-behaviour change (no consumer, no endpoint reads it).
--   All new columns are additive/nullable → N-1 rolling-deploy safe (AUDIT4 P1-5). Named constraints
--   avoid schema↔migration drift (the migration 0026 lesson). Decoupled from ADR-0013's animal-transfer
--   invariants and ADR-0014's not-yet-built offering supertype — no god-table (ADR-0038 §1/§2).
--
-- APPEND-ONLY vs the status machine (scope note): in THIS slice the ONLY status ever written is
--   'CONFIRMED', from the transfer anchor — a single, terminal, immutable row that never transitions, so
--   the append-only trigger holds byte-for-byte. The markSold PENDING_CONFIRMATION → CONFIRMED transition
--   mechanics (superseding-row à la consents/moderation_decisions, vs. a relaxed guard) are DEFERRED to
--   the behaviour slice behind `sale_buyer_confirmation` — reserved in the CHECK vocabulary, not exercised
--   here. The status/CHECK carries the full vocabulary form-now; only CONFIRMED is produced today.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + named constraints + DROP TRIGGER IF EXISTS + INSERT …
-- ON CONFLICT DO NOTHING. Validated on live PostgreSQL (run TWICE — second run is a clean no-op). Every
-- invariant has an AUTOMATED negative test in `backend/test/confirmed-sales.e2e-spec.ts` (describe
-- "negative invariants (m1)"): UNIQUE(ownership_transfer_id) violation, append-only UPDATE + DELETE both
-- rejected by the trigger, and each named CHECK — anchor_type / status / offering_type / market /
-- actor_principal_type — rejecting a bad value (plus an AGENT positive-control). tables +1 → 39.
-- ============================================================================

BEGIN;

-- ----- §A confirmed_sales --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS confirmed_sales (
    id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- What was sold (polymorphic subject; migration 0032 dialect / ADR-0014 seam / ADR-0038 §2).
    -- offering_id is the polymorphic pointer to the offering instance (a listing); NULL for a pure
    -- TRANSFER anchor (a transfer is not necessarily tied to a listing). The concrete instance pointers
    -- listing_id/animal_id carry the ANIMAL_LISTING subtype's links. No FK on offering_id (polymorphic
    -- target across future subtype tables; anti-god-table, exactly as favorites/saved_searches).
    offering_type          VARCHAR(30) NOT NULL DEFAULT 'ANIMAL_LISTING',
    offering_id            UUID,
    listing_id             UUID REFERENCES listings(id) ON DELETE SET NULL, -- concrete offering instance (markSold path)
    animal_id              UUID REFERENCES animals(id)  ON DELETE SET NULL, -- the animal (transfer anchor)
    -- Derived market (ADR-0018/0033; ADR-0002 hard split). Cached at capture from species.market via the
    -- animal — the sanctioned intra-aggregate read (TransferService, animal module). Never re-derived on read.
    market                 VARCHAR(9) NOT NULL,
    -- Parties. Seller = the party giving up the animal (transfer FROM-side); buyer = the receiving
    -- TO-side. Exactly-one-of user/org per side is enforced by the writer (form-now; no DB CHECK so the
    -- reserved org path stays open without over-constraining the animal-only MVP).
    seller_user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    buyer_user_id          UUID REFERENCES users(id) ON DELETE SET NULL,
    seller_organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    buyer_organization_id  UUID REFERENCES organizations(id) ON DELETE SET NULL,
    -- Anchor + lifecycle (spec 18 §4 state machine).
    anchor_type            VARCHAR(20) NOT NULL,
    ownership_transfer_id  UUID REFERENCES ownership_transfers(id) ON DELETE SET NULL, -- set when anchor='TRANSFER'
    status                 VARCHAR(24) NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    -- markSold buyer-nomination — RESERVED form-now (ADR-0038 §4 item 3); the counter-confirmation path
    -- (behind feature_toggles.sale_buyer_confirmation) sets & confirms it without a schema change.
    nominated_buyer_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    seller_confirmed_at    TIMESTAMP WITH TIME ZONE, -- markSold / transfer-complete time (asserting side)
    buyer_confirmed_at     TIMESTAMP WITH TIME ZONE, -- buyer counter-confirm (auto-set on the TRANSFER anchor)
    confirmed_at           TIMESTAMP WITH TIME ZONE, -- set once status→CONFIRMED (both acked)
    expires_at             TIMESTAMP WITH TIME ZONE, -- PENDING_CONFIRMATION timeout horizon (markSold path)
    -- Reserved deal fact (owner decision 2026-07-09, ADR-0038 Open-Q1): nullable, OFF-record default —
    -- NO code path writes it in this slice. Capture behaviour decided with finance + legal at payments activation.
    amount_minor           BIGINT,
    -- Actor snapshot (ADR-0006/0011) — WHO produced this state, as-of-the-action (not joined-now).
    actor_id               UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type   VARCHAR(10) NOT NULL DEFAULT 'HUMAN',
    created_at             TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), -- append-only; no updated_at
    -- Named constraints (drift-gate: avoid auto-generated names that diverge schema↔migration; 0026 lesson).
    -- Widen-additively: a later migration extends offering_type's IN(...) when a subtype ships.
    CONSTRAINT chk_confirmed_sales_offering_type CHECK (offering_type IN ('ANIMAL_LISTING')),
    CONSTRAINT chk_confirmed_sales_market        CHECK (market IN ('pet','livestock')),
    CONSTRAINT chk_confirmed_sales_anchor        CHECK (anchor_type IN ('TRANSFER','LISTING_MARK_SOLD')),
    CONSTRAINT chk_confirmed_sales_status        CHECK (status IN
        ('PENDING_CONFIRMATION','CONFIRMED','DISPUTED','EXPIRED','CANCELLED')),
    CONSTRAINT chk_confirmed_sales_actor_ptype   CHECK (actor_principal_type IN ('HUMAN','AGENT')),
    -- One confirmed sale per anchored transfer (mirror of ownership_transfers INV-4). NULLs are distinct
    -- in Postgres, so the markSold path (ownership_transfer_id NULL) is unconstrained by this — correct.
    CONSTRAINT uq_confirmed_sales_transfer       UNIQUE (ownership_transfer_id)
);

COMMENT ON TABLE confirmed_sales IS
  'ADR-0038: first-class, append-only record-of-truth that a real deal happened (proof-of-transaction root for reputation, ADR-0039). Anchored to a COMPLETED ownership_transfers (auto-CONFIRMED, in-tx) or a listing markSold (buyer counter-confirm, deferred behind sale_buyer_confirmation). Immutable (trg_confirmed_sales_immutable). Derived market cached (ADR-0018/0033). DORMANT capture in MVP — no consumer, no endpoint reads it.';
COMMENT ON COLUMN confirmed_sales.offering_id IS
  'ADR-0038 §2: polymorphic offering-instance pointer (migration 0032 dialect). NULL for a pure TRANSFER anchor (no listing); == listing_id for the markSold path. No FK — polymorphic target.';
COMMENT ON COLUMN confirmed_sales.market IS
  'ADR-0018/0033 discipline: DERIVED market (species.market via the animal), cached at capture, ADR-0002 hard split. Never re-derived on read.';
-- Guarded (migration 0041 §A drops confirmed_sales.nominated_buyer_user_id): on a canon-first replay
-- (database_schema.sql is post-0041, so CREATE TABLE IF NOT EXISTS above is a no-op and the column is
-- absent) → skip; on the historical incremental path the column exists here → COMMENT exactly as before.
-- Dollar-quoted EXECUTE body ($q$) so the comment's own single quotes need no doubling. Idempotent.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'confirmed_sales'
               AND column_name = 'nominated_buyer_user_id') THEN
    EXECUTE $q$
COMMENT ON COLUMN confirmed_sales.nominated_buyer_user_id IS
  'ADR-0038 §4 item 3: RESERVED form-now for the listing markSold buyer-nomination; the counter-confirmation flow (feature_toggles.sale_buyer_confirmation) uses it without a schema change. Unused by the transfer path.'
$q$;
  END IF;
END $do$;
COMMENT ON COLUMN confirmed_sales.amount_minor IS
  'ADR-0038 Open-Q1 (owner 2026-07-09): RESERVED nullable, OFF-record default — NO code path writes it. Capture behaviour decided with finance + legal at payments activation (never monetises reputation).';
COMMENT ON COLUMN confirmed_sales.actor_id IS
  'ADR-0006/0011 actor snapshot: WHO produced this state. For the TRANSFER anchor = the responding (accepting) user; actor_principal_type carries HUMAN|AGENT as-of-the-action.';

CREATE INDEX IF NOT EXISTS idx_confirmed_sales_subject      ON confirmed_sales(offering_type, offering_id);
CREATE INDEX IF NOT EXISTS idx_confirmed_sales_parties      ON confirmed_sales(seller_user_id, buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_confirmed_sales_animal       ON confirmed_sales(animal_id);
-- Scan support for the (deferred) confirmation-expiry sweeper — mirrors idx_listings_escalation_scan.
-- Guarded (migration 0041 §A drops confirmed_sales.expires_at and this index): absent on a canon-first
-- replay → skip; present on the historical incremental path → create exactly as before. Idempotent.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'confirmed_sales'
               AND column_name = 'expires_at') THEN
    EXECUTE $q$
CREATE INDEX IF NOT EXISTS idx_confirmed_sales_confirm_scan ON confirmed_sales(expires_at)
    WHERE status = 'PENDING_CONFIRMATION'
$q$;
  END IF;
END $do$;

-- Append-only immutability — REUSE the shared trigger function (ADR-0038 §5; do NOT invent a second path).
-- Same discipline as consents / moderation_decisions. Idempotent (DROP IF EXISTS).
DROP TRIGGER IF EXISTS trg_confirmed_sales_immutable ON confirmed_sales;
CREATE TRIGGER trg_confirmed_sales_immutable
BEFORE UPDATE OR DELETE ON confirmed_sales
FOR EACH ROW EXECUTE FUNCTION trg_block_modify_append_only();

-- ----- §B gate form: sale_buyer_confirmation (OFF in MVP) ------------------------------------------
-- The listing markSold buyer-counter-confirmation flow (spec 18 §4 LISTING_MARK_SOLD anchor). FORM now,
-- behaviour deferred — same shape as payments / ownership_transfer_verification. `reputation_reviews`
-- (the review authoring/read gate) is seeded by the reviews slice (ADR-0039), NOT here.
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('sale_buyer_confirmation',
        'Гейт подтверждения сделки покупателем на пути listing markSold (ADR-0038 §4, spec 18 §4 anchor=LISTING_MARK_SOLD): продавец отмечает продано + номинирует покупателя → PENDING_CONFIRMATION → покупатель подтверждает → CONFIRMED. Форма заведена, поведение отложено — в MVP ВЫКЛЮЧЕНО (пассивно пишутся только авто-CONFIRMED строки с пути передачи владения).',
        FALSE, 0)
ON CONFLICT (key) DO NOTHING;

COMMIT;
