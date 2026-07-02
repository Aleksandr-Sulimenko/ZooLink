# ZooLink HYPER Audit — Phase 2 · reviewer-qa (test-coverage gap map, forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (NOT pushed) · **Role:** reviewer-qa (QA/control gate).
**Method:** read every e2e suite (`backend/test/*.e2e-spec.ts`, 20 files) + unit specs (40 files) + CI
(`.github/workflows/ci.yml`) + migrations 0001-0028 against the contract; mapped active-user's 12
Phase-1 scenarios onto existing tests; verified the two remediation commits (b7aa6b4, addb377).
**Finding format:** `[severity][criterion][reviewer-qa] file:line → problem → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO · criterion ∈ coverage · negative-invariant · migration ·
forward-compat · masking · determinism. Unverifiable → `требует ручной проверки`.

> **Scope discipline:** I did NOT run the suite (that is Phase 3) and made NO code/doc edits. This file
> is my sole output. Line numbers are as-read on this checkout.

---

## A. Verdict on the audit's CRITICAL test gaps — CONFIRMED CLOSED (with one masking caveat)

The 2026-06-30 audit flagged four behavioral gaps. All are now backed by **real behavioral tests** that
drive the live HTTP stack (PG + Redis), not mock-only assertions. Confirmed:

| Gap (AUDIT_2026-06-30) | Test that closes it | Verdict |
|---|---|---|
| Refresh-token rotation / reuse-detection (**zero** tests) | `backend/test/auth-refresh.e2e-spec.ts` (6 cases: rotate+revoke-old, **reuse → whole-family burn on live PG**, logout-one, logout-all, garbage-token, deactivated-account re-check) | **CLOSED — strong.** Reuse/theft path (the #1 risk) is genuinely exercised incl. sibling-revocation on live `refresh_tokens`. |
| Cascade-deactivation triggers | `backend/test/listing-cascade.e2e-spec.ts` (animal-cascade, user-cascade, SOLD/EXPIRED **not** touched, one-way non-resurrection, `is_active` cleared) | **CLOSED — strong.** Both AFTER-UPDATE triggers + negative (terminal states skipped) covered. |
| 429 rate-limit + headers on HTTP | `backend/test/rate-limit.e2e-spec.ts` (under-limit `X-RateLimit-*`, limit+1 → 429 `problem+json` `RATE_LIMITED` + `Retry-After`) | **CLOSED.** Also a 2nd 429 path in `listing-contact-sold.e2e-spec.ts:209` (per-market reveal cap 10/h). |
| `uq_active_listing_per_type` negative | `backend/test/listing-cascade.e2e-spec.ts:220` (2nd ACTIVE same-type on one animal → APPROVE flip → **409 `ACTIVE_LISTING_EXISTS`**, not 500; not flipped) | **CLOSED — strong.** Partial-unique violation mapped to a clean 409 and asserted. |

**b7aa6b4 (QA-gate) verified:** the diff really adds the 4 files it claims (idempotency.interceptor 6,
org-membership 4, recovery 1 unit + moderation APPROVE/REJECT event-seam e2e, +267 lines). It closes
the **event-emission** zero-test gap (`moderation.e2e-spec.ts` now asserts `Moderation.Decided` +
`Listing.Activated` envelope on APPROVE, and Decided-not-Activated on REJECT). Legitimate, not a
rubber-stamp.

- `[CRITICAL][masking][reviewer-qa] backend/test/listing-contact-sold.e2e-spec.ts:116 → the contact-reveal happy-path test SEEDS contact_phone/contact_telegram/contact_prefs directly via prisma.users.create (fixture), so it proves only the reveal MECHANISM works when contacts are pre-populated. It does NOT test active-user finding #1 (the BLOCKER): there is NO application writer for those columns — registration (identity.service.ts:90) omits them and UpdateProfileDto (identity.dto.ts:102) has no contactPhone/telegram/visibility field. → the green suite HIDES a dead marketplace: every real (registered) user reveals `channels: {}`. ADD (Phase 3) an e2e that registers via the real flow, tries to set contacts via PATCH /v1/me, and asserts the reveal is non-empty — it will FAIL today, correctly. Assert now that UpdateProfileDto REJECTS contactPhone (forbidNonWhitelisted 400) so the gap is documented as a red test.`

