# ZooLink HYPER Audit — Phase 1 · active-user (lived-experience proxy)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** walked every implemented flow first-person
as each persona, judged against real human needs, then tried to break/abuse it. Grounded in actual code
(controllers + services + DTOs + migrations), not the stale 2026-06-30 audit.

Finding format: `[severity][criterion][active-user] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ needs · friction · dead-end · abuse · forward-compat · trust · consistency.

> **What actually EXISTS today (verified reality baseline — corrects the stale 2026-06-30 audit):**
> Implemented modules = auth/identity, animal (+transfer), listing (+contact-reveal, mark-sold, analytics, photos),
> moderation (+content-report), saved-search, admin. Contact-reveal, mark-sold, `Listing.Sold`/`ContactReveal.Created`
> events, and the retention/expire scheduler (auto-EXPIRE + erase-after-grace) are **now built** (were flagged missing
> on 06-30). **NOT built** (contracts exist as vision only, no controller/route): favorites, geo-search service,
> organization/branch, notification, payment, matching, ServiceOffering/ProductOffering/ConsultationOffering.
> Roles enum = USER · BREEDER · FARMER · VETERINARIAN · GROOMER · MODERATOR · ADMIN (`identity.dto.ts:15`).
> Listing types = sale · breeding · show · adoption · stud_service · leasing. Every listing REQUIRES an owned
> animal (`listing.service.ts:146`); market is derived from the animal's species (`marketOf(animal_id)`).

---

## 🔴 The two headline findings (kill or cripple the product for real humans)

### 1. Contact-reveal returns EMPTY channels for every real user — the ONLY buyer→seller path is a dead-end
The whole MVP is a "no-chat" marketplace whose single conversion mechanism is `POST /listings/{id}/contact-reveal`.
That endpoint reads `users.contact_phone` / `contact_telegram` / `contact_prefs` (`listing.service.ts:459-476`).
But those columns are **never populated on any happy path**:
- Phone registration (`identity.service.ts:90-104`) sets `phone_hash`, `full_name`, `city_id`, `email`, `avatar_url`,
  `role` — but **NOT** `contact_phone`, `contact_telegram`, or `contact_prefs`.
- The self-service profile DTO `UpdateProfileDto` (`identity.dto.ts:102-131`) exposes only `fullName`, `cityId`,
  `email`, `avatarUrl`, `preferredLanguage` — **no contact_phone / telegram / show_phone / show_telegram**.
- The ONLY writers of these columns are erase/retention, which set them to `null` / default
  (`admin-user.service.ts:223-225`, `retention.service.ts:130-132`).

Result: `contact_prefs` is unset → `show_phone`/`show_telegram` fall through falsy → `channels = {}`. Even if a default
`{show_phone:true}` were applied, `contact_phone` is `null` so `crypto.decrypt(null)` yields nothing. **Every reveal
returns an empty `channels` object** while consuming the buyer's per-hour quota. As a buyer I click "показать контакт",
burn one of my 10 reveals, and get *nothing back*. As a seller I never receive a single lead. This is the marketplace's
entire reason to exist and it does not connect two humans. **BLOCKER.**

`[BLOCKER][dead-end][active-user] backend/src/modules/identity/dto/identity.dto.ts:102 → no self-service way to set contact_phone/contact_telegram/contact_prefs; registration never sets them either (identity.service.ts:90) → contact-reveal (listing.service.ts:459) always returns empty channels, the sole buyer↔seller connection is dead → add contact fields + channel-visibility to /v1/me PATCH (and/or capture verified login phone into contact_phone on verify-phone), backfill contact_prefs default on user create.`

### 2. Half the personas have no role, and the two service roles that exist can't offer anything
Six of the twelve target personas — **кинолог/trainer, выгульщик/walker, передержка/boarding, приют/shelter,
продавец товаров/goods-seller** — have **no role at all** in the enum (`identity.dto.ts:15`). The two that do exist,
**VETERINARIAN & GROOMER**, are **excluded from listing WRITE_ROLES** (`listing.controller.ts:38` = USER/BREEDER/FARMER/ADMIN)
and there is no ServiceOffering — so a vet or groomer can log in, get a role, and then **literally cannot publish
anything**. They can only reveal contacts and read, i.e. behave as buyers. For a service provider that is a blank product.

`[CRITICAL][needs][active-user] backend/src/modules/listing/listing.controller.ts:38 → VETERINARIAN & GROOMER roles exist but are excluded from listing WRITE_ROLES and no ServiceOffering exists → these providers cannot offer anything; trainer/walker/boarding/shelter/goods-seller have no role at all → confirm intended MVP scope; if providers are in scope, needs ServiceOffering (Part-B ADR-A/C); if not, hide the vet/groomer roles until then to avoid a dead sign-up.`

### 3. No self-service role acquisition — a breeder/farmer registers as a plain USER and is stuck
Everyone registers as `role: 'USER'` (`identity.service.ts:100,218`). The only way to become BREEDER/FARMER/etc. is
`PATCH /v1/admin/users/:userId/role`, which is **ADMIN-only** (`admin-user.controller.ts:16,21`). There is no
progressive/just-in-time onboarding. So a farmer or breeder who signs up cannot access their market's affordances
without an admin manually promoting them — and USER can already create listings anyway, so the role split adds friction
without a self-service path. This directly contradicts the apex "прогрессивные just-in-time роли" vision
(`future-features.md:167`).

`[CRITICAL][forward-compat][active-user] backend/src/modules/identity/admin-user.controller.ts:21 → role change is ADMIN-only; registration hard-codes USER (identity.service.ts:100) with no self-service upgrade → breeder/farmer personas cannot self-declare; blocks progressive just-in-time roles (future-features.md:167) and multi-role accounts → design a self-service role-request/claim path (form-now seam) before role-gated features multiply.`

---

## Per-persona walkthroughs & verdicts

### 👨‍👩‍👧 Pet owner (buys/rehomes a companion animal)
**JTBD:** find a healthy kitten/puppy nearby, trust the seller, contact them, complete safely.
- Register (phone OTP) → create animal → create listing (type `sale`/`adoption`) → add ≥1 photo → submit → wait
  moderation → ACTIVE. This path works and is well-guarded (idempotency, ETag, ownership). Good.
- **Friction:** to search I must pass `species_id`/`breed_id` as integers (`listing.dto.ts:293-305`), but reference-data
  GET is `@Public` (`reference-data.controller.ts:49`) so the catalog *is* browsable — acceptable, but the buyer UX
  depends on the frontend wiring it; backend-wise OK. `требует ручной проверки` on FE.
- **Dead-end:** I find the perfect kitten, hit "reveal contact" → empty channels (finding #1). I cannot reach the seller.
- **Unmet need:** no favorites/shortlist endpoint exists (favorites-api.yaml is vision only) — I can't save the 3 kittens
  I'm deciding between. Saved-search exists but that's a query, not a shortlist of specific animals.
- **Trust:** no reviews/ratings, no seller verification, no report-listing surfaced in my buyer flow (content-report
  exists but is oriented to moderators). I'm asked to meet a stranger about a live animal with zero trust signal.
- **Verdict — вернусь ли я?** ❌ **No.** The one thing I came for (reach the seller) doesn't work, and I can't even
  save candidates. I go back to Avito, where the phone number actually shows.

### 🐄 Фермер / livestock farmer
**JTBD:** source/sell cattle, poultry, breeding stock in bulk; price by weight/head/negotiation.
- **Blocker for the persona:** registers as USER, not FARMER, with no self-service upgrade (finding #3).
- **Unmet need (data model):** price is a single `priceCents` integer (`listing.dto.ts:97`). Livestock deals are
  "за голову", "за кг", "договорная", lot-based. There is no `price_terms_text` (GAP-BA-001 in prior audit,
  `listing.service.ts:162`). `quantity` exists but no unit. A farmer cannot express "20 голов, цена договорная".
- **Friction:** livestock contact-reveal cap is 5/hour (`listing.service.ts:48`) — stricter, fine for privacy but a
  serious buyer comparing many lots hits it fast. Combined with finding #1 (empty channels) it's moot today.
- **Forward-compat:** livestock services/goods (корма оптом, вет крупного скота, ВетИС) are a whole separate B2B track
  (`future-features.md:197`) with no seam today; market derived from species blocks species-less offerings.
- **Verdict — вернусь ли я?** ❌ **No.** Can't even declare myself a farmer, can't express real pricing, can't connect.

### 🐕 Заводчик / breeder
**JTBD:** advertise litters, offer `stud_service`/`breeding`, prove pedigree, build repeat reputation.
- listing types `breeding`, `stud_service`, `show` all exist and are accepted (`listing.dto.ts:32`). Good — the vocab
  is there.
- **Unmet need:** a breeder's value is *reputation over time* — no reviews, no verified-breeder badge, no kennel/org
  profile (organization module unbuilt). Every litter is an anonymous cold post.
- **Unmet need:** `stud_service` is transactionally identical to `sale` — no price-terms, no booking. The prior audit's
  GAP-BA-005 (`show` listing_type ruleless) bites here: `show` and `stud_service` have no distinct behaviour
  (`listing.service.ts:159` "no special behaviour").
- **Abuse I tried:** create many animals → many listings (one active per type per animal via `uq_active_listing`), no
  per-user listing quota anywhere (`grep` confirms none) → a breeder/spammer can flood a breed/city with near-dupes.
- **Verdict — вернусь ли я?** ⚠️ **Maybe once, not repeatedly.** No reputation carry = no reason to prefer ZooLink over
  a Telegram breeder chat.

### 🩺 Ветеринар / veterinarian
**JTBD:** list clinic services, get leads, show license/credentials.
- Has a role (VETERINARIAN) but **cannot create any listing** (excluded from WRITE_ROLES, finding #2) and there is no
  ServiceOffering. A vet can only act as a buyer.
- **Forward-compat/legal:** vet is a regulated, license-gated category (`future-features.md:190`, 498-ФЗ/ВетИС) — no
  verification seam exists, so enabling vet offerings later needs the whole provider-verification story first.
- **Verdict — вернусь ли я?** ❌ **No.** There is nothing here for me to do.

### 🐩 Кинолог / dog-trainer & 🐾 Выгульщик / walker & 🏠 Передержка / boarding
**JTBD:** advertise recurring local services; be discoverable "рядом со мной, открыто сейчас".
- **No role exists** for any of these (`identity.dto.ts:15`). No ServiceOffering, no find-nearby directory
  (geo-search service unbuilt; only listing geo-filter exists and it's animal-bound). These personas cannot participate
  at all today.
- **Forward-compat:** these are exactly the Stage-1 "PET-услуги через find-nearby" wedge (`future-features.md:194`).
  The animal-bound listing model + species-derived market are the anti-pattern the ADR-A/B seam must undo.
- **Verdict — вернусь ли я?** ❌ **N/A today** — the product has no surface for me.

### 🏥 Приют / shelter
**JTBD:** post many adoptable animals, low friction, no price, trust/verification.
- `adoption` listing type exists (good), but shelters post *volume* — one-animal-then-one-listing, one active per type,
  no bulk import, no org profile. No shelter/NGO role or verified badge.
- **Friction:** `submit` requires price ≥ MIN for `sale` only, so `adoption` with price 0 is fine — good. But ≥1 photo
  is required per listing (`listing.service.ts:349`); a shelter with 50 animals photographs and moderates 50 times.
- **Verdict — вернусь ли я?** ⚠️ **Only if desperate.** Volume operations are pure manual toil; no adopter can reach me
  anyway (finding #1).

### 📦 Продавец товаров / goods seller (feed, accessories)
**JTBD:** list products, reorder/subscription for consumables (the retention engine per vision).
- **No role, no ProductOffering, no listing type for goods.** A goods listing would need a fake animal to attach to
  (`animalId` required, `listing.dto.ts:61`). Cannot participate.
- **Forward-compat:** `goods_marketplace` toggle still absent (GAP-BA-011). Corn/feed reorder = the vision's top LTV
  driver (`future-features.md:154`) and has zero seam.
- **Verdict — вернусь ли я?** ❌ **N/A today.**

### 🆕 Новичок-покупатель / first-time buyer
**JTBD:** browse without an account, understand states, feel safe.
- Public browse works: `GET /listings` and `GET /listings/{id}` are `@Public` for ACTIVE (`listing.controller.ts:57,85`).
  Good — no forced signup to look.
- **Friction:** to reveal a contact I must be authenticated AND hold a REVEAL_ROLE (`listing.controller.ts:40`) — fine —
  but then I get empty channels (finding #1). First impression: "sign up, then get nothing."
- **Trust:** no reviews, no verification, no "safe deal" guidance. A first-timer buying a live animal is given no
  reassurance.
- **Verdict — вернусь ли я?** ❌ **No.** Signed up for nothing.

### 💼 Матёрый продавец / seasoned seller
**JTBD:** manage many listings, see performance, move stock fast.
- Owner tooling is decent: analytics endpoint exists (`listing.controller.ts:165`) with `contactReveals` sourced —
  **but `views` is always 0** (`listing.dto.ts:420` "no capture source in MVP"). So my dashboard shows reveals (which
  are always 0 too, finding #1) and 0 views. Analytics are effectively blank.
- mark-sold works and emits `Listing.Sold` (`listing.service.ts:554`) — good for closing the loop.
- **Friction:** no bulk operations, no bump/boost, no repost of an EXPIRED listing (EXPIRED is terminal, editing gated
  to DRAFT/ACTIVE `listing.service.ts:224`) — a seasoned seller must recreate from scratch after expiry.
- **Verdict — вернусь ли я?** ⚠️ **No** — I get no leads and no usable metrics to justify staying.

---

## Consolidated findings

- `[BLOCKER][dead-end][active-user] backend/src/modules/listing/listing.service.ts:459 → contact-reveal reads contact_phone/telegram/prefs that are never set (registration identity.service.ts:90 omits them; /me PATCH DTO identity.dto.ts:102 lacks them; only writers null them) → every reveal returns empty channels, sole buyer↔seller path dead → expose contact + visibility on /me PATCH and populate contact_phone from verified login phone; default contact_prefs on create.`
- `[CRITICAL][needs][active-user] backend/src/modules/listing/listing.controller.ts:38 → VETERINARIAN/GROOMER roles exist but cannot create listings and no ServiceOffering → service providers have a dead account → scope-decide: build ServiceOffering (ADR-A/C) or hide those roles.`
- `[CRITICAL][forward-compat][active-user] backend/src/modules/identity/admin-user.controller.ts:21 → role acquisition is ADMIN-only, register hard-codes USER (identity.service.ts:100) → no progressive/just-in-time or multi-role onboarding (future-features.md:167) → add self-service role-claim seam.`
- `[MAJOR][needs][active-user] backend/src/modules/listing/dto/listing.dto.ts:97 → price is a single priceCents int; no price_terms_text / unit → livestock ("за голову/кг/договорная") and stud_service unrepresentable (GAP-BA-001) → add price_terms_text or amend BR.`
- `[MAJOR][abuse][active-user] backend/src/modules/listing/listing.service.ts:130 → no per-user/per-period listing-creation quota (only one-active-per-type-per-animal + 10 photos) → create N animals → flood N listings; spam/dup abuse → add per-user active-listing cap + creation rate-limit; route to security.`
- `[MAJOR][needs][active-user] backend/src/modules/listing/dto/listing.dto.ts:420 → analytics.views hard-0 (no capture source) and contactReveals 0 in practice (finding #1) → seller dashboard is blank → instrument view capture (even coarse) or drop the field from the contract until sourced.`
- `[MAJOR][dead-end][active-user] favorites-api.yaml (no controller) → buyers cannot shortlist specific listings/animals; only saved-search (a query) exists → confirm favorites is a planned slice; the OfferingRef{type,id} seam (future-features.md:210) should shape it now.`
- `[MAJOR][trust][active-user] whole repo → no reviews/ratings, no provider/seller verification, no buyer-facing "report/safe-deal" affordance → zero trust signal for buying a live animal from a stranger → reserve Reviews/Reputation + verification seam form-now (ADR-E; future-features.md:174,177).`
- `[MAJOR][forward-compat][active-user] backend/src/modules/listing/listing.service.ts:146 → every listing requires an owned animal and market is species-derived (marketOf) → services/goods/expertise (species-less) cannot be listed; this coupling is the exact anti-pattern ADR-A/B must undo → introduce polymorphic Offering seam before provider/goods work.`
- `[MINOR][friction][active-user] backend/src/modules/listing/listing.service.ts:224 → EXPIRED is terminal & non-editable; no repost/renew → sellers recreate from scratch after expiry → add reactivate/renew from EXPIRED (or clarify duration).`
- `[MINOR][consistency][active-user] backend/src/modules/saved-search/saved-search.controller.ts:29 → code notes the geo-search contract omitted VET/GROOMER (drift) and added them → reconcile contract to match RBAC to prevent future confusion.`
- `[INFO][forward-compat][active-user] docsRU/01-discovery/future-features.md:184 → goods_marketplace toggle still absent from feature_toggles (GAP-BA-011) → INSERT form-now so "nothing dropped".`
- `[INFO][needs][active-user] shelter/boarding personas → no bulk import / org profile / volume tooling → note for Part-B org-domain sequencing.`

## Adversarial / misuse findings (route to security)

- `[MAJOR][abuse][active-user] listing.service.ts:130 → no listing-count quota per user → mass-dup flooding (see consolidated).`
- `[MINOR][abuse][active-user] listing.service.ts:511 → contact-reveal rate limit is keyed per (market,viewerId) in Redis; a cheap second account resets the quota (Sybil), and there is no per-listing or per-seller cap → an enumerator could scrape all seller contacts across many accounts (moot today due to finding #1, but live once contacts populate) → add per-seller/per-listing reveal caps + account-age gate.`
- `[INFO][abuse][active-user] listing.dto.ts:244 GET /listings?seller_id= is public → seller-listing enumeration, but limited to ACTIVE (L-5) so no non-public leak → acceptable; note for when private states or provider addresses appear.`
- `[INFO][abuse][active-user] listing.service.ts:452 self-reveal blocked (422 SELF_REVEAL) and analytics/animal reads are owner/operator-scoped (prior-audit IDOR headline holds) → no object-level break found by me; certified for the flows I walked.`
- Positive: server-derived `seller_id` (`listing.service.ts:155`), server-forced `status=DRAFT` (`:169`), `forbidNonWhitelisted` on write DTOs, and 404-no-leak on saved-search delete (`saved-search.controller.ts:73`) all resisted my spoofing attempts. Solid.

## Forward-compat flags (persona-need → decision-made-now that blocks the ecosystem)

1. **Animal-bound listing + species-derived market** (`listing.service.ts:146`, `marketOf`) blocks all species-less
   offerings (services/goods/expertise) → **must** land ADR-A (polymorphic Offering) + ADR-B (`market_scope`) before the
   walker/vet/goods personas can exist.
2. **ADMIN-only single-role model** (`admin-user.controller.ts:21`) blocks progressive + multi-role accounts
   (`future-features.md:167,210`) → design the `roles[]` + self-claim seam now.
3. **No OfferingRef in saved-search/favorites** → saved-search stores a raw query; when discovery goes polymorphic it
   will need `offering_type` — reserve it now (`future-features.md:210`).
4. **No Reviews/Reputation or verification seam** → the trust layer every persona asked for (breeder rep, vet license,
   boarder identity) has no anchor → reserve provider+offering review seam (ADR-E).
5. **No monetization_type / geo-anchor as first-class** → single priceCents + optional lat/lng on the listing only;
   provider service-area & lead-gen/subscription/take-rate switching need form-now fields (`future-features.md:186,210`).
6. **`views` never captured** → North-star "частота × широта" needs value + funnel events from day one; view/impression
   capture is irrecoverable history (`future-features.md:201`).

---

## Needs-driven test scenarios (for Phase-3 reviewer-qa / backend to execute)

> Format: **persona → steps → expected**. Each is runnable against the `backend` build (dev-token or phone-OTP).

1. **[BLOCKER repro] Pet owner — contact-reveal returns something.**
   Steps: register+verify seller A (phone); create animal; create `sale` listing; add photo; submit; moderator APPROVE →
   ACTIVE. Register buyer B; `POST /v1/listings/{id}/contact-reveal`.
   Expected (desired): `channels` contains at least one usable contact (phone or telegram).
   Actual (predicted): `channels: {}` — **fails**. Proves finding #1. Variant: seller sets contact via /me — currently
   impossible (no DTO field) → confirms root cause.

2. **[CRITICAL] Provider — vet/groomer can offer a service (or is honestly blocked).**
   Steps: admin promotes user to VETERINARIAN; user `POST /v1/listings` with any listing_type.
   Expected: 403 (excluded from WRITE_ROLES). Confirms the persona has no offering surface → decision needed.

3. **[CRITICAL] Progressive role — farmer self-upgrade.**
   Steps: register USER; attempt to self-set role to FARMER (no endpoint); only `PATCH /v1/admin/users/:id/role` works
   and requires ADMIN. Expected: 403/404 for self, 200 only as admin. Confirms no self-service path (finding #3).

4. **[MAJOR abuse] Listing flood — no per-user quota.**
   Steps: one user creates 50 animals then 50 listings (loop). Expected: all succeed (no quota) → demonstrates spam
   surface. Assert desired: a cap/429 after threshold.

5. **[MAJOR] Livestock pricing expressiveness.**
   Steps: FARMER creates a livestock `sale` listing intending "20 голов, договорная". Expected: only a single integer
   `priceCents` and integer `quantity` storable; no free-text terms → documents GAP-BA-001 impact.

6. **[MAJOR] Seller analytics are meaningful.**
   Steps: create+activate listing; buyer(s) view and reveal; seller `GET /v1/listings/{id}/analytics`.
   Expected: `views` reflects real views. Actual (predicted): `views: 0` always; `contactReveals` reflects reveal rows
   (but reveals return empty channels). Confirms blank-dashboard finding.

7. **[MAJOR abuse] Contact-reveal Sybil / cap bypass.**
   Steps: buyer B reveals up to pet cap (10/h) → 11th → 429 + Retry-After. Then register buyer C, reveal same listing →
   succeeds. Expected: per-seller/per-listing cap should also apply; today only per-(market,viewer) → demonstrates
   Sybil reset.

8. **[MINOR] EXPIRED repost.**
   Steps: create listing with short `expiresAt`; run retention tick → EXPIRED; attempt PATCH/submit.
   Expected: editing gated to DRAFT/ACTIVE → EXPIRED is a dead terminal, seller must recreate. Confirms friction.

9. **[Trust] Buyer report / review absence.**
   Steps: as buyer, look for a way to review a seller or flag a suspicious listing from the buyer flow.
   Expected: no reviews endpoint; content-report exists but is moderator-oriented → documents missing trust layer.

10. **[Forward-compat] Species-less offering.**
    Steps: attempt `POST /v1/listings` without `animalId` (goods/service intent). Expected: 400 (animalId required) →
    proves the animal-bound coupling that blocks the ecosystem (finding fwd-compat #1).

11. **[Positive/IDOR guard] Cross-user object access.**
    Steps: user A creates DRAFT listing + animal; user B `GET /v1/listings/{A-draft-id}`, `GET /v1/animals/{A-id}`,
    `GET /v1/listings/{A-id}/analytics`, `DELETE /v1/saved-searches/{A-id}`.
    Expected: 404/403 no-leak throughout. Certifies the IDOR posture I could not break.

12. **[Consistency] Saved-search role parity.**
    Steps: VETERINARIAN creates a saved search. Expected: 200 (code grants it) even though the geo-search contract
    omits VET/GROOMER → reconcile contract vs RBAC.

---

*Scope note:* frontend wiring (catalog dropdowns, buyer report UI) is `требует ручной проверки` — I audited backend
contracts + code only. I did not modify any product code or docs; this file is my sole output.
