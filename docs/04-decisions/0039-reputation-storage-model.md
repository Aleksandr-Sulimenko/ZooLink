# ADR-0039: Reputation storage model — materialised per-(subject, market) aggregate over append-only reviews; erasure keeps the rating

**Status**: Accepted (owner, 2026-07-09 — section-by-section review; Open Q1 direction fixed per recommendation, legal sign-off still gates the behaviour). **Amended 2026-08-04 (AUDIT5 gate-pass — §3 Amendment below): forward `superseded_by_id` → backward `supersedes_review_id` + `reviews_current` view; mutable `moderation_status`/`is_visible` moved to the companion `review_states` (β) (migration 0041).**
**Date**: 2026-07-09
**Builds on**: [ADR-0038](0038-confirmed-sale-record-of-truth.md) (the confirmed-sale record every review must reference — proof-of-transaction), [ADR-0002](0002-hard-split-markets.md) (per-market scope — the two reputations never mix), [ADR-0020](0020-versioned-consent-record-model.md) (the append-only `consents` model reused for review-publication consent, and the `seq` monotonic-order lesson, migration 0036), [ADR-0021](0021-first-outbox-consumer-notification-path.md) (transactional-outbox the `Review.*` events ride).
**Related**: [ADR-0006](0006-ai-agents-operate-platform.md)/[ADR-0011](0011-agent-principal-actor-model.md) (actor-snapshot + append-only discipline; ст.16 ФЗ-152 if an agent ever moderates), [ADR-0012](0012-pii-at-rest-encryption.md)/[ADR-0019](0019-pii-at-rest-form-enforcement.md) (PII-at-rest; a review is dual personal data), [ADR-0040](0040-reputation-trust-integrity-governance.md) (who may create/adjudicate reviews — the governance layer).
**Source**: spec `docs/specs/18-reputation.md` §12 items 2, 3, 8, 9 (`Review.*` half) — routed to architect; AUDIT4 **P3-1**. Owner business forks §13 (2026-07-09) are normative inputs: fork 2 (double-blind), fork 3 (90-day window / 72-hour edit grace), fork 5 (1–5 stars + text, facet columns form-now), fork 6 (per-market display over single identity), fork 8 (pseudonymise-author-keep-rating, legal-gated).

---

## Context and Problem Statement

[ADR-0038](0038-confirmed-sale-record-of-truth.md) fixes the **record of truth** (the confirmed sale). This ADR decides the second structural cluster from spec §12 — **how the review data and the derived reputation are stored, computed, scoped, and retained**:

- **§12.2 — aggregate storage / recompute strategy.** Materialised table (the spec §3.3 sketch) vs on-read aggregation vs event-sourced projection. A read-performance / consistency choice.
- **§12.3 — cross-market reputation model.** One identity carrying per-market scores vs fully separate reputations. Shapes the aggregate PK and the display contract (ADR-0002 boundary).
- **§12.8 — erasure policy for reviews (ФЗ-152).** On `eraseUser`, pseudonymise the author and keep the rating, vs full removal. A retention/lawfulness decision that directly affects whether the aggregate is recomputed downward on erasure.
- **§12.9 (`Review.*` half) — event-catalog additions.** `Review.{Submitted,Released}` — emitted by the reviews entity (the `ConfirmedSale.*` half is in [ADR-0038](0038-confirmed-sale-record-of-truth.md) §3).

The **review behaviour** is owner-fixed (§13): append-only 1–5 stars + optional text with reserved facet columns form-now (fork 5); **double-blind release** (fork 2); a **90-day** submission window and **72-hour** edit grace, edit = superseding row (fork 3); per-market aggregates over a single identity (fork 6); pseudonymise-author-keep-rating on erasure, legal-gated (fork 8). This ADR decides the **storage structure** that realises those, not the behaviour.

## Decision Drivers