## B. Migration-integrity verdict — CONFIRMED (addb377 is real and adequate)

`ci.yml` job **`migration-drift`** (lines ~94-162) does exactly what the commit claims:
1. **Path 1** — fresh DB from `database_schema.sql` (canonical).
2. **Path 2** — canonical schema + replay `migrations/*.sql` (pass 1, `ON_ERROR_STOP=1`, must apply clean).
3. **Idempotency HARD GATE** — replay ALL migrations a **2nd time** (pass 2) — same proof as seed×2.
4. **DDL drift diff (BLOCKING)** — normalized `pg_dump --schema-only` of canonical vs migrated; any
   structural divergence fails the build. (Already caught 0023 CHECK-name drift, reconciled by 0026.)

Migrations **0001-0028** are all under this guard (glob `migrations/*.sql`). The main `build` job also
does seed×2 + a Prisma-schema drift check. **Verdict: migration integrity is genuinely gated — replayed,
idempotent-×2, and diffed against the canonical schema dump.** One residual:

- `[MINOR][migration][reviewer-qa] .github/workflows/ci.yml:~148 → the DDL diff strips comments (`--no-comments`) and normalizes `\restrict` tokens; it proves STRUCTURAL identity but not that data-seeding migrations (0010/0011 reasons/reference-data) are idempotent at the ROW level (only DDL is diffed) → add a row-count/`ON CONFLICT` assertion for seed-bearing migrations, or `требует ручной проверки` that all seed migrations are `INSERT ... ON CONFLICT DO NOTHING`.`
- `[INFO][migration][reviewer-qa] migrations/ 0001-0028 → replayed on TOP of the canonical schema, which already contains their end-state; this proves "migration is a no-op/idempotent against final schema" but NOT "migration transforms an OLD DB forward" (there is no from-N-1 replay path) → acceptable under ADR-0007 (SQL-canonical, provision applies schema.sql only), but note it: migrations are drift-guards, not a live upgrade path. Document so no one assumes rolling upgrades are tested.`

## C. active-user's 12 scenarios → existing-test map (Phase-3 build list)

`✅ COVERED` = a test asserts the expected behavior · `🟡 PARTIAL` = mechanism covered, the scenario's
specific negative/abuse leg is not · `❌ GAP` = no test.

| # | Scenario (persona → intent) | Existing test | Status |
|---|---|---|---|
| 1 | Contact-reveal returns something (BLOCKER repro) | `listing-contact-sold.e2e` proves reveal **mechanism** only (contacts pre-seeded); no happy-path-writer / `/me` test | 🟡 PARTIAL → treat as **GAP** (blocker root-cause untested; see A masking finding) |
| 2 | Vet/groomer can offer (or honestly 403) | none — no test asserts VET/GROOMER → 403 on `POST /listings` | ❌ GAP |
| 3 | Farmer self-role-upgrade blocked | `admin-user.service.spec` covers admin-driven role change; no test that SELF cannot set role | ❌ GAP |
| 4 | Listing flood — no per-user quota | none | ❌ GAP |
| 5 | Livestock pricing expressiveness | none (documents GAP-BA-001) | ❌ GAP |
| 6 | Seller analytics meaningful | `listing-contact-sold.e2e:290` asserts `views:0, contactReveals:1`, ETag, private cache | ✅ COVERED (documents views=0) |
| 7 | Contact-reveal cap + **Sybil** bypass | cap 10/h→429 covered (`:209`); the Sybil reset (2nd account revives quota, no per-seller/per-listing cap) NOT tested | 🟡 PARTIAL |
| 8 | EXPIRED repost friction | `retention.e2e` covers ACTIVE→EXPIRED + idempotency; NOT that PATCH/submit on EXPIRED is gate-rejected | 🟡 PARTIAL → **GAP** on the edit-gate leg |
| 9 | Buyer report/review absence (trust) | none (feature absent) | ❌ GAP (forward test) |
| 10 | Species-less offering (`animalId` required) | `animalId` is `@IsUUID` required (dto:62) so omission → 400 implicitly; no dedicated forward-compat test | 🟡 PARTIAL → **GAP** on the explicit assertion |
| 11 | IDOR cross-user object access | DRAFT read 404 (`listing.e2e` L-5:178), analytics non-owner 404 (`:300`), animals non-owner 403 (`animal.e2e:211,282`), saved-search delete 404 | ✅ COVERED |
| 12 | Saved-search role parity (VET) | `saved-search.e2e` SS-1:102 (VETERINARIAN can create/list own) | ✅ COVERED |

