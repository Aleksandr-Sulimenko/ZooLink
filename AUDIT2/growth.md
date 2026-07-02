# ZooLink HYPER Audit — Phase 2 · growth (liquidity / cold-start / sequencing, FORWARD-COMPAT lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Role:** growth (go-to-market, activation, retention, marketplace liquidity, AARRR + North-star).
**Method:** read the ratified vision (`future-features.md:145-227` §A–G, `ECOSYSTEM_ADR_PLAN.md` Q1–Q6, ADR-0014–0019), then grepped the live schema + code for every growth-critical seam (consent, reverse-request, roles[], per-city liquidity, favorites/saved-search polymorphism, monetization_type, referral, value-events). Grounded in `AUDIT2/active-user.md` as the demand-signal / lived-experience proxy.

Finding format: `[severity][criterion][growth] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ liquidity · cold-start · retention · onboarding · north-star · forward-compat · sequence.

> **Verified reality baseline (2026-07-02):** growth-relevant *plans* are ratified and documented (ADR-0014/0015 Accepted; goods_marketplace/service_marketplace/vet_leadgen/boosted_listings/premium_profiles/payments toggles all seeded `false,0`), but growth-critical *seams in code* are largely **absent or listing-bound**. The gap this audit measures is **plan (rich) vs seam (thin)** — the sequence is coherent on paper; the product is not yet shaped so that executing it avoids a rewrite.

---

## 🔴 Headline growth risks (kill or cripple launch/retention for real)

### 1. Retention engine is legally ungated — no consent seam (ФЗ-38). The LTV prize can't be collected.
The vision's retention engine = повторный заказ / подписка / boosted-push / lifecycle messaging (`future-features.md:154,206`) — **all of it is advertising** under ФЗ-38 ст.18 (opt-in) once it reaches a user's phone/email/push. The only user-preference structure that exists is `users.contact_prefs JSONB` (`database_schema.sql:972`), which the code uses solely for **contact-reveal visibility** (`show_phone`/`show_telegram`). There is **no marketing-consent field, no transactional-vs-marketing split, no double-opt-in, no consent table or timestamp/source of record**. So the day retention messaging ships, we either message without lawful basis (ФЗ-38 violation, legal's 06-30 BLOCKER) or bolt on consent retroactively with no historical opt-in to rely on. This is the single most expensive retrofit in the growth surface because **consent must be captured at the moment of the action, not reconstructed later** (same irrecoverability class as `views`).

`[BLOCKER][retention][growth] database_schema.sql:972 → contact_prefs holds only reveal-visibility; no marketing/transactional consent split, no double-opt-in, no consent-of-record (grant source+timestamp) anywhere in schema/code → retention engine (reorder/subscription/boosted/lifecycle push = ФЗ-38 advertising) has no lawful-basis seam; retrofitting loses all historical opt-in → reserve a consent model NOW (marketing_consent {channel, granted_at, source, withdrawn_at} form-now, default off), coordinate wording with legal. Reaffirms [BLOCKER][growth+legal] AUDIT_2026-06-30:85 — still unaddressed.`

### 2. Demand-side cold-start has no answer — the reverse "Request" object doesn't exist even as a seam.
Growth's 06-30 audit position (`AUDIT_2026-06-30.md:87`) and the orchestrator addendum (`future-features.md:205` §E) both call to **lift the reverse-marketplace "Запрос" into Stage 1** — a buyer posts a need ("выгул в районе X завтра 18:00"), providers respond — precisely because it delivers value **before** dense supply exists, the only real lever against a two-sided cold-start. There is **zero seam** for it: no request/wanted/demand object in schema, no controller, no reservation. Every discovery path today is supply-first (`GET /listings` needs ACTIVE listings to exist). With supply thin per-city (see #3), a supply-first-only product shows "0 результатов" and the visitor leaves. The one mechanism designed to break that is unbuilt and unreserved.

`[CRITICAL][cold-start][growth] database_schema.sql (whole) → no reverse-marketplace/"Request" (buyer-posts-need) object exists or is reserved; all discovery is supply-first → demand-side cold-start unaddressed; the vision's own Stage-1 wedge (future-features.md:205) has no anchor → reserve a Request/Demand seam (author, market_scope, geo-anchor, offering_type-of-need, expires_at) form-now so it can lift into Stage 1 without a rewrite. Route structural shape to architect (fits ADR-0014 polymorphic family).`

