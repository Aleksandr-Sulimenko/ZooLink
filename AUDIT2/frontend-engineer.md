# ZooLink HYPER Audit — Phase 2 · frontend-engineer (CLIENT-INTEGRABILITY, forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** no SPA exists yet, so I audited the
**contract as the client will consume it** — walked each screen a client MUST build (login/refresh, catalog list,
listing detail + contact-reveal card, "edit my contacts", empty/error states, near-me) and asked "can a
codegen-typed client render this honestly, cache it, and survive Part-B offerings without a rewrite?" Grounded in
`AUDIT2/active-user.md` (Phase-1) + `AUDIT2/alpha-analyst.md` (contract-shape). I **build on** alpha's contract-drift
findings and do **not** re-file them; my lens is *what breaks in the client*.

Finding format: `[severity][criterion][frontend] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ integrability · render · caching · auth · forward-compat · trust.

> **Consumer baseline.** A Phase-2 SPA is planned behind Caddy (`try_files … /index.html`, ADR-0009); the placeholder
> role forbids me picking a framework — so this is a **contract-consumability** audit, not UI code. The four headline
> frontend MAJORs from `AUDIT_2026-06-30.md:55` are re-judged below **through the client's eyes** (they are real, and
> each has a concrete client-side symptom). Alpha-analyst owns the contract-of-record fixes; I own the render impact.

---

## 🔴 Client-integration blockers (a client literally cannot build the screen)

### 1. The "add your phone / Telegram" screen cannot exist → contact-reveal card renders permanently empty
The client's core conversion UI is: buyer taps **«показать контакт»** → renders a card from `ContactRevealResult.channels`
(`listings-api.yaml:995-1026` → `{phone?, telegram?}`). But the seller has **no screen to populate those channels**:
`UpdateProfileRequest` (`auth-api.yaml:763-792`) exposes only `fullName/cityId/avatarUrl/email/preferredLanguage` — there
is **no `contactPhone`, `contactTelegram`, `showPhone`, `showTelegram`**. A typed client generated from this contract has
**no field to bind a "мои контакты" form to**, and `forbidNonWhitelisted` on the DTO means posting one 400s. Consequence
for the UI: `channels` is always `{}`, so the reveal card renders as an **empty state with no honest copy** — the client
can't even show "продавец не указал контакт" because the contract implies channels *should* be there. This is the
client-facing twin of active-user BLOCKER #1 / alpha §4 — I file the **render symptom**, not the contract gap.
`[BLOCKER][integrability][frontend] auth-api.yaml:763 (UpdateProfileRequest) → no contactPhone/contactTelegram/showPhone/showTelegram field ⇒ the "edit my contacts" screen is unbuildable and ContactRevealResult.channels (listings-api.yaml:1017) is always {} ⇒ the reveal card, the app's only conversion surface, renders empty forever → add the four fields to UpdateProfileRequest so a client can bind the settings form; then the reveal card has data to render. (Contract fix owned by alpha-analyst/backend; this records the UI blocker.)`

### 2. Client cannot implement the prescribed silent-refresh; forced into the XSS-liable pattern
`AuthResponse.refreshToken` (`auth-api.yaml:670`) + `TokenPairResponse.refreshToken` (:651) + `RefreshTokenRequest.refreshToken`
(:630) put the refresh token **in the JSON body**, contradicting `API_CONVENTIONS §2` (HttpOnly `refresh_token` cookie).
Client impact is twofold and real: (a) to persist a session across reloads the SPA must **store the refresh token in JS-reachable
storage** (localStorage/memory) — the exact XSS-exfiltration liability §2 exists to remove; a codegen client wires the token
into an `Authorization`/body flow, not a cookie. (b) The convention's **silent refresh on 401** (browser auto-sends the cookie
to `POST /auth/refresh`) is **un-implementable** — the client must hand-manage refresh-token lifecycle, rotation, and logout
revocation itself. Either way the client is built wrong-by-contract.
`[MAJOR][auth][frontend] auth-api.yaml:670,651,630 → refreshToken in body forces the SPA to store a long-lived secret in XSS-reachable JS and makes the §2 cookie-based silent-refresh un-buildable → per Prime-Directive-3 fix contract-of-record: move refresh to HttpOnly cookie (or amend §2). Alpha-analyst owns the ADR; client verdict = today's contract yields an XSS-liable auth client.`

---

## 2. Render honesty — empty & error states (can the client render the truth?)