1. **Read performance at trust-read time (spec NFR §7).** `GET /users/{id}/reputation?market=…` is on the trust-decision hot path (a buyer judging a stranger before a high-anxiety live-animal purchase) — it must be a single indexed read (< 50 ms p95), never a live aggregation. Highest driver.
2. **Two markets never mix (ADR-0002).** A pet score and a livestock score are computed and displayed **separately**; a livestock review must never move the pet aggregate. Structural, not cosmetic.
3. **Derived, never asserted (spec §Constraints, psychologist TP-8).** The aggregate is a pure function of visible+approved reviews; **never** hand-written, **never** purchasable — a paid "trust cue" is a dark pattern (fork 7).
4. **Append-only + actor-snapshot + monotonic order (ADR-0011, ADR-0020 migration-0036 lesson).** Reviews are append-only (edit = superseding row); resolving "current review per (sale, direction)" must be a **total, causal order**, not a tie-breakable timestamp (the exact fail-open bug fixed for `consents` by `seq`, migration 0036).
5. **ФЗ-152 dual data subject (spec §9).** A review is simultaneously the reviewer's PII and personal data about the rated subject; erasure and legal-basis must be first-class, not bolted on.
6. **Correctness of the aggregate under change (spec §5.4).** Recompute must be incremental (O(Δ), not O(all reviews)) and idempotent, driven by the event path — never lazy-on-read (the F4 residual-defect trap).
7. **Dormant-form-first / no MVP behaviour change (ADR-0022, migration 0034).** Tables + trigger ship dormant; authoring/reading is behind `feature_toggles.reputation_reviews`.

---

## §1 — Aggregate storage & recompute: materialised per-(subject, market) cache, incrementally recomputed (§12.2)

**Considered options**

### Option 1: On-read aggregation (compute `AVG(rating)` live per request)
No aggregate table; `GET reputation` runs `SELECT AVG(rating), COUNT(*) … WHERE subject=… AND market=… AND visible AND approved`.

Pros:
- Zero denormalised state; always exactly consistent with `reviews`; no recompute path.

Cons:
- The **trust-read hot path becomes an aggregation scan** over all of a subject's reviews on every read — fails the < 50 ms NFR as a popular seller accrues reviews; the read cost grows unbounded with reputation. Rejected (driver 1).

### Option 2: Event-sourced projection (rebuild reputation from a `Review.*` event stream)
Reputation is a projection materialised from the event log.

Pros:
- Full auditability of every reputation change; replayable.

Cons:
- **Over-engineered for MVP-era volume** — a whole projection-rebuild subsystem before there is any scale to justify it; the platform has one outbox, not an event-store. The append-only `reviews` table + actor-snapshot already gives the audit trail. Reserve as a Phase-2 scale evolution, not now. Rejected for MVP.

### Option 3: Materialised per-(subject, market) aggregate table, incrementally recomputed on the event path (Chosen)
A `reputation_aggregates` row per `(subject_user_id, market)` holding `review_count`, `rating_sum`, `rating_avg` (derived = sum/count), and a `dist_1..dist_5` histogram (spec §3.3). Recomputed **incrementally** (O(Δ)) whenever a review becomes / ceases to be visible+approved — driven by the review-state event path, never on read. `GET reputation` is a single PK read.

Pros:
- The trust read is a single indexed PK lookup (< 50 ms) that never scans `reviews` (driver 1).
- The histogram + sum make recompute O(Δ), not O(all reviews) (driver 6).
- One bounded row per (user, market) — trivially per-market scoped (driver 2), the PK *is* the ADR-0002 boundary (§2).
- `rating_avg` is a **derived** column, never hand-written — enforced by "recompute only" (driver 3); no path writes it directly.

Cons:
- A denormalised cache that must be kept correct by the recompute path (mitigated: incremental, idempotent, event-driven, with a recompute-from-source repair job for drift).

**Decision:** **Option 3** — a **materialised `reputation_aggregates` table**, one row per `(subject_user_id, market)`, **incrementally recomputed on the review-state event path**, never on read, never hand-written. On-read aggregation and event-sourcing are rejected for MVP (event-sourcing reserved as the Phase-2 scale evolution behind this seam).

