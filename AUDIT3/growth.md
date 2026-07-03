# ZooLink HYPER² Audit — Round 3 · growth (forward-compat + liquidity/retention lens)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) · **Role:** growth (GTM, acquisition, activation, retention, two-sided liquidity, AARRR + North-star).
**Method:** independent pass first (did NOT read round-1 before forming findings) — grepped the live schema + backend code for the growth-critical seams called out in the brief: single-valued role / self-onboard, contact-reveal supply, saved-search match loop, referral/virality, consent (ФЗ-38). Then diffed against `AUDIT2/growth.md`.

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR. Criterion ∈ activation · onboarding · liquidity · cold-start · retention · virality · north-star · forward-compat. Each carries **hypothesis → metric → decision**.

> **Baseline (verified this pass):** the marketplace's core value-exchange loop (list → discover → contact → deal) and its return loop (save search → get notified → come back) are **both physically broken in code**, independent of the (well-documented) monetization plans. Round-1 caught the consent, role, referral and north-star seams precisely; this round **adds two root-cause activation/retention breaks** that round-1 only touched as symptoms.

---

## 🔴 NEW this round (not isolated as root-cause findings in round-1)

### N1. Sellers have NO self-service path to enter contact info → contact-reveal returns empty → the whole marketplace value-exchange is dead.
`revealContact()` (`listing.service.ts:444`) is correctly implemented: it decrypts `contact_phone` and returns phone/telegram **gated on `seller.contact_prefs.show_phone/show_telegram`** (`:465-476`). But the self-service profile DTO `UpdateMeDto` (`identity/dto/identity.dto.ts:108-125`) exposes **only** `fullName / cityId / avatarUrl` — there is **no write path for `contact_phone`, `contact_telegram`, or `contact_prefs`** anywhere in the user-facing surface (grep: only test fixtures + admin-null). `phone_hash` is a one-way HMAC (not a usable contact); `contact_phone` is the ADR-0019 encrypted column explicitly documented as *"seam-ready/backfilled, no read-write path (contact-exchange = sub-wave C deferred)"*. Net: a real seller **cannot supply a contact channel**, so `contact_prefs` is empty/false, so every reveal returns `{}`. Round-1 #9 noted "reveal returns empty channels (active-user #1)" but framed it as a north-star *measurement* artifact and attributed the cause to active-user — it did **not** pin the root cause (no self-service contact write) nor rate it as the activation blocker it is.

