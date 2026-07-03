# ZooLink HYPER² Audit — Round 3 · finance (monetization / unit-economics under forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` HEAD `4533e78` (not pushed) · **Role:** finance specialist.
**Method:** independent round-3 pass over the *actual* schema / migrations / code (not the round-1
`AUDIT2/finance.md`), then reconciled. Lens: forward-compat × monetization × billing-unit integrity.
I modified no product code or docs — this file is my sole output. No commit, no push.

**Finding format:** `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ fiscal · forward-compat · billing-unit · consistency · sequencing.

> **Grounding assumptions (explicit):**
> - **A1 — near-term model = lead-gen + boost.** First paid surfaces are `vet_leadgen` / `service_marketplace`
>   (lead-gen) and `boosted_listings`; **contact-reveal is the natural animal-marketplace lead unit** (a buyer
>   who reveals a seller's contact = one lead). If the *first* paid surface were take-rate-at-escrow only, N1/N2
>   severity drops (reveal not billed) but the KPI-inflation half of N2 survives.
> - **A2 — commission is taken at settlement** (from the captured payment amount), not from the listing price.
>   This bounds N4: `price_or_terms` non-scalarity breaks GMV *modelling/analytics*, not commission *capture* —
>   UNLESS a pre-settlement surface keys off listing price (price-band listing fees, %-of-listing boost), which
>   raises N4 to CRITICAL.
> - **A3 — money-as-minor-units holds** (`price_cents`/`amount_minor` BigInt) — re-verified, unchanged. Good.

---

## NEW findings (round 3 — not present in AUDIT2/finance.md)

### N1 — Contact-reveal billing unit is dirty: an EMPTY reveal still consumes quota, writes the billable row, and fires the lead event
`revealContact()` enforces the rate-limit (line 457) and unconditionally writes a `contact_reveals` row +
`ContactReveal.Created` outbox event (lines 480-491) **before/independent of** whether any contact channel is
actually returned. `channels` is computed at 468-476 and can be **empty `{}`** when the seller has
`show_phone=false` and `show_telegram=false` (or an absent phone). Result: a buyer burns a reveal against a
listing that exposed **no contact**, and the system records a `contact_reveals` row + emits a lead event for a
**non-lead**. As a lead-gen billing/metric unit this is broken *before* monetization even begins: you would
charge (or count toward a per-lead invoice / seller lead-quota) for reveals that delivered nothing.

`[MAJOR][billing-unit][NEW] backend/src/modules/listing/listing.service.ts:457,480 → rate-limit consumed and contact_reveals row + ContactReveal.Created emitted even when channels={} (seller exposed no phone/telegram) → an empty reveal becomes a billable/countable "lead" → compute channels FIRST; if empty, return a distinct "no contact available" result that neither consumes quota nor writes a reveal row nor emits the lead event. Cheap now (pre-revenue); becomes a live-revenue correction once vet_leadgen/service lead-gen or per-lead animal billing ships → then CRITICAL.`

### N2 — Contact-reveal has NO dedup: repeat (viewer, listing) reveals create duplicate billable rows, re-burn quota, and inflate the lead KPI
`contact_reveals` (schema:975-984) has only **non-unique** indexes `idx_contact_reveals_viewer_time` and
`idx_contact_reveals_listing` — **no unique constraint on `(viewer_id, listing_id)`** — and the create at
service:480 is unconditional. So the same buyer revealing the same listing 5× writes 5 rows, burns 5 units of
the per-market hourly quota, and `ListingAnalytics.contactReveals = count(where listing_id)` (service:604)
counts **raw rows, not distinct viewers** → the near-term "leads/engagement" KPI that growth & finance will
read is inflated by repeat views. A per-lead price built on this over-counts one real lead as many.

`[MAJOR][billing-unit][NEW] backend/src/modules/listing/listing.service.ts:480 & database_schema.sql:975 → no dedup on (viewer_id, listing_id); repeat reveals = duplicate billable rows + re-burned quota + inflated contactReveals count → define the lead unit as a DISTINCT (viewer, listing) [within a window]: add a partial-unique index / upsert-on-conflict so a repeat is idempotent (no new row, no quota burn), and count DISTINCT viewer_id for the metric. Reserve the unique shape form-now — retrofitting dedup after rows are revenue/lead records means reprocessing historical billing data.`

### N3 — `feature_toggles` has no market dimension → the two markets (ADR-0002) cannot be enabled / rolled out / sequenced separately at the gate
`feature_toggles` is `(key, description, is_enabled, rollout_percentage, …)` (schema:589-596) — **market-blind**.
Every revenue toggle (`payments`, `boosted_listings`, `premium_profiles`, `vet_leadgen`, …) is therefore
all-or-nothing across **both** markets. But the ratified finance sequence monetizes **livestock first** (high
ticket pays back the 54-ФЗ/acquiring load before pet — AUDIT2 finding #4). With a global toggle you cannot flip
`payments` on for livestock while keeping it off for pet. The per-market *pattern* already exists elsewhere
(`enforceRevealRateLimit` uses `LIVESTOCK_*` vs `PET_*` limits, service:510), so the gate is the outlier.

**Can we price the two markets separately today?** *Partially.* Pricing **values** can be market-separated
(per-offering `monetization_type` + `market_scope` per ADR-0014/0015, plus the per-market rate-limit precedent).
But the **enablement/rollout gate** is market-blind → a per-market phased launch is not expressible without this fix.

`[MAJOR][forward-compat][NEW] database_schema.sql:589 → feature_toggles has no market_scope; revenue gates are global while the ratified launch monetizes livestock before pet (ADR-0002 priced separately) → decide the market-gating layer NOW: either (a) add a nullable market_scope column to feature_toggles form-now (cheapest, matches ADR-0015 vocabulary) OR (b) fix the contract that per-market gating lives in the pricing/offering layer (toggle stays global, code gates by market like the reveal limit already does). Escalate the choice to architect (touches the toggle contract). Sensitivity: if pet & livestock always launch monetization together, this is INFO; the moment a market-first launch is planned it is a blocker to that plan.`

### N4 — Livestock `price_or_terms` is non-scalar (text: "negotiable"/"8000 per straw"/"package"), but schema stores only scalar `price_cents` → GMV is uncomputable for the highest-ticket market
BR mandates `price_or_terms VARCHAR(150)` (livestock-marketplace.md:178; "negotiable" is **common** — GAP-LS-005),
but the schema has only `price_cents BIGINT` nullable (schema:252). So negotiable/договорная and package/"per straw"
livestock listings carry `price_cents = NULL` or a scalar that misrepresents "per-unit × quantity". Finance impact:
**GMV and any listing-price-derived monetization are blind exactly where the ticket is highest.** Take-rate captured
at settlement is safe (A2), but (a) GMV forecasting / marketplace-health modelling for livestock is unreliable, and
(b) any pre-settlement price-keyed monetization (price-band listing fees, %-of-listing boost) silently fails on
NULL-price rows.

`[MAJOR][consistency][NEW] database_schema.sql:252 (GAP-BA-001) → livestock price_or_terms (text/negotiable/per-unit) not representable in scalar price_cents → GMV & pre-settlement price-keyed pricing blind for the highest-ticket market → resolve GAP-BA-001 (price_terms_text or a structured {amount, unit, negotiable} form) via architect/alpha-analyst BEFORE any livestock take-rate/GMV target is set; keep commission-at-settlement as the money source (A2). Requires data-analyst actual on the negotiable-share once listings flow — if >~40% non-numeric, livestock GMV forecasting is effectively unmeasured. → requires manual verification of actual negotiable share.`

---

## Reconciliation with AUDIT2/finance.md (diff)

### C1 — Payments toggle description folds boost/premium under one gate, implying "no 54-ФЗ until payments-on"
`[CRITICAL][fiscal][CONFIRMED] database_schema.sql:686 + migrations/20260618_0011_seed_reference_data.sql:51 → payments desc "Внутриплатёжные платежи (продвижение, premium и т.п.)" unchanged; still folds boost/premium under the payments gate → boost/premium are the Operator's OWN B2C services → 54-ФЗ ККТ + acquiring the moment money is taken, independent of the payments toggle → amend boosted_listings/premium descriptions to state the independent 54-ФЗ+эквайринг trigger; scope payments desc to escrow/take-rate custody only (legal owns the ruling).` — verified still present at both seed sites.

