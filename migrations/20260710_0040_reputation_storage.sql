-- Migration 0040 — reputation storage model: dormant reviews + reputation_aggregates (ADR-0039, reputation FORM-slice #2).
--
-- ============================================================================
-- ЧТО:
--   §A  New table `reviews` — an APPEND-ONLY, one-CURRENT-per-(sale,direction) rating+text authored by one
--       party of a CONFIRMED sale about the other (ADR-0039 §3; spec 18 §3.2). Structural pins over the
--       spec sketch (ADR-0039 §7):
--         · FK `confirmed_sale_id` → confirmed_sales(id) ON DELETE CASCADE — the proof-of-transaction root
--           (ADR-0038); no confirmed sale ⇒ no review.
--         · monotonic `seq BIGINT GENERATED ALWAYS AS IDENTITY` — the fail-SAFE "current/supersede" order
--           (mig 0036 lesson): resolve current-per-(sale,direction) and supersession by seq DESC, NEVER by
--           created_at (two same-µs rows tie-broken on a random UUID is the fail-OPEN bug mig 0036 fixed for
--           consents). GENERATED ALWAYS = never app-written → N-1-safe.
--         · `is_visible BOOLEAN DEFAULT FALSE` — the double-blind release gate (fork 2); flips on release.
--         · `moderation_status` (PENDING/APPROVED/REJECTED/CHANGES_REQUESTED — spec §3.2 / ADR-0040 §2):
--           the body is moderated like listing content.
--         · three facet columns (`facet_description_accuracy`, `facet_communication`, `facet_as_described`)
--           nullable + DORMANT (fork 5) — reserved so a later facet phase needs no schema change; NO facet
--           behaviour is built (the scale is decided in that phase → no CHECK constrains a reserved column).
--         · `market` VARCHAR(9) NOT NULL CHECK pet|livestock — copied from the sale's derived market (ADR-0002
--           hard split, ADR-0018/0033 discipline).
--         · `reviewer_user_id` FK ON DELETE SET NULL — pseudonymise-author-keep-rating on erasure (fork 8,
--           legal-gated; §4). `subject_user_id` FK ON DELETE SET NULL likewise. Both NULLABLE (the spec
--           sketch's `NOT NULL … ON DELETE SET NULL` is self-contradictory — SET NULL requires nullable; the
--           ADR §7 ON DELETE SET NULL pin wins, mirroring confirmed_sales' party FKs exactly).
--         · actor-snapshot pair `actor_id` + `actor_principal_type` HUMAN|AGENT (ADR-0006/0011) — an AGENT
--           reviewer is a reserved/gated future case (ADR-0040 §3 — authoring stays OFF).
--         · append-only via the REUSED `trg_block_modify_append_only` trigger (do NOT invent a 2nd path;
--           mirrors consents / moderation_decisions / confirmed_sales).
--         · ONE-CURRENT-per-(sale,direction) = a PARTIAL UNIQUE index on the head rows
--           `WHERE superseded_by_id IS NULL` (the transfer INV-4 shape) — see the design note below.
--   §B  New table `reputation_aggregates` — the DERIVED per-(subject, market) rating cache (ADR-0039 §1/§2;
--       spec §3.3). PK (subject_user_id, market) = the ADR-0002 boundary structurally. `rating_avg` is a
--       Postgres GENERATED ALWAYS … STORED column = ROUND(rating_sum::numeric / NULLIF(review_count,0), 2):
--       structurally "recompute-only, never hand-written" (ADR-0039 §1 driver 3 / fork 7 / TP-8) — a stronger
--       guarantee than a code comment. NOT append-only (it is a recomputed cache; the recompute path UPDATEs
--       review_count/rating_sum and the generated avg follows). Star histogram dist_1..dist_5. The ADR-0040 §1
--       per-author weighting hook is NOT a column now — it is additive (added when fraud data justifies it).
--   §C  `consents.consent_type` CHECK widened additively with `REVIEW_PUBLICATION` — the reserved consent-of-
--       record for publishing a review (ADR-0039 §4 / spec §9): reuse the existing consents model, do NOT
--       invent a second consent store. The auto-named 0029 check is replaced by the stable named
--       `chk_consents_consent_type` (drift-gate; mig 0026/0030 lesson). NO consents rows are written here.
--   §D  Seed `feature_toggles.reputation_reviews` = OFF/0% — the master gate for review authoring/read/display
--       + (with legal sign-off) the §4 erasure behaviour (same shape as sale_buyer_confirmation / payments).
--
-- ПОЧЕМУ:
--   AUDIT4 P3-1: the built marketplace captures none of the value it creates — no confirmed-sale signal, no
--   reputation, so a buyer bears 100% of scam risk on the highest-anxiety purchase (a living creature) with
--   nothing to judge a stranger by. ADR-0038 (mig 0039) captured the confirmed-sale record of truth; this
--   slice lays the DORMANT storage the reviews/reputation loop hangs off. FORM-first / behaviour-gated (the
--   proven pattern: dormant user_roles mig 0034, signal-first view_count mig 0031).
--
-- ПОЧЕМУ ТАК ЛУЧШЕ для проекта:
--   The structure is cheapest to lay now and must not change MVP behaviour: tables present + EMPTY, no
--   endpoints, no recompute, no consumer → byte-identical HUMAN behaviour. The migration-0036 fail-open lesson
--   is pinned structurally (reviews resolve on `seq`, not a tie-breakable timestamp); the GENERATED rating_avg
--   makes a forgeable/purchasable score IMPOSSIBLE by construction; the per-(subject,market) PK makes the
--   ADR-0002 cross-market leak impossible. Named constraints avoid schema↔migration drift (mig 0026 lesson).
--   All additive/nullable/GENERATED-ALWAYS → N-1 rolling-deploy safe.
--
-- DESIGN NOTE — "one CURRENT per (sale, direction)" (task asks: partial-unique honestly, w/ supersede rows):
--   Chosen = PARTIAL UNIQUE `uq_reviews_current_per_direction (confirmed_sale_id, direction) WHERE
--   superseded_by_id IS NULL` — the transfer INV-4 shape (`UNIQUE(animal_id) WHERE status='PENDING'`). It
--   enforces exactly ONE head (current) review per (sale, direction) while allowing unlimited superseded
--   history rows. The spec sketch's plain `UNIQUE(confirmed_sale_id, direction, superseded_by_id)` is
--   INEFFECTIVE at this — Postgres treats NULLs as DISTINCT, so two head rows (both superseded_by_id NULL)
--   would NOT collide; the partial index is the honest enforcement.
--   ⚠ FLAG to architect / the behaviour slice (mirrors the confirmed_sales markSold-transition flag, mig
--   0039): the ADR/spec-named FORWARD pointer `superseded_by_id` conflicts with the reused append-only
--   trigger — marking a predecessor superseded needs an UPDATE the trigger blocks. The behaviour slice must
--   pick one resolution: (i) resolve "current" purely by `seq DESC` (à la consents — no superseded write; then
--   drop this partial-unique), or (ii) invert to a BACKWARD `supersedes_review_id` pointer set at INSERT (à la
--   moderation_decisions.supersedes_decision_id) with `UNIQUE(supersedes_review_id)`. This FORM slice ships
--   the ADR-named column + the correct-and-INERT head partial-unique (zero rows today; a future transfer-anchor
--   auto-review writes exactly one head per direction → the constraint holds, no supersession exercised).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS + named constraints + CREATE INDEX IF NOT EXISTS + DROP TRIGGER IF
-- EXISTS + DROP CONSTRAINT IF EXISTS…ADD + INSERT … ON CONFLICT DO NOTHING. Validated on live PostgreSQL (run
-- TWICE — second run is a clean no-op). Every invariant has an AUTOMATED negative test in
-- `backend/test/reputation-storage.e2e-spec.ts` (describe "negative invariants (m2/m3)"): reviews append-only
-- UPDATE+DELETE, head partial-unique, FK confirmed_sale_id, every named CHECK (direction/market/rating 0&6/
-- moderation_status/actor_ptype), GENERATED seq rejects a direct value; reputation_aggregates PK duplicate,
-- GENERATED rating_avg rejects a direct value + derives correctly, nonneg CHECK, market CHECK, and a positive
-- control that the cache IS mutable (not append-only). tables +2 → 41.
-- ============================================================================

BEGIN;

-- ----- §A reviews -----------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Proof-of-transaction root: no confirmed sale ⇒ no review (ADR-0038/0039 hard invariant). CASCADE so a
    -- (test-only) sale delete removes its reviews; in prod sales are append-only and never deleted.
    confirmed_sale_id UUID NOT NULL REFERENCES confirmed_sales(id) ON DELETE CASCADE,
    direction         VARCHAR(16) NOT NULL,           -- BUYER_ON_SELLER | SELLER_ON_BUYER
    -- Parties. ON DELETE SET NULL = ФЗ-152 pseudonymise-author-keep-rating (fork 8, legal-gated; §4). NULLABLE
    -- (the sketch's NOT NULL is incompatible with SET NULL — the ADR §7 ON DELETE SET NULL pin wins).
    reviewer_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
    subject_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    market            VARCHAR(9) NOT NULL,            -- copied from the sale's derived market (ADR-0002)
    rating            SMALLINT NOT NULL,              -- 1..5 (chk_reviews_rating)
    body              TEXT,                           -- optional free text; moderated like listing content
    moderation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    is_visible        BOOLEAN NOT NULL DEFAULT FALSE, -- double-blind gate (fork 2); flips on release
    -- Edit-within-grace = a new superseding row (fork 3). Forward pointer per ADR/spec name; see DESIGN NOTE.
    superseded_by_id  UUID REFERENCES reviews(id) ON DELETE SET NULL,
    -- Reserved DORMANT facet columns (fork 5) — no facet behaviour is built; scale decided in the facet phase.
    facet_description_accuracy SMALLINT,
    facet_communication        SMALLINT,
    facet_as_described         SMALLINT,
    -- Actor snapshot (ADR-0006/0011) — WHO authored the row, as-of-the-action. For a human review == reviewer.
    actor_id             UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN',
    -- Monotonic, DB-assigned "current/supersede" order (mig 0036 lesson) — resolve current by seq DESC, NEVER
    -- created_at. GENERATED ALWAYS = never app-written → N-1 safe.
    seq               BIGINT GENERATED ALWAYS AS IDENTITY,
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), -- append-only; no updated_at
    -- Named constraints (drift-gate; widen direction/moderation_status additively if behaviour needs).
    CONSTRAINT chk_reviews_direction         CHECK (direction IN ('BUYER_ON_SELLER','SELLER_ON_BUYER')),
    CONSTRAINT chk_reviews_market            CHECK (market IN ('pet','livestock')),
    CONSTRAINT chk_reviews_rating            CHECK (rating BETWEEN 1 AND 5),
    CONSTRAINT chk_reviews_moderation_status CHECK (moderation_status IN
        ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED')),
    CONSTRAINT chk_reviews_actor_ptype       CHECK (actor_principal_type IN ('HUMAN','AGENT'))
);

COMMENT ON TABLE reviews IS
  'ADR-0039: append-only, one-current-per-(sale,direction) proof-of-transaction review (rating 1..5 + optional body). Current/supersede resolve on seq DESC (mig 0036 lesson), NOT created_at. Double-blind is_visible gate (fork 2). Immutable (trg_reviews_immutable, reused). Facet columns reserved DORMANT (fork 5). Party FKs ON DELETE SET NULL (ФЗ-152 pseudonymise, fork 8/legal-gated). DORMANT in MVP — no endpoints, behaviour behind feature_toggles.reputation_reviews.';
COMMENT ON COLUMN reviews.seq IS
  'ADR-0039 §3 / mig 0036 lesson: monotonic DB-assigned order. Resolve current-per-(sale,direction) and supersession by seq DESC — the fail-SAFE causal order, never a tie-breakable created_at. GENERATED ALWAYS = never app-written.';
COMMENT ON COLUMN reviews.superseded_by_id IS
  'ADR-0039 §3 forward supersede pointer (edit = new row within 72h grace, fork 3). See migration 0040 DESIGN NOTE: conflicts with the append-only trigger (marking a predecessor needs a blocked UPDATE) — the behaviour slice picks seq-DESC resolution OR a backward supersedes_review_id pointer. FORM slice ships the head partial-unique only.';
COMMENT ON COLUMN reviews.facet_description_accuracy IS
  'ADR-0039 §3 fork 5: RESERVED DORMANT facet column — no facet behaviour built; the scale is decided in the later facet phase (hence no CHECK now). Reserved so that phase needs no schema change.';

-- One CURRENT (head) review per (sale, direction) — transfer INV-4 shape; NULLs-distinct makes a plain
-- 3-col UNIQUE ineffective (see DESIGN NOTE), so a partial unique index on the heads is the honest form.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reviews_current_per_direction
    ON reviews(confirmed_sale_id, direction) WHERE superseded_by_id IS NULL;
-- Trust-read support (spec §3.2): visible+approved current reviews for a subject in a market.
CREATE INDEX IF NOT EXISTS idx_reviews_subject_market ON reviews(subject_user_id, market)
    WHERE moderation_status = 'APPROVED' AND is_visible = TRUE AND superseded_by_id IS NULL;
-- Monotonic ordered-lookup for "current review per (sale, direction)" by seq DESC (mig 0036 idiom).
CREATE INDEX IF NOT EXISTS idx_reviews_current_seq ON reviews(confirmed_sale_id, direction, seq DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_agent_actor ON reviews(actor_principal_type) WHERE actor_principal_type = 'AGENT';

-- Append-only immutability — REUSE the shared trigger function (ADR-0039 §3; do NOT invent a second path).
DROP TRIGGER IF EXISTS trg_reviews_immutable ON reviews;
CREATE TRIGGER trg_reviews_immutable
BEFORE UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION trg_block_modify_append_only();

-- ----- §B reputation_aggregates ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reputation_aggregates (
    subject_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    market          VARCHAR(9) NOT NULL,             -- per-market, ADR-0002 (the PK is the boundary)
    review_count    INTEGER NOT NULL DEFAULT 0,
    rating_sum      INTEGER NOT NULL DEFAULT 0,
    -- DERIVED, recompute-only, NEVER hand-written (ADR-0039 §1 driver 3 / fork 7 / TP-8). A Postgres GENERATED
    -- STORED column structurally forbids a direct write (Postgres rejects a non-DEFAULT value) — stronger than
    -- a comment. NULL when there are no reviews (NULLIF(count,0) → NULL), not a misleading 0.
    rating_avg      NUMERIC(3,2) GENERATED ALWAYS AS (ROUND(rating_sum::numeric / NULLIF(review_count, 0), 2)) STORED,
    dist_1          INTEGER NOT NULL DEFAULT 0,      -- star histogram (spec §3.3)
    dist_2          INTEGER NOT NULL DEFAULT 0,
    dist_3          INTEGER NOT NULL DEFAULT 0,
    dist_4          INTEGER NOT NULL DEFAULT 0,
    dist_5          INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    recomputed_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(), -- bumped by the recompute path (mutable cache)
    CONSTRAINT pk_reputation_aggregates PRIMARY KEY (subject_user_id, market),
    CONSTRAINT chk_reputation_aggregates_market CHECK (market IN ('pet','livestock')),
    CONSTRAINT chk_reputation_aggregates_nonneg CHECK
        (review_count >= 0 AND rating_sum >= 0 AND dist_1 >= 0 AND dist_2 >= 0 AND dist_3 >= 0 AND dist_4 >= 0 AND dist_5 >= 0)
);

COMMENT ON TABLE reputation_aggregates IS
  'ADR-0039 §1/§2: DERIVED per-(subject, market) rating cache (count/sum/avg/histogram), incrementally recomputed on the review-state event path (O(Δ)), read as a single indexed PK lookup (< 50ms). NOT append-only (a recomputed cache). PK (subject_user_id, market) = the ADR-0002 boundary. rating_avg is a GENERATED column — recompute-only, never hand-written (fork 7 / TP-8). DORMANT in MVP — no recompute path wired, behaviour behind feature_toggles.reputation_reviews.';
COMMENT ON COLUMN reputation_aggregates.rating_avg IS
  'ADR-0039 §1 driver 3 / fork 7: GENERATED ALWAYS AS ROUND(rating_sum::numeric / NULLIF(review_count,0),2) STORED — a purchasable/forgeable score is structurally impossible (a direct write is rejected by Postgres). NULL when review_count = 0.';

-- ----- §C consents.consent_type — reserve REVIEW_PUBLICATION (ADR-0039 §4; reuse the consents model) -------
-- Widen additively; a widened CHECK never rejects existing rows (old set ⊂ new set) and no code writes the new
-- value yet → N-1 safe. Replace the auto-named 0029 check with the stable named constraint (drift-gate).
ALTER TABLE consents DROP CONSTRAINT IF EXISTS consents_consent_type_check;
ALTER TABLE consents DROP CONSTRAINT IF EXISTS chk_consents_consent_type;
ALTER TABLE consents ADD CONSTRAINT chk_consents_consent_type CHECK (consent_type IN
    ('CONTACT_DISTRIBUTION','MARKETING','ANALYTICS_PROFILING','NONESSENTIAL_COOKIES','REVIEW_PUBLICATION'));

-- ----- §D gate form: reputation_reviews (OFF in MVP) -----------------------------------------------
-- The review authoring/read/display gate (+ §4 erasure behaviour, additionally legal-gated). FORM now,
-- behaviour deferred — same shape as payments / sale_buyer_confirmation.
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('reputation_reviews',
        'Гейт репутации/отзывов (ADR-0039): авторство и чтение отзывов, double-blind раскрытие, отображение агрегата репутации, поведение стирания (§4, дополнительно под юридическим одобрением). Таблицы reviews/reputation_aggregates заведены спящими; в MVP ВЫКЛЮЧЕНО — эндпоинтов нет, пересчёта нет, поведение людей байт-в-байт прежнее.',
        FALSE, 0)
ON CONFLICT (key) DO NOTHING;

COMMIT;