**ЧТО:** Reputation is a materialised per-(subject, market) aggregate (count/sum/avg/histogram), recomputed incrementally (O(Δ)) on the review-state event path and read as a single indexed PK lookup; `rating_avg` is derived and never written directly.
**ПОЧЕМУ:** The trust read is a hot, latency-sensitive decision surface that must not scan a subject's whole review history; the aggregate must stay a pure, tamper-proof function of visible+approved reviews.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** A single-row read keeps the trust surface fast as reputation grows (unbounded on-read cost avoided); incremental histogram-based recompute is O(Δ) and idempotent (correctness on the event path, not lazy-on-read — dodges the F4 trap); "recompute only" makes a purchasable/forgeable score structurally impossible (fork 7, TP-8); the bounded per-(user,market) row *is* the ADR-0002 separation. Alternatives rejected: on-read aggregation (unbounded hot-path cost); event-sourced projection (a subsystem with no MVP-scale justification — reserved for Phase 2).

---

## §2 — Cross-market model: per-market aggregates over one underlying identity (§12.3)

Owner fork 6 fixes the **product direction** (per-market display over a single identity); this ADR fixes the **structural realisation**.

**Considered options**

### Option 1: Fully separate reputation identities per market
A pet reputation and a livestock reputation are distinct subjects (e.g. separate profile rows / separate subject IDs).

Cons:
- Fragments one human's identity — breaks account linkage, erasure, and the single `users` row; a user would have two disconnected trust profiles to manage and moderate. Over-separates. Rejected (contradicts single-identity; fork 6 says *one underlying identity*).

### Option 2: One global reputation across both markets
A single `rating_avg` per user, all markets pooled.

Cons:
- **Cross-market leak** — a livestock breeder's score bleeds into the pet buyer's judgement, the exact ADR-0002 mental-separation violation. A pet buyer must never read a livestock score as if it were relevant. Rejected (violates driver 2 / ADR-0002 / fork 6).

### Option 3: One identity, per-market aggregate rows; per-market read enforced (Chosen — realises fork 6)
The subject is the single `users` row; `reputation_aggregates` PK is `(subject_user_id, market)` — one aggregate row per market. `reviews.market` is copied from the sale (ADR-0038 derived market). Every reputation/review read **requires an explicit `?market=`** (omission → `MARKET_REQUIRED` 422, spec §6); a market's read returns only that market's aggregate and reviews. Recompute is market-partitioned (a livestock review only touches the livestock aggregate — spec §5.4).

Pros:
- Single human identity preserved (account, erasure, moderation all operate on the one `users` row) — fork 6 exactly.
- Structural ADR-0002 separation: the PK partitions by market; a cross-market read is impossible without asking for the other market explicitly.
- Forced `?market=` makes the separation a **contract-level** guarantee, not a UI convention.

Cons:
- A user active in both markets has two aggregate rows and two scores to reason about — accepted; that *is* the intended mental model (two markets, two reputations, one person).

**Decision:** **Option 3** — **one underlying `users` identity, per-market `reputation_aggregates` rows keyed `(subject_user_id, market)`**, with `?market=` required on every reputation/review read. Realises fork 6 and enforces ADR-0002 structurally.

**ЧТО:** The aggregate PK is `(subject_user_id, market)` over the single `users` identity; reviews carry the sale's derived `market`; every reputation/review read requires an explicit market (omission = `MARKET_REQUIRED`); recompute is market-partitioned.
**ПОЧЕМУ:** Owner fork 6 wants one identity but per-market scores; ADR-0002 forbids a pet buyer ever seeing a livestock score bleed in — the separation must be structural, not cosmetic.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Keying the aggregate by `(user, market)` makes cross-market leakage impossible by construction while preserving the single human identity (one account/erasure/moderation target); the required `?market=` lifts ADR-0002 from a UI habit to a contract guarantee; market-partitioned recompute keeps the two scores independent. Alternatives rejected: separate identities (fragments the human, breaks erasure/linkage); one global score (the ADR-0002 cross-market leak).

