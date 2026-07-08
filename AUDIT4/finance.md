# ZooLink HYPER³ Audit — Round-4 · finance (money-integrity of built mechanics · win-win · reserve-now)

**Date:** 2026-07-08 · **Branch:** `backend` HEAD `0fcc182` · **Role:** finance specialist.
**Mode: RECORD-ONLY.** Monetization is **owner-deferred to near-release** (soft-start, discussed
explicitly before ANY paid toggle; the `monetization_type` seam is reserved **SPEC-ONLY** on purpose).
So this pass does **not** design pricing and does **not** recommend flipping any toggle. It (a) stresses
the **economics integrity** of already-built mechanics, (b) applies the **new abuse-/money-integrity axis**,
and (c) gives a **win-win economics verdict** per reserved toggle + the cheapest **reserve-now** seams.
I modified no product code, docs, or schema. No commit, no push.

**Finding format:** `[severity][criterion][axis: same|new|trash|strat][NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED] file:line → problem → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO. Criterion ∈ fiscal · forward-compat · billing-unit · money-integrity · consistency · sequencing · win-win.
Strategic findings carry `[WW|PERSP]`. **All monetization recommendations are RECORD-ONLY.**

> **Grounding baselines (re-verified 2026-07-08):**
> - **Money-as-minor-units — HOLDS.** `listings.price_cents BIGINT` (schema:270), payment/refund `amount_minor BIGINT`. ✅
> - **No money-taken path active.** StubPaymentProvider rejects while `payments=off`; `purpose_type` written by no code. ✅
> - **All revenue toggles seeded form-now / OFF** (schema:739-751). ✅
> - **`monetization_type` absent from schema/contract** — now an *intentional* spec-only reservation, not an accident (see P1).

---

## DIFF vs AUDIT3/finance.md (reconciliation)

### N1 — Empty contact-reveal no longer billable → **FIXED-VERIFIED**
Round-3 N1 (an empty reveal, `channels={}`, still burned quota + wrote a `contact_reveals` row + fired the
lead event) is **fixed** by ADR-0020 (mig 0029). `revealContact()` now computes the resolvable channels
**FIRST** (two-layer gate: consent `distributionAllowed` AND per-channel `contact_prefs.show_*`), and if none
resolve returns a distinct `NO_CHANNELS` result that burns **no quota**, writes **no row**, emits **no event**.

`[MAJOR][billing-unit][same][FIXED-VERIFIED] backend/src/modules/listing/listing.service.ts:553-569 → channels computed before any side-effect; empty reveal → status:'NO_CHANNELS', no quota/row/event → the lead unit no longer counts a delivered-nothing reveal. Verified in code; no live-revenue backfill will be needed. ✅`

### N2 — Contact-reveal dedup + inflated lead KPI → **FIXED-VERIFIED**
Round-3 N2 (no dedup on `(viewer, listing)`: repeat reveals = duplicate billable rows + re-burned quota +
inflated `contactReveals` count) is **fixed**. DB backstop `uq_contact_reveals_viewer_listing UNIQUE(viewer_id,
listing_id)` (schema:1041, mig 0029) + an app-level pre-check (service:572-578) that returns the existing row's
channels without quota/row/event, + a race handler (service:612-619) that catches the unique-violation on a
concurrent double-reveal and returns the winner's channels rather than a 500. Consequently the metric
`contact_reveals.count(where listing_id)` (service:750) is now **inherently DISTINCT viewers** (a second row per
viewer is impossible), so the "leads/engagement" KPI growth & finance read is no longer inflatable by repeat views.

`[MAJOR][billing-unit][same][FIXED-VERIFIED] database_schema.sql:1041 + listing.service.ts:572-578,612-619 → UNIQUE(viewer_id,listing_id) + check-first + race-to-dedup; count(where listing_id) == distinct viewers → lead unit is one-per-(viewer,listing)-lifetime, un-double-charged, un-double-counted, race-safe. ✅`

### C1 — `payments` toggle desc still folds boost/premium → implies "no 54-ФЗ until payments-on" → **CONFIRMED**
`[CRITICAL][fiscal][same][CONFIRMED] database_schema.sql:741 → payments desc "Внутриплатёжные платежи (продвижение, premium и т.п.) …" unchanged; still folds boost/premium under one gate; boosted_listings desc "Платное продвижение объявлений в поиске" (schema:744) carries no fiscal note → boost/premium are the Operator's OWN B2C services ⇒ 54-ФЗ ККТ + эквайринг the moment money is taken, independent of the payments toggle → amend boost/premium descriptions to state the independent 54-ФЗ+acquiring trigger; scope payments desc to escrow/take-rate custody only. Legal owns the ruling. RECORD-ONLY (no toggle flips).`