### C2 — `premium_profiles` still conflated (Q5 split B2C-boost vs B2B-subscription never reached schema/seed)
`[MAJOR][consistency][CONFIRMED] database_schema.sql:685 / migrations/20260618_0011:50 → single row, no monetization_type, no B2C/B2B distinction → split into two form-now toggles each tagged with its monetization_type; until then annotate the row that it conflates two fiscal models.` — unchanged since round-1.

### C3 — `monetization_type` seam absent (HIGH rewrite-risk if any offering ships without it)
`[CRITICAL][forward-compat][CONFIRMED] backend/prisma/schema.prisma (0 hits) → monetization_type (lead-gen|subscription|take-rate|none) mandated by ADR-0014 §9 / ADR-0016:121 as a form-now offering field; absent → any paid offering shipped without it forces a live-revenue migration.`
**Round-3 addendum — the exact cheap form to reserve NOW (recommendation to architect/backend, not implemented here):**
one additive, backfill-free column on `listings` (the only offering subtype today):
`monetization_type VARCHAR(20) CHECK (monetization_type IN ('lead-gen','subscription','take-rate','none')) DEFAULT 'none'`
— NULL/`'none'` = unmonetized existing rows, no backfill. When the ADR-0014 polymorphic seam + discovery
read-model land, carry the **same** column onto the read-model and each subtype. (A CHECK-column is lighter and
more additive-friendly than a PG enum; an INT lookup `monetization_types` in the A2 house-style is the alternative
if a localized label is ever needed — not needed for a 4-value technical enum.) Sequence this ahead of the first
paid surface (boost/premium/vet_leadgen). This is the single highest anti-rewrite money item.