---

## §3 — Review entity: append-only, monotonic-ordered, double-blind, windowed (realises forks 2, 3, 5)

The review *behaviour* is owner-fixed; this section pins the **structure** that carries it, and applies the migration-0036 monotonic-order lesson.

**Decision (normative):**
- **Append-only, one *current* per (sale, direction).** `reviews` is append-only (reuse `trg_block_modify_append_only`). An edit within the 72-hour grace (fork 3) is a **new superseding row** (`superseded_by_id`), never an UPDATE — mirroring `consents`/`moderation_decisions`.
- **Monotonic order, not timestamp tie-break (ADR-0020 / migration 0036 lesson).** "The current review for (sale, direction)" and "supersession order" resolve on a **strictly-increasing DB-assigned `seq`** (`GENERATED ALWAYS AS IDENTITY`), **not** `created_at` (two same-µs rows tie-broken on a random UUID is the fail-open bug migration 0036 fixed for `consents`). This is a **standing structural requirement** for every append-only "latest wins" table on the platform.
- **Double-blind release (fork 2).** `is_visible` defaults FALSE; both parties' approved reviews flip visible together when both submit **or** the window closes — the release is a scheduler/event action (spec §5.3), never lazy-on-read.
- **Windowed (fork 3).** A 90-day submission window from CONFIRMED; a 72-hour edit grace, then immutable. Window-close and grace-elapse run on the **existing scheduler/sweeper pattern** (transfer-expiry H3, SLA-tick advisory lock) — never lazy-on-read (the F4 trap).
- **Shape (fork 5).** `rating SMALLINT 1..5` + optional `body TEXT` (moderated like listing content, ADR-0040 §2). **Facet columns reserved form-now, dormant** (description-accuracy, communication, animal-as-described) — added as nullable columns now so a later facet phase needs no schema change; **no facet UI/behaviour is built** (the dormant-form precedent).
- **Actor-snapshot (ADR-0011).** Every row carries `actor_principal_type` — an AGENT reviewer is a future/gated case governed by [ADR-0040](0040-reputation-trust-integrity-governance.md) §3.

**ЧТО:** `reviews` is append-only (edit = superseding row); "current"/supersession resolve on a monotonic `seq` (not `created_at`, per the migration-0036 lesson); double-blind `is_visible` and the 90-day/72-hour windows are scheduler/event-driven (never lazy-on-read); shape = 1–5 + optional text with dormant facet columns reserved.
**ПОЧЕМУ:** Append-only + a total causal order is the only tamper-proof, fail-safe way to resolve "latest review" (a `created_at` tie-break fails open, as migration 0036 proved for consents); the release/window timing must be deterministic and event-driven to be correct and auditable.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Reuses the platform's proven append-only trigger + actor-snapshot + monotonic-`seq` discipline (no new immutability or ordering mechanism to review) and pins the migration-0036 anti-fail-open lesson as a standing rule; scheduler-driven release/windows dodge the F4 lazy-on-read defect; reserving facet columns dormant opens the richer-review phase with no rewrite while keeping MVP to stars+text. (Forks 2/3/5 are honoured, not re-opened.)

---

## §3 Amendment (2026-08-04, AUDIT5 gate-pass m-20260804-234834) — backward supersede pointer + `reviews_current` view + mutable `review_states` companion (β)

**Status of the amendment:** Accepted (держатель gate-pass, 2026-08-04). Realised in migration 0041 (reputation-pack COMMIT-1). This pins the supersede *mechanism* and separates mutable state; it does **not** re-open §3's append-only / monotonic-order / double-blind decisions.

