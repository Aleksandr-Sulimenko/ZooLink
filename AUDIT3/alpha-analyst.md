# ZooLink HYPER² Audit — Round 2 · alpha-analyst (contract↔code↔schema integrity, forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed)
**Method:** independent pass FIRST (no peek at round-1) — enumerated every `@Controller`/route in
`backend/src/**/*.controller.ts`, diffed against all 13 `docs/03-architecture/api-contracts/*-api.yaml`
path sets; traced BR→spec→ADR→schema→code→test for the pricing, consent, roles and market seams;
THEN diffed against `AUDIT2/alpha-analyst.md` (round 1). Grounded in charter `.claude/agents/alpha-analyst.md`.

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ conformance · drift · consistency · forward-compat · needs · security.

---

## 0. Independent inventory — routes that EXIST vs contracts that EXIST

**Implemented controllers (routes live in `backend/src`):** auth, identity(register/verify/recover),
me (GET/PATCH/reactivate/erase — **no notification-preferences**), admin-users(role/rebind/erase),
animals(+deactivate/reactivate), transfers(full)+ownership-history, listings(full incl contact-reveal,
mark-sold, analytics, photos GET/POST/DELETE — **no conversations**), **saved-searches (GET/POST/DELETE — BUILT & wired)**,
moderation(full), content-reports(full), admin(reference-data/user-roles/system-settings/audit),
health, metrics.

### Dead contracts (YAML promises a path, NO controller backs it)
| Contract file | Dead path(s) | Note |
|---|---|---|
| `branch-api.yaml` | `/branches`, `/branches/{id}` (all) | fully contract-only |
| `payment-api.yaml` | `/payments*` (all) | contract-only — **acceptable**: behaviour gated behind `feature_toggles.payments` off (form-vs-behaviour, doc-code-protocol) |
| `organization-api.yaml` | `/organizations*`, `/organization-users/*` (all) | fully contract-only |
| `favorites-api.yaml` | `/favorites`, `/listings/{id}/favorite` (all) | contract-only |
| `matching-api.yaml` | `/matching/*` (all) | contract-only |
| `notification-api.yaml` | `/notifications/*`, `/me/notification-preferences`, `/notifications/webhook` (all) | contract-only |
| `geo-search-api.yaml` | `/geo-search`, `/geo/geocode` | `/saved-searches` in the SAME file **IS built** (separate module) |
| `admin-api.yaml` | `/moderation/ban-user`, `/moderation/log/{listing_id}` | dead **and** duplicate — see §2 |
| `listings-api.yaml` | `/listings/{id}/conversations` | **correctly `deprecated:true`** (ADR-0005 no-chat) — not a violation, see §4 |

> **Not dead:** `contact-reveal` and `photos` POST are BOTH implemented — round-1's implicit worry is unfounded for the endpoints
> themselves. The real defects are (a) contact-reveal has no *population* path (round-1 CRITICAL, confirmed §3) and (b) livestock
> pricing terms are unexpressible (§1, NEW).

---

## 1. NEW — the biggest contract↔schema↔BR break round-1 missed: livestock `price_or_terms` (GAP-BA-001)

- `[MAJOR][drift][NEW] docs/02-requirements/business-requirements/livestock-marketplace.md:26-29,178,194 ↔ database_schema.sql:252 (listings.price_cents BIGINT) ↔ listings-api.yaml:664,853,899 (priceCents+currency) → the livestock BR **requires** `price_or_terms VARCHAR(150)` expressing "negotiable", "8000 per straw", "package: 3 straws + synchronization" (data-dictionary row marks it **Required=Yes**). Schema + contract carry ONLY a single scalar `priceCents:int` + `currency`. There is NO field able to hold "negotiable"/per-unit/package terms → a whole half of the platform (livestock, ADR-0002) cannot list on its own required pricing model; the BR is silently dropped (violates truth-hierarchy apex). → Reconcile the contract-of-record FIRST (WHAT/WHY/WHY-BETTER): either (a) add `priceTerms:string(150)` alongside `priceCents` on the listing contract + a `price_terms` column (numeric stays for filterable sale price, terms free-text for the rest), or (b) supersede the BR if the scalar model is deliberate. Route → architect (ADR) + alpha-analyst SDD.`

**Contract probe (B — live):** create a livestock `stud_service` listing with body `{priceTerms:"8000 per straw"}` →
**predicted 400 (forbidNonWhitelisted)** — proves the terms model is unrepresentable today.

## 2. NEW — `admin-api.yaml` is a stale duplicate of `moderation-api.yaml` (contract↔contract canon ambiguity)