### 3. Supply can't self-onboard — progressive/just-in-time roles are the growth blocker.
Independently confirms active-user #3. `users.role` is a **single VARCHAR** (`database_schema.sql:115`), registration hard-codes `USER` (`identity.service.ts:100`), and the only role-change path is **ADMIN-only** (`admin-user.controller.ts:21`). The apex comfort-BR is *«прогрессивные just-in-time роли … роль активируется при первом действии, без новой регистрации»* (`future-features.md:167`) and the form-now seam is *«модель мульти-роль аккаунта + паттерн прогрессивного онбординга»* (`future-features.md:210`). Neither is reserved: role is singular, not `roles[]`. **For growth this is the supply-seeding blocker** — every service provider (groomer/vet/walker/trainer) the Stage-1 wedge depends on must be hand-promoted by an admin, so supply cannot scale except by manual ops. You cannot seed a two-sided market when one side requires a human admin per signup.

`[CRITICAL][onboarding][growth] backend/src/modules/identity/admin-user.controller.ts:21 → role is single-valued (database_schema.sql:115), register hard-codes USER (identity.service.ts:100), role change ADMIN-only; no roles[] and no self-serve claim → provider supply cannot self-onboard at scale; blocks progressive just-in-time roles (future-features.md:167,210) and the entire Stage-1 services wedge → design roles[]/multi-role + self-service role-claim seam now (ADR-0016 is still Proposed — surface as the growth-gating dependency).`

### 4. Liquidity is per-city and there is no supply-seeding path or empty-state capture.
Liquidity = **category × city**, not global (`AUDIT_2026-06-30.md:87`; `future-features.md:199` "тонкий supply везде → «грумер рядом: 0 результатов» убивает обещание удобства"). The geo primitives for the **demand** query exist (animals/users carry `city_id`, `database_schema.sql:68,109`; `saved_searches` carries `lat/lng/radius_m`, `:365-367`). But there is **nothing on the supply side**: `cities` is a bare lookup (`id + name_localized + sort_order`, `database_schema.sql`), with no per-city supply/liquidity signal, no seeding workflow, and — critically — **no empty-state capture**: a "0 results in your city" hit is a silent dead-end, not a lead ("notify me / post a request / invite a provider"). The comfort promise dies city-by-city with no instrument to detect or repair the hole.

`[CRITICAL][liquidity][growth] database_schema.sql (cities, bare lookup) → no per-city supply/liquidity signal and no empty-result capture path (0-results is a silent dead-end) → per-city cold-start ("грумер рядом: 0") kills the comfort promise with no seam to detect the hole or convert the miss into demand/invite → instrument per-(category,city) supply density (data-analyst) + add an empty-state capture seam (feeds the Request object #2 and referral #8). Seed supply directly per-city, not "post-purchase on thin base" (growth position, AUDIT_2026-06-30:87).`

---

## Forward-compat growth-seam gaps (decision-made-now that forces a later rewrite)

### 5. favorites is hard-bound to listing_id — not polymorphic (OfferingRef seam missed).
`favorites` (`database_schema.sql:349-355`) FKs directly to `listings(id)` with `uq_favorite_user_listing`. ADR-0014 + `future-features.md:210` explicitly reserve a **polymorphic OfferingRef {offering_type, offering_id}** "form-now, cheap as a seam, expensive to retrofit" across discovery/moderation/**favorites**/saved-search. Favorites was built listing-only → when services/goods/consultations ship, a buyer cannot favorite a groomer or a feed-subscription without a schema migration + data backfill. This is exactly the anti-pattern the ADR names.

`[MAJOR][forward-compat][growth] database_schema.sql:349 → favorites FK-bound to listing_id, no offering_type/offering_id → cannot favorite polymorphic offerings (services/goods); contradicts the form-now OfferingRef seam (future-features.md:210, ADR-0014 §F) → add offering_type discriminator (keep listing back-compat) before Stage-1 services ship; route to architect.`