**What was wrong.** The FORM slice (migration 0040) shipped §3's `superseded_by_id` as a **FORWARD** pointer, which requires an UPDATE of the *older* row to mark it superseded — an UPDATE the reused append-only trigger blocks. So `superseded_by_id` could never be set → it was permanently NULL → the partial-unique `WHERE superseded_by_id IS NULL` covered **all** rows (working as a plain UNIQUE) and edit-in-grace was structurally impossible. Independently, `moderation_status` and `is_visible` are **mutable by design** (moderation transitions; scheduler double-blind release) yet also lived on the append-only `reviews` — two more unbuildable axes. (Migration 0040's own DESIGN NOTE flagged both tensions for this behaviour-slice resolution.)

**Decision (WHAT).**
- **Backward supersede pointer.** Replace the forward `superseded_by_id` with a **backward `supersedes_review_id UUID REFERENCES reviews(id) ON DELETE RESTRICT`** — the exact `moderation_decisions.supersedes_decision_id` model. The NEW (edit-in-grace) row *names its predecessor* at INSERT (it writes about *itself*), so append-only holds byte-for-byte.
- **"Current" is a DB invariant, in one named place.** `uq_reviews_supersedes (supersedes_review_id) WHERE NOT NULL` = at most one successor per predecessor → the edit chain is **LINEAR**; `uq_reviews_root_per_direction (confirmed_sale_id, direction) WHERE supersedes_review_id IS NULL` = one root chain per (sale, direction) → one head. A single **`VIEW reviews_current`** (the head = a row nothing supersedes) is the one place "current" resolves; readers query it, not a hand-rolled `NOT EXISTS`. This *preserves* "one current per (sale, direction)" as a DB invariant (Q6) rather than pushing it to the application. **Q5:** the `uq_reviews_supersedes` UNIQUE is **deliberately stricter** than `moderation_decisions` (which allows an override to branch) — a review *edit* is linear, a moderation *override* may branch; the reason is recorded as a COMMENT on the index so a future "unification" pass does not silently drop it.
- **Mutable state → companion `review_states` (β).** Move `moderation_status` + `is_visible` off `reviews` into a NEW mutable **`review_states`** (PK `review_id` FK `reviews` `ON DELETE CASCADE`, its own `updated_at` trigger). `reviews.id` stays stable (state hangs off it; reads join). Moderation and the double-blind release become the natural UPDATEs they are.

**Why (WHY).** A forward pointer and a backward pointer are not cosmetic variants under append-only — only the backward one (write-about-self) is compatible. Mutable operator/scheduler state cannot live on an immutable row. **α vs β:** the rejected α (every state change = a new superseding row) churns `reviews.id`, bloats double-blind release into a row-per-timer, and conflates an author's edit with a moderator's state move; **β** keeps a stable id and one clean pattern.

**Why better (WHY-BETTER).** β makes the canon **homogeneous**: `reviews` = fact, `review_states` = state, `moderation_decisions` = decision, `reputation_aggregates` = cache — four roles, four forms, symmetric with ADR-0038 §4 Amendment's `confirmed_sales`/`sale_confirmations`. The backward pointer + linear-chain UNIQUE + `reviews_current` view make "current" a checkable DB invariant resolved once, not re-derived per reader. All additive/guarded → N-1 safe; DORMANT → zero MVP behaviour change.

## §4 — Erasure policy: pseudonymise the author, keep the rating; legal-gated (§12.8, realises fork 8)

Owner fork 8 fixes the direction (pseudonymise-author-keep-rating); §9 flagged a **legal confirmation** still pending before the behaviour toggle flips. This ADR fixes the structure and carries the legal gate.

**Considered options**

### Option 1: Full removal on erasure (delete the review + recompute the aggregate down)
On `eraseUser`, hard-delete the reviewer's reviews; recompute aggregates downward.

Pros:
- Maximal erasure of the reviewer's authored data.

Cons:
- **Corrupts the truthful trust history of the *subject*** — a seller's earned/lost reputation silently changes because a *counterparty* erased their account; opens a griefing lever (erase to scrub a deserved 1-star). The subject's rating is *their* personal data too (dual-subject, driver 5); deleting it is not obviously required by the reviewer's erasure right. Rejected as the default (retained only if legal mandates it).

