# ZooLink HYPER Audit — Phase 2 · alpha-analyst (API/contract, forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** read every `docs/**/*-api.yaml`
(13 EN + 13 RU mirror) against `API_CONVENTIONS.md`; cross-checked reserved seams vs ADR-0014/0015/0016
+ `future-features.md §145-227`; spot contract↔code drift against `backend/src`; EN↔RU parity spot-check.
Grounded in Phase-1 `AUDIT2/active-user.md`.

Finding format: `[severity][criterion][alpha-analyst] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ conformance · drift · consistency · forward-compat · needs · security.

> **Verified baseline.** 13 contracts, all `version: 1.0.0` except `geo-search-api` `1.1.0` (EN **and** RU — parity holds).
> There is **NO** `_common.yaml` — `Problem`, `PageMeta`, `LocalizedString`, `Actor`, `bearerAuth` are re-defined
> inline in every file. B0 (2026-06-23) brought 12 contracts to canon; the drift that remains is isolated (see §1).
> **Built vs vision:** `listings`/`auth`/`animals`/`moderation`/`admin`/`transfers` back real code; `favorites`,
> `geo-search`, `saved-searches`, `organization`, `branch`, `matching`, `notification`, `payment` are **contract-only
> (no controller)** — which makes their seams *cheap to fix now* and is the crux of the forward-compat verdict.

---

## 🔴 Headline verdict — the reserved anti-rewrite seams are ABSENT from every contract

ADR-0014 (Accepted 2026-07-01) and `future-features.md §F` mandate the polymorphic Offering seam as **form-now**
("дёшево как шов, дорого ретрофитить"). A whole-corpus grep of all 13 EN contracts returns **NONE** of them:

| Reserved seam (ADR-0014/0015 / future-features §F) | Present in any `*-api.yaml`? |
|---|---|
| `offering_type` / `offeringType` / `OfferingRef{type,id}` / `offering_id` | **NONE** |
| `market_scope` (pet\|livestock\|both) | **NONE** (only listing-scoped `market` enum pet\|livestock) |
| `monetization_type` (lead-gen\|subscription\|take-rate\|none) | **NONE** |
| `geo_anchor` (first-class, service-area-ready) | **NONE** (only per-listing `lat`/`lng`) |
| multi-role `roles[]` | **NONE** (single `role` everywhere; acquisition ADMIN-only) |

The cross-cutting capabilities that ADR-0014 says must be "built **once**, polymorphically" — favorites,
saved-search, discovery/geo-search — are each **hard-wired to `listingId`**. Because those modules are still
contract-only, fixing the shape now costs a schema edit; shipping them as-is bakes in the exact retrofit ADR-0014
§Decision-driver-3 calls **"irreversible-if-deferred"**. **This is the central Phase-2 finding.**

---

## 1. Contract conformance & drift

- `[MAJOR][conformance][alpha-analyst] api-contracts/*.yaml (all 13) → no shared _common.yaml; Problem/PageMeta/LocalizedString/Actor re-defined inline per file → structural drift risk (a fix to the canonical shape must be hand-applied 13×; B0 already had to). Proof it bites: favorites-api drifted (next two findings) → extract a _common.yaml (or a single components file) $ref'd by all, OR add a schema-lint gate asserting each inline Problem/PageMeta is byte-equal to the API_CONVENTIONS canon.`
- `[MAJOR][drift][alpha-analyst] favorites-api.yaml:67-75 → Problem schema OMITS `instance` and `errors` fields (present in the other 12 and required by API_CONVENTIONS §4); PageMeta (:60-66) OMITS `nextCursor` (present in the other 12; §5 says it is the additive cursor-ready field) → a favorites client can never do keyset paging without a contract break, and field-level validation errors have nowhere to go → bring favorites Problem+PageMeta to the §4/§5 canon. RU mirror carries the SAME drift (symmetric — verified by diff).`
- `[MAJOR][conformance/security][alpha-analyst] auth-api.yaml:625-672 → refresh token is returned/accepted in the JSON BODY (RefreshTokenRequest.refreshToken, TokenPairResponse.refreshToken, AuthResponse.refreshToken, LogoutRequest.refreshToken) — directly violates API_CONVENTIONS §2 ("refresh token is set/read as an HttpOnly, Secure, SameSite=Strict cookie `refresh_token`; access token in body"). **Contract↔code: code AGREES with the yaml** (auth.service.ts:29,45 return `{accessToken, refreshToken}`; auth.controller.ts:34 reads `dto.refreshToken`) — so contract AND code both diverge from the governing convention; a body-borne refresh token is XSS-exfiltratable → per Prime-Directive-3 fix the contract-of-record first: EITHER move refresh to an HttpOnly cookie in §2+auth-api+code, OR amend §2 if the body form is a deliberate decision. Route to **security** + **architect** (ADR).`
- `[MAJOR][conformance §13][alpha-analyst] listings-api.yaml:192,203,534,546 & geo-search-api.yaml:17-69 → public GETs send `ETag`+`Cache-Control` but the contract documents NO `If-None-Match` request header and NO `304 Not Modified` response (grep: zero "304"/"If-None-Match" in either file) → §13 conditional reads are un-implementable per contract; the CDN/perf targets §13 promises are unreachable → add `If-None-Match` param + `304` response to GET /listings, GET /listings/{id}, GET /geo-search, GET /geo/geocode, reference-data GETs.`
- `[MINOR][conformance][alpha-analyst] favorites-api.yaml:35-49 → POST /listings/{id}/favorite documents no `Idempotency-Key` header (API_CONVENTIONS §11 explicitly lists "favorite" among idempotency-key POSTs) and omits `400`/`403` responses (§4 requires 400/401/403/404/500 on non-public ops) → add Idempotency-Key + the missing error responses.`

## 2. Contract ↔ contract consistency

- `[MAJOR][consistency][alpha-analyst] listings-api.yaml:18-49 (GET /listings) vs geo-search-api.yaml:17-69 (GET /geo-search) → TWO near-me endpoints over ACTIVE listings with INCOMPATIBLE contracts: radius unit `radius_km` (1–100) vs `radius_m` (1000–100000); `market` required-on-geo vs optional; listing_type enum 6 values incl `leasing` vs 5 values (no `leasing`); response `Listing` vs thin `GeoSearchResult{listingId,titleLocalized,lat,lng,distanceM}`. Same job, two shapes, and which is canonical is undocumented → active-user confirms only the listings geo-filter is BUILT; geo-search is vision-only → collapse to one: make GET /geo-search the (future polymorphic) discovery entry and GET /listings the owner/filter list, OR deprecate one. Reconcile units+enums either way.`
- `[MINOR][consistency][alpha-analyst] geo-search-api.yaml:44 (`species` STRING) vs :360 (SavedSearchFilters.species_id INT) → a saved search stored as `species_id:int` cannot re-execute against /geo-search which takes `species:string` (the file itself flags it "Phase-2 mapping concern") → align both on `species_id:int` before saved-search behaviour ships.`
- `[MINOR][consistency][alpha-analyst] geo-search-api.yaml:48,370 → `leasing` listing_type (listings migration 0021, present in listings-api enum) is omitted from both the /geo-search filter and SavedSearchFilters → a leasing listing is invisible to geo-search and un-saveable → add `leasing` to both enums.`
- `[MINOR][consistency][alpha-analyst] favorites-api.yaml:16,37,45 → x-required-roles = [USER, BREEDER, FARMER, MODERATOR, ADMIN] OMITS VETERINARIAN & GROOMER, whereas saved-searches (geo-search-api:102), animals, transfers all include them → a vet/groomer cannot favorite a listing → reconcile with rbac-matrix.md (favoriting is a read-side affordance every authenticated role should have).`

## 3. Forward-compat / anti-rewrite (the reserved seams — judged)

- `[MAJOR][forward-compat][alpha-analyst] favorites-api.yaml:54-59,32 → Favorite.listingId + path /listings/{id}/favorite hard-code a listing-only FK — the EXACT shape ADR-0014 §Decision-driver-3 names "irreversible-if-deferred" ("favorites rows written against a non-polymorphic FK can't be retrofitted truthfully"). When ServiceOffering/ProductOffering land, every favorite row is un-migratable → REWRITE-RISK, and the module is unbuilt so the fix is free now → replace with polymorphic `OfferingRef{offeringType,offeringId}` (offeringType enum `ANIMAL_LISTING` only in MVP, additive per ADR-0014 §3); path `POST /favorites {offeringRef}` or `/offerings/{type}/{id}/favorite`.`
- `[MAJOR][forward-compat][alpha-analyst] geo-search-api.yaml:265-383 (SavedSearchFilters, additionalProperties:false) → the saved-search filter whitelist is animal-listing-shaped (market pet|livestock, species_id, breed_id, listing_type, price) with NO `offering_type` dimension and NO `market_scope` (pet|livestock|both) → a saved search can never span "groomer + food near me" — the apex comfort-BR ADR-0014 exists to carry (future-features.md:150,160). Because additionalProperties:false, adding the dimension later is a breaking widen of a stored shape → reserve `offeringType` + `marketScope` in SavedSearchFilters and the read-model NOW (values constrained to today's set).`
- `[MAJOR][forward-compat][alpha-analyst] geo-search-api.yaml:230-253 (GeoSearchResult) → the discovery/find-nearby result — the natural home of ADR-0014's polymorphic read-model (offering_type, market_scope, geo_anchor, monetization_type, provider_ref) — carries listing-only fields (listingId, titleLocalized, lat, lng, distanceM). Shipping discovery on this shape re-implements find-nearby per-type later (ADR-0014 Option-3, rejected) → introduce the read-model envelope (`offeringType, offeringId, marketScope, geoAnchor, monetizationType, status, providerRef` + display) before any subtype code, per ADR-0014 Implementation Notes.`
- `[MAJOR][forward-compat][alpha-analyst] auth-api.yaml (UserProfile.role :730, UpdateProfileRequest has no role, PATCH /admin/users/{userId}/role :146 "ADMIN-granted, never self-claimed" :152) → single-`role` model everywhere; no `roles[]`; no self-service/progressive claim endpoint → blocks the "прогрессивные just-in-time роли" + multi-role account the vision makes apex (future-features.md:167,210) → reserve a `roles[]` array on the User contract (single-element in MVP, additive) and design a self-service role-claim/request endpoint seam before role-gated offering features multiply.`
- `[INFO][forward-compat][alpha-analyst] api-contracts/*.yaml → `monetization_type` and `geo_anchor` (ADR-0014 §9,§5; future-features.md §F) exist in NO contract → reserve `monetizationType` (lead-gen|subscription|take-rate|none) and a first-class `geoAnchor` on the offering/read-model side when the discovery contract is authored, so the business model can flip without a contract break.`

## 4. Phase-1 needs — coverage in the contract surface

- `[CRITICAL][needs][alpha-analyst] auth-api.yaml:763-792 (UpdateProfileRequest) → the /me PATCH contract exposes ONLY fullName/cityId/avatarUrl/email/preferredLanguage — NO contactPhone/contactTelegram/showPhone/showTelegram/contactPrefs — while listings-api POST /listings/{id}/contact-reveal (:355) reveals exactly those channels from `contact_prefs`/`contact_phone`. The contract itself provides NO path to POPULATE the channels its sole conversion endpoint reveals → this is the CONTRACT twin of active-user BLOCKER #1 (dead buyer↔seller path); a contract that cannot express the one thing the product is for → add contact + per-channel visibility fields to UpdateProfileRequest (and document capture of the verified phone into contact_phone on verify-phone). Route to alpha-analyst SDD + backend.`
- `[INFO][needs][alpha-analyst] listings-api.yaml:400 (POST /listings/{id}/mark-sold, 409 LISTING_NOT_ACTIVE) → mark-sold IS expressed in the contract (Phase-1 need covered). contact-reveal endpoint IS expressed (:355) but un-populatable (finding above). Self-service role-acquisition is NOT expressed (only ADMIN PATCH .../role) → coverage: contact-reveal ✓endpoint/✗population · mark-sold ✓ · roles-acquisition ✗self-service.`

## 5. EN ↔ RU parity

- `[INFO][consistency][alpha-analyst] docsRU/**/favorites-api.yaml → EN↔RU differ only in translated prose (title/summary/description); structure, schemas, versions identical — parity holds, BUT the RU mirror inherits the SAME drifted thin Problem/PageMeta (§1) → fixing the drift must touch both mirrors.`
- `[INFO][consistency][alpha-analyst] all 13 files → versions match EN↔RU (all 1.0.0; geo-search 1.1.0 both). operationIds identical EN/RU for listings (spot-check). Full field-level EN↔RU diff across the other 12 files = требует ручной проверки (line counts differ by 0–3, consistent with translated prose only).`

---

## Contract test probes (for Phase-3 to run)

> Three families: **(A) schema-lint** (static, over the yaml), **(B) contract-vs-code** (live response-shape), **(C) EN↔RU diff**.

### A. Schema-lint assertions (Spectral / custom, static)
1. **A1 — canonical Problem.** For every `*-api.yaml`, assert `components.schemas.Problem.required == [type,title,status,code]` AND properties include `detail,instance,errors`. **Fails on favorites-api** (no instance/errors).
2. **A2 — canonical PageMeta.** Assert every `PageMeta` has properties `{page,limit,total,totalPages,nextCursor}`. **Fails on favorites-api** (no nextCursor).
3. **A3 — camelCase bodies.** Assert every `components.schemas.*.properties` key matches `^[a-z][a-zA-Z0-9]*$` (allow §7 `price_cents`). Query params under `sort`/filter may stay snake_case.
4. **A4 — global security + public opt-out.** Assert top-level `security:[{bearerAuth:[]}]` present; every op that lacks `x-required-roles` has explicit `security:[]`; the public set == the §2 whitelist.
5. **A5 — error-response completeness.** Every non-public op documents 400,401,403,404,500 `$ref` Problem. **Flags favorites** (missing 400/403).
6. **A6 — §13 conditional reads.** Every op in the §2 public-GET whitelist declares an `If-None-Match` param and a `304` response. **Fails today on listings + geo-search.**
7. **A7 — §10/§11 headers.** Every mutating PATCH declares `If-Match` (+412/428); every unsafe POST in §11's list declares `Idempotency-Key`. **Flags favorites POST.**
8. **A8 — refresh-token transport.** Assert NO schema property named `refreshToken` appears in any request/response body (§2 cookie rule). **Fails on auth-api** (4 schemas) — this probe encodes the decision; flip its polarity if §2 is amended.
9. **A9 — reserved-seam presence (forward-compat gate).** On favorites/geo-search/saved-search/discovery contracts, assert presence of `offeringType`(enum incl ANIMAL_LISTING), `marketScope`(pet|livestock|both). **Fails today** — turn this into the tracking gate for the ADR-0014 form-now work.
10. **A10 — role-enum canon.** Every `x-required-roles` / role enum ⊆ {USER,MODERATOR,ADMIN,BREEDER,FARMER,VETERINARIAN,GROOMER} (org roles excluded). Flag favorites' omission of VET/GROOMER as an rbac-matrix cross-check.
11. **A11 — near-me single-source.** Assert only ONE endpoint accepts a `(lat,lng,radius*)` triple over listings, with one radius unit. **Fails today** (radius_km vs radius_m on two endpoints).

### B. Contract-vs-code response-shape tests (live, against `backend`)
12. **B1 — auth body vs cookie.** POST /auth/register/phone→verify; assert the response either (a) sets `Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Strict` and OMITS `refreshToken` from body (§2), or (b) documents the body form. **Predicted: body carries refreshToken, no cookie** (auth.service.ts:29) → proves the §2 divergence.
13. **B2 — contact-reveal populatability.** Register seller; attempt to set contact via PATCH /me with `contactPhone`/`showPhone`. **Predicted: 400 (forbidNonWhitelisted) — fields not in UpdateProfileRequest**; then buyer POST /contact-reveal → `channels:{}`. Proves the contract cannot populate its own reveal (finding §4).
14. **B3 — list envelope shape.** Every list endpoint returns `{items:[…], meta:{page,limit,total,totalPages}}` and (favorites) whether `nextCursor` is emitted. Cross-check code DTO vs the yaml PageMeta.
15. **B4 — Problem body shape.** Force a 400/404/422 on each domain; assert the live `application/problem+json` body matches that file's Problem schema (catches code emitting `instance`/`errors` the favorites yaml omits, or vice-versa).
16. **B5 — listing geo units.** GET /listings?lat&lng&radius_km=1..100 vs GET /geo-search?radius_m=1000..100000; assert the built endpoint's unit matches its yaml and the other endpoint is either implemented consistently or 404 (unbuilt).

### C. EN↔RU diff checks
17. **C1 — structural parity.** For each of the 13 pairs, diff the set of `paths`, `operationId`s, `components.schemas.*` keys and their property keys, and `info.version`; assert byte-equal (only `summary`/`description`/`title` prose may differ). Spot-check confirmed favorites + listings; run across all 13.
18. **C2 — version lockstep.** Assert `info.version` equal EN↔RU per file (today: all 1.0.0, geo-search 1.1.0 both — passes; guards future drift).

---

*Scope note:* I audited the contract surface + targeted contract↔code spot-checks (auth, /me, listings). Full
field-level EN↔RU diff of the 12 non-favorites files and the internal shape of matching/notification/payment/organization
contracts are **требует ручной проверки** (Probe C1 / manual). No product code or docs were modified; this file is my sole output.
