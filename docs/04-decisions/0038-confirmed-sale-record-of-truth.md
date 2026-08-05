# ADR-0038: Confirmed-Sale record of truth — a first-class append-only entity (not a projection), polymorphic subject, event-emitting

**Status**: Accepted (owner, 2026-07-09 — section-by-section review; Open Q1 resolved per recommendation). **Amended 2026-08-04 (AUDIT5 gate-pass — §4 Amendment below): `confirmed_sales` is a CONFIRMED-only FACT; the PENDING/negotiation lifecycle moved to the mutable companion `sale_confirmations` (migration 0041).**
**Date**: 2026-07-09
**Refines / builds on**: [ADR-0013](0013-mvp-ownership-transfer.md) (a COMPLETED `ownership_transfers` is the strongest, already-two-sided sale signal — the auto-confirm anchor), [ADR-0014](0014-offering-supertype-polymorphic-seam.md) (the polymorphic Offering seam this entity's subject reuses), [ADR-0018](0018-cross-aggregate-access-rule.md)/[ADR-0015](0015-market-scope-refines-0002.md) (derived-`market` cache discipline — mirror of `listings.market`, migration 0033), [ADR-0021](0021-first-outbox-consumer-notification-path.md) (transactional-outbox emission the events ride).
**Related**: [ADR-0002](0002-hard-split-markets.md) (per-market scope, never mixed), [ADR-0004](0004-animal-as-aggregate.md) (animal aggregate root the transfer re-attributes), [ADR-0006](0006-ai-agents-operate-platform.md)/[ADR-0011](0011-agent-principal-actor-model.md) (actor-snapshot on every append-only row), [ADR-0039](0039-reputation-storage-model.md) (the reviews/aggregate that hang off this record), [ADR-0040](0040-reputation-trust-integrity-governance.md) (dispute/abuse governance of the record).
**Source**: spec `docs/specs/18-reputation.md` §12 items 1, 7, 9 (ConfirmedSale.* half) — routed to architect; AUDIT4 **P3-1** (`⇊converged` active-user / psychologist / growth): the built marketplace is a one-way contact-reveal that leaks the whole relationship off-platform — no confirmed-sale signal, no reputation, so the platform captures none of the value it creates. Owner business forks §13 (2026-07-09) are normative inputs (fork 1 hybrid confirmation, fork 4 CONFIRMED-only).

---

## Context and Problem Statement

Spec 18 (`18-reputation.md`) established, as a design-only FORM-first contract, that ZooLink must **record that a real deal happened** so that reputation, trust, and (later) any agent-run trust-and-safety can hang off a signal the platform currently loses irreversibly. The spec deferred nine structural choices to architect (§12). This ADR decides the **first and most foundational** cluster: **what the confirmed-sale record structurally *is*** — its entity identity, the shape of *what was sold*, and *what it emits*.

Three tightly-coupled §12 questions are decided here because they all describe the same object:

- **§12.1 — new aggregate vs derived view.** Is the confirmed sale its **own** first-class entity, or a **projection/query** over `ownership_transfers` + listing `markSold`? This is the schema-shaping keystone; everything else (reviews FK target, event emission, dispute state) depends on it.
- **§12.7 — reputation over the Offering seam (ADR-0014).** *What was sold* must be shaped so the same primitive later serves services/goods (the polymorphic Offering seam) without a rewrite.
- **§12.9 (ConfirmedSale.* half) — event-catalog additions.** `ConfirmedSale.{Created,Confirmed,Disputed,Expired}` — the emission contract the notification/analytics/agent layers subscribe to. (The `Review.*` half of §12.9 is decided with the reviews entity in [ADR-0039](0039-reputation-storage-model.md), where those events are emitted.)

The confirmation **behaviour** (who confirms, timeouts, double-blind) is already normatively fixed by the owner (§13): **hybrid confirmation** — auto-confirm when anchored to a COMPLETED `ownership_transfers`, buyer counter-confirmation for the listing-`markSold` path (fork 1); only a CONFIRMED sale ever unlocks reviews (fork 4). This ADR does not re-open those; it decides the **structure** that carries them.

## Decision Drivers

1. **Capture the irreversibly-lost signal now (AUDIT4 P3-1, cost-of-change apex).** The confirmed-sale signal — especially a COMPLETED transfer — is lost forever if not recorded when it happens. Same reserved-first logic that pulled `view_count` forward (migration 0031, D1). Highest driver.
2. **Proof-of-transaction integrity (spec §Constraints, psychologist TP-7).** A review must reference a durable, immutable, uniquely-identified CONFIRMED sale row. A fragile projection cannot be a stable proof anchor across dispute, supersede, and erasure.
3. **Reuse the strongest existing signal (ADR-0013).** A COMPLETED `ownership_transfers` is already two-sided-consented and atomically re-attributes the animal — the record must be **derivable from it in the same transaction** (transactional-outbox) so the signal is never lost between the two writes.
4. **Forward-compat with the Offering seam (ADR-0014).** Services/goods reputation must not force a table rewrite; the subject must be polymorphic from the first row (widen-additively CHECK), exactly like `favorites`/`saved_searches` (migration 0032).
5. **Two markets never mix (ADR-0002).** The record carries a **derived** per-row `market`, scoped and displayed separately — never a cross-market leak.
6. **Append-only + actor-snapshot from row one (ADR-0006/0011).** Every state row carries `actor_id` + `actor_principal_type ('HUMAN'|'AGENT')`, protected by the reused `trg_block_modify_append_only` discipline, so an AI operator path is auditable from day one (North-Star).
7. **Dormant-form-first / no MVP behaviour change (ADR-0022, migration 0034; `IMPLEMENTATION_PLAYBOOK.md §5`).** The record starts accruing passively; review authoring/reading stays behind a real toggle.

---

## §1 — Is the confirmed sale a first-class entity or a derived projection? (§12.1)

**Considered options**

### Option 1: Derived view / query over `ownership_transfers` + listing `markSold`
No new table; `confirmed_sales` is a SQL view (or a service-layer query) that projects "a sale happened" from a COMPLETED transfer or a `markSold` listing row.

Pros:
- Zero new storage; no duplication of the transfer's facts.
- Always consistent with its sources by construction (it *is* its sources).

Cons:
- **No stable identity to anchor a review FK to** — a review needs `confirmed_sale_id` to reference an immutable row (proof-of-transaction); a view row has no durable PK across recompute.
- **Cannot carry its own lifecycle** — the `markSold` path needs `PENDING_CONFIRMATION → CONFIRMED/EXPIRED/CANCELLED/DISPUTED` state that lives *nowhere* in the sources (a listing has no buyer-counter-confirmation column; a transfer has no listing-markSold notion). A projection cannot hold state the sources do not have.
- **Cannot capture the buyer counter-confirmation, dispute, or the actor-snapshot** required by fork 1 and ADR-0011 — these are new facts, not projections of old ones.
- The livestock/goods/no-transfer path (`LISTING_MARK_SOLD`) has **no upstream two-sided record at all** to project from — the whole point is that the platform must *create* the confirmation it currently lacks. Rejected: a projection cannot invent the signal it is meant to capture.

### Option 2: First-class append-only entity `confirmed_sales`, *anchored* to the upstream signal (Chosen)
A real table (spec §3.1 sketch). Each row is created from an **anchor** — `anchor_type ∈ {'TRANSFER','LISTING_MARK_SOLD'}` — carrying `ownership_transfer_id`/`listing_id`, both parties, a derived `market`, its own status machine, confirmation/expiry timestamps, the actor-snapshot pair, and a `UNIQUE(ownership_transfer_id)` guard (mirror of the transfer INV-4 one-live-per-anchor shape). The TRANSFER anchor auto-creates a CONFIRMED row **in the same transaction** as `OwnershipTransfer.Completed`; the LISTING_MARK_SOLD anchor creates a PENDING row awaiting buyer counter-confirmation.

Pros:
- A **stable, immutable PK** to anchor every review FK to — proof-of-transaction has a durable root (driver 2).
- Holds the **new facts** the sources lack (buyer counter-confirmation, dispute state, actor-snapshot, expiry) — carries fork 1's hybrid lifecycle natively.
- **Captures the signal at the moment it exists** and never loses it (in-tx with the transfer; the `markSold` path *creates* the confirmation record the platform currently lacks) — driver 1/3.
- Append-only + actor-snapshot from row one → agent-auditable, ФЗ-152-safe erasure via `ON DELETE SET NULL` (driver 6).
- The record of truth an AI operator can *see* — closes the North-Star "invisible deal" gap.

Cons:
- Duplicates a few facts already in `ownership_transfers` (parties, animal) — accepted: they are *snapshots* at sale time and the anchor FK keeps the link; the duplication is the price of a stable, disputable, reviewable identity.
- One new table (plus the reviews/aggregate tables in ADR-0039).

### Option 3: Reuse `ownership_transfers` itself (add markSold-confirmation columns to it)
Extend the transfer table to also represent listing-markSold sales.

Cons:
- Conflates two different aggregates — a *transfer of an animal's ownership* (ADR-0013, animal-scoped, GUC-gated owner-lock) with a *sale confirmation* (offering-scoped, polymorphic, future services/goods). Overloads ADR-0013's invariants and blocks the Offering seam (a service sale has no animal to transfer). Rejected: violates single-responsibility and ADR-0014's anti-god-table principle.

**Decision:** **Option 2** — `confirmed_sales` is a **first-class, append-only entity** anchored to the upstream signal, not a projection. The TRANSFER anchor derives an auto-CONFIRMED row in the same transaction as `OwnershipTransfer.Completed`; the LISTING_MARK_SOLD anchor creates a PENDING_CONFIRMATION row (fork 1). `UNIQUE(ownership_transfer_id)` prevents a duplicate sale per transfer.

**ЧТО:** The confirmed sale is its own append-only table with a stable PK, an anchor to the upstream signal (`TRANSFER` | `LISTING_MARK_SOLD`), its own confirmation state machine, and the actor-snapshot pair — not a view/projection over `ownership_transfers` + `markSold`.
**ПОЧЕМУ:** A review needs an immutable, uniquely-identified proof anchor and the record must carry new facts (buyer counter-confirmation, dispute, actor) that its sources do not have; a projection can neither anchor a FK nor hold state the sources lack, and cannot invent the signal the no-transfer path is meant to create.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** Captures the irreversibly-lost confirmed-sale signal at the instant it exists (in-tx with the transfer; created for the markSold path), giving reputation a durable proof-of-transaction root and an AI operator a deal it can *see* (North-Star) — while staying decoupled from ADR-0013's animal-transfer invariants (no god-table, honours ADR-0014). Alternatives rejected: derived view (no stable identity, cannot hold new lifecycle facts, cannot invent the no-transfer signal); reusing `ownership_transfers` (conflates two aggregates, breaks the Offering seam).

---

## §2 — Shape of *what was sold*: polymorphic subject reusing the Offering seam (§12.7)

**Considered options**

### Option 1: Hard-wire the subject to `listing_id` / `animal_id` only
The sale references a listing (and an animal when transfer-anchored); no generic subject.

Pros:
- Simplest for the animal-only MVP behaviour.

Cons:
- When services/goods reputation arrives (ADR-0014 Offering seam), the reviews/aggregate must re-point to a new subject shape — a **schema + FK rewrite** of the two most sensitive tables (reviews, aggregate). Contradicts driver 4 and the cost-of-change rule. Rejected.

### Option 2: Polymorphic `offering_type` discriminator + `offering_id`, widen-additively (Chosen)
`confirmed_sales.offering_type VARCHAR(30) NOT NULL DEFAULT 'ANIMAL_LISTING'` with `CHECK (offering_type IN ('ANIMAL_LISTING'))` **widened additively** as subtypes land — the **exact pattern** already ratified for `favorites`/`saved_searches` (ADR-0014 seam, migration 0032). `listing_id`/`animal_id` remain as the concrete instance pointers for the `ANIMAL_LISTING` subtype; the polymorphic pair is the future-proof subject. No polymorphic FK (the target is polymorphic — anti-god-table, same rationale as migration 0032).

Pros:
- Services/goods reputation later widens one CHECK, no table rewrite (driver 4).
- **Consistency of pattern** — the platform already speaks this exact polymorphic dialect (migration 0032), so reviewers, moderation, and analytics reuse one mental model.
- Behaviour stays animal-only in the first phase (CHECK admits only `ANIMAL_LISTING`).

Cons:
- A discriminator column that is single-valued until the seam widens — accepted (form-now, the migration 0032 precedent).

### Option 3: A shared `offerings` supertype table the sale FKs to
Build the full ADR-0014 `offerings` supertype now and FK the sale to it.

Cons:
- Pulls the entire Offering-supertype build forward before any service/goods behaviour exists — premature; ADR-0014 itself keeps that a **seam**, not a built table, until a formal Change Request. Over-engineered for the animal-only first phase. Rejected (defer to ADR-0014's own activation).

**Decision:** **Option 2** — the sale's subject is a **polymorphic `offering_type` + `offering_id`**, widen-additively, mirroring migration 0032; `ANIMAL_LISTING` is the only admitted subtype in the first phase; `listing_id`/`animal_id` stay as the concrete `ANIMAL_LISTING` pointers. The `reviews` subject inherits the same discriminator (decided in [ADR-0039](0039-reputation-storage-model.md)).

**ЧТО:** *What was sold* is modelled as a polymorphic `offering_type` (CHECK-widened additively, `ANIMAL_LISTING`-only now) + `offering_id`, exactly like `favorites`/`saved_searches` (migration 0032); the concrete `listing_id`/`animal_id` pointers remain for the animal subtype.
**ПОЧЕМУ:** Services/goods reputation must reuse the same primitive without rewriting the reviews/aggregate FK target; the polymorphic discriminator is the widen-additively seam ADR-0014 mandates.
**ПОЧЕМУ ТАК ЛУЧШЕ:** One additive CHECK widening (not a rewrite of the two most sensitive tables) opens the Offering seam later, reusing the platform's already-ratified polymorphic dialect (migration 0032) so nothing new must be reviewed; behaviour stays animal-only now, honouring MVP focus and ADR-0014's "seam not table" discipline. Alternatives rejected: hard-wired subject (forces a future rewrite); building the full `offerings` supertype now (premature, over-engineered for animal-only).

**Derived-`market` discipline (ADR-0018/0015).** `confirmed_sales.market` caches the **derived** market (from `species.market` via the animal, or the listing's market) — never a client-asserted `market_scope` tag — mirroring `listings.market` (migration 0033). Scoped and displayed per-market (ADR-0002); the aggregate PK carries the same `market` (ADR-0039 §2).

---

## §3 — Event surface: `ConfirmedSale.*` emitted in-transaction via the outbox (§12.9, ConfirmedSale half)

**Decision (normative — backend-engineer owns `event-catalog.md`; listed here for coordination, not edited by this ADR):**
The confirmed-sale entity emits, through the **existing transactional-outbox** (ADR-0021, `Listing.Activated`/`OwnershipTransfer.*` are the built precedents), the following domain events **in the same transaction** as the state change that raises them (so the signal is never lost — the F4/AUDIT3 dead-event-layer discipline):

| Event | Raised when | Primary consumers (later) |
|---|---|---|
| `ConfirmedSale.Created` | a PENDING_CONFIRMATION row is written (markSold anchor) | notification (buyer "confirm this deal?"), analytics |
| `ConfirmedSale.Confirmed` | status → CONFIRMED (buyer counter-confirm, or auto on TRANSFER anchor) | review-window opener, notification, analytics (completion signal) |
| `ConfirmedSale.Disputed` | status → DISPUTED (either party disputes) | moderation queue (ADR-0040 §2), analytics |
| `ConfirmedSale.Expired` | scheduler tick sets EXPIRED (no counter-confirm by horizon) | analytics (weak-signal capture); **never** opens a review window |

- **Emission is transactional** (in the tx with the write) and **forward-only replay** (relay `WHERE processed_at IS NULL`), reusing ADR-0021's guardrail — **the outbox is never pruned before analytics** (the confirmed-sale signal is the one we cannot lose).
- **No consumer is wired in this ADR** — this is the emission *contract*. The first consumer (the review-window opener + buyer-confirm notification) lands with the reputation behaviour slice, gated by `feature_toggles.reputation_reviews` (§4). `ConfirmedSale.Created`/`Confirmed` may be emitted from the transfer path **form-now, dormant** even before any consumer exists (the signal accrues; no one listens yet) — the safest capture.
- The `Review.{Submitted,Released}` events are the reviews entity's surface and are specified with it in [ADR-0039](0039-reputation-storage-model.md) §5.

**ЧТО:** Define `ConfirmedSale.{Created,Confirmed,Disputed,Expired}` as transactional-outbox events emitted in-tx with the state change; no consumer wired here (the emission contract only); `ConfirmedSale.Created/Confirmed` may accrue dormant from the transfer path before any consumer exists.
**ПОЧЕМУ:** An AI operator (and notification/analytics) can only act on a transaction it can *see* as events; in-tx emission via the proven outbox guarantees the signal is captured atomically and replayable, never silently dropped.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Reuses the built transactional-outbox + forward-only-replay + no-purge guardrail (ADR-0021) — no new event mechanism to review; emitting dormant from the transfer path captures the irreversibly-lost signal before behaviour exists (the `view_count`/D1 reserved-first logic applied to events); keeping the contract in the ADR (not the schema) lets backend-engineer own `event-catalog.md` without a doc↔code inversion. Alternative rejected: raising events outside the tx (the AUDIT3 dead-event / lost-signal failure mode).

---

## §4 — Phase boundary: form-now dormant capture, behaviour behind a toggle

Per the cost-of-change rule and the dormant-form-first precedent (ADR-0022, migration 0034; spec §10):

- **FORM-now (ship the seam, dormant — recommended order per spec §10):**
  1. `confirmed_sales` table created; **passive auto-CONFIRMED write at `OwnershipTransfer.Completed`** (anchor=`TRANSFER`, in-tx) — **the highest-value dormant seam**, the signal lost irreversibly today. Reviews stay off; the record of truth starts accruing.
  2. Polymorphic `offering_type` (§2) + derived `market` present from row one.
  3. The `markSold` buyer-nomination column reserved now, so flipping counter-confirmation behaviour needs **no** schema change.
  4. `ConfirmedSale.Created/Confirmed` emitted dormant from the transfer path (§3).
- **Behaviour-later (gated):**
  - The listing-`markSold` buyer counter-confirmation flow → behind `feature_toggles.sale_buyer_confirmation` (seeded off/0 %, same shape as `ownership_transfer_verification`).
  - Any review authoring/reading that consumes these events → behind `feature_toggles.reputation_reviews` (ADR-0039).
- **MVP truth:** table present, transfer-anchored rows may accrue (dormant, no consumer), no markSold-confirmation UI, no reviews — byte-identical HUMAN behaviour otherwise.

**ЧТО:** Build the `confirmed_sales` table + passive transfer-anchored auto-capture now (dormant); gate the markSold counter-confirmation behind `sale_buyer_confirmation` and all review behaviour behind `reputation_reviews`.
**ПОЧЕМУ:** The confirmed-sale signal is lost forever if not captured now, but the confirmation/review *behaviour* must not change MVP or expose an untested surface.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Mirrors the platform's proven signal-first/behaviour-gated pattern (`view_count` D1, dormant `user_roles` migration 0034) — the irreversibly-lost signal is captured immediately, behaviour is reversible and testable behind real toggles, and MVP behaviour is unchanged.

---

## §5 — Proposed schema sketch (PROPOSED — this ADR writes no migration)

The authoritative DDL lands in `database_schema.sql` + an idempotent migration in the reputation slice (per `IMPLEMENTATION_PLAYBOOK.md §3`: schema + migration + ERD + `data-model.md` + table-count in both `CLAUDE.md`; run twice on live PG; negative tests per invariant; `npm run db:sync`). The spec §3.1 sketch is the starting shape; the structural refinements this ADR pins:

```sql
-- PROPOSED sketch — not canonical. First-class, append-only, anchored, polymorphic-subject, actor-snapshotted.
-- Structural decisions pinned by this ADR (behaviour/columns finalised by the slice):
--   • first-class table (§1)                 — not a view/projection
--   • polymorphic offering_type (§2)         — widen-additively CHECK, ANIMAL_LISTING-only now (mig 0032 pattern)
--   • derived market cache (§2)              — from species.market/listing, ADR-0018/0033 discipline
--   • UNIQUE(ownership_transfer_id) (§1)     — one live sale per transfer (transfer INV-4 mirror)
--   • actor snapshot pair (ADR-0006/0011)    — actor_id + *_principal_type, append-only trigger reused
--   • append-only via trg_block_modify_append_only (reuse — do NOT invent a second immutability path)
-- amount_minor: reserved nullable, off-record default — capture behaviour is an OWNER/finance/legal fork (Open Q1).
```

Table count **+1** (`confirmed_sales`) when the slice lands. All columns nullable/additive where they touch existing paths → N-1 rolling-deploy safe (AUDIT4 P1-5). The `reviews`/`reputation_aggregates` tables are decided and sketched in [ADR-0039](0039-reputation-storage-model.md).

---

## §4 Amendment (2026-08-04, AUDIT5 gate-pass m-20260804-234834) — CONFIRMED-only FACT; the PENDING lifecycle moves to `sale_confirmations`

**Status of the amendment:** Accepted (держатель gate-pass, 2026-08-04). Realised in migration 0041 (reputation-pack COMMIT-1). This narrows the §1/§4 vocabulary and moves columns; it does **not** re-open the Option-2 first-class-entity decision.

**What was wrong.** The FORM slice (migration 0039) modelled a **state machine on an APPEND-ONLY table**: `confirmed_sales.status` carried the full `PENDING_CONFIRMATION|CONFIRMED|DISPUTED|EXPIRED|CANCELLED` vocabulary with intent columns (`nominated_buyer_user_id`, `seller_confirmed_at`, `buyer_confirmed_at`, `expires_at`), yet the reused append-only trigger allowed exactly **one** of the seven state edges (born-CONFIRMED). The `markSold` `PENDING → CONFIRMED` transition was structurally unbuildable — a self-contradiction *inside* this ADR (§4 "hybrid lifecycle carried natively" vs §5 "reuse append-only, do not invent a second immutability path").

**Decision (WHAT).** Split the immutable **FACT** from the mutable **STATE**:
- `confirmed_sales` becomes a **CONFIRMED-only fact** — a row EXISTS iff a sale is confirmed. `status` keeps a **narrowed `CHECK (status = 'CONFIRMED')`** (no `DEFAULT`) as a Q2 **gravestone** (a narrowed value tells a future reader where PENDING went; a silently-dropped column would not). The negotiation columns and `idx_confirmed_sales_confirm_scan` are dropped. `confirmed_at` and the **FULL** `UNIQUE(ownership_transfer_id)` stay (Q1 — a confirmed transfer-sale is permanent; cancel/dispute *after* confirmation is a NEW record about the fact, never a mutation of it → the full UNIQUE is correct, not a constraint).
- A NEW **mutable companion `sale_confirmations`** carries the `markSold` PENDING→CONFIRMED/EXPIRED/CANCELLED/DISPUTED lifecycle (its own `updated_at` trigger). The biconditional `chk_sale_conf_confirmed_link` (mirror of `chk_moddec_override`) makes "a CONFIRMED negotiation ⇔ has produced its one fact row" a one-query invariant; `uq_sale_conf_live_per_listing` keeps one live negotiation per listing. The **TRANSFER path never writes here** — a completed transfer is born CONFIRMED directly in `confirmed_sales` (byte-identical to the pre-amendment transfer capture, minus the two synthetic timestamps `confirmed_at` already covers).

**Why (WHY).** Append-only and a multi-edge state machine are incompatible on one table; the reform is cheapest now (0 `markSold` rows, all transfer rows already CONFIRMED). **Q3:** a dispute *after* confirmation is an ADR-0040 `content_report` subtype (a third-party assertion), **not** a state key on the companion — the fact happened and is never erased; a dispute is a new record *about* it.

**Why better (WHY-BETTER).** One canon-wide pattern — **immutable fact + mutable companion** — now covers sales (`confirmed_sales`/`sale_confirmations`) and reviews (`reviews`/`review_states`, ADR-0039 §3 Amendment β), symmetric with the existing `moderation_decisions` (decision) and `reputation_aggregates` (cache). Every change is additive/guarded → N-1 safe; DORMANT → zero MVP behaviour change. Alternative rejected: keeping the machine on the append-only table (leaves 6 of 7 edges unbuildable) or relaxing the append-only trigger (destroys the record-of-truth guarantee reviews anchor to).

## Consequences

### Positive
- The immutable-fact / mutable-state split resolves the append-only-vs-machine self-contradiction structurally, with one pattern reused across the reputation subsystem (amendment, migration 0041).
- The irreversibly-lost confirmed-sale signal (esp. the strongest — a COMPLETED transfer) is captured at the instant it exists, dormant, with zero MVP behaviour change — the deepest AUDIT4 P3-1 strategic gap starts closing structurally.
- Reputation gets a durable, immutable, uniquely-identified proof-of-transaction root (reviews FK target).
- The subject is Offering-seam-ready (services/goods) via one additive CHECK, reusing the migration-0032 dialect — no future rewrite of the sensitive tables.
- An AI operator can *see* the transaction as in-tx outbox events from day one (North-Star), audit-safe via actor-snapshot and forward-only replay.
- Decoupled from ADR-0013's animal-transfer invariants and ADR-0014's not-yet-built supertype — no god-table.

### Negative
- One new table now (plus ADR-0039's two); a few facts snapshot-duplicated from `ownership_transfers` (the price of a stable disputable identity).
- Dormant rows accrue with no consumer until the behaviour slice — acceptable (the `view_count`/D1 pattern); requires the no-purge outbox guardrail to hold.

### Neutral
- MVP behaviour byte-identical apart from dormant transfer-anchored rows nobody reads yet.
- Confirmation/window/visibility *behaviour* is owner-fixed (§13); this ADR only decides the structure that carries it.
- `event-catalog.md` is edited by backend-engineer in the slice; this ADR is the coordination contract, not the edit.

## Open questions — RESOLVED by the owner (2026-07-09)

1. **[owner / finance / legal] Capture the sale amount (`amount_minor`)?** Reserve a nullable, off-record-by-default `amount_minor` now (form) so a future take-rate/commission (behind `feature_toggles.payments`) and analytics have a fee-base — **or** omit entirely for strict data-minimisation? *Recommendation:* **reserve the nullable column (form-now, off-record default), decide capture behaviour with finance + legal at payments activation** — the column is free forward-compat and does not monetise reputation (fork 7 untouched: the money is on the deal, never on trust). **Owner decision 2026-07-09: as recommended — reserve the nullable column form-now, nothing written by default; capture behaviour decided with finance + legal at payments activation.**

*(No unresolvable conflict with §13 was found. Forks 1 (hybrid confirmation) and 4 (CONFIRMED-only) are honoured structurally; the confirmation/visibility behaviour they fix is carried, not re-opened, by this ADR.)*

## Related Decisions
- [ADR-0013](0013-mvp-ownership-transfer.md) — a COMPLETED transfer is the auto-confirm anchor; `UNIQUE(ownership_transfer_id)` mirrors its INV-4 one-live-per-anchor shape.
- [ADR-0014](0014-offering-supertype-polymorphic-seam.md)/[ADR-0015](0015-market-scope-refines-0002.md) — the polymorphic subject and derived-`market` discipline reused here (migration 0032/0033 pattern).
- [ADR-0018](0018-cross-aggregate-access-rule.md) — market is derived, not asserted; read animal facts through the aggregate.
- [ADR-0021](0021-first-outbox-consumer-notification-path.md) — the transactional-outbox + forward-only-replay + no-purge guardrail the `ConfirmedSale.*` events ride.
- [ADR-0039](0039-reputation-storage-model.md) — the reviews/aggregate hanging off this record (and the `Review.*` events).
- [ADR-0040](0040-reputation-trust-integrity-governance.md) — dispute → moderation and agent/abuse governance of the record.

## References
- `docs/specs/18-reputation.md` §3.1 (`confirmed_sales` sketch), §4 (state machine), §10 (FORM-now vs behaviour-later), §12 (items 1, 7, 9), §13 (owner forks 1, 4).
- `database_schema.sql` (`ownership_transfers` migration 0023, `listings.market` migration 0033, `favorites`/`saved_searches` polymorphic `offering_type` migration 0032, `feature_toggles`).
- `AUDIT4_HARDENING.md` §P3-1 (the one-way-reveal strategic gap).
- `IMPLEMENTATION_PLAYBOOK.md §3` (DB workflow), §5 (phase-boundary / dormant-form-first / rewrite test).