### C2 — `premium_profiles` still conflated (B2C-boost vs B2B-subscription) → **CONFIRMED**
`[MAJOR][consistency][same][CONFIRMED] database_schema.sql:740 → single undifferentiated row, no monetization_type, no B2C/B2B split (ECOSYSTEM Q5 ratified the split) → two fiscal models under one toggle → when the offering seam eventually lands, split into two form-now toggles each tagged with monetization_type; until then annotate the row. RECORD-ONLY.`

### C3 — `monetization_type` seam absent → **CONFIRMED, but now INTENTIONAL (SEV-CHG BLOCKER-risk → deliberate deferral)**
Round-3 rated this the single highest anti-rewrite money item (CRITICAL). Re-framed for round-4: the owner has
**deliberately** kept `monetization_type` **spec-only** to keep the soft-start open, and — critically — **no paid
offering is being built** (monetization deferred), so the rewrite-risk *cannot be realized yet* (the risk was
always "the moment the FIRST paid surface ships without it"). It is therefore **not a live blocker today**; it is a
**reserve-now seam** — see **P1**. It re-arms to CRITICAL the instant the first paid surface enters design.
`[CRITICAL→deferred][forward-compat][same][SEV-CHG] backend/prisma/schema.prisma (0 hits) → intentional spec-only; harmless while no offering ships; must land BEFORE the first paid surface, not with it. RECORD-ONLY → tracked as P1.`

### N3 — `feature_toggles` has no market dimension (livestock-first vs pet-first not expressible at the gate) → **CONFIRMED**
`[MAJOR][forward-compat][same][CONFIRMED] database_schema.sql:644-651 → feature_toggles(key,is_enabled,rollout_percentage) is market-blind; a per-market phased monetization launch (ADR-0002 priced separately) cannot be flipped for one market only → reserve-now decision (see P2): add nullable market_scope OR ratify that per-market gating lives in code (the reveal rate-limit already gates by market, service:633-645). Escalate the contract choice to architect. RECORD-ONLY.`

### N4 — Livestock `price_or_terms` non-scalar → GMV blind for the highest-ticket market → **CONFIRMED**
`[MAJOR][consistency][same][CONFIRMED] database_schema.sql:270 (GAP-BA-001) → only scalar price_cents BIGINT (nullable); BR livestock price_or_terms is text ("negotiable"/"per straw"/"package") → GMV & any pre-settlement price-keyed pricing are blind where the ticket is highest; commission-at-settlement mitigates (charges the captured amount, not the listing price) → resolve GAP-BA-001 before any livestock GMV/take-rate target. Actual negotiable-share requires data-analyst actuals once listings flow — **requires manual verification**. RECORD-ONLY.`

### C5 — `vet_leadgen` (sole fiscally-exempt model) not flagged as such in code → **CONFIRMED**
`[MINOR][fiscal][same][CONFIRMED] database_schema.sql:745 → desc "Генерация лидов для ветеринарных клиник" omits it is the ONLY 54-ФЗ-exempt model (B2B invoice, pure intermediary) with immunity conditional on provider-license verification → annotate: "B2B lead-gen invoice, вне 54-ФЗ ККТ; НЕ принимать деньги потребителя in-app; иммунитет посредника ⇐ верификация лицензии провайдера." RECORD-ONLY.`