- `[MAJOR][consistency][NEW] admin-api.yaml:302,369,392,419,444 vs moderation-api.yaml:/moderation/queue,/moderation/listing/{id},/moderation/action → TWO contracts define the SAME `/moderation/queue`, `/moderation/listing/{id}`, `/moderation/action` paths, plus admin-api ADDS `/moderation/ban-user` and `/moderation/log/{listing_id}` that moderation-api does NOT have and NO controller backs. The live code (`moderation.controller.ts`) implements the **moderation-api** shape (adds `queue/{listingId}/claim`, `decisions`, `decision-templates`) → `admin-api.yaml`'s `/moderation/*` block is superseded/stale; which file is canonical for `/moderation/action` is undocumented → a client generated from admin-api gets the wrong shape and two dead endpoints. → Remove the `/moderation/*` block from admin-api.yaml (delegate moderation wholly to moderation-api.yaml), or mark it `deprecated` with a pointer; decide ban-user's fate (user suspend already lives in identity/user-roles). Route → doc-keeper + architect.`

**Schema-lint probe (A):** assert no `path` string appears in >1 `*-api.yaml`. **Fails today** on the three `/moderation/*` paths.

## 3. Consent / ФЗ-38 — no versioned, provable opt-in log (NEW forward-compat + legal seam)

- `[MAJOR][forward-compat][NEW] database_schema.sql:124 (users.<jsonb> notification prefs) — the ONLY consent surface is a mutable on/off JSONB blob on `users`; there is NO consent table, NO versioned/timestamped marketing opt-in record, NO `policy_version`, NO per-channel (SMS/email/push) grant-with-proof → ФЗ-38 (реклама) requires *provable prior consent* to send marketing; ФЗ-152 requires a demonstrable, time-stamped basis. A boolean toggle cannot prove *when* / *to what version* the user consented, and overwriting it destroys the audit trail → when notifications ship (contract exists, unbuilt) this is a retrofit onto rows written without provenance = the exact "irreversible-if-deferred" class. → Reserve an append-only `user_consents{user_id, consent_type(MARKETING|TX|…), channel, granted_at, revoked_at, policy_version, source, actor_id, principal_type}` seam now (cheap while notifications are unbuilt). Route → legal + architect (ADR).`

## 4. CONFIRMED / SEV-CHG against round 1

- `[—][consistency][REFUTED] AUDIT2/alpha-analyst.md:15,16 (baseline: "saved-searches … contract-only (no controller)") → FALSE. `backend/src/modules/saved-search/saved-search.controller.ts` exists (GET/POST/DELETE, own-scope, 404-no-leak), `SavedSearchModule` is imported+registered in `app.module.ts:19,48`. saved-search CRUD is BUILT. (Round-1's forward-compat point about the *stored SavedSearchFilters shape* still stands — §5 — but the module is not unbuilt.) → correct the baseline: dead-contract set excludes saved-searches.`
- `[INFO][forward-compat][SEV-CHG] AUDIT2 Headline + §3 (market_scope "ABSENT from every contract", implied MAJOR) → downgrade the GENERIC claim: ADR-0015:97,100-101 EXPLICITLY defers `market_scope` ("lives dormant … until a species-less subtype is built — not now") and for `ANIMAL_LISTING` the market is a **derived** value via the built join `listings.animal_id→animals.species_id→species.market` (listings-api.yaml:31-33). So market IS enforced today (ADR-0002 no-leak) and its absence as a stored column is by-design for the animal-only MVP. The residual MAJOR is narrow → keep it ONLY on `SavedSearchFilters` (§5), not "every contract".`
- `[MAJOR][forward-compat][CONFIRMED] geo-search-api.yaml SavedSearchFilters (additionalProperties:false) → reserving `offeringType`+`marketScope` in the STORED filter shape is still correct and cheap NOW; the module is built (§4) so the schema of `saved_searches.filters` JSONB should carry the dimension before real cross-market saved-searches exist. Round-1 finding stands. → additive `offeringType`(enum ANIMAL_LISTING) reservation.`
- `[CRITICAL][needs][CONFIRMED] auth-api.yaml UpdateProfileRequest ↔ listings-api.yaml contact-reveal → confirmed independently: `me.controller.ts` PATCH exposes no contact/visibility fields, yet `listing.controller.ts:137` `contact-reveal` returns `ContactRevealView`. The reveal endpoint IS built but has NO population path → the single conversion path is dead end-to-end. Round-1 CRITICAL holds. → add contact + per-channel visibility to the /me contract+code.`
- `[MINOR][consistency][CONFIRMED] favorites-api.yaml:16,37,45 x-required-roles omits VETERINARIAN/GROOMER vs rbac-matrix.md:78 ("Favorites/saved searches C/R/U/D own" for ALL USER sub-roles) → round-1 finding confirmed against the matrix.`
- `[MAJOR][conformance/security][CONFIRMED] auth-api.yaml refresh-token in body vs §2 cookie — not re-derived here; round-1's code-cross-check (auth.service returns refreshToken in body) is accepted. **требует ручной проверки** re: whether migration 0020 session-form changed transport. Route → security + architect.`

## 5. NEW — notification-preferences role gate mirrors the favorites bug (round-1 caught only favorites)

- `[MINOR][consistency][NEW] notification-api.yaml:69,102,114 (/me/notification-preferences GET/PUT/…) x-required-roles = [USER,BREEDER,FARMER,MODERATOR,ADMIN] OMITS VETERINARIAN & GROOMER, while rbac-matrix.md:74 grants "Notifications (own) … manage prefs" to every USER sub-role → a vet/groomer could not manage their own notification prefs if built from this contract. Same defect class as favorites (round-1 §2) but a DISTINCT file → add VETERINARIAN, GROOMER. (Schema-lint probe A10 should sweep ALL contracts, not just favorites.)`

## 6. NEW — photo endpoint: contract==code, but two latent issues (INFO)

- `[INFO][security][NEW] listings-api.yaml ListingPhotoCreate{listingId,url,orderIndex} ↔ listing.controller.ts:190 (@Post ':id/photos', @Body ListingPhotoCreateDto) → (a) the body carries `listingId` REDUNDANT with path `{id}` → confused-deputy surface if the service trusts the body FK over the path (**требует ручной проверки** — confirm service uses path `id`, ignores/validates body `listingId`); (b) `url` is a client-supplied external URI — there is NO binary-upload / object-storage presign / content-type-validation flow. Contract and code AGREE (both JSON-URL), so NOT a dead contract, but the "upload" is really "register an arbitrary URL" (SSRF/hotlink/abuse surface). → drop `listingId` from the body (path is authoritative); route the upload-pipeline gap → security + architect.`
- `[INFO][conformance][NEW] listings-api.yaml:559 /listings/{id}/conversations is `deprecated:true` and documents Deprecation+Sunset headers (ADR-0005) — correct handling, NOT a dead contract. BUT no route exists, so a call returns 404 rather than the promised 200+Deprecation/Sunset. Acceptable for out-of-MVP; if a client relies on the sunset signal, add a thin deprecated stub. INFO only.`

---

## Contract test probes (round-2 additions for Phase-3)

- **A12 — no duplicate paths across files.** Assert each URL `path` string appears in exactly ONE `*-api.yaml`. **Fails: `/moderation/queue`,`/moderation/listing/{id}`,`/moderation/action` (admin-api ∩ moderation-api).**
- **A13 — role-list sweep (generalise round-1 A10).** For EVERY op whose rbac-matrix row grants all USER sub-roles, assert `x-required-roles ⊇ {USER,BREEDER,FARMER,VETERINARIAN,GROOMER}`. **Fails: favorites (all ops), notification /me/notification-preferences.**
- **A14 — dead-contract gate.** For each documented path, assert a matching `@Controller`+route exists in `backend/src` OR the op is `deprecated:true` OR its domain is toggle-gated-off. **Fails: branch, organization, matching, notification, geo-search(`/geo-search`,`/geo/geocode`), favorites, admin-api `/moderation/ban-user`+`/moderation/log`.**
- **B6 — livestock terms unrepresentable.** POST /listings `{listingType:'stud_service', priceTerms:'8000 per straw'}` → predicted 400 forbidNonWhitelisted (proves GAP-BA-001).
- **B7 — photo body/path FK.** POST /listings/{A}/photos with body `{listingId:B,url}` → assert photo attaches to A (path wins) or 400; NEVER to B. (confused-deputy check)
- **B8 — consent provenance.** After a (future) marketing opt-in, assert a row with `granted_at`+`policy_version` exists and is append-only (revocation adds a row, never overwrites). Encodes the §3 seam.

*Scope note:* independent route-vs-contract inventory + BR/schema traces are complete. Deep field-level EN↔RU diff,
the refresh-token transport re-derivation, and the photo-service body-FK handling are **требует ручной проверки**.
No product code or docs were modified; this file (`AUDIT3/alpha-analyst.md`) is my sole output.