### Option 2: Pseudonymise authorship, keep the rating in the aggregate (Chosen — realises fork 8, legal-gated)
On `eraseUser`, the reviewer's authored text/identity is pseudonymised (author → "Deleted user"; `reviewer_user_id` `ON DELETE SET NULL` already supports it) while the **rating** persists so the subject's aggregate stays truthful. Free-text `body` handling (retain / redact / drop) is a sub-fork for legal (the text is more identifying than a star).

Pros:
- The subject's earned reputation stays truthful and tamper-proof; no counterparty-erasure griefing lever.
- The reviewer's *identity* is removed (pseudonymised) — the erasure right is served for the identifying data; `ON DELETE SET NULL` is already the mechanism (spec §9, ADR-0011 deactivate-not-delete family).
- Consistent with the platform's "keep the truthful append-only record, redact the person" posture (`consents`, `audit_log`).

Cons:
- Requires a **legal basis** to retain the rating (a data point about the subject authored by a now-erased person) — the ФЗ-152 legitimate-interest-of-a-trust-system argument must be confirmed by legal before the behaviour toggle flips (Open Q1). Until then, the structure is ready but dormant.

**Decision:** **Option 2** — **pseudonymise authorship, keep the rating** (fork 8), via `ON DELETE SET NULL` on `reviewer_user_id`; the free-text `body` retention/redaction is a legal sub-fork; the whole policy is **gated on legal sign-off** before `reputation_reviews` flips on. Reuse the `consents` model's `REVIEW_PUBLICATION` consent type (ADR-0020) as the consent-of-record for publishing a review — do **not** invent a second consent store.