### C6 — Payment seam well-formed (`purpose_type`/`idempotency_key`) → **CONFIRMED**
`[INFO][forward-compat][same][CONFIRMED] backend/prisma — purpose_type free VarChar, unique idempotency_key, no writer → when payments is built, constrain purpose_type to a vocabulary aligned with offering.monetization_type so B2C(ККТ)/B2B(invoice) rows partition for fiscal reporting. RECORD-ONLY.`

**No REFUTED findings.**

---

## NEW AXIS — abuse-economics / money-integrity

### M1 — Contact-reveal billing UNIT is now correct & un-gameable → **NEW (positive verification)**
With N1+N2 fixed, the reveal unit is: **one billable/countable lead per `(viewer, listing)` for its lifetime**,
gated on a *delivered* contact, race-safe (DB UNIQUE + catch), and metric = DISTINCT viewers automatically.
Assessed for the three gaming vectors:
- **Double-charge:** impossible — UNIQUE index + check-first + race-to-dedup. ✅
- **Free-ride via race:** impossible — concurrent double-reveal collapses to the winner's single row (service:612-619). ✅
- **Reveal-farming to inflate a lead invoice:** the lifetime-dedup means a single buyer cannot manufacture N leads on one listing; a *ring of fake buyers* could still each generate one lead (Sybil), but that is an identity/anti-fraud problem, not a billing-unit defect — the unit itself is clean.

`[INFO][money-integrity][new][NEW] listing.service.ts:533-625 + schema:1041 → the contact-reveal lead unit is double-charge-proof, free-ride-proof, and race-safe. It is the CORRECT TEMPLATE for every future lead-billed surface (vet_leadgen, service_marketplace). Reserve this discipline as the money-integrity contract for those — see P3. RECORD-ONLY.`

