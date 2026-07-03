# ZooLink HYPER² Audit (Round 2) — frontend-engineer · forward-compat, API-consumer lens

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) · **Role:** placeholder
(no SPA exists — I audit the **contract + code as a future codegen-typed client will consume it**, per the
placeholder-role boundary; I do not scaffold UI, pick a framework, or edit product code).

**Method:** Independent pass first (did not re-read round-1 until step 2). Walked the screens a client must
build — login/refresh, "my contacts" settings, catalog list/detail, contact-reveal card, near-me, favorites,
notifications, saved-search "new matches" — and asked: can a typed client render it honestly, cache it, and
survive Part-B offerings without a rewrite? Then diffed against `AUDIT2/frontend-engineer.md`.

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ auth · integrability · render · caching ·
forward-compat · i18n · trust.

---

## A. Security seams visible to the frontend

- `[MAJOR][auth][CONFIRMED] docs/03-architecture/api-contracts/auth-api.yaml:630,651,670 + backend/src/modules/auth/auth.controller.ts:33 + auth.service.ts:29,45 (TokenPairDto.refreshToken) → refresh token is returned in and read from the JSON body. This directly contradicts the normative API_CONVENTIONS.md:33-35 ("refresh token is set/read as an HttpOnly, Secure, SameSite=Strict cookie `refresh_token`; access token in the body"). NEW granularity vs round-1: contract AND code agree with each other and both VIOLATE the convention (3-way: convention=cookie, contract=body, code=body). Consumer impact: a codegen client must persist the refresh token in JS-reachable storage (localStorage/memory) → XSS token-exfil, the exact risk the cookie policy exists to remove; the convention's browser-driven silent-refresh-on-401 is un-buildable. → Per Prime-Directive-3 fix the contract-of-record (architect ADR): move refresh to Set-Cookie HttpOnly + drop it from the body, OR amend §2 with a WHY. Verdict: today's contract yields an XSS-liable auth client.`

- `[MAJOR][trust][NEW] backend/src/modules/identity/dto/identity.dto.ts:44-47 (RegisterOAuth/complete), :91-94 (OAuthDto), :123-125 (UpdateProfileDto) → `avatarUrl` is validated only `@IsString() @MaxLength(500)` — NO `@IsUrl` and NO scheme allowlist. auth-api.yaml declares `avatarUrl: format: uri` (:564,595,716) but OpenAPI `format` is documentation only (class-validator does not enforce it), and `uri` format does not exclude `javascript:`/`data:text/html` schemes anyway. Contrast listing photos which ARE guarded (`listing.dto.ts:215 @IsUrl({require_tld:false})`). Consumer impact: a stored `javascript:…`/`data:…` string reaches any future admin panel or SPA that renders `avatarUrl` as `<img src>` or (worse) `<a href>` → stored XSS in an operator/admin surface (ADR-0006 makes operators agents/humans — a poisoned avatar is a cross-tenant seam). → Add `@IsUrl({ protocols:['http','https'], require_protocol:true })` to all three DTOs now (cheap, form-only), and mandate FE-side URL sanitisation before render. NEW — round-1 audited the contract only; this is the code-DTO gap the contract hides.`

- `[MINOR][trust][NEW] backend/src/modules/identity/oauth/telegram.adapter.ts:72 → `avatarUrl` is taken from provider `photo_url` unvalidated and stored. Same stored-XSS class as above via an untrusted upstream; the `@IsUrl` fix on the write path plus render-time sanitisation both apply. → Validate provider-supplied avatar URLs on ingest.`

## B. Contract readiness for a codegen SPA

### B1. RFC7807 / PageMeta / roles — RESOLVED since round-1 (positive)
- `[INFO][integrability][SEV-CHG] docs/03-architecture/api-contracts/*.yaml → ALL 13 contracts now carry a `Problem` $ref, `PageMeta`, and `x-required-roles`; `offset` count is 0 across every file. My prior memory (2026-06-22) and round-1's implicit baseline treated Problem/PageMeta non-conformance and matching's `offset` pagination as the #1 rewrite risk — that mechanical conformance is now DONE. SEV-CHG: downgrade "envelope drift / matching-offset" from CRITICAL to resolved. The `code`-enum discipline (VALIDATION_ERROR/UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT/RATE_LIMITED/STALE_RESOURCE + domain codes SELF_REVEAL/LISTING_NOT_ACTIVE/MARKET_REQUIRED/GEO_PARAMS_INCOMPLETE) is exactly what a client switches on for toasts/inline errors. Good.`

### B2. Structural type-sharing — still not codegen-clean
- `[MINOR][integrability][CONFIRMED] docs/03-architecture/api-contracts/ (no `_common.yaml`) → `Problem`/`PageMeta`/`LocalizedString` are defined INLINE in each of the 13 files. A per-file codegen yields 13 structurally-divergent types for the same concept; and `favorites-api.yaml`'s `Problem` has NO `errors` field (contrast `animals-api.yaml:316 errors: {type: array…}`), so a client's field-error renderer has nowhere to read validation issues on favourite flows. → Extract `_common.yaml` and `$ref` it everywhere so codegen yields ONE shared `Problem`/`PageMeta`/`LocalizedString`. CONFIRMED (round-1 §5/#9); severity holds at MINOR now that the wire shapes themselves match.`