**Tally: 3 fully COVERED (6, 11, 12) · 3 PARTIAL (1, 7, 8/10) · 6 effective GAP (1, 2, 3, 4, 5, 9)** —
i.e. only **3 of 12 are green-and-honest**; the other 9 need Phase-3 tests (some deliberately RED to
lock a known-broken invariant per the owner's "no test → not done" rule).

## D. Coverage census — surfaces WITH vs WITHOUT negative-invariant tests

**Well-covered (negative tests exist):** auth/refresh (rotation+reuse), listing lifecycle + RBAC + ETag
+ idempotency (`listing.e2e` ~40 cases), listing search/geo Haversine boundary (`listing-search.e2e`
L2-7/9/14), contact-reveal gating + mark-sold state machine, cascade triggers + uq_active, moderation
+ escalation + event-seam, retention/expire, outbox relay/backoff, rate-limit 429, saved-search
own-scope, admin reference-data/system-settings/audit, transfer, content-report, crypto/sigv4/pii units.

**Under-covered / no negative test:**
- `[MAJOR][coverage][reviewer-qa] backend/src/modules/identity/dto/identity.dto.ts:102 → UpdateProfileDto (self-service /me) has NO test at the e2e layer proving which fields it accepts/rejects; profile.service.spec is unit-only → the contact-field gap (finding #1) has no guard → add /me PATCH e2e (accept fullName/cityId/email/avatar/lang; reject contactPhone until built).`
- `[MAJOR][coverage][reviewer-qa] backend/src/modules/listing/listing.controller.ts:38 → WRITE_ROLES (USER/BREEDER/FARMER/ADMIN) exclusion of VETERINARIAN/GROOMER has no negative test → a future widening of the role set could silently grant listing-write with nothing catching it → add role-matrix e2e per rbac-matrix.md.`
- `[MAJOR][coverage][reviewer-qa] backend/src/modules/listing/listing.service.ts:130 → no per-user listing-creation quota AND no test asserting current (unbounded) behavior → the abuse surface is neither capped nor characterized → add a RED test that documents the flood, flip to GREEN when a cap lands.`
- `[MINOR][coverage][reviewer-qa] backend/src/modules/listing/dto/listing.dto.ts:420 → analytics.views hard-0 is asserted (good) but there is no view-capture pipeline to test; when it lands it must ship WITH a funnel test → reserve a forward test stub so views≠0 is provable.`

## E. FORWARD-COMPAT — where tests must be laid AHEAD (owner's "lay tests down for the unbuilt")

The ecosystem surfaces are contract-only today (favorites, Offering/ServiceOffering, org/branch,
reviews, find-nearby directory, notification, payment). Per the rule "no test → not done, tests ahead
for the unbuilt," pre-write RED/`it.todo` tests so building can't regress silently:

- `[MAJOR][forward-compat][reviewer-qa] future-features.md:210 (OfferingRef seam) → polymorphic Offering (service/product/consultation) is unbuilt; when it lands, the animal-bound `listing.service.ts:146` coupling must be relaxed → pre-write it.todo e2e: "POST an Offering with NO animalId → 201" (today 400) so the seam has a target.`
- `[MAJOR][forward-compat][reviewer-qa] future-features.md:194 (find-nearby wedge) → geo is tested only for animal-bound listings; the provider/Offering find-nearby directory has no test anchor → pre-write it.todo: "find-nearby returns species-less providers within radius, sorted by distanceM" reusing the Haversine fixture from listing-search.e2e.`
- `[MAJOR][forward-compat][reviewer-qa] future-features.md:174,177 (Reviews/verification) → no reviews/reputation/provider-verification endpoint → pre-write it.todo negative: "a buyer can review a completed transaction; cannot review without one; one review per (reviewer,subject)" so the trust invariants exist before code.`
- `[MINOR][forward-compat][reviewer-qa] favorites-api.yaml (no controller) → pre-write it.todo: "favorite a listing; list favorites own-scoped; unfavorite is idempotent" — the OfferingRef{type,id} shape reserved now.`
- `[INFO][forward-compat][reviewer-qa] migrations/20260701_0027_goods_marketplace_toggle.sql → the goods toggle now exists (GAP-BA-011 closed); add a feature-toggle e2e asserting goods listings are gated OFF by default so the flag's default can't flip unnoticed.`

---

## Phase-3 hyper-test plan

**Execution model.** All e2e drive the real HTTP stack (host PG + Redis), dev-token or phone-OTP, deterministic
(reset throttle + flush reveal keys, self-contained fixtures, clean up outbox rows). Unit specs for pure logic.
Run order: P0 regression (must stay green) → P1 gap-closers (some deliberately RED) → P2 forward stubs (`it.todo`).
Each case: `id · file · steps · expected · today's actual`. RED = expected-to-fail-today (locks a known-broken
invariant so it can't silently "pass"); when the fix lands the test flips GREEN.

### P0 — Regression guard (run first; MUST stay green)
1. **P0-1 Full suite baseline** — `npm test` (unit ×2 deterministic) + `npm run test:e2e`. Expected: 450 unit / 237 e2e green (per b7aa6b4). Any red = regression before we start.
2. **P0-2 CI migration-drift locally** — apply `database_schema.sql`; replay `migrations/*.sql` ×2; `pg_dump` diff canonical vs migrated = empty. Expected: clean (mirrors `ci.yml` migration-drift job).
3. **P0-3 Seed×2** — `npm run seed` twice; no unique-violation, row counts stable. Expected: idempotent.

### P1 — Coverage-gap closers (the census + active-user GAPs)
4. **P1-1 (scenario 1, RED) Contact happy-path** — register+verify seller via real OTP flow; `PATCH /v1/me` attempt to set contactPhone. Expected(desired): accepted + reveal returns non-empty channels. **Actual today: RED** — `UpdateProfileDto` rejects contactPhone (400) → reveal `channels:{}`. Lock finding #1.
5. **P1-2 (scenario 1b) /me DTO whitelist** — `PATCH /v1/me` with `{contactPhone,contactTelegram,showPhone}`. Expected today: 400 `forbidNonWhitelisted`. Documents the missing writer; flips when the field is added.
6. **P1-3 (scenario 2) Vet/groomer listing-write** — admin-promote user to VETERINARIAN; `POST /v1/listings`. Expected today: **403** (excluded from WRITE_ROLES). Certifies the honest block; re-point when ServiceOffering lands.
7. **P1-4 (scenario 3) Self role-upgrade blocked** — USER attempts to self-set role (no endpoint exists) and `PATCH /v1/admin/users/:id/role` as non-admin. Expected: 404/403 for self, 200 only as ADMIN.
8. **P1-5 (scenario 4, RED) Listing-flood quota** — one user creates N animals then N listings in a loop. Expected(desired): a 429/`QUOTA_EXCEEDED` after threshold. **Actual today: RED** — all succeed (no cap). Locks the abuse surface (route fix to security/backend).
9. **P1-6 (scenario 7) Contact-reveal Sybil** — buyer B exhausts pet cap (10/h → 429); register buyer C; reveal same listing → succeeds today. Expected(desired): a per-seller/per-listing cap also fires. Assert current per-(market,viewer) keying + document the Sybil reset as RED.
10. **P1-7 (scenario 8) EXPIRED edit-gate** — retention tick → EXPIRED; attempt `PATCH`/`submit`. Expected: 409/422 (editing gated to DRAFT/ACTIVE, `listing.service.ts:224`). Certifies EXPIRED is terminal; documents no-repost friction.
11. **P1-8 (scenario 10) Species-less offering explicit** — `POST /v1/listings` with NO `animalId`. Expected today: 400 (`@IsUUID` required). Explicit assertion of the animal-bound coupling (fwd-compat #1 anchor).
12. **P1-9 (scenario 5) Livestock pricing** — FARMER creates livestock `sale` intending "20 голов, договорная". Expected: only integer `priceCents`+`quantity` storable; no free-text terms. Documents GAP-BA-001; flips when `price_terms_text` lands.
13. **P1-10 /me profile e2e** — happy-path `PATCH /v1/me` (fullName/cityId/email/avatar/lang accepted; unknown rejected; ETag/If-Match honored). Closes the identity-DTO census gap.
14. **P1-11 RBAC role-matrix e2e** — table-drive each role × each write endpoint (create-listing, contact-reveal, moderation-action, admin-role) against `rbac-matrix.md`. Expected: exact allow/deny per matrix. Guards silent role-widening.

### P2 — Forward tests laid AHEAD (`it.todo`/RED stubs for the unbuilt)
15. **P2-1 Offering seam** — `it.todo`: POST an Offering with no animalId → 201; market from `market_scope` not species. (undoes `marketOf` coupling)
16. **P2-2 find-nearby directory** — `it.todo`: provider/Offering find-nearby within radius, sorted by `distanceM`, species-less. Reuse Haversine fixture from `listing-search.e2e`.
17. **P2-3 Reviews/reputation** — `it.todo`: review only after a completed transaction; one per (reviewer,subject); reputation aggregates; provider-verification badge gate.
18. **P2-4 Favorites** — `it.todo`: favorite/unfavorite idempotent, own-scoped list, `OfferingRef{type,id}` shape.
19. **P2-5 Booking (Offering)** — `it.todo`: book a service slot; double-book → 409; cancel state machine. (for ServiceOffering/consultation)
20. **P2-6 goods_marketplace toggle** — feature-toggle e2e: goods listings gated OFF by default (0027 migration), flip-on path exercised.
21. **P2-7 View-capture funnel** — `it.todo`: instrument a view → analytics.views ≥ 1 (locks the day-1 funnel so `views` can't stay hard-0 silently).

### P3 — Adversarial / non-functional (carry from security's lane; verify, don't own)
22. **P3-1 Idempotency under concurrency** — parallel identical `Idempotency-Key` POSTs → exactly one effect (extends idempotency.interceptor.spec to e2e race).
23. **P3-2 Migration from-N-1 (optional)** — if a live-upgrade path is ever claimed, add a forward-transform replay; today `требует ручной проверки` (ADR-0007 = schema-canonical, not tested).

**Plan size: 23 concrete cases** — 3 regression guards, 11 gap-closers (2 deliberately RED: P1-1, P1-5;
several documenting-RED), 7 forward stubs, 2 adversarial/NFR. Closing P1 takes the 12 scenarios from
**3 green → 12 green-or-honest-RED**; P2 lays the ecosystem tripwires so the unbuilt can't regress silently.

---

*No code or docs modified. `require ручной проверки`: (a) exact green counts (450/237) — asserted by
b7aa6b4, not re-run here (Phase 3 runs the suite); (b) row-level idempotency of seed-bearing migrations
(only DDL is diffed in CI); (c) frontend wiring of the /me contact form (backend contract only).*