### M2 — Reveal quota lives in Redis, not a durable ledger → fine as a free anti-abuse gate, WRONG if quota ever becomes a paid entitlement → **NEW**
`enforceRevealRateLimit` (service:633-645) counts via Redis INCR + TTL (`contact-reveal:{market}:{viewer}`, fixed
1h). Only a first resolvable reveal consumes it (empty/dedup paths never reach it — good). As a **free** abuse
throttle this is correct. But if a future model ever makes reveals a **paid entitlement** ("N free reveals, then
pay" / buyer-side reveal packs), a Redis-only counter is not billing-grade: an eviction/flush silently grants free
quota. Note: the durable ledger already exists — `contact_reveals` rows can be counted in a window — so a paid
quota must key off the table, not Redis.
`[MINOR][money-integrity][new][NEW] listing.service.ts:633-645 → Redis quota is free-abuse-grade, not billing-grade; a flush = free quota → IF reveals ever become a paid entitlement, source the paid quota from the durable contact_reveals table (windowed count), keep Redis only for the free throttle. RECORD-ONLY, pre-condition on any paid-reveal model.`

### M3 — No boost/subscription/lead ledger exists → the money-integrity invariants for boost & lead surfaces are UNDEFINED → **NEW (missing invariant)**
`boosted_listings`, `premium_profiles`, `vet_leadgen`, `service_marketplace` are toggles only — no ledger, no
state machine, no dedup. When any is designed, these **money-integrity invariants must be reserved with the first
row** (record-only, do not build now):
- **Boost:** a paid boost must bind to an **immutable paid-period** (start/end + consumed/refunded state) that a
  **relist / edit / deactivate→reactivate cannot reset or extend for free** (the natural gaming vector); self-boost
  must not corrupt match quality (a ranking-integrity, not just money, concern).
- **Subscription (premium B2B):** entitlement must be **durable** (Postgres, not Redis), with defined proration/
  refund on cancel and a clear active-window so a lapsed sub cannot retain paid features.
- **Lead (vet_leadgen/service):** a **DISTINCT, delivered, qualified** lead unit + dedup UNIQUE + durable count —
  the exact contact_reveals template (M1). A padded/duplicate lead invoice both breaks money-integrity AND breaks
  the intermediary framing (over-billing a clinic is extraction, not lead-gen).

`[MAJOR][money-integrity][new][NEW] database_schema.sql:739-751 (toggles only, no ledgers) → boost/subscription/lead surfaces have no money-integrity model yet → reserve these invariants (immutable paid-period · durable entitlement · distinct-qualified-lead-with-dedup) as the design contract for each surface BEFORE it is built. RECORD-ONLY.`

---

## STRATEGIC — per-toggle WIN-WIN economics verdict  `[WW]` (RECORD-ONLY)

For each reserved toggle: does the pricing MODEL (when eventually designed) **naturally align both sides**, or
structurally **extract from one**? And does it fit the **soft-start** (helps liquidity) or would it **harm
cold-start** if turned on early? No pricing designed here — model shape only.

| Toggle | Soft-start fit (cold-start) | Win-win alignment of the MODEL | Money-integrity risk (once on) |
|---|---|---|---|
| **payments** (escrow / take-rate) | **LAST.** Heaviest fiscal (54-ФЗ + 115-ФЗ AML + 161-ФЗ); off harms nothing on cold-start, on adds checkout friction to thin liquidity. | **Strongest win-win.** Take-rate at settlement charges **only when a real deal closes** → platform earns iff both sides got value. Self-aligning. | Escrow custody, double-capture, chargeback/refund — needs idempotency (present ✅) + refund state machine. |
| **vet_leadgen** (B2B cost-per-lead) | **Earliest paid surface.** Monetizes **without taxing** the core marketplace transaction; can *help* by funding growth off B2B budgets. | **Win-win IF the lead is genuinely qualified.** A pet-owner truly seeking a vet + a clinic paying for reach both win. Turns extractive only if leads are padded/duplicate. | **Highest new-surface risk:** no lead unit built. Must inherit the contact_reveals dedup/qualified discipline (M1/M3) or it over-bills the clinic. Fiscally lightest (invoice, intermediary — C5). |
| **service_marketplace** (lead-gen → later take-rate) | **Lead phase can help liquidity** (connects providers to demand); take-rate phase later. | Lead phase aligns like vet_leadgen; take-rate phase aligns like payments (charge-on-success). Both sides win when a real service is booked. | Lead-quality integrity now; escrow/fiscal load when take-rate turns on. |
| **premium_profiles** (B2B subscription ⟂ B2C boost) | **B2B-subscription** tolerable earlier IF it delivers **real tooling** (analytics, more listings); **B2C-vanity-boost** shares boost's cold-start caution. | **Split verdict:** B2B-subscription = win-win when the provider pays for genuine productivity (aligned). B2C-vanity-boost leans **extractive** (pay to look better, no counterpart value). Conflated today (C2). | Durable entitlement (not Redis), proration on cancel (M3). |
| **boosted_listings** (paid search rank) | **NOT early.** On a thin two-sided market it **taxes the scarce supply** you are trying to attract and degrades buyer match (paid rank ≠ best match) → **harms cold-start**. | **Most extractive of the set.** If boost merely reshuffles rank it extracts rent from sellers without adding buyer value; becomes win-win only when supply is **abundant** (boost = real differentiation, not rent). | Boost-gaming via relist/edit/reactivate; needs an immutable bound paid-period (M3). |

**Headline `[WW]`:** the model is naturally win-win where the platform **earns only on delivered value** —
**payments/take-rate** (charge-on-close) and **qualified vet/service lead-gen** are the soft-start-friendly,
self-aligning surfaces; **boosted_listings** (and B2C-vanity premium) are the structurally extractive,
cold-start-harming surfaces to keep off longest. This ranking is *emergent from the mechanics*, not a pricing
proposal — final call is the owner's, at monetization time.

---

## `[PERSP]` — cheapest economics/measurement seams to RESERVE now (before monetization-on, WITHOUT designing pricing)

Each is a **form/measurement** reservation that avoids a live-revenue rewrite; **none sets a price or flips a toggle.**

- **P1 — `monetization_type` on the offering seam (the single highest anti-rewrite money item).** `[PERSP]` Owner has
  kept it spec-only on purpose; the standing risk is only that it must **land before the FIRST paid surface, not with
  it** (a paid offering shipped without it forces a schema+contract+backfill migration on live revenue rows). Cheapest
  form when the time comes: one additive `monetization_type VARCHAR(20) CHECK (… IN ('lead-gen','subscription','take-rate','none')) DEFAULT 'none'`, NULL/'none' = existing unmonetized rows, no backfill. **RECORD-ONLY.**
- **P2 — market-gating layer for `feature_toggles`.** `[PERSP]` Decide (architect) whether per-market monetization
  sequencing (livestock-first) lives as a nullable `market_scope` on the toggle OR in code (as the reveal rate-limit
  already does). Reserving the decision now keeps a market-first launch expressible. **RECORD-ONLY.**
- **P3 — the contact_reveals dedup discipline as the reusable "billable-event" contract.** `[PERSP]` Before building
  vet_leadgen/service lead-billing, ratify the pattern proven by M1 (**DISTINCT unit + UNIQUE dedup + durable count +
  delivered-value gate**) as the money-integrity template so no future lead surface reinvents (and mis-bills) the unit.
  **RECORD-ONLY.**
- **P4 — `purpose_type` vocabulary aligned to `monetization_type`.** `[PERSP]` (C6) Keep the two vocabularies from
  diverging so B2C(ККТ)/B2B(invoice) rows partition for fiscal reporting when payments is built. **RECORD-ONLY.**
- **P5 — livestock price representability.** `[PERSP]` (N4/GAP-BA-001) Reserve a structured price form (`{amount, unit,
  negotiable}` or price_terms_text) before any livestock GMV/take-rate target, so GMV is measurable where the ticket is
  highest. **RECORD-ONLY.**

---

## Verdict summary
- **Money-integrity of built mechanics:** ✅ **The one live billable-ish mechanic — contact-reveal — is now clean.**
  N1/N2 fixed & verified (channels-first, UNIQUE dedup, race-safe, metric = distinct viewers). It is double-charge-,
  free-ride-, and race-proof, and is the correct template for future lead billing (M1). Redis reveal-quota is fine as a
  free throttle but must move to the durable table if reveals ever become paid (M2). No boost/subscription/lead ledger
  exists yet, so those money-integrity invariants are **undefined and must be reserved with the first row** (M3).
- **Win-win headline:** the platform is naturally win-win where it **earns only on delivered value** —
  **payments/take-rate** and **qualified lead-gen (vet/service)** are soft-start-friendly and self-aligning;
  **boosted_listings** (and B2C-vanity premium) are the structurally extractive, cold-start-harming surfaces to keep off
  longest.
- **Reserve-now seams (record-only):** P1 monetization_type-before-first-surface · P2 toggle market-gating · P3 the
  billable-event dedup contract · P4 purpose_type↔monetization_type vocabulary · P5 livestock price representability.
- **Fiscal framing (CONFIRMED):** payments toggle desc still folds boost/premium (C1); vet_leadgen not flagged as the
  sole 54-ФЗ-exempt model (C5). Legal owns the ruling.
- **Money-as-minor-units:** ✅ holds.

*Scope note:* frontend and all un-built payment/offering behaviour are `требует ручной проверки`. Actual
negotiable-share (N4/P5) and reveal repeat-rate require data-analyst actuals once listings flow. Final pricing, the
toggle-contract choice (P2), and any toggle flip are the **owner's** at monetization time — **everything here is
RECORD-ONLY.** I model and recommend only; no code/doc/schema modified; no commit, no push.