### 6. saved_searches.filters is a raw JSONB blob — no first-class offering_type.
`saved_searches.filters JSONB` (`database_schema.sql:363`) stores an opaque query. The polymorphic-discovery seam (`future-features.md:210`) wants `offering_type` reservable so a saved search can be scoped to a market/offering vertical when discovery goes polymorphic. Today it can only live un-enforced inside the JSON blob → no index, no validation, no guaranteed presence. Softer than #5 (JSON *can* carry it), but it means discovery-polymorphism has no first-class hook here.

`[MAJOR][forward-compat][growth] backend/.../saved-search + database_schema.sql:363 → filters is opaque JSONB; no first-class offering_type/market_scope column → polymorphic discovery (ADR-0014/0015) has no enforced hook in saved-search → reserve offering_type/market_scope as a typed field when discovery goes polymorphic (coordinate with architect on ADR-0014 rollout).`

### 7. No monetization_type field on any offer/side.
`future-features.md:186,210` and ADR-0014 reserve `monetization_type ∈ {lead_gen, subscription, take_rate}` **form-now** so the model can switch (lead-gen → in-app booking → take-rate) without a refactor. No such column exists anywhere. The gating toggles exist (`vet_leadgen`, `service_marketplace`, `boosted_listings`, `payments`) but the **per-side switchable field** does not. Deferred-behind-ADR is defensible, but the audit position (and the ADR) explicitly rank this as cheap-now / expensive-later.

`[MAJOR][forward-compat][growth] database_schema.sql (no monetization_type anywhere) → the form-now switchable field (future-features.md:186,210) reserved by ADR-0014 is unbuilt → switching lead-gen→subscription→take-rate later forces a per-side migration → add monetization_type when the first Offering subtype table is created (architect/ADR-0014).`

### 8. No referral/invite hooks — AARRR "Referral" stage has zero surface.
Grep finds **no** referral, invite, promo-code, or invitation seam in schema or code. Referral/invite is the **cheapest RF-market acquisition loop** (VK/Telegram share, breeder/farmer community virality) and doubles as the fix for the #4 empty-state ("invite a groomer to your city"). Its absence isn't a launch blocker but it removes the lowest-CAC growth lever and the natural per-city supply-seeding channel.

`[MAJOR][forward-compat][growth] whole repo → no referral/invite/promo seam (AARRR Referral stage absent) → lowest-CAC RF acquisition loop + organic per-city supply-seeding channel unavailable; retrofitting attribution loses early-cohort provenance → reserve a lightweight referral/invite seam (code, referrer_id, redeemed_at) form-now; ties to consent (#1) and empty-state capture (#4).`