### B3. Conditional GET — client cache still un-buildable on public reads
- `[MAJOR][caching][CONFIRMED] docs/03-architecture/api-contracts/listings-api.yaml (GET /listings, GET /listings/{id}), animals-api.yaml, geo-search-api.yaml → public GETs SEND `ETag` but declare NO `If-None-Match` request param and NO `304` response (only auth-api.yaml references If-None-Match, for /me). A client receives an ETag it has nowhere to send back → every catalog scroll / detail re-open re-downloads full bodies; §13's CDN/perf promise is unreachable from the client. → Add `If-None-Match` param + `304` to every public read. CONFIRMED unchanged since round-1.`

### B4. Dead contracts — yaml exists, no backend behavior (client would build on emptiness)
Modules present: `admin, animal, auth, identity, listing, moderation, saved-search`. Absent: everything else.
- `[MAJOR][integrability][NEW] notification-api.yaml → NO `notification` module exists (only a `notification_prefs` column referenced at admin-user.service.ts:225). A client that builds a notification centre / bell / unread-badge binds to a contract with zero behavior behind it. → Mark the contract "form-only, behavior deferred" (like payments) so the FE phase doesn't ship a dead surface; sequence delivery before any notification UI.`
- `[MAJOR][integrability][NEW] backend/src/modules/saved-search/ → saved searches are PERSISTED (create/list/CRUD) but there is NO matcher/runner/notifier (no cron/worker/match/notify in saved-search.service.ts). A client "у вас N новых совпадений" surface would render against nothing — the feature looks broken. → Either build the matcher or document saved-search as store-only in MVP so the FE doesn't promise match alerts. NEW (round-1 did not cover saved-search).`
- `[MINOR][integrability][NEW] favorites-api.yaml → NO `favorites` module (grep: zero). The ONLY historically-conformant contract has no behavior. A favourites/shortlist toggle is un-backed. → Track as form-only; the forward-compat point (B6) still applies to its shape.`
- `[MINOR][integrability][NEW] organization-api.yaml, branch-api.yaml, matching-api.yaml, payment-api.yaml, geo-search-api.yaml (standalone) → no backing modules (payment is expected gated behind `feature_toggles.payments`; matching overlaps saved-search). Inventory so the FE phase knows which yaml are consumable vs decorative. → Annotate each contract's implementation status; a client should not codegen a screen for a decorative contract.`

### B5. Contact-reveal — REFUTED as "dead", narrowed to a missing setter
- `[BLOCKER][integrability][CONFIRMED] docs/03-architecture/api-contracts/auth-api.yaml:763 (UpdateProfileRequest) + backend/src/modules/identity/dto/identity.dto.ts:102-131 (UpdateProfileDto) → the seller profile-update surface exposes only fullName/cityId/email/avatarUrl/preferredLanguage — NO contactPhone/contactTelegram/showPhone/showTelegram. With `forbidNonWhitelisted`, posting one 400s. So a "мои контакты" form is unbuildable and the seller's `contact_phone`/`contact_prefs` stay null. → Add the four fields to the profile-update DTO + contract. CONFIRMED (round-1 blocker #1).`
- `[MAJOR][integrability][REFUTED-partial] backend/src/modules/listing/listing.service.ts:444 (revealContact) → the reveal BEHAVIOR is now fully implemented (ACTIVE-gate, self-reveal 422/SELF_REVEAL, per-market rate-limit, ADR-0019 decrypt-at-reveal). REFUTES the task-hint framing that "contact-reveal channels" is a dead contract — it is LIVE. The card is empty ONLY because of the missing setter (B5 blocker), not missing reveal. Net: the gap narrowed from "no reveal + no setter" to "reveal works, setter missing".`
- `[MAJOR][render][CONFIRMED] listings-api.yaml:6-37 (ContactRevealResult) → `channels {phone?, telegram?}`, both optional, NO discriminator between "seller disabled channel", "seller never set it", and "revealed OK". The client cannot write honest copy ("контакт скрыт" vs "не указан") and it BURNS the buyer's reveal quota to render `{}`. → Add `hasChannels`/per-channel `{value, visibility}` so the client renders an honest state and can gate the button before spending quota. CONFIRMED (round-1 render MAJOR).`

## C. Forward-compat — OfferingRef / polymorphism for the future OfferingCard

