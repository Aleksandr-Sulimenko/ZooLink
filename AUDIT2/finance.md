# ZooLink HYPER Audit — Phase 2 · finance (monetization under forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Role:** finance specialist.
**Method:** vetted the monetization model (fiscal correctness, toggle forms, the `monetization_type`
seam, sequencing economics) against the *actual* schema/migrations/code, not the stale 2026-06-30
audit. Grounded in `AUDIT_2026-06-30.md`, `ECOSYSTEM_ADR_PLAN.md` (Q2/Q5), `future-features.md:145-227`,
ADR-0014/0016, and `AUDIT2/active-user.md`.

Finding format: `[severity][criterion][finance] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ fiscal · forward-compat · sequencing · consistency · trust.

> **Verified monetization reality baseline (2026-07-02):**
> - **Money = integer minor units — CONFIRMED GOOD.** `listings.price_cents BigInt?` (schema:285),
>   `payment_transactions.amount_minor BigInt` (:536), `refunds.amount_minor BigInt` (:577); listing DTO
>   `priceCents` is `@IsInt()` "Price in minor units" (`listing.dto.ts:97`). The anti-rewrite money convention holds.
> - **Toggles seeded form-now/off — CONFIRMED.** `feature_toggles` (migration 0011:49-59 + 0027) carries
>   `premium_profiles, payments, boosted_listings, vet_leadgen, service_marketplace, regulatory_integration,
>   digital_assets, health_passport_api, genetics_portal, goods_marketplace` — **all `false, 0`.**
>   `leasing` is NOT a toggle; it is a `listings.listing_type` CHECK value added form-now by migration 0021.
> - **Payment domain = form-now, hard-off.** `payment_transactions`/`refunds` tables exist (amount_minor BigInt,
>   `purpose_type`/`purpose_id` polymorphic, unique `idempotency_key`), but `purpose_type` is **written by no code**
>   and the provider is `StubPaymentProvider { available=false }` that *rejects loudly* — "payments are disabled
>   (feature_toggles.payments=off, ADR-0008)". **No money-taken path is active today.** GOOD.
> - **`monetization_type` = ABSENT from schema/contract.** `grep monetization_type backend/prisma/schema.prisma`
>   → zero hits. It lives ONLY in docs/ADRs. Confirms alpha-analyst/architect.
> - **`premium_profiles` split (Q5) = doc-ratified but NOT in code.** Still a single conflated toggle row.

---

## 🔴 Headline finance findings

### 1. Fiscal framing is WRONG in code: the `payments` toggle description implies boost/premium are "no-54-ФЗ-until-payments-on"
The ONLY real 54-ФЗ-ККТ-exempt model is `vet_leadgen` — a **B2B cost-per-lead invoice between legal entities**,
where ZooLink stays a pure information intermediary (ст.1253.1 ГК; `future-features.md:181`). By contrast
**`boosted_listings` and `premium_profiles` are the Operator's OWN B2C services sold to a consumer** → 54-ФЗ
ККТ (online fiscal receipt) **and** acquiring are triggered **the moment money is taken, regardless of the
`payments` toggle** (`future-features.md:181-183`; ECOSYSTEM_ADR_PLAN:58; ruling = legal).

The code says the opposite. The `payments` toggle is seeded with description **"Внутриплатёжные платежи
(продвижение, premium и т.п.)"** — it *folds boost/premium under a single "internal payments" gate*, which
reinforces exactly the dangerous reading "no fiscal obligation until `payments` flips on." Nothing in the
toggle set, schema, or migration comments records that boost/premium carry an independent 54-ФЗ+acquiring
trigger separate from `payments`. `grep -i "54-ФЗ|ккт|эквайринг|acquiring"` over `migrations/*.sql` +
`schema.prisma` = **zero hits.** So at the source-of-truth (DB seed) level, the fiscal distinction the
2026-06-30 audit flagged as CRITICAL is **still not reflected** — the doc layer (future-features, ADR plan)
states it correctly, but the toggle descriptions still imply "no 54-ФЗ."

`[CRITICAL][fiscal][finance] migrations/20260618_0011_seed_reference_data.sql:51 → payments toggle desc "Внутриплатёжные платежи (продвижение, premium и т.п.)" folds boost/premium under the payments gate, implying no 54-ФЗ/acquiring until payments is on; boost/premium are the Operator's OWN B2C services → 54-ФЗ ККТ + acquiring the moment money is taken, independent of the payments toggle → amend boosted_listings/premium_profiles toggle descriptions to state "приём денег ⇒ 54-ФЗ ККТ + эквайринг (независимо от toggle payments); требует платёжного рельса"; keep payments desc scoped to escrow/take-rate custody only; legal owns the ruling.`

### 2. `premium_profiles` is still CONFLATED in code — the Q5 split (B2C-boost vs B2B-subscription) never reached schema/seed
ECOSYSTEM_ADR_PLAN Q5 (owner-ratified 2026-07-01) says `premium_profiles` must be **split into two distinct
concepts** — a B2C consumer boost (→ 54-ФЗ ККТ) vs a B2B subscription (→ invoice) — with **distinct
`monetization_type`** (ADR-0014 §9; ADR-0016:121). In the actual DB it is **one undifferentiated row**:
`('premium_profiles', 'Включить премиум-профили с расширенной галереей и аналитикой', false, 0)`
(migration 0011:50). No second toggle, no `monetization_type`, no B2C/B2B distinction. The two halves have
**different fiscal treatment and different launch timing**, so leaving them merged means when either ships the
other's fiscal rail is ambiguous — a rewrite risk and a compliance trap. This is a doc↔code DRIFT: the ADR
says "split," the seed still conflates.

`[MAJOR][consistency][finance] migrations/20260618_0011_seed_reference_data.sql:50 → premium_profiles is a single conflated toggle; ECOSYSTEM_ADR_PLAN Q5 (ratified) + ADR-0014 §9 require it SPLIT into B2C-boost (54-ФЗ ККТ) vs B2B-subscription (invoice) with distinct monetization_type → still merged, no monetization_type → split into two form-now toggles (e.g. profile_boost B2C / provider_subscription B2B) each tagged with its monetization_type when the offering seam lands; until then annotate the row that it conflates two fiscal models.`

### 3. `monetization_type` seam ABSENT — HIGH rewrite-risk if any offering ships without it
ADR-0014 §9 mandates `monetization_type` (`lead-gen | subscription | take-rate | none`) as a **form-now field
on the offering side** so the business model flips without a refactor; ADR-0014:57/89/116 puts it on the
discovery read-model and the offering; ADR-0016:121 fixes it *on the offering, not the provider*. Q2 explicitly
names it (with money-as-integer-minor-units) as the *only* seam escrow needs reserved now. **It does not exist
in the schema.** `favorites` (schema:234) is still a `listing_id`-only FK (not polymorphic `(offering_type,
offering_id)`), `saved_searches` (schema:588) stores a raw `filters` JSON with no `offering_type`, and there is
no discovery read-model table and no `monetization_type` column anywhere.

**Rewrite-risk rating: HIGH — but not yet realized.** Today no offering/promotion/subscription surface is built
(active-user baseline: ServiceOffering/ProductOffering/boost/premium have no controller), so nothing is *shipping*
without `monetization_type` yet — the seam is merely un-reserved, not violated. The risk becomes CRITICAL the
moment the **first** paid surface (boosted_listings, premium split, or vet_leadgen) is built: without the field,
switching a side from lead-gen → subscription → take-rate is a schema+contract+backfill migration on live
revenue rows, i.e. exactly the anti-rewrite scenario ADR-0014 exists to prevent. Because it is a cheap form-now
column, the cost-of-change rule says reserve it **before** the first offering, not with it.

`[CRITICAL][forward-compat][finance] backend/prisma/schema.prisma (no monetization_type column) → ADR-0014 §9 / ADR-0016:121 / ECOSYSTEM_ADR_PLAN Q2 require monetization_type (lead-gen|subscription|take-rate|none) as a form-now offering field; absent from schema+contract → any paid offering shipped without it forces a live-revenue migration to switch models → land the form-now polymorphic offering migration (offering_type + monetization_type + geo_anchor per ADR-0014:116) BEFORE the first paid surface; sequence it ahead of boosted_listings/premium/vet_leadgen build. (owner+architect: this is the single highest anti-rewrite item on the money side.)`

### 4. Sequencing economics are financially coherent in docs — but the sequence/dependency is encoded NOWHERE in code
The documented order (future-features §D + ECOSYSTEM Q2/Q6) is financially sound and I endorse it:
`vet_leadgen` (fiscally lightest, B2B invoice, pure intermediary) → `service_marketplace` (lead-gen → later
take-rate) → `goods_marketplace` → **`payments`/escrow LAST** (enable only once GMV covers 54-ФЗ/115-ФЗ/161-ФЗ +
acquiring; livestock's high ticket pays it back before pet). Monetization-ON only *after* liquidity is correct:
premium-first on thin two-sided supply suppresses the very supply it needs (finance+growth). Escrow-last is
correct: it is the heaviest compliance load (115-ФЗ AML + 161-ФЗ payment-agent limits) and irreversible-piece-free,
so deferring it forces no rewrite (Q2). This is coherent.

Two soft flags: (a) the toggle **seed order** in 0011 lists `premium_profiles`/`payments` FIRST — cosmetic only
(seed order ≠ launch order), but a reader could misread it as priority; (b) the sequence and its
liquidity-precondition live only in prose — there is no machine-readable dependency/precondition on the toggles.
Acceptable for now (roadmap is the right home), but note the economics are not enforceable at the gate.

`[MINOR][sequencing][finance] migrations/20260618_0011_seed_reference_data.sql:50 → toggle seed lists premium_profiles/payments first while the ratified launch sequence is vet_leadgen→service→goods→payments-last (monetization only post-liquidity) → seed order ≠ launch order but reads as priority; no precondition encoded → add a one-line comment per revenue toggle noting its launch-sequence rank + liquidity precondition (doc-level; do not gate in code).`

### 5. vet_leadgen — the sole fiscally-exempt model — is not flagged as such anywhere in code
`vet_leadgen` is the linchpin of the "stay a pure intermediary" strategy: B2B cost-per-lead billed by invoice
between legal entities is the **only** revenue model genuinely outside 54-ФЗ ККТ. Its toggle description
("Генерация лидов для ветеринарных клиник", 0011:54) carries no note of its fiscal specialness or the
intermediary-immunity precondition (provider license verification, ADR-0016 / `future-features.md:190`). If a
future builder reads the toggle set and treats all revenue toggles as fiscally alike, the one model that must
stay invoice-only (never take consumer money in-app) could be wired through the same acquiring rail as boost —
collapsing the exemption. Worth an explicit annotation.

`[MINOR][fiscal][finance] migrations/20260618_0011_seed_reference_data.sql:54 → vet_leadgen desc omits that it is the ONLY 54-ФЗ-exempt model (B2B invoice, pure intermediary) and that intermediary immunity is conditional on provider-license verification (ADR-0016) → a builder could route it through the boost acquiring rail and lose the exemption → annotate the toggle: "B2B lead-gen invoice, вне 54-ФЗ ККТ; НЕ принимать деньги потребителя in-app; иммунитет посредника ⇐ верификация лицензии провайдера."`

### 6. INFO — payment domain seam is well-formed; keep purpose_type ready for monetization_type
`payment_transactions.purpose_type VarChar(40)` + `purpose_id Uuid` is a decent polymorphic money-attribution
seam and `idempotency_key` is unique (webhook-idempotency ready, matches `future-features.md:186` "подписанные и
идемпотентные webhook"). When `monetization_type` lands, ensure `purpose_type` values map cleanly to the
offering's `monetization_type` (boost/premium/subscription/take-rate) so fiscal reporting can partition B2C
(54-ФЗ ККТ) from B2B (invoice) rows. No change now — just don't let the two vocabularies diverge.

`[INFO][forward-compat][finance] backend/prisma/schema.prisma:536 → payment_transactions.purpose_type is a free VarChar with no code writer yet and no link to monetization_type → when payments is built, constrain purpose_type to a vocabulary aligned with offering.monetization_type so B2C(ККТ)/B2B(invoice) rows are separable for fiscal reporting.`

---

## Finance probes  (concrete assertions for Phase-3 to run)

> Format: **probe → how to check → pass condition.** Runnable against the `backend` build / schema.

1. **No money-taken path active while `payments` is off.**
   Check: attempt any `PaymentProvider.createPayment(...)` in the running app; grep for any live writer of
   `payment_transactions` / `purpose_type`.
   Pass: provider rejects with `ProviderError('payment','config', … feature_toggles.payments=off)`
   (`stub-payment.adapter.ts:17`); **zero** production code writes `payment_transactions`. FAIL if any path
   inserts a payment row or charges while the toggle is off.

2. **`monetization_type` is present on the offering seam.**
   Check: `grep -i monetization_type backend/prisma/schema.prisma` and the OpenAPI contract.
   Pass (desired): a `monetization_type` column/field exists on the offering/read-model with domain
   `{lead-gen, subscription, take-rate, none}`. **Actual today: FAIL (absent)** — proves finding #3.

3. **All money amounts are integer minor units (no floats/decimals for money).**
   Check: `grep -iE "price|amount|fee|cost" backend/prisma/schema.prisma | grep -iE "Float|Decimal"`.
   Pass: no money field is `Float`/`Decimal`; `price_cents`, `amount_minor` are `BigInt`. Currently PASS.

4. **Every revenue toggle ships form-now and OFF.**
   Check: query `SELECT key,is_enabled,rollout_percentage FROM feature_toggles` for
   `payments, boosted_listings, premium_profiles, vet_leadgen, service_marketplace, goods_marketplace,
   regulatory_integration`.
   Pass: all rows exist with `is_enabled=false, rollout_percentage=0`. Currently PASS.

5. **`premium_profiles` is split into B2C-boost vs B2B-subscription with distinct monetization_type.**
   Check: count `premium`-related toggles / offering rows and their `monetization_type`.
   Pass (desired): two distinct concepts, distinct `monetization_type`. **Actual today: FAIL (single conflated
   toggle, no monetization_type)** — proves finding #2.

6. **Boost/premium cannot take consumer money without the fiscal rail present.**
   Check: assert there is NO code path that accepts consumer payment for a boost/premium purchase while
   `feature_toggles.payments=off` AND no 54-ФЗ receipt integration is wired.
   Pass: no such path exists today (offerings unbuilt + stub rejects). Guards against silently shipping a B2C
   charge before the 54-ФЗ ККТ + acquiring rail (finding #1).

7. **vet_leadgen never routes through consumer acquiring.**
   Check (when built): assert `vet_leadgen` billing is invoice/B2B only and never calls the consumer
   `PaymentProvider` / creates a 54-ФЗ consumer receipt.
   Pass (desired): lead-gen charges are B2B-invoice, distinct from the B2C acquiring path — preserves the sole
   fiscal exemption (finding #5). Not yet buildable; assertion reserved.

8. **Webhook idempotency + minor-units on the payment seam.**
   Check: `payment_transactions.idempotency_key` is UNIQUE; `amount_minor` is BigInt.
   Pass: both hold (schema:536, unique idempotency_key). Guards double-charge and float-money regressions
   before `payments` flips on.

---

## Verdict summary
- **Fiscal correctness:** ⚠️ **Docs correct, CODE still implies "no 54-ФЗ."** The `payments` toggle description
  folds boost/premium under one "internal payments" gate — the exact framing that hides the independent
  54-ФЗ-ККТ+acquiring trigger. Not fixed at the source-of-truth (seed) level (finding #1).
- **`monetization_type` rewrite-risk:** **HIGH (unrealized).** Absent from schema/contract; harmless *only*
  because no paid surface is built yet — becomes a live-revenue migration the moment the first one ships.
  Reserve the form-now column BEFORE any offering (finding #3).
- **`premium_profiles` split:** **NOT done in code.** Q5 ratified the split; the DB still has one conflated
  toggle with no `monetization_type` (finding #2).
- **Sequencing:** financially coherent in docs; not encoded/enforced in code (acceptable) (finding #4).
- **Money-as-minor-units:** ✅ holds (BigInt throughout).

*Scope note:* frontend and any un-built payment/offering behaviour are `требует ручной проверки`. I audited
schema, migrations, seeds, and payment-provider code only; I modified no product code or docs — this file is my
sole output. No commit, no push.
