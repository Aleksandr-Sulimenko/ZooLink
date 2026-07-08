# ZooLink HYPER³ Audit — Round-3 · Phase-2 · growth

**Date:** 2026-07-08 · **Branch:** `backend` · **HEAD:** `0fcc182` · **Role:** growth (GTM, acquisition, activation, retention, two-sided liquidity, AARRR + North-star; co-owner of the needs-coverage map).
**Method:** independent re-derivation on the LIVE code — read the built surfaces (identity/profile+consent, listing create/reveal/view, saved-search, notification consumer+registry, favorite, claim-code, transfer/report rate-limits) and the feature-toggle seeds; then diffed vs `AUDIT3/growth.md` (N1/N2/C1–C4/S1) and `AUDIT2/growth.md` (#1–#11). Monetization is **record-only** (owner-deferred); I stress abuse-economics, cold-start liquidity, needs-coverage. No src/docs/commits touched.

Finding format: `[severity][criterion][axis][state] file:line → problem → fix`. Axis ∈ same | new | trash | strat. State ∈ NEW | CONFIRMED | REFUTED | SEV-CHG | FIXED-VERIFIED. Strategic findings carry `[NS|WW|PERSP]`.

> **Baseline shift since round-3:** the two activation/retention root-cause breaks I raised in AUDIT3 are **half-closed**. **N1 (contact-write seam) is FIXED** — a real seller can now supply a contact channel and reveal returns it, so the core value-exchange loop (list→discover→contact→deal) is physically completable for the first time. **C2 (consent-of-record) is FIXED** — an append-only, versioned, ФЗ-152-shaped `consents` store now exists. **N2 (return loop) is still broken** but the notification infra now exists, so it dropped from a domain-build to a registry-edit. The product now serves the **supply side** end-to-end; the **demand-side return loop** is the remaining hole, and a fresh **abuse-economics gap (no create quota)** can poison the very liquidity metrics growth reads.

---

## ✅ FIXED-VERIFIED (round-3 findings resolved in code)

### F1. Contact-write seam shipped → activation loop is now physically completable. (was AUDIT3 N1 / S1, CRITICAL)
`UpdateProfileDto` (`identity/dto/identity.dto.ts:143-176`) now exposes `contactPhone` (E.164), `contactTelegram`, `showPhone`, `showTelegram`; `MeController.updateMe` (`identity/me.controller.ts:36`) → `ProfileService.updateMe` (`identity/profile.service.ts:57-96`) encrypts the phone at rest (ADR-0019 CryptoService), writes `contact_prefs`, and records the `CONTACT_DISTRIBUTION` consent transition **in the same transaction** (`:86-93`). `revealContact` (verified round-3) reads those prefs. Net: a real seller can supply a channel and a buyer's reveal returns it — the reveal-returns-`{}` activation blocker is gone.

`[CRITICAL][activation][same][FIXED-VERIFIED] identity/dto/identity.dto.ts:143 + profile.service.ts:61-93 → contact-write + consent-on-opt-in wired; reveal now resolvable → activation (find→contact→deal) is completable → HOLD released: the "no acquisition spend until reveals are non-empty" gate (AUDIT3 N1 decision) is satisfied at the code layer. Residual: verify ≥90% of ACTIVE listings expose ≥1 channel once real users onboard (data-analyst; requires live data).`

### F2. Consent-of-record store shipped → retention messaging now has a lawful-basis seam. (was AUDIT3 C2 / AUDIT2 #1, BLOCKER)
`ConsentService` + the append-only `consents` table (migration 0029, ADR-0020) record `{user_id (subject), consent_type, granted, policy_version, source, actor_id, actor_principal_type}` with DB-enforced immutability and "latest-row-wins" current state (`identity/consent.service.ts:43-70`). This is exactly the ст.9 ч.1 ФЗ-152 proof store AUDIT2/#1 and AUDIT3/C2 demanded (channel-of-record, timestamp, source, withdrawal = superseding `granted:false` row). Subject≠actor split makes an AGENT-recorded on-behalf consent representable (ADR-0006).

`[BLOCKER][retention][same][FIXED-VERIFIED] identity/consent.service.ts:43 + migration 0029 → versioned consent-of-record exists; MARKETING/ANALYTICS_PROFILING types reserved (:6-10) → lawful-basis seam present; the BLOCKER downgrades to "wire MARKETING consent capture at the first lifecycle-message action" → when N2/lifecycle ships, gate it on ConsentService.currentlyGranted(userId,'MARKETING') and record the grant at the opt-in moment (legal on ФЗ-38 ст.18 double-opt-in wording).`

### F3. North-star numerator materially instrumented (2-of-3 proxies now real). (was AUDIT3 C4 / AUDIT2 #9, MAJOR)
`view_count` is now captured (migration 0031; `listing.service.ts:279-292 captureView`): best-effort atomic increment on the public detail read, **deduped per viewer** (authed userId or anon-IP) in Redis 30-min window, **seller self-view excluded**, **ACTIVE-only**, never throws. With F1, `ContactReveal.Created` now carries a real (non-empty) reveal, so it is a true signal, not the false one of round-3. `Listing.Sold` still emits. So the numerator moved from ~1/3 to a real view→reveal→sale top-of-funnel.

`[MAJOR][north-star][same][SEV-CHG] listing.service.ts:279 (view_count captured) + F1 (reveal real) → view/reveal/sale funnel now measurable; was "views hard-0, reveal empty" → residual GAP is the DENOMINATOR: no session/impression/"active household" instrumentation, and anon view_count is soft (see T1) → instrument session/household activity on the existing outbox seam before spend (data-analyst). Downgrade to MINOR once denominator lands.`

### F4. Growth-integrity rate-limits present on the sensitive mutation surfaces. (partial, supports new-axis)
Contact-reveal is per-market/per-viewer/hour (pet 10/h, livestock 5/h — `listing.service.ts:59-61,633`); registration/verify/OAuth/recovery are `@Throttle`d (`identity.controller.ts:61-105`); transfer claim-mint + initiate are Redis-rate-limited (`animal/transfer.service.ts:107,147`); content-report is `@Throttle`d and does **not** auto-takedown on volume (no threshold→hide in `content-report.service.ts`) so competitor-brigading cannot silently remove a rival's listing. Claim codes are 80-bit, single-use, atomic-GETDEL, no-enumeration.

`[INFO][growth-integrity][new][FIXED-VERIFIED] listing.service.ts:585 + identity.controller.ts:61 + transfer.service.ts:107 + content-report throttle → reveal-harvest, claim-code spam, auth-abuse, report-brigading are gated → these AARRR-poisoning vectors are closed. The ONE unguarded mutation is listing/animal creation (see N-AE1).`

---

## 🔴 NEW this round

### N-AE1. Listing + animal creation have NO per-user quota/rate-limit → supply-flood can poison the liquidity metrics growth steers by. (abuse-economics)
`ListingController.create` (`listing/listing.controller.ts:70`) and `POST /animals` (`animal/animal.controller.ts:43`) carry **only** an `Idempotency-Key` interceptor — which dedups a single retried request, NOT repeated distinct creates. There is no active-listing cap per user, no create/submit rate-limit (grep: `enforceRateLimit`/`@Throttle` present on reveal/transfer/report/auth, **absent** on listing & animal create). A single account can mint unbounded animals + DRAFT listings and submit them all. Today the moderation gate (DRAFT→PENDING→ACTIVE) throttles what reaches discovery — but it makes the **moderation queue** the flood target (SLA/escalation pressure), and the moment AI-agent auto-moderation lands (ADR-0006, the North-Star direction) a create-flood becomes **direct supply pollution**: fake ACTIVE listings that inflate per-(category,city) supply-density — the exact signal growth/data-analyst read to judge liquidity and decide seeding. A market can be made to *look* warm while being fake; Sybil supply (many OTP-verified accounts × unbounded listings) compounds it.

`[MAJOR][abuse-economics][new][NEW] listing/listing.controller.ts:70 + animal/animal.controller.ts:43 (Idempotency-Key only; no quota/rate-limit) → unbounded listing/animal creation → moderation-queue flooding now, supply-pollution once auto-moderation is on; distorts per-city supply-density, the core liquidity signal → add a per-user active-listing cap + create/submit Redis rate-limit (reuse the reveal/transfer enforceRateLimit convention); route the cap value to architect/finance (abuse-cost vs legit-power-seller). Hypothesis: liquidity metrics are only trustworthy if supply is quota-bounded. Metric: listings-created/user/day distribution (flag p99 outliers). Decision: land the cap before any per-city supply-density metric is used to trigger seeding spend.`

### N-AE2. Anonymous view_count dedup is IP-keyed → inflatable; keep it off decision-critical paths. (abuse-economics)
`captureView` dedups anonymous readers by client IP (`listing.service.ts:282`). Authed dedup is solid, but IP rotation / a botnet can inflate an ACTIVE listing's `view_count`, and (once boosted/ranking reads engagement) a seller could self-inflate demand signal. It is a soft funnel-top vanity metric today (nothing ranks on it), so severity is low — but it must not silently become an input to ranking or a "hot listing" surface without a bot-resistance pass.

`[MINOR][abuse-economics][new][NEW] listing.service.ts:282 (anon view dedup by IP) → view_count inflatable via IP rotation; fine as a soft signal, dangerous if it feeds ranking/boost → keep view_count out of any ranking/boost input until a bot-resistance pass (data-analyst/security); prefer authed-viewer counts for decisions. Metric: anon-share of view_count per listing; Decision: never trigger spend/ranking on a metric whose anon share is unbounded.`

---

## ⚠️ CONFIRMED — still open (independently re-derived)

### C1. Saved-search is still store-only; the primary re-engagement loop never fires. (was AUDIT3 N2, HIGH → SEV-CHG effort)
`saved-search.service.ts` is still `create/list/delete` only (`:73/:96/:115`) — no match evaluation, no emit. The `NOTIFICATION_REGISTRY` (`notification/notification.registry.ts:53`) has **no `SavedSearch.Matched`** key (only Moderation.Decided + 5 transfer-lifecycle events), and nothing on Listing→ACTIVE evaluates saved searches. So a buyer who saves a search on a thin cold-start market is **still never told** when matching supply lands → does not return → the two-sided market can't warm. **But** the notification domain now exists (`NotificationConsumer` + IN_APP channel + idempotent materialization + registry pattern, ADR-0021), so this dropped from "build a notification domain" to "add one registry entry + emit `SavedSearch.Matched` from the listing-activation path."

`[HIGH][retention][same][SEV-CHG] saved-search.service.ts (CRUD only) + notification.registry.ts:53 (no SavedSearch.Matched) → save→notify→return loop still absent; retention loop = 0 → on Listing→ACTIVE, evaluate matching saved_searches and emit SavedSearch.Matched to the outbox; add the registry route (recipients = saver, template, context) — the consumer already materializes it. Effort is now LOW (infra ready). Gate any promo-flavored variant on MARKETING consent (F2); a pure "your saved search matched" alert is transactional (ФЗ-38-exempt), ship that first. Hypothesis: cold-start recovery needs pulling savers back when supply lands. Metric: saved-search→7-day return after a matching ACTIVE (today 0; target ≥25%). Decision: build this BEFORE any supply-seeding push — seeding into a market with no return-trigger burns the supply.`

### C2. Provider/role self-onboarding still blocked — `user_roles` junction is DORMANT. (was AUDIT3 C1 / AUDIT2 #3, CRITICAL → SEV-CHG scope)
Migration 0034 added a `user_roles` junction (ADR-0022) but it is explicitly **dormant**: `users.role` stays the sole authz source, no code reads the junction, and the only mutation is still `PATCH /admin/users/:id/role` (ADMIN-only) synced write-only into the junction. No self-claim path. **Scope refinement vs round-3:** the pet/livestock *listing* marketplace is NOT blocked by this — any `USER` (plus BREEDER/FARMER/ADMIN) is in `WRITE_ROLES` and can self-list an animal (`listing.controller.ts:39`), so C2C supply self-onboards fine today. The block is specifically for **service-provider roles** (groomer/vet/walker/sitter) and **verified-breeder badges** — i.e. the Phase-2 services wedge and trust-signal, not the MVP marketplace.

`[MAJOR][onboarding][same][SEV-CHG] admin/user-roles.controller.ts + migration 0034 (junction dormant; users.role authoritative; no self-claim) → provider-role supply (services vertical) can't self-onboard; verified-breeder trust badge has no self-serve path → activate a just-in-time self-claim on the junction (role activates on first provider action) before the services vertical opens; ratify the authz-read switch (ADR-0022 rule 5). Downgraded from CRITICAL: MVP C2C listing supply is unblocked. Metric: provider signups/week needing zero admin action (today 0). Decision: gate the services-vertical launch on this, not the MVP marketplace.`

### C3. No referral/invite/promo seam — AARRR "Referral" has zero surface. (was AUDIT3 C3 / AUDIT2 #8, MAJOR)
Grep is still empty across schema + src (`referral|referrer|invite|promo_code`), except the unrelated B2B `organization_users.invitation_token`. Referral is the lowest-CAC RF loop (VK/Telegram share, breeder/farmer community virality) and the natural per-city supply seed ("invite a groomer to your city"). Attribution provenance is lost irrecoverably if added after early cohorts.

`[MAJOR][virality][same][CONFIRMED] whole repo (no user↔user referral seam) → AARRR Referral absent; lowest-CAC loop + per-city supply-seed channel unavailable → reserve a lightweight referral seam (code, referrer_id, redeemed_at, market_scope — ADR-0002 keeps pet/livestock invite copy separate) form-now; ties to consent (F2) and empty-state capture (C4). Route to architect. Metric: viral coefficient k by market (target >0.3). Decision: reserve the column now (cheap); build the loop once C1-notify makes an invited user land on a working return-loop.`

### C4. Demand-side cold-start unanswered — no reverse "Request" object, no per-city supply signal / empty-state capture. (was AUDIT2 #2+#4, CRITICAL)
Still no buyer-posts-need / request / demand object in schema or controllers; all discovery is supply-first (`GET /listings` needs ACTIVE supply). `cities` is still a bare lookup with no per-(category,city) supply-density signal, and a "0 results in your city" hit is a silent dead-end — not captured as a lead (notify / post-Request / invite-provider). This is the single lever designed to deliver value *before* dense supply exists, and it is unbuilt and unreserved.

`[MAJOR][cold-start][same][CONFIRMED] database_schema.sql (no Request/demand object; cities bare) → demand-side cold-start has no answer; the "грумер рядом: 0 результатов" empty-state kills the comfort promise with no seam to detect the hole or convert the miss → reserve a Request/Demand seam (author, market_scope, geo-anchor, offering-type-of-need, expires_at) fitting the ADR-0014 polymorphic family + a per-(category,city) supply-density signal + empty-state capture. Route structural shape to architect; instrument density with data-analyst. Metric: empty-result rate per (category,city); Decision: seed supply directly per-city AND capture the miss before the comfort promise is marketed.`

### C5. Forward-compat seams from AUDIT2 that remain open (not re-argued, verified still true).
`monetization_type` is still absent everywhere (AUDIT2 #7 — acceptable while monetization is record-only/deferred, but it is the cheap-now/expensive-later switchable field). `premium_profiles` is still a single toggle, not the ratified B2C-boost / B2B-subscription split (AUDIT2 #10). `saved_searches.filters` is still opaque JSONB with no first-class offering_type (AUDIT2 #6 — partially mitigated: `offering_type` column now exists at row level via migration 0032, but the *filters* remain a validated whitelist blob). `favorites` polymorphism (AUDIT2 #5) is **resolved** — `offering_type`/`offering_id` now present (migration 0032, `favorite.service.ts:64-70`).

`[MINOR][forward-compat][same][CONFIRMED] no monetization_type; single premium_profiles toggle (database_schema.sql:740) → switchable-monetization + B2C/B2B split unreserved → add monetization_type + split the toggle when the first Offering-subtype table is created (architect/ADR-0014); monetization is record-only now, so this is a reservation note, not a launch item.`

`[MINOR][forward-compat][same][FIXED-VERIFIED] favorite.service.ts:64 + migration 0032 → favorites now carry offering_type/offering_id (was listing_id-only, AUDIT2 #5) → polymorphic-offering favorites unblocked.`

---

## STRATEGIC — needs-coverage map (my half: the four market sides + key personas) `[WW]`

Real need → built surface → status (CLOSED / PARTIAL / GAP) → what would close it.

| Side / persona | Real need | Built surface | Status | What closes it |
|---|---|---|---|---|
| **Pet BUYER** | find healthy pet near me · contact seller · trust it · be told when the right one appears | `GET /listings` (public ACTIVE, cache), `getById`+view, `contact-reveal` (now resolvable F1), favorites, saved-search (store) | **PARTIAL** | discovery+contact CLOSED; **return/notify GAP (C1)**, **reverse "I want X" GAP (C4)**, per-city empty-state GAP (C4) |
| **Pet SELLER / breeder** | list animal · get discovered · get contacted · close · prove legitimacy | create→submit→moderate→ACTIVE, contact-write (F1), mark-sold, per-listing analytics (views+reveals now real F3) | **CLOSED** for C2C listing | verified-breeder trust badge GAP (C2 role self-claim); promotion deferred (boosted off — correct for soft-start) |
| **Livestock BUYER (farmer)** | find breeding stock · health/ВетИС context · contact | same listing surface, market hard-separated, reveal 5/h; health_certifications/genetic_markers dicts exist (mig 0019) | **PARTIAL** | trust GAP: health-cert dicts not surfaced in the listing/discovery flow; return/reverse-Request GAP (C1/C4); livestock sequenced last (Q6) — expected |
| **Livestock SELLER (farm/org)** | list stock · org account · transfer · bulk | org listings (organization_id + org-admin gate), ownership transfer + claim codes, quantity field | **PARTIAL→CLOSED** for listing+transfer | bulk-ops/CSV GAP; discovery-return GAP shared with buyers |
| Service providers (groomer/vet/walker/sitter) | self-onboard · be discoverable · get leads | — (`service_marketplace` off; roles dormant; no Request object) | **GAP** | C2 (role self-claim) + C4 (Request/demand) + services vertical build |
| Shelter | bulk-list for adoption · adoption framing | listing surface (generic) | **PARTIAL/GAP** | adoption-specific offering type + bulk |
| Goods seller | list accessories/feed | — (`goods_marketplace` off, GAP-BA-011 deferred) | **GAP** (intentional) | goods vertical (deferred, correct) |

**Win-win symmetry verdict `[WW]`:** the built funnel is now **supply-complete but demand-return-incomplete** — the seller side goes list→moderate→active→contact→sold→analytics end-to-end (all real after F1/F3), while the buyer side has discovery+contact but **no reason and no trigger to return** (C1 saved-search notify = 0, C4 reverse-Request/empty-state = 0). For a two-sided cold-start this is the **wrong tilt**: you can seed supply, but demand won't come back, so early supply is wasted on a one-shot audience. The highest-leverage rebalancer is **C1 (saved-search→notify)** — the infra now exists, so it is a low-effort registry-edit that restores buyer-side symmetry.

**Soft-start monetization sequencing (record-only) `[WW]`:** every revenue toggle is correctly OFF. None is liquidity-positive if flipped early — `boosted_listings` ON on thin supply *harms* cold-start (pay-to-rank over a near-empty market reads as gamed and there is nothing to out-rank); `premium_profiles`/`vet_leadgen` are neutral-to-harmful pre-liquidity. The genuine growth levers (referral C3, saved-search notify C1, reverse-Request C4) are **not monetization toggles** — they are unbuilt seams. So the soft-start sequence is exactly right: **keep all revenue toggles off, build C1/C3/C4 first, monetize after liquidity.** No pricing designed (owner-deferred).

**`[NS]` Can an agent-operator run growth ops on the current surfaces?** Partially observe, cannot act. **Signals present:** `view_count` (F3), `contact_reveals`, `Listing.Sold`, `saved_searches` (stored intents), `audit_log`, per-listing analytics. **Missing SIGNAL:** no per-(category,city) supply-density view (C4) — an agent cannot *see* which cells are thin to balance them. **Missing LEVERS:** (a) no MARKETING-consented outbound channel — the only notification consumer is transactional IN_APP, so an agent cannot send an onboarding/liquidity nudge; (b) no referral lever (C3); (c) no reverse-Request to route captured demand to supply (C4). Net: an operator agent can read a partial funnel but has no growth actuators. Laying C1+C4+C3 is what makes agent-run growth ops possible.

**`[PERSP]` Cheapest seams to lay NOW (before Phase-2 frontend / monetization-on), ranked impact×effort:**
1. **C1 — `SavedSearch.Matched` emit + registry route** — infra ready (LOW effort), restores buyer-side symmetry (HIGH impact). #1 pick.
2. **N-AE1 — listing/animal create quota** — cheap Redis gate, protects the liquidity metrics all seeding decisions depend on.
3. **C3 — referral seam** (code/referrer_id/redeemed_at/market_scope) — form-now, provenance lost if late.
4. **C4 — Request/demand object + per-city supply-density signal + empty-state capture** — the demand-side cold-start lever and the agent-operator's missing eye (larger, route to architect).
5. **F2 follow-through** — wire MARKETING consent capture at the first lifecycle-message action (unblocks lawful nudges + the agent-operator's missing lever).

---

## Growth-seam priority (this round, impact × effort)
1. **C1** saved-search→notify (retention loop = 0; infra ready — do first).
2. **N-AE1** create quota (protects liquidity metrics from supply-flood/Sybil).
3. **C3** referral seam (form-now; lowest-CAC loop + per-city supply seed).
4. **C4** reverse-Request + per-city supply-density + empty-state (demand cold-start; architect).
5. **C2** provider-role self-claim (gates the services vertical, not MVP).
6. **F3 residual** session/household denominator instrumentation (data-analyst).
7. **F2 residual** wire MARKETING consent at first lifecycle message (legal/ФЗ-38).

*Scope note:* frontend onboarding UX, real per-city supply numbers, live channel-non-empty rates, and CAC/LTV economics are **requires manual verification** (frontend / data-analyst / finance). I audited backend schema + code + the round-2/3 findings only. Monetization treated as record-only per owner deferral — no pricing designed. No product code, docs, or commits were touched; this file is my sole output.
