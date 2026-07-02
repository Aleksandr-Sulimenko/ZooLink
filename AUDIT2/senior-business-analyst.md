# ZooLink HYPER Audit — Phase 2 · senior-business-analyst (traceability & "nothing dropped silently", forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** traced BR → spec → ADR → schema → code → test end-to-end against the 2026-07-01 fix-wave; verified each GAP-BA-001..011 against the *actual* schema (`database_schema.sql`), migrations (`./migrations/*`), BR docs (`docs/02-requirements/business-requirements/*`), the ecosystem ADRs (0014/0015/0016), and the live traceability matrix. Cross-checked against Phase-1 `AUDIT2/active-user.md`.

Finding format: `[severity][criterion][sba] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ traceability · dropped-need · forward-compat · matrix-freshness · contract.

> **Verified fix-wave reality (corrects the stale 06-30 audit):** the 2026-07-01 wave landed real structural work — ecosystem ADR-0014 (Offering supertype / polymorphic seam), ADR-0015 (`market_scope` refines ADR-0002), ADR-0016 (provider model) are **all `Status: Accepted`, owner-ratified 2026-07-01**; `feature_toggles.goods_marketplace` is **seeded** (`database_schema.sql:697` + migration `0027`); `users.contact_phone/telegram/prefs` **columns exist** (`:970-973`, ADR-0019); GAP-BA-003/005/006/009 are **doc-annotated closed** in the BR set. This is a genuine forward-compat win at the *decision* layer. What remains open is concentrated at the **BR-contract**, **code write-path**, and **traceability-matrix** altitudes.

---

## 🔴 Headline: GAP-BA verdicts (closed by fix-wave vs still open)

| GAP | Subject | Verdict | Evidence |
|-----|---------|---------|----------|
| **BA-001** | `price_or_terms` VARCHAR vs `price_cents` BIGINT | **STILL OPEN** | BR still mandates text; schema int-only; no `price_terms_text` |
| BA-002 | listing location model (`location_city_id`) | **OPEN / drift** | BR mandates `location_city_id` FK; schema stores `lat/lng` only |
| BA-003 | breed filter-vs-boost | ✅ CLOSED | `matching-domain.md:44` aligned to spec |
| BA-004 | `contact_method_visibility` | **OPEN (naming + no write-path)** | BR boolean vs schema `contact_prefs` JSONB; no DTO to set it → contact-reveal dead |
| BA-005 | `show` listing_type ruleless | ✅ CLOSED | pet+livestock BR annotate as Фаза-2 form-only |
| BA-006 | `name_localized` Optional∧Required | ✅ CLOSED | `organization-domain.md:16` aligned |
| BA-007 | address required/nullable | **требует ручной проверки** | not doc-annotated; BR:29 "optional address precision" |
| BA-009 | livestock ownership rule asymmetric | ✅ CLOSED | `livestock-marketplace.md:201` synced to shared invariant |
| **BA-011** | `goods_marketplace` toggle | ✅ CLOSED (schema) | `database_schema.sql:697` + migration `0027` seeded, default off |

**Net: 4 of 9 doc-GAPs closed (003/005/006/009); BA-011 closed in schema; BA-001/002/004 remain live traceability breaks; BA-007 unverified.**

---

## Traceability breaks (BR → schema → code)

- `[CRITICAL][contract][sba] docs/02-requirements/business-requirements/pet-marketplace.md:170 (+livestock-marketplace.md:178) → BR mandates price_or_terms VARCHAR(100)/(150) text ("negotiable","free","8000 per straw","pick of litter"); schema has price_cents BIGINT only (database_schema.sql:252), no price_terms_text; code uses priceCents int (listing.dto.ts:97) → livestock "договорная / за голову / за кг" and stud_service fee-terms are UNREPRESENTABLE. GAP-BA-001 was NOT fixed by the wave (unlike 003/005/006/009). The doc IS the contract (prime-directive #3) and it is unsatisfied → either add price_terms_text (+ keep price_cents for numeric) or amend the BR to price_cents and delete price_or_terms. architect/alpha-analyst.`
- `[CRITICAL][traceability][sba] docs/02-requirements/business-requirements/pet-marketplace.md:31 → BR requires contact_method_visibility (boolean: show phone/socials after moderation); schema seam exists as contact_prefs JSONB (database_schema.sql:972, default {show_phone:true}) BUT there is NO write-path: UpdateProfileDto (identity.dto.ts) exposes no contactPhone/contactTelegram/contact_prefs field (grep: 0 hits) and register never sets contact_phone → contact-reveal returns empty channels (active-user BLOCKER #1). The requirement is present and un-dropped in docs, but DROPPED in implementation end-to-end. GAP-BA-004 also carries a naming drift (BR boolean vs schema JSONB). → add contact + visibility fields to PATCH /me; backfill contact_phone from verified login phone; reconcile BR field name.`
- `[MAJOR][contract][sba] docs/02-requirements/business-requirements/pet-marketplace.md:171 → BR data-model mandates location_city_id INT (FK to cities) as the listing location; schema stores lat/lng DOUBLE (+ optional location_point GEOGRAPHY, database_schema.sql:266-330), NO location_city_id column on listings → BR↔schema location-model drift (GAP-BA-002 not annotated closed). Same table also has title VARCHAR(100) in BR vs title_localized JSONB in schema (:250) and price_or_terms vs price_cents → the whole BR data-model table is stale against the localized-JSONB reality. → refresh the BR data-model tables to the JSONB/lat-lng schema, or amend schema; note which is the intended source of truth.`
- `[MINOR][traceability][sba] docs/02-requirements/business-requirements/pet-marketplace.md:29 → GAP-BA-007 (address required vs nullable) has no fix annotation; BR says "city + optional address precision"; schema has no listing address column at all → требует ручной проверки whether the fix-wave addressed it or it was folded into geo-privacy (coarse location) decisions.`

## Dropped / untracked Phase-1 needs (apex "nothing dropped silently")

- `[INFO][forward-compat][sba] docs/04-decisions/0016-provider-model.md:18,48 → active-user's "missing service-provider roles" (trainer/walker/boarding/shelter/goods-seller) and "no progressive onboarding" are NOW tracked: ADR-0016 (Accepted 2026-07-01) reserves INDIVIDUAL provider_kind + progressive just-in-time roles form-now; future-features.md:167 states the comfort BR → NOT silently dropped at the decision layer. Verdict: reserved, gated, honest. Good.`
- `[MAJOR][dropped-need][sba] docs/specs/traceability Matrix.md (whole) + docs/02-requirements/* → the ecosystem apex-BR (services/goods/expertise, one-account, progressive roles, find-nearby, unified provider profile, booking lifecycle) lives ONLY in discovery (future-features.md §A-G) and decisions (ADR-0014/0015/0016). It is NOT lifted into the REQUIREMENTS layer as reserved BR IDs, and NOT present in the traceability matrix (17 rows = BR-001..017, zero ecosystem/offering/provider/goods/north-star mentions). At the BR/matrix altitude these apex needs ARE dropped — a builder reading only the BR set + matrix would not see them. → mint reserved BR IDs (e.g. BR-018 ServiceOffering, BR-019 goods, BR-020 provider-profile, BR-021 booking, BR-022 reviews) and add matrix rows pointing to the ADRs, even if "gated/deferred".`
- `[MAJOR][forward-compat][sba] docsRU/01-discovery/future-features.md:201 → the north-star (частота × широта = completed value-events per active pet-household) exists ONLY in discovery. It is NOT expressed as an NFR/measurable requirement, NOT in the matrix, and event-capture is history-irrecoverable (audit conflict #7). analytics.views is hard-0 (listing.dto.ts:420). → reserve a north-star instrumentation NFR (value-event family *.Completed, household proxy) in docs/02-requirements/nfr and start coarse capture now; the requirement altitude currently drops it.`

## Forward-compat BR-seam gaps (decided but not yet formed)

- `[MAJOR][forward-compat][sba] docs/04-decisions/ECOSYSTEM_ADR_PLAN.md:112 → the form-now seams the ADRs mandate (multi-role roles[], OfferingRef{type,id} in favorites/saved-search/discovery, monetization_type, first-class geo-anchor, Reviews/Reputation seam) are DECIDED (ADR-0014/0016) but ABSENT from schema/contracts — no migration adds them (0026 owntransfer, 0027 goods-toggle, 0028 PII only). The Part-B audit's "form-now seams declared but absent from schema/contracts" STILL holds. This is acceptable as gated Stage-0 handoff, but flag it: the anti-rewrite value is only realized once the seams land, and every day of new listing rows without OfferingRef is retrofit debt. → sequence the seam migrations before Stage-1 code (owner go).`
- `[INFO][forward-compat][sba] docs/01-discovery/future-features.md:219-220 → Booking lifecycle (ADR-D) and Reviews/Reputation (ADR-E) are NAMED as ADRs-to-create-later, not yet written. Correctly reserved (not dropped), but they are the two apex-BR comfort pillars (booking lifecycle, trust layer) with no document yet → confirm they are on the ADR backlog so they don't silently lapse.`

## Traceability-matrix freshness

- `[MAJOR][matrix-freshness][sba] docs/specs/traceability Matrix.md:2-3 → matrix is still version 1.3 / lastUpdated 2026-06-30; the 2026-07-01 fix-wave is NOT reflected at all: no rows/refs for ADR-0014/0015/0016, no goods_marketplace toggle, no ecosystem BR, no north-star. The audit's own P2 action "traceability matrix refresh" is NOT done. GAP-BA-003/005/006/009 are de-facto closed in the BR docs but the matrix carries no closure trace. → bump to v1.4, add the ecosystem BR rows + ADR columns, mark closed GAPs.`
- `[MINOR][matrix-freshness][sba] docs/specs/traceability Matrix.md:27 → BR-016 lists favorites-api.yaml (GET /favorites, POST/DELETE /listings/{id}/favorite) as if delivered, but no favorites controller exists in backend (active-user confirms vision-only) → matrix implies coverage that code lacks; mark favorites as reserved/unbuilt.`
- `[MINOR][matrix-freshness][sba] docs/01-discovery/future-features.md:184 → still reads "New toggle to register: goods_marketplace (flagged to architect)" though the toggle is now seeded (schema:697 + migration 0027) → stale note; update to "registered (0027, off)". Same closure-trace gap as the matrix.`

---

## Requirement-coverage probes (BR → observable acceptance check for Phase-3)

> Each probe: apex/critical BR → concrete assertion Phase-3 reviewer-qa/backend can run against the `backend` build.

1. **BR pet/livestock price expressiveness (GAP-BA-001).** FARMER (or dev-token) creates a livestock `sale` listing intending "20 голов, договорная". *Assert:* only integer `price_cents` + integer `quantity` are storable; there is no field to persist "договорная"/"per head" text. **Expected today: fails (no text terms) → proves BA-001 open.** Coverage passes only when `price_terms_text` exists OR the BR is amended to price_cents and the text examples removed.
2. **BR-003 contact_method_visibility end-to-end (GAP-BA-004 / active-user #1).** Seller sets phone visible via `PATCH /v1/me`; buyer `POST /v1/listings/{id}/contact-reveal`. *Assert:* (a) `PATCH /me` accepts a contact/visibility field (today: rejected/absent), (b) reveal returns a non-empty `channels`. **Expected today: fails at (a) → the requirement is not covered end-to-end.**
3. **Ecosystem apex-BR traceability (dropped-need).** Grep the traceability matrix for `goods_marketplace | ServiceOffering | ADR-0014 | provider`. *Assert:* at least one matrix row references each accepted ecosystem ADR. **Expected today: 0 hits → matrix does not trace the apex-BR.** Coverage passes when reserved BR rows exist.
4. **goods_marketplace gate is FORM-now-only (BA-011).** Query `feature_toggles WHERE key='goods_marketplace'`. *Assert:* row exists, `is_enabled=false`, and no code path reads it (grep backend/src = 0). **Expected: passes (seeded, off, inert) → confirms honest gate.**
5. **Progressive-role BR (ADR-0016 §2).** Register as USER; attempt self-upgrade to a provider/FARMER role. *Assert:* no self-service endpoint yet (only ADMIN `PATCH /admin/users/:id/role`) AND ADR-0016 documents the reserved seam. **Expected: 403/404 for self + ADR present → reserved-not-built (honest); flags when the seam must land.**
6. **market_scope refinement (ADR-0015 / BA-002 location).** Create pet + livestock listings. *Assert:* market is derived from the animal's species (`marketOf`), markets never mix in discovery, and (BA-002) note that listing location is `lat/lng`, not `location_city_id` as BR states. **Expected: market-split holds; location-model drift surfaces → documents BA-002.**
7. **North-star value-event capture (forward-compat).** Activate a listing, mark it SOLD. *Assert:* a `Listing.Sold` value-event is emitted with `market`/`occurredAt` and `analytics.views` reflects real views. **Expected today: Sold event emits but `views` is hard-0 (listing.dto.ts:420) → north-star denominator uninstrumented; coverage fails until capture starts.**
8. **`show` listing_type is form-only (BA-005).** Create a `show` listing. *Assert:* accepted into the enum but no `show`-specific rule/price/flow fires (identical handling to `sale`). **Expected: passes → matches the annotated BR (form present, behaviour deferred).**

**Probe count: 8** (covers BA-001, BA-004, ecosystem-BR traceability, BA-011, progressive-role, market_scope/BA-002, north-star, BA-005).

---

*Scope note:* I audited docs + schema + migrations + DTO signatures only; runtime behaviour of the fix-wave and GAP-BA-007 address handling are `требует ручной проверки` by reviewer-qa/backend. No product code or docs were modified; this file is my sole output.