- `[MAJOR][forward-compat][CONFIRMED] docs/03-architecture/api-contracts/listings-api.yaml (Listing.animalId REQUIRED; GET /listings → items:[Listing]) → no polymorphic `OfferingRef`/discriminator anywhere in the contract set (only `transfers-api.yaml:354 oneOf` exists, and that is the user/org party union, NOT an offering polymorphism). A client's list/detail/card built today is hard-`Listing`/`animalId`-shaped; when ServiceOffering/ProductOffering (species-less) land, the card renderer, list type, and detail route all need re-typing — the "irreversible-if-deferred" retrofit ADR-0014 warns about. → Introduce a generic `OfferingRef{offeringType, offeringId}` + a polymorphic read-model card envelope (offeringType, marketScope, displayTitle, priceOrTerms, providerRef; ANIMAL_LISTING only in MVP, additive) so the client builds ONE card that switches on `offeringType`. Free now (modules unbuilt). CONFIRMED.`
- `[MAJOR][forward-compat][CONFIRMED] geo-search-api.yaml (GeoSearchResult.listingId) + favorites-api.yaml (Favorite.listingId) → near-me grid and favourites/shortlist are keyed on `listingId`; a polymorphic discovery forces a second incompatible data path later. → Key both on `OfferingRef` now. CONFIRMED (round-1 forward-compat).`
- `[MAJOR][consistency][CONFIRMED] listings-api.yaml (GET /listings, `radius_km` 1–100, returns Listing) vs geo-search-api.yaml (GET /geo-search, `radius_m` 1000–100000, returns thin GeoSearchResult) → two near-me endpoints, different radius units and shapes, no doc on which the map view calls. A client integrator must guess. → Collapse to one canonical near-me endpoint. CONFIRMED.`
- `[MINOR][forward-compat][CONFIRMED] listings-api.yaml (PATCH If-Match REQUIRED; ETag on GET/mutation) → optimistic-UI IS supportable (ETag/If-Match/412-STALE_RESOURCE + Idempotency-Key). BUT a PATCH of a material field on an ACTIVE listing silently re-enqueues to PENDING_MODERATION → naive autosave-on-keystroke would bounce a live listing out of search. → Client must gate autosave to DRAFT + explicit "сохранить" on ACTIVE. CONFIRMED (round-1 MINOR).`

## D. i18n / LocalizedString consistency

- `[INFO][i18n][SEV-CHG] docs/03-architecture/api-contracts/animals-api.yaml, moderation-api.yaml, organization-api.yaml, listings-api.yaml → LocalizedString is now consistently a `$ref`'d `{en, ru}` schema (via `allOf`), including organization (my 2026-06-22 memory flagged organization using flat `name_ru`/`name_en` and listings using freeform `additionalProperties` — both now unified). SEV-CHG: the "three localization shapes" i18n-rewrite risk is largely RESOLVED at the wire level. Residual: the type is still inlined per file (see B2) — one shared `LocalizedString` awaits `_common.yaml`. EN-fallback behavior (`Accept-Language: ru|en`) is a runtime concern to assert in the FE phase (`требует ручной проверки` on live responses).`

---

## Diff summary vs AUDIT2/frontend-engineer.md

| # | Finding | Verdict |
|---|---------|---------|
| A | refresh token in JSON body vs cookie convention | **CONFIRMED** (+ code-level 3-way proof) |
| A | avatarUrl `@IsString` without `@IsUrl` → stored-XSS | **NEW** |
| A | Telegram provider avatar URL unvalidated on ingest | **NEW** |
| B1 | Problem/PageMeta/x-required-roles conformance | **SEV-CHG** (CRITICAL→resolved) |
| B1 | matching `offset` pagination | **REFUTED** (offset=0 everywhere) |
| B2 | no `_common.yaml`, favorites Problem lacks `errors` | **CONFIRMED** |
| B3 | ETag without If-None-Match/304 on public reads | **CONFIRMED** |
| B4 | notification-api.yaml unimplemented | **NEW** |
| B4 | saved-search stored but no matcher/notifier | **NEW** |
| B4 | favorites-api.yaml unbacked | **NEW** |
| B4 | organization/branch/matching/payment/geo no modules | **NEW** (inventory) |
| B5 | "мои контакты" setter missing → reveal empty | **CONFIRMED** (blocker #1) |
| B5 | contact-reveal is a dead contract | **REFUTED** (reveal is LIVE) |
| B5 | ContactRevealResult no hidden/unset discriminator | **CONFIRMED** |
| C | Listing.animalId-shaped, no OfferingRef | **CONFIRMED** |
| C | geo/favorites keyed on listingId not OfferingRef | **CONFIRMED** |
| C | two near-me endpoints, radius unit mismatch | **CONFIRMED** |
| C | material-edit bounces ACTIVE → autosave guard | **CONFIRMED** |
| D | LocalizedString / three-shapes i18n rewrite risk | **SEV-CHG** (resolved at wire level) |

**Counts:** NEW 6 · CONFIRMED 10 · REFUTED 2 · SEV-CHG 3.

*Scope note:* No SPA exists; I audited contract + code as a future client consumes them. I did not scaffold UI,
pick a framework, or edit product code/docs (placeholder-role boundary + Prime-Directive-7). Framework/SSR/
design-system remain architect+owner (ADR). This file is my sole output.