### 9. North-star ("частота × широта") is ~1-of-3 instrumented; irrecoverable history is being lost daily.
North-star = завершённые value-события (продажа / бронь услуги / заказ) на активное домохозяйство (`future-features.md:201`). Of the three value-event types: **продажа** emits (`Listing.Sold`, `listing.service.ts:577` — good, the outbox seam is solid); **бронь услуги** and **заказ** cannot emit (those sides are unbuilt — expected). But the two measurable proxies today are broken: `views` is hard-`0` with no capture source (`listing.service.ts:617`, irrecoverable), and `ContactReveal.Created` emits but the reveal returns empty channels (active-user #1) so it's a false signal. Net: the North-star numerator captures ~one event class, its denominator ("активное домохозяйство") has no session/impression instrumentation, and impression history is lost every day it isn't captured. Cross-checks **data-analyst's ~15% instrumentable** — consistent; the constraint is missing events (views/impressions/sessions), not the outbox mechanism, which is reusable.

`[MAJOR][north-star][growth] backend/src/modules/listing/listing.service.ts:617 → views hard-0 (no capture), ContactReveal.Created fires but returns empty (active-user #1); only Listing.Sold is a real value-event → North-star "frequency×breadth" numerator ≈1/3 event-types, denominator (active pet-household) uninstrumented; impression history irrecoverable → instrument view/impression + session/household activity from day one on the existing outbox seam (with data-analyst). Confirms data-analyst ~15%.`

### 10. premium_profiles toggle not split into B2C-boost vs B2B-subscription (Q5 ratified).
`ECOSYSTEM_ADR_PLAN.md` Q5 ratified: split `premium_profiles` into **two distinct concepts** (B2C consumer boost vs B2B subscription) with distinct `monetization_type`. Schema still carries a **single** `premium_profiles` toggle (`database_schema.sql:685`) alongside `boosted_listings`. Minor (both are gated OFF), but the ratified split isn't reflected, so the two monetization models remain conflated in the gate.

`[MINOR][forward-compat][growth] database_schema.sql:685 → single premium_profiles toggle; Q5 (ECOSYSTEM_ADR_PLAN.md) ratified a split into B2C-boost vs B2B-subscription with distinct monetization_type → conflated monetization models in the gate → split the toggle (or annotate) when monetization_type (#7) lands.`

### 11. Sequence coherence: the plan is documented but no code seam reflects "seed supply + Request-first".
The launch sequence (services → goods → expertise → livestock B2B, `future-features.md:193-197`; Q6 livestock-last) is coherent and each stage's cold-start is acknowledged (`:199`). Growth's specific audit position — **seed supply directly + lift Request into Stage 1** — is recorded in the 06-30 audit but is **not reflected as a plan/seam in the product**: no Request object (#2), no supply-seeding path (#4), no self-serve provider onboarding (#3). So the sequence is a document, not yet a runway.

`[INFO][sequence][growth] future-features.md:193-205 + AUDIT_2026-06-30.md:87 → launch sequence is ratified in docs but the growth-specific "seed supply + Request-in-Stage-1" position has no product seam (see #2,#3,#4) → treat #2/#3/#4 as the Stage-0 growth-seam prerequisites before Stage-1 services build begins.`

---

## Growth probes

Concrete, assertable checks for Phase-3 (reviewer-qa / backend). Format: **probe → how → expected (today) / desired.**

1. **Marketing-consent seam exists.** Grep schema+DTOs for a marketing/transactional consent field distinct from `contact_prefs` reveal-visibility. Expected today: **none** (only `contact_prefs.show_phone/show_telegram`). Desired: a consent-of-record (channel, granted_at, source) before any lifecycle messaging. Asserts #1.

2. **Progressive role self-serve.** As a plain `USER`, attempt to self-acquire BREEDER/FARMER/GROOMER without admin. Expected today: no endpoint; only `PATCH /v1/admin/users/:id/role` (ADMIN, 403 for self). Desired: a self-service role-claim path; `roles[]` (multi-role) shape. Asserts #3.

3. **Per-city empty-state has a supply-seeding path.** Query listings/(future services) for a category in a city with zero ACTIVE supply. Expected today: empty result set, **no capture** (silent dead-end). Desired: an empty-state seam that captures the miss (notify / post-Request / invite-provider). Asserts #4.

4. **Reverse-Request object reserved.** Grep schema/controllers for a buyer-posts-need / request / wanted / demand object. Expected today: **absent**. Desired: a reserved Request seam (author, market_scope, geo-anchor, offering_type-of-need, expires_at). Asserts #2.

5. **favorites polymorphism.** Inspect `favorites` — is it FK-bound to `listing_id` only, or does it carry `offering_type`? Expected today: `listing_id` FK only (`database_schema.sql:349`). Desired: polymorphic OfferingRef. Asserts #5.

6. **monetization_type field.** Grep schema for `monetization_type` on any offer/side. Expected today: **absent**. Desired: `{lead_gen|subscription|take_rate}` reserved form-now. Asserts #7.

7. **Referral/invite hook.** Grep schema/code for referral/invite/promo. Expected today: **none**. Desired: a lightweight referral seam. Asserts #8.

8. **North-star value-event coverage.** Trigger a sale, a view, and a contact-reveal; inspect emitted outbox events + `analytics.views`. Expected today: `Listing.Sold` emits; `views=0` always (`listing.service.ts:617`); `ContactReveal.Created` emits but channels empty. Desired: view/impression capture + real reveal. Asserts #9. (Overlaps active-user probe 6.)

9. **premium_profiles split.** Read `feature_toggles`: is `premium_profiles` one row or split B2C/B2B? Expected today: single row (`database_schema.sql:685`). Desired: two, with distinct `monetization_type`. Asserts #10.

---

*Scope note:* frontend onboarding UX, actual per-city supply numbers, and CAC/LTV economics are `требует ручной проверки` (frontend / data-analyst / finance). I audited backend schema + code + the ratified vision docs only. No product code, docs, or commits were touched; this file is my sole output. Findings that overlap active-user (#3 role, #9 north-star/views) are independently re-derived here through the growth lens, not copied.