- `[MAJOR][render][frontend] listings-api.yaml:995-1026 (ContactRevealResult) → channels is `{phone?, telegram?}` with BOTH optional and NO discriminator between "seller disabled channels", "seller never set them", and "revealed successfully" → the client cannot tell an empty-because-unset card from an empty-because-hidden card, so it cannot write honest copy ("контакт скрыт" vs "не указан") and worse, it BURNS the buyer's reveal quota (pet 10/h) to render nothing (active-user #1) → add an explicit `hasChannels`/reason or a per-channel `{value, visibility}` so the client renders an honest state AND can gate the button before spending quota.`
- `[MAJOR][render][frontend] listings-api.yaml:131-145 (GET /listings) → the list envelope documents 200/400/422/500 but the buyer's primary filter path (species/breed/price/geo) can yield ZERO rows; there is no distinct signal, so an empty catalog and a valid-but-empty filter both return `{items:[], meta:{total:0}}` → acceptable IF `meta.total` is reliably 0 (it is present — PageMeta:600-604) → the client CAN render "ничего не найдено" from `meta.total===0`; **this one is OK** — recorded as the positive baseline for the empty-state probe.`
- `[MINOR][render][frontend] listings-api.yaml:170 (analytics — via active-user #6) → seller dashboard binds `views`/`contactReveals` which are hard-0 today → the client renders a truthful-but-useless "0 просмотров, 0 контактов" dashboard → not a contract bug (§16 shape is fine); flag so the FE phase doesn't ship a dashboard screen that looks broken. `требует ручной проверки` on whether to hide `views` until sourced.`
- `[INFO][render][frontend] all contracts → RFC7807 `code` is a stable machine string (§4 enum: VALIDATION_ERROR/UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT/RATE_LIMITED/…) + domain codes (SELF_REVEAL, LISTING_NOT_ACTIVE, STALE_RESOURCE, MARKET_REQUIRED) → the client CAN switch on `code` to render specific toasts/inline errors → **good**; the enumerated-code discipline is exactly what a client needs. Probe FE-P1 asserts every listed code is reachable/renderable.`

## 3. Caching — conditional GET (client-side perf)

- `[MAJOR][caching][frontend] listings-api.yaml:199-210 (GET /listings/{id}) & :131-145 (GET /listings) & geo-search-api.yaml GET /geo-search → responses SEND `ETag` (:203) but the operations declare NO `If-None-Match` request param and NO `304` response → a client cannot implement §13 conditional GET: it receives an ETag it has nowhere to send back, so every catalog scroll / detail re-open re-downloads full bodies → the CDN/perf targets §13 promises are unreachable from the client side. Alpha §1 files the contract gap; I file the **client symptom**: no revalidation, no bandwidth win, no offline-ish snappiness → add `If-None-Match` param + `304` to every §2 public GET so the browser/client cache actually works.`

## 4. FORWARD-COMPAT — can a client built today absorb Part-B offerings without a rewrite?

**Verdict: NO — a client built on today's contract is hard-`Listing`/`animalId`-shaped and will need a rewrite when service/goods cards land.**

- `[MAJOR][forward-compat][frontend] listings-api.yaml:616-660 (Listing, `animalId` REQUIRED :620) + :139-141 (GET /listings returns `items:[Listing]`) → the list/detail/card components a client builds today are typed against a concrete `Listing` with a mandatory `animalId` and species-derived `market` → when ServiceOffering/ProductOffering (species-less) arrive, the client's card renderer, list type, and detail route are all animal-shaped and must be re-typed/re-written — the exact retrofit ADR-0014 calls "irreversible-if-deferred" → introduce a generic `OfferingRef{offeringType,offeringId}` + a polymorphic read-model card envelope (offeringType, marketScope, displayTitle, priceOrTerms, providerRef) so the client builds ONE card component that switches on `offeringType` (ANIMAL_LISTING only in MVP, additive). Alpha §3 owns the schema; I confirm the **client-rewrite cost** is high and the fix is free now (modules unbuilt).`
- `[MAJOR][forward-compat][frontend] geo-search-api.yaml (GeoSearchResult listingId/titleLocalized/lat/lng/distanceM) + favorites-api.yaml (Favorite.listingId) → the near-me results grid and the favorites/shortlist UI a client builds are keyed on `listingId` → a polymorphic discovery ("groomer + корма рядом") forces a second, incompatible client data path later → build the discovery grid + favorites toggle against `OfferingRef` now so one component serves all offering types.`
- `[MAJOR][consistency][frontend] listings-api.yaml:18 (GET /listings, `radius_km` 1–100, returns `Listing`) vs geo-search-api.yaml (GET /geo-search, `radius_m` 1000–100000, returns thin `GeoSearchResult`) → the client faces TWO near-me endpoints with different radius units and response shapes and NO documentation of which to call for the map view → a client integrator must guess, and a guess wrong = wrong data path → collapse to one canonical near-me endpoint (alpha §2) so the FE has a single, typed discovery call.`
- `[MINOR][forward-compat][frontend] listings-api.yaml:211-264 (PATCH, If-Match REQUIRED; ETag on every GET/mutation) → **positive for optimistic-UI**: the ETag/If-Match/412-STALE_RESOURCE loop (§10) gives a client everything it needs for optimistic edits with conflict-rollback, and Idempotency-Key (§11) makes create/reveal double-tap-safe → optimistic-UI IS supportable. **BUT draft-autosave is NOT clean**: PATCH of a **material** field on an ACTIVE listing silently re-enqueues to PENDING_MODERATION (:222-230), removing it from public search → an autosave-on-keystroke client would repeatedly bounce a live listing out of search → the client MUST gate autosave to DRAFT and require an explicit "сохранить" on ACTIVE. Record so the FE phase doesn't ship naive autosave.`