**ЧТО:** On erasure, pseudonymise the author (`reviewer_user_id → NULL`) and keep the rating so the subject's aggregate stays truthful; free-text retention is a legal sub-fork; publication consent reuses the `consents` model (`REVIEW_PUBLICATION`); the policy is legal-gated before behaviour flips on.
**ПОЧЕМУ:** The subject's earned reputation is their own personal data and a public-good trust signal that a counterparty's erasure should not silently corrupt; the reviewer's erasure right is served by pseudonymising the identifying authorship, not by destroying the subject's truthful history — but retaining any subject-data authored by an erased person needs a confirmed ФЗ-152 legal basis.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Keeps the trust signal truthful and closes an erase-to-scrub-a-bad-review griefing lever, while still honouring erasure for the identifying data via the already-present `ON DELETE SET NULL` and the existing `consents` model (no second consent store, no new mechanism); making it legal-gated respects "surface, don't guess" on a regulatory call the architect cannot make. Alternative rejected: full removal (corrupts the subject's truthful reputation on a counterparty's action — a griefing lever, and not clearly required by the reviewer's own erasure right).

---

## §5 — Event surface: `Review.{Submitted,Released}` (§12.9, `Review.*` half)

**Decision (normative — backend-engineer owns `event-catalog.md`; listed for coordination):**
The reviews entity emits, via the transactional-outbox (ADR-0021), in-tx with the state change:

| Event | Raised when | Consumers (later) |
|---|---|---|
| `Review.Submitted` | a review row is created (or supersedes) and enters moderation | moderation queue (ADR-0040 §2), double-blind counter-check |
| `Review.Released` | `is_visible` flips TRUE (both submitted or window closed) → aggregate recompute | aggregate recompute (§1), notification, analytics |

- Aggregate recompute (§1) is triggered by `Review.Released` (and by moderation state changes) — the incremental, event-driven path, never lazy-on-read.
- No consumer is wired in this ADR (the emission contract only); consumers land with the `reputation_reviews` behaviour slice. Forward-only replay + no-purge guardrail (ADR-0021).

**ЧТО:** Define `Review.{Submitted,Released}` as transactional-outbox events; `Review.Released` drives the incremental aggregate recompute; no consumer wired here (contract only).
**ПОЧЕМУ:** The aggregate recompute and moderation/notification must be driven by durable, replayable, in-tx events — not by a read-time side effect.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Reuses the built outbox + forward-only-replay (no new event mechanism); event-driven recompute keeps the aggregate correct and O(Δ) off the hot path; keeping the contract in the ADR lets backend own `event-catalog.md` without a doc↔code inversion.

---

## §6 — Phase boundary: tables + trigger dormant, behaviour behind `reputation_reviews`

Per the dormant-form-first precedent (ADR-0022, migration 0034; spec §10):

- **FORM-now (dormant):** `reviews` + `reputation_aggregates` tables created with the append-only trigger reused, monotonic `seq`, per-market PK, dormant facet columns, `is_visible` gate — **no** review authoring/reading endpoints wired. `feature_toggles.reputation_reviews` seeded off/0 %.
- **Behaviour-later (gated behind `reputation_reviews`, and legal sign-off for §4):** authoring/reading, double-blind release, the 90-day/72-hour scheduler, aggregate display, and the erasure policy (§4) go live only when the toggle flips **and** legal confirms the retention basis.
- **MVP truth:** tables present and empty, no endpoints, no recompute — byte-identical HUMAN behaviour.

**ЧТО:** Ship `reviews`/`reputation_aggregates` dormant (trigger + `seq` + per-market PK + facet columns), behaviour behind `reputation_reviews`; §4 erasure additionally gated on legal sign-off.
**ПОЧЕМУ:** The structure is cheapest to lay now and must not change MVP behaviour or expose an untested/legally-unconfirmed surface.
**ПОЧЕМУ ТАК ЛУЧШЕ:** The proven signal/structure-first pattern (migration 0034) makes the seam testable and reversible with zero MVP behaviour change; double-gating §4 on legal respects the regulatory call.

---

## §7 — Proposed schema sketch (PROPOSED — this ADR writes no migration)

Authoritative DDL lands in the reputation slice (full DB workflow, `IMPLEMENTATION_PLAYBOOK.md §3`). Spec §3.2/§3.3 sketches are the starting shape; the structural refinements this ADR pins over the spec sketch:

```sql
-- PROPOSED sketch — not canonical. Refinements over spec §3.2/§3.3:
--   • reviews.seq BIGINT GENERATED ALWAYS AS IDENTITY  — monotonic "current/supersede" order (§3; migration-0036 lesson)
--       → resolve current-per-(sale,direction) and supersession by seq DESC, NOT created_at
--   • reputation_aggregates PK (subject_user_id, market)  — per-market over one identity (§2; fork 6)
--   • rating_avg is DERIVED (= rating_sum / NULLIF(review_count,0)) — recompute-only, never written (§1; fork 7)
--   • reviews append-only via trg_block_modify_append_only (reuse — no second immutability path)
--   • reviewer_user_id ON DELETE SET NULL  — pseudonymise-keep-rating on erasure (§4; fork 8, legal-gated)
--   • facet columns (facet_description_accuracy, facet_communication, facet_as_described) nullable, DORMANT (§3; fork 5)
--   • market copied from the sale's derived market (ADR-0038 §2 / ADR-0018 discipline)
--   • REVIEW_PUBLICATION consent type reserved on the existing consents model (ADR-0020) — no second consent store (§4)
```

Table count **+2** (`reviews`, `reputation_aggregates`) when the slice lands (on top of ADR-0038's `confirmed_sales`, +1 → the reputation subsystem is +3 tables total). All additive/nullable where touching existing paths → N-1 safe. The slice finalises the DDL.

---

## Consequences

### Positive
- The trust read stays a single fast indexed lookup as reputation grows; the aggregate is a tamper-proof, unpurchasable, derived function (fork 7 / TP-8 enforced by construction).
- ADR-0002 separation is structural (per-market PK + required `?market=`), not a UI convention — a livestock score can never bleed into a pet judgement.
- The migration-0036 fail-open lesson is pinned as a standing rule for append-only "latest wins" tables (reviews resolve on `seq`, not a tie-breakable timestamp).
- Erasure keeps the subject's reputation truthful and closes an erase-to-scrub griefing lever, while pseudonymising the identifying authorship — reusing the present `ON DELETE SET NULL` + `consents` model, and gated on legal.
- Aggregate recompute is incremental, idempotent, and event-driven (dodges the F4 lazy-on-read trap).

### Negative
- A denormalised aggregate cache to keep correct (mitigated: incremental + a recompute-from-source repair job).
- Three new tables total (with ADR-0038); a legal dependency blocks the §4 erasure behaviour until confirmed.
- Facet columns sit dormant until a later phase.

### Neutral
- MVP behaviour byte-identical (tables empty, no endpoints, no recompute).
- Review shape/visibility/window *behaviour* is owner-fixed (§13); this ADR decides only the storage that realises it.
- Event-sourcing remains the reserved Phase-2 scale evolution behind the materialised-aggregate seam.

## Open questions — owner review 2026-07-09

1. **[owner / legal] Confirm the ФЗ-152 basis to keep a rating authored by an erased user (§4 / spec §9).** Retaining the subject's rating after the reviewer erases their account needs a lawful basis (legitimate interest of a trust-safety system vs the reviewer's erasure right); the free-text `body` (more identifying than a star) is a sub-fork — retain, redact, or drop the text while keeping the star? *Recommendation:* **pseudonymise author + keep the star rating; redact/drop the free-text `body` on erasure** (the star is minimal, non-identifying subject-data; the prose is the identifying part) — subject to legal sign-off before `reputation_reviews` flips on. **Owner decision 2026-07-09: direction fixed as recommended — star stays, free-text `body` is dropped/redacted on erasure; the ФЗ-152 lawful-basis confirmation itself remains routed to legal and still gates `reputation_reviews`.**

*(No unresolvable conflict with §13 was found. Forks 2, 3, 5, 6, 8 are honoured structurally. Fork 8's still-pending legal confirmation is carried as Open Q1, exactly as §9/§13 flagged.)*

## Related Decisions
- [ADR-0038](0038-confirmed-sale-record-of-truth.md) — the confirmed-sale record every review references (proof-of-transaction); the `ConfirmedSale.*` event half.
- [ADR-0002](0002-hard-split-markets.md) — the per-market separation the aggregate PK enforces structurally.
- [ADR-0020](0020-versioned-consent-record-model.md) — the append-only `consents` model reused (`REVIEW_PUBLICATION`) and the `seq` monotonic-order lesson (migration 0036) applied to `reviews`.
- [ADR-0011](0011-agent-principal-actor-model.md)/[ADR-0006](0006-ai-agents-operate-platform.md) — actor-snapshot + append-only + ст.16 transparency if an agent moderates.
- [ADR-0012](0012-pii-at-rest-encryption.md)/[ADR-0019](0019-pii-at-rest-form-enforcement.md) — a review is dual personal data; PII-at-rest posture.
- [ADR-0040](0040-reputation-trust-integrity-governance.md) — who may create/adjudicate reviews (governance).

## References
- `docs/specs/18-reputation.md` §3.2/§3.3 (sketches), §5 (decision tables / Gherkin), §7 (NFR), §9 (ФЗ-152), §10, §12 (items 2, 3, 8, 9), §13 (forks 2, 3, 5, 6, 8).
- `database_schema.sql` (`consents` migrations 0029/0036 — the append-only + `seq` precedent; `trg_block_modify_append_only`; `feature_toggles`).
- `AUDIT4_HARDENING.md` §P3-1; migration 0036 (consent monotonic tie-break — the fail-open lesson).
- `IMPLEMENTATION_PLAYBOOK.md §3` (DB workflow), §5 (phase-boundary / dormant-form-first).