### C4 — Launch sequence financially coherent but encoded/enforced nowhere in code
`[MINOR][sequencing][CONFIRMED] migrations/20260618_0011:50 → seed lists premium_profiles/payments first while ratified order is vet_leadgen→service→goods→payments-last; not machine-encoded → add a one-line launch-rank + liquidity-precondition comment per revenue toggle (doc-level, do not gate in code).` **Note:** the *structural* half of round-1's soft-flag (b) — that the gate cannot even express per-market sequencing — is promoted to its own finding **N3** (a distinct structural gap, not cosmetic seed-order).

### C5 — `vet_leadgen` (sole fiscally-exempt model) not flagged as such in code
`[MINOR][fiscal][CONFIRMED] migrations/20260618_0011:54 → vet_leadgen desc omits it is the ONLY 54-ФЗ-exempt model (B2B invoice, pure intermediary) with immunity conditional on provider-license verification → annotate: "B2B lead-gen invoice, вне 54-ФЗ ККТ; НЕ принимать деньги потребителя in-app; иммунитет посредника ⇐ верификация лицензии провайдера."` — unchanged.

### C6 — Payment seam well-formed (`purpose_type`/`idempotency_key`) — keep aligned to `monetization_type`
`[INFO][forward-compat][CONFIRMED] backend/prisma/schema.prisma:536 → purpose_type free VarChar, no writer yet → when payments is built, constrain purpose_type to a vocabulary aligned with offering.monetization_type so B2C(ККТ)/B2B(invoice) rows are separable for fiscal reporting.` — unchanged; no money-taken path is active (StubPaymentProvider rejects while payments=off).

**No REFUTED findings.** No SEV-CHG on round-1 items (C4's structural half is broken out as new N3 rather than a severity change).

---

## Verdict summary
- **Billing-unit integrity (NEW, round-3 focus):** ⚠️ **broken pre-monetization.** The contact-reveal — the
  natural animal-marketplace lead unit — consumes quota / writes a billable row / fires the lead event on
  **empty** reveals (N1) and has **no dedup** (N2), so any per-lead price or lead KPI built on it over-counts.
  Both are cheap to fix now, expensive after reveals become revenue records.
- **Two-market separability (NEW):** pricing *values* can be market-separated; the *gate* cannot (N3) → a
  livestock-first monetization launch is not expressible today.
- **GMV computability (NEW):** livestock `price_or_terms` non-scalarity (N4) blinds GMV for the highest-ticket
  market; commission-at-settlement mitigates, price-keyed pre-settlement surfaces do not.
- **monetization_type (CONFIRMED CRITICAL):** still absent; exact cheap form specified (C3 addendum) — reserve
  before the first paid surface.
- **Fiscal framing (CONFIRMED CRITICAL):** payments toggle desc still folds boost/premium → hides the
  independent 54-ФЗ trigger (C1). Legal owns the ruling.
- **Money-as-minor-units:** ✅ holds.

*Scope note:* frontend and all un-built payment/offering behaviour are `требует ручной проверки`. Actual
negotiable-share (N4) and reveal repeat-rate (N2) require data-analyst actuals once listings flow. Final pricing
& the toggle-contract choice (N3) are the owner's / architect's — I model and recommend only.