## 5. Client-side drift from the missing `_common.yaml` (build on alpha §1)

- `[MINOR][integrability][frontend] api-contracts/*.yaml (no `_common.yaml`; Problem/PageMeta/LocalizedString inline ×13, favorites drifted) → a client that codegens per-file gets 13 structurally-divergent `Problem`/`PageMeta`/`LocalizedString` TYPES (favorites' Problem lacks `errors` → the client's field-error renderer has nowhere to read validation issues on favorite flows) → the SPA must hand-write a normalization shim or special-case favorites → extract `_common.yaml` (alpha §1) so codegen yields ONE shared `Problem`/`PageMeta`/`LocalizedString` type the whole client reuses.`

---

## Frontend probes
> Client-contract checks Phase-3 (reviewer-qa / backend) can assert against the `backend` build. Complements alpha's
> A/B/C families — these are **client-render** assertions (can the SPA build the screen honestly). Format: id → check → expected.

- **FE-P1 — every documented error code is renderable.** For each op, force each `code` it documents (VALIDATION_ERROR 400, UNAUTHENTICATED 401, FORBIDDEN 403, NOT_FOUND 404, SELF_REVEAL 422, LISTING_NOT_ACTIVE 409, STALE_RESOURCE 412, RATE_LIMITED 429, MARKET_REQUIRED/GEO_PARAMS_INCOMPLETE 422). Assert the live `application/problem+json` body carries a **non-empty stable `code`** a client can switch on. Expected: pass (enum discipline holds). Guards silent/unlabelled errors the SPA can't map to copy.
- **FE-P2 — contact channel is settable end-to-end.** PATCH `/me` with `{contactPhone, showPhone:true}`. Expected TODAY: **400 forbidNonWhitelisted** (field absent) → proves the "мои контакты" screen is unbuildable (blocker #1). After fix: 200, then buyer `POST /contact-reveal` → `channels.phone` present. This is the go-live gate for the conversion UI.
- **FE-P3 — refresh via HttpOnly cookie (not body).** `POST /auth/verify-phone`. Expected (desired §2): `Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Strict` AND **no `refreshToken` in body**; then `POST /auth/refresh` with cookie only rotates the pair. Predicted TODAY: body carries `refreshToken`, no cookie → proves the XSS-liable auth client (blocker #2).
- **FE-P4 — conditional GET works (304).** GET `/listings/{id}`, capture `ETag`, re-GET with `If-None-Match: <etag>`. Expected (desired §13): **304 Not Modified**, empty body. Predicted TODAY: 200 full body (no If-None-Match handling) → proves client caching is impossible.
- **FE-P5 — empty catalog renders honestly.** GET `/listings?species_id=<none-match>`. Expected: `200 {items:[], meta:{total:0,totalPages:0}}` → client renders "ничего не найдено" from `meta.total===0`. Asserts the honest-empty baseline holds (positive).
- **FE-P6 — reveal empty-state is distinguishable.** Buyer reveals a listing whose seller set no channels. Expected TODAY: `channels:{}` with no reason field → client cannot distinguish hidden vs unset (and burned a quota unit). Asserts the need for `hasChannels`/reason before spending quota.
- **FE-P7 — one polymorphic card type.** Static/codegen assert: `GET /listings` items are typed `Listing{animalId required}` (not `OfferingRef`) → **fails the forward-compat gate**; turn into the tracking assertion for the ADR-0014 read-model envelope so the client builds one card, not two.
- **FE-P8 — material edit bounces ACTIVE out of search (autosave guard).** PATCH a material field (title/price) on an ACTIVE listing with valid If-Match. Expected: 200 with `status=PENDING_MODERATION` → proves naive autosave-on-ACTIVE is unsafe; client must gate autosave to DRAFT.
- **FE-P9 — shared error/page types.** Codegen all 13 contracts; assert `Problem`/`PageMeta`/`LocalizedString` resolve to ONE shared type. Predicted TODAY: 13 inline types, favorites' `Problem` missing `errors` → client needs a normalization shim (drives the `_common.yaml` extraction).

---

*Scope note:* No SPA exists; I audited the contract as a future client will consume it — I did **not** scaffold UI, pick a
framework, or edit product code/docs (placeholder-role boundary + Prime-Directive-7). Framework/SSR/design-system decisions
remain `требует ручной проверки` / architect+owner (ADR). This file is my sole output.