`[CRITICAL][activation][NEW] backend/src/modules/identity/dto/identity.dto.ts:108 (UpdateMeDto = fullName/cityId/avatarUrl only) + listing.service.ts:465 → no self-service write path for contact_phone/contact_telegram/contact_prefs; reveal is gated on prefs that can never be set → contact-reveal returns {} for real users → activation (find→contact→deal) is impossible; the platform cannot demonstrate a single successful match → open the contact-write seam (PATCH /me: contactPhone via CryptoService encrypt, contactTelegram, contactPrefs) as a Stage-0 activation prerequisite; coordinate the encrypt/PII rules with security+legal (ADR-0019/ФЗ-152).`
- **Hypothesis:** the activation funnel dies at the reveal step because there is nothing to reveal (not because buyers don't try).
- **Metric:** % of contact-reveal calls that return ≥1 non-empty channel (today ≈ 0 for organic users; test-only). Target after fix: ≥ 90% of ACTIVE listings expose ≥1 channel.
- **Decision:** if reveals return empty for real listings, no acquisition spend is justified — **hold all paid/launch spend until the contact-write seam ships and reveals are non-empty.**

### N2. Saved-search is store-only — no notification domain is built → the platform's only re-engagement loop never fires.
`saved-search.service.ts` implements `create / list / delete` only (`:63/:82/:101`) — no match evaluation, no outbox emit, no notify. There is **no notification module** in `backend/src/modules/` at all (dirs: admin/animal/auth/identity/listing/moderation/saved-search — none for notifications; spec 13 exists on paper only). So a buyer who saves a search on a thin/empty market (the expected cold-start state) is **never told when matching supply appears** → they do not return → the two-sided market cannot warm up even when supply arrives. Round-1 mentions `saved_searches` only for `offering_type` polymorphism (#6) and consent (#1); it does **not** flag that the save→notify→return retention loop is entirely absent.

`[HIGH][retention][NEW] backend/src/modules/saved-search/saved-search.service.ts (create/list/delete only; no notification module in backend/src/modules) → saved searches are a dead store; no match-notification fires when new supply matches → the primary re-engagement loop is missing → users don't return, match density can't build → reserve+build the notify seam: on Listing→ACTIVE, evaluate matching saved_searches and emit SavedSearch.Matched to the outbox (consumed by the notification domain, gated by consent N-consent/round-1 #1). Route the notification-domain build to architect/backend; gate delivery on consent.`
- **Hypothesis:** cold-start recovery depends on pulling savers back when supply lands; without it, early supply is wasted on an empty audience.
- **Metric:** saved-search → return-visit rate within 7 days of a matching listing going ACTIVE (today: 0, no trigger exists). Target: ≥ 25%.
- **Decision:** build the notify seam before any supply-seeding push — seeding supply into a market with no return-trigger burns the supply. Sequence: N1 (contact) → N2 (notify) → supply seeding.

---

## ✅ CONFIRMED (independently re-derived; round-1 was right)

### C1. Supply cannot self-onboard — single-valued role + ADMIN-only change. (round-1 #3)
`role VARCHAR(20) ... DEFAULT 'USER'` (`database_schema.sql:115`, single-valued CHECK incl. BREEDER/FARMER/VETERINARIAN/GROOMER); the only mutation is `PATCH /admin/users/:userId/role` (`admin-user.controller.ts:21`, ADMIN-only). No `roles[]`, no self-service claim. Provider supply (groomer/vet/walker/boarding) can only be created by manual ops — you cannot seed a two-sided market when one side needs an admin per signup. This directly kills the find-nearby comfort promise and the Stage-1 services wedge (`future-features.md:167,210`).

`[CRITICAL][onboarding][CONFIRMED] backend/src/modules/identity/admin-user.controller.ts:21 + database_schema.sql:115 → single-valued role, ADMIN-only change, register hard-codes USER → provider supply can't self-onboard; progressive just-in-time roles (future-features.md:167) blocked → design multi-role roles[] + just-in-time self-claim seam (activate role on first provider action, no re-registration); ADR-0016 still Proposed — this is the growth-gating dependency. Route to architect.`
- **Hypothesis:** manual role-promotion caps provider supply at ops throughput → supply side never reaches liquidity.
- **Metric:** provider signups/week that require zero admin action (today: 0). Target: ~100% self-serve.
- **Decision:** ratify ADR-0016 (roles[]) before opening the services vertical; until then, services launch is ops-bound and non-scalable.

### C2. No marketing-consent seam → retention engine is legally ungated (ФЗ-38). (round-1 #1)
`notification_prefs JSONB DEFAULT '{"email":true,"sms":true,"promo":false}'` (`database_schema.sql:125`) plus `contact_prefs` (reveal-visibility) are the only preference structures. There is **no consent-of-record** — no per-channel `granted_at / source / withdrawn_at`, no transactional-vs-marketing split, no double-opt-in proof. `promo:false` is a sensible default but is a mutable flag, **not** lawful-basis evidence. Any lifecycle/promo message (incl. the N2 saved-search notify if it ever carries promo) needs ФЗ-38 ст.18 opt-in captured at the moment of grant; retrofitting loses all historical opt-in.

`[BLOCKER][retention][CONFIRMED] database_schema.sql:125 (notification_prefs) + contact_prefs → mutable flags only, no consent-of-record (channel, granted_at, source, withdrawn_at), no txn/marketing split, no double-opt-in → retention/lifecycle messaging (ФЗ-38 advertising) has no lawful basis; consent can't be reconstructed later → reserve a marketing_consent model NOW (form-now, default off), wording+basis with legal. Reaffirms round-1 #1 and AUDIT_2026-06-30:85 — still unaddressed.`
- **Hypothesis:** LTV depends on lawful lifecycle messaging; without a consent seam it's either illegal or unshippable.
- **Metric:** % of messageable users with a valid, timestamped, sourced opt-in (today: 0 — none captured). Target: consent captured at first eligible action.
- **Decision:** no lifecycle/promo channel ships until the consent seam exists; transactional (N2 match alert) vs marketing must be split from day one.

### C3. No referral/invite/promo seam — AARRR "Referral" has zero surface. (round-1 #8)
Grep confirms: the only `invite`/`invitation_token` in schema is `organization_users` (`database_schema.sql:1049`) — **B2B team invites**, not user↔user referral. No `referral`, `referrer_id`, `promo_code`, `redeemed_at` anywhere. Referral is the lowest-CAC RF acquisition loop (VK/Telegram share, breeder/farmer community virality) and doubles as the per-city empty-state fix ("invite a groomer to your city"). Retrofitting attribution loses early-cohort provenance irrecoverably.

`[MAJOR][virality][CONFIRMED] whole repo (only org-team invitation_token at database_schema.sql:1049; no user↔user referral) → AARRR Referral stage absent; lowest-CAC loop + organic per-city supply-seeding channel unavailable; attribution provenance lost if added late → reserve a lightweight referral seam (code, referrer_id, redeemed_at, market_scope) form-now; ties to consent (C2) and empty-state capture. Route to architect.`
- **Hypothesis:** invite-driven acquisition is the cheapest viable RF channel and the natural per-city supply seed.
- **Metric:** viral coefficient k (invites sent × conversion) — unmeasurable today (no seam). Target after launch: track k by market; act if k>0.3.
- **Decision:** reserve the seam now (cheap); build the loop once N1/N2 make an invited user land on a working product.

### C4. North-star ("частота × широта") ~1/3 instrumented; view/impression history lost daily. (round-1 #9)
Of the three value-events, only `Listing.Sold` emits (`listing.service.ts:577`); service-booking/order sides are unbuilt (expected); `views` is hard-`0` (no capture source, GAP-TRACE-006) and `ContactReveal.Created` fires but returns empty (see N1) → false signal. `listings.view_count / contact_shown_count` columns are absent. Denominator ("active household") has no session/impression instrumentation.

`[MAJOR][north-star][CONFIRMED] backend/src/modules/listing/listing.service.ts (views hard-0; ContactReveal empty per N1) + missing listings.view_count/contact_shown_count → North-star numerator ≈1/3 event-types, denominator uninstrumented, impression history irrecoverable → instrument view/impression + session/household activity on the existing outbox seam from day one (with data-analyst). Confirms round-1 #9 / data-analyst ~15%.`
- **Hypothesis:** you can't grow what you can't see; the top of the activation funnel (view→reveal) is invisible.
- **Metric:** view→contact-reveal→deal funnel conversion, per (category, city, market). Today: unmeasurable above the reveal step.
- **Decision:** land view/session capture before spend; a funnel with an invisible top cannot be optimized.

---

## SEV-CHG / refinement vs round-1

### S1. Contact-reveal "returns empty" — reclassify from north-star symptom to activation root cause.
Round-1 #9 lists the empty reveal as a north-star measurement artifact ("false signal", attributed to active-user #1). This pass verifies the **mechanism**: reveal code is correct; the break is upstream — no self-service contact-write path (N1). Reclassify: **root-cause activation BLOCKER**, not a measurement footnote. The fix is a new write seam (N1), not instrumentation.

`[SEV-CHG][activation] listing.service.ts:465 + identity.dto.ts:108 → round-1 treated empty-reveal as a north-star symptom (MAJOR, #9); root cause is the missing contact-write seam → elevate to CRITICAL activation blocker (see N1). Instrumentation (C4) measures it; it does not fix it.`

---

## Not refuted — round-1 findings I did not independently re-derive but that stand
Round-1's #2 (reverse-"Request"/demand object), #4 (per-city supply signal + empty-state capture), #5 (favorites listing-bound, not polymorphic OfferingRef), #6 (saved_searches.filters opaque JSONB, no first-class offering_type), #7 (no monetization_type), #10 (premium_profiles B2C/B2B split), #11 (sequence-as-doc-not-runway) are all **valid and unrefuted** — I verified the schema facts they rest on (favorites/saved_searches/toggles) in passing and found no contradiction. They remain open; I add nothing beyond round-1 on them.

---

## Growth-seam priority (this round, impact × effort)
Stage-0 activation/retention prerequisites, in order (each cheap-now, expensive-later):
1. **N1 — contact-write seam** (activation is 0 without it; small DTO+service change on existing crypto).
2. **C1 — roles[] / self-serve provider onboarding** (supply is ops-bound without it; ADR-0016).
3. **N2 — saved-search → notify** (return loop is 0 without it; needs notification domain build).
4. **C2 — marketing_consent seam** (form-now; blocks lawful lifecycle/promo; legal-coordinated).
5. **C3 — referral seam** (form-now, cheap; unlocks lowest-CAC loop + per-city supply seed).
6. **C4 — view/impression/session instrumentation** (funnel visibility; with data-analyst).

*Scope note:* frontend onboarding UX, real per-city supply numbers, and CAC/LTV economics are `требует ручной проверки` (frontend / data-analyst / finance). I audited backend schema + code + the brief's named seams only. No product code, docs, or commits were touched; this file is my sole output. N1/N2 are independently derived root-cause findings; C1–C4 independently re-confirm round-1 #3/#1/#8/#9.
