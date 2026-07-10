---
version: "1.3"
lastUpdated: "2026-06-30"
author: "System Analyst"
status: "Approved"
---

# Spec: Geo-Search Service

## Outcome
Provide efficient geographic search capabilities for finding animals and listings within a specified radius (1-100 km) from a user's location. Support accurate distance calculations and filtering to enable location-based discovery across all marketplace domains (Pet, Livestock, Matching).

> ⚠️ **MVP decision (resolved):** the MVP uses `lat`/`lng` columns + **Haversine formula with a bounding-box prefilter** (no extension), per [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md) and `storage.md`. **PostGIS** (and the `earthdistance`/`ll_to_earth` alternative) is **Фаза 2+**, not a MVP open question. Mentions of PostGIS below are the Target option.

## Scope & Boundaries
**In Scope:**
- Distance calculation using Haversine formula or PostGIS extension
- Radius-based search: find all points within X kilometers of a given latitude/longitude
- Integration with Listing entities (Pet Marketplace, Livestock Marketplace)
- Integration with Animal entities (for Matching domain)
- Support for both exact location matching and radius search
- Ability to combine geo-search with other filters (species, breed, price, etc.)
- Performance optimization for large datasets (100k+ records)
- Configuration of search radius limits (min 1km, max 100km as per requirements)

**Out of Scope:**
- Routing/directions - deferred
- Place autocomplete/geocoding service (handled by external Maps API)
- Complex polygon-based searches (e.g., search within city boundaries) - deferred
- Real-time location tracking - deferred
- Offline maps/caching - deferred

## Constraints
- **Legal:** Must use compliant geocoding service (Yandex.Maps API for MVP as per tech stack decision).
- **Accuracy:** Distance calculations must be accurate enough for user trust (within 100m error acceptable).
- **Performance:** Geo-search queries must complete in <1s for 95% of requests under expected load.
- **Scalability:** Must efficiently handle 100k+ geo-tagged records.
- **Technology:** Leverage PostgreSQL with PostGIS extension or implement efficient Haversine formula in SQL.
- **Usability:** Search radius adjustable via UI (slider/input) with clear distance units (km).
- **Data:** Location data must be stored as latitude/longitude coordinates (WGS84).

## Prior Decisions
- Store location as separate latitude and longitude floating-point columns in Listing and optionally Animal tables.
- **MVP (resolved):** PostgreSQL `lat`/`lng` + Haversine + bounding-box prefilter, B-tree indexes on lat/lng. PostGIS/earthdistance is Фаза 2+ (ADR-0009).
- For MVP, implement geo-search using Haversine formula optimized with bounding box pre-filter to reduce computational load.
- External geocoding (address to coordinates) will be handled by Yandex.Maps API via frontend/backend abstraction.
- Maximum search radius enforced at 100km to prevent abusive queries.
- Minimum search radius of 1km to ensure meaningful results.
- Location data is required for all listings; users must provide location via map interaction or address input.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Geo-search queries must complete in <1s for 95% of requests under expected load (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Uses Yandex.Maps API for geocoding as specified in tech stack (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Search radius adjustable via UI with clear distance units (km) (see docs/02-requirements/nfr/accessibility.md)

## User Stories

### Geo-Search Functionality
**UC-GS-01:** As a user looking for animals or listings near me, I want to search within a specific radius so that I can find local opportunities efficiently.
- Acceptance Criteria:
  - Search radius adjustable from 1km to 100km via slider or input
  - Current location detection with user permission
  - Manual location entry via address or map interaction
  - Search results show distance from user location
  - Geo-search completes in <1s for 95% of requests
  - Ability to combine geo-search with other filters (species, breed, price, etc.)
  - Clear indication when no results found within radius

**UC-GS-02:** As a user concerned about privacy, I want to control my location sharing so that I can use the platform comfortably while protecting my personal information.
- Acceptance Criteria:
  - Explicit permission request for location access
  - Ability to disable location services and use manual entry only
  - Location data stored minimally (only latitude/longitude needed for search)
  - No sharing of exact address with other users
  - Option to use approximate location (city/region level) for browsing
  - Clear explanation of how location data is used and stored

**UC-GS-03:** As a power user, I want to save and reuse my favorite locations and search settings so that I can quickly access frequently searched areas.
- Acceptance Criteria:
  - Save current location as a favorite with custom name
  - Quick access to saved locations from search interface
  - Save search filters combined with location for one-click search
  - Synchronize saved locations across devices (future enhancement)
  - Import/export saved locations (future enhancement)
  - **Scope:** saving/reusing searches and locations is **MVP** (persisted in the `saved_searches` table). Proactive **alerts** on new matching listings are **LIVE** (Slice H4, SS-M1..SS-M7 below); on-demand **re-execution** of a saved search is **Phase 2** (see `01-discovery/future-features.md`).

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `geo-search` shared service (could be in `src/lib/` or as a utility)
   - [ ] Implement Haversine distance calculation function (TypeScript)
   - [ ] Create database query builder that adds geo-filter with bounding box optimization
   - [ ] Integrate geo-search into Listing search methods in PetMarketplaceService and LivestockMarketplaceService
   - [ ] Integrate geo-search into Animal search methods in MatchingService/Any other service needing location search
   - [ ] Add validation for latitude/longitude ranges (-90 to 90, -180 to 180)
   - [ ] Add validation for search radius (1-100 km)
   - [ ] Create database indexes on latitude/longitude columns (consider composite index)
   - [ ] Write unit tests for distance calculation and query building
   - [ ] Write integration tests for geo-search with sample data
   - [ ] Create OpenAPI documentation showing geo-search parameters in listing/animal endpoints

2. **Database**
   - [ ] Add `latitude` and `longitude` columns to Listing table (already in schema)
   - [ ] Consider adding `latitude` and `longitude` to Animal table if needed for matching (optional)
   - [ ] Create indexes: CREATE INDEX ON listings USING GIST (ll_to_earth(latitude, longitude)); if using PostGIS
   - [ ] Or create btree indexes on latitude, longitude for bounding box pre-filter
   - [ ] Seed some test data with known distances for validation

3. **Frontend (React)**
   - [ ] Create reusable geo-search component (map picker + radius selector)
   - [ ] Integrate with Yandex.Maps API for address search and reverse geocoding
   - [ ] Create radius input (slider or numeric input) with km units
   - [ ] Ensure geo-search parameters are passed to API calls for listing/animal searches
   - [ ] Display distance from user in search results (optional)
   - [ ] Write unit and e2e tests for geo-search component

4. **Infrastructure**
   - [ ] Decide on PostGIS vs earthdistance vs custom Haversine based on performance testing
   - [ ] If using PostGIS: enable extension in PostgreSQL and adjust schema
   - [ ] Configure connection pooling and query timeouts for geo-search heavy operations
   - [ ] Consider caching frequent geo-search results (e.g., popular locations) in Redis

## Verification Criteria
- [ ] Unit tests >90% coverage for geo-search service (backend)
- [ ] Integration tests verify: distance calculation accuracy, bounding box optimization, radius search correctness
- [ ] E2E tests cover: user searches for listings within 5km, sees correct results, radius adjustment works
- [ ] Manual testing: verify accuracy against known distances (e.g., using Google Maps distance tool)
- [ ] Performance: geo-search with 100k listings returns in <1s for 95% of requests at 50 RPS
- [ ] Compliance: uses Yandex.Maps API for geocoding as specified in tech stack
- [ ] Documentation: API specs show lat/long/radius parameters clearly
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented

---

## Algorithm, result contract & edge cases (round-4, normative)

**Haversine + bounding-box (MVP):** Earth radius `R = 6_371_000 m`.
- **Bbox prefilter** (uses the B-tree on lat/lng): `Δlat = radius_m / 111_320`;
  `Δlng = radius_m / (111_320 * cos(radians(lat)))`; filter `lat BETWEEN lat0-Δlat AND lat0+Δlat` and same for lng.
- **Exact distance:** `d = 2*R*asin(sqrt( sin²((lat-lat0)/2) + cos(lat0)cos(lat) sin²((lng-lng0)/2) ))`, keep `d ≤ radius_m`.
- **Boundary:** comparison is `≤` with a `±100 m` tolerance (NFR), so "exactly at radius" is INCLUDED despite float error.

**Result contract:** `ORDER BY distance_m ASC, created_at DESC, id ASC`; `distance_m` is returned (rounded); pagination
`page`/`limit` (default 20, max 100); `total` = COUNT within radius. Always combined with `status='ACTIVE'` and the
animal's `market` filter.

**Edge cases (normative):**
- **Antimeridian (±180° lng):** when the bbox crosses ±180 (relevant for RF: Chukotka/Kamchatka), split into two lng
  ranges (`lng ≥ min` OR `lng ≤ max`).
- **Near-pole:** clamp `Δlng` (cos→0) to 180° to avoid blow-up.
- **Missing coordinates:** listings without `lat/lng` are excluded from geo results (no city-centroid fallback in MVP).
- **Radius:** must be `1_000 ≤ radius_m ≤ 100_000`; values outside are rejected (validation).
- `listings.search_radius_m` is **not** a geo-search filter — it is reserved for "looking within X" matching use; the
  query radius is the authoritative one for geo-search.

**Combined search & saved searches:** geo + Russian FTS (`to_tsvector('russian', …)`) + trigram fuzzy + attribute
filters (species/breed/price/type) compose into one query (bbox + bitmap-AND of GIN indexes). `saved_searches.filters`
JSONB schema = the geo-search query params: `{ q?: str, species_id?: int, breed_id?: int, listing_type?: str,
price_min?: int, price_max?: int }` plus stored `lat/lng/radius_m`; re-execution maps these to `/geo-search` params.

## Saved searches — save / list / delete (round-5, normative) — Listings Slice 3

> **WHAT:** Pin the `/saved-searches` contract (GET list, POST create, DELETE) to validated invariants
> SS-1..SS-6: own-scope reads, 404-no-leak delete, a bounded `filters` whitelist (incl. `market`),
> `radius_m` bounds + lat/lng coherence, the `{items, meta: PageMeta}` list envelope, and
> Idempotency-Key as the only dedup. No schema change (the `saved_searches` table already exists;
> `radius_m` has no DB CHECK, so its bounds are app-level).
> **WHY:** the reviewer-qa Slice-3 preflight returned GO-no-migration with a gap list (G1..G6); the
> contract was ambiguous (`filters: type:object`, raw-array list, no stated owner-scope/no-leak rule),
> which would force the backend to guess on the project's #1 historical risk class (IDOR) and on
> ADR-0002 market separation.
> **WHY-BETTER-for-the-whole-project:** the build becomes mechanical and 100% test-coverable; IDOR is
> closed at the contract (own-scope + 404-no-leak); ADR-0002 is preserved into Phase-2 alerts (a saved
> search is market-pinned); the list shape now matches API_CONVENTIONS §5 (the file header's §5 claim
> becomes true); arbitrary client JSON can never be persisted.

These invariants are **testable** and own the saved-search lifecycle. Error `code`s are RFC7807
(`API_CONVENTIONS §4`); reused codes are noted, new ones are introduced here.

| ID | Invariant (MUST) | Enforcement | On violation |
|----|------------------|-------------|--------------|
| **SS-1** | `GET /saved-searches` returns **only the caller's own** rows (`user_id = actor`). No query param widens it; **MODERATOR/ADMIN do NOT see other users' saved searches** (rbac-matrix.md:78 = own/own/own — the operator role is a call-gate, never a scope-widener). | Service: `WHERE user_id = :actorId`. | n/a (scope is structural) |
| **SS-2** | `DELETE /saved-searches/{id}` of an id that is non-existent, **owned by another user**, or the caller's **own but already-deleted** row returns **404**, byte-for-byte identical in all three cases. It MUST NEVER return **403** for a non-owned id (403 vs 404 leaks existence → IDOR/enumeration). Delete is a **hard delete, no tombstone** → NOT idempotent-204; only the first successful delete returns 204, a repeat returns 404 (the row is gone, so the cases are indistinguishable without leaking existence). | Service: `DELETE … WHERE id=:id AND user_id=:actorId`; 0 rows → 404. | `404` `SAVED_SEARCH_NOT_FOUND` (new) |
| **SS-3** | `filters` MUST conform to the bounded whitelist `{ q?:string(≤200), market?:'pet'\|'livestock', species_id?:int, breed_id?:int, listing_type?:enum, price_min?:int(minor units,≥0), price_max?:int(minor units,≥0) }`. **Unknown keys rejected** (`additionalProperties:false`); serialized JSON **≤ 2048 bytes**; `price_max ≥ price_min` when both set. Arbitrary client JSON is **never stored**. `market` is included (ADR-0002, G3): a saved search is market-pinned so Phase-2 re-execution/alerts can never blur pet vs livestock. | DTO + class-validator; size cap checked before persist. | `422` `INVALID_FILTERS` (new) |
| **SS-4** | Location coherence: `lat` & `lng` are **both-present-or-both-absent** (matches `chk_saved_searches_latlng`). `radius_m` is **REQUIRED (non-null) when a point is present** and **MUST be null/absent when no point** (a point without a radius — or a radius without a point — is meaningless). When present, `1000 ≤ radius_m ≤ 100000` (mirrors `/geo-search`). **App-level** validation — `radius_m` has no DB CHECK. | DTO + service guard. | `422` `RADIUS_OUT_OF_RANGE` (reused, Slice-2 listings) for the bound; `422` `GEO_PARAMS_INCOMPLETE` (reused, Slice-2 listings) for coherence (one of lat/lng missing, or radius/point mismatch) |
| **SS-5** | `GET /saved-searches` returns the standard **`{items: [SavedSearch], meta: PageMeta}`** envelope with `page`/`limit` query params (mirrors `/geo-search`), default sort `created_at:desc`. **Not** a raw array. | Pagination lib (`backend/src/lib`). | `400` `INVALID_SORT` for a non-whitelisted `sort` |
| **SS-6** | Dedup is by **Idempotency-Key (24h replay) ONLY** (§11): there is **no** DB unique on `(user_id, filters)` and **no** `name` uniqueness per user. Two saves with **different** keys (or no key) are **allowed by design**; same key + same body → stored 201 replayed; same key + different body → 422 (§11 platform behavior). | Platform idempotency middleware. | `422` (§11 key reuse with different body) |

**Error code summary (saved searches):**

| code | HTTP | When | Reuse / new |
|------|------|------|-------------|
| `SAVED_SEARCH_NOT_FOUND` | 404 | DELETE of a non-existent **or non-owned** id (SS-2 no-leak) | new |
| `INVALID_FILTERS` | 422 | `filters` has an unknown key, a type mismatch, exceeds the 2 KB size cap, or `price_max < price_min` (SS-3) | new |
| `RADIUS_OUT_OF_RANGE` | 422 | `radius_m` present but outside `[1000,100000]` (SS-4) | reused (Slice-2 listings) |
| `GEO_PARAMS_INCOMPLETE` | 422 | lat/lng not both-present-or-both-absent, or radius/point coherence broken (SS-4) | reused (Slice-2 listings) |
| `INVALID_SORT` | 400 | `sort` not in the whitelist (SS-5) | reused (Slice-2 listings) |
| (§11 reuse) | 422 | Idempotency-Key replayed with a different body (SS-6) | platform §11 |

**Re-execution drift (documented, not resolved — Phase 2):** saved `filters` use `species_id:int`
while `/geo-search` exposes `species:string`. When Phase-2 alerts/re-execution map a saved search to
`/geo-search` query params, this int↔string mapping (and the `listing_type=leasing` gap — listings
migration 0021 added `leasing`, not yet a `/geo-search` value) must be handled by the mapping layer.
This is recorded here per the truth-hierarchy "no requirement dropped silently" rule.

## Proactive saved-search alerts — match & notify (round-N, normative) — Slice H4 (AUDIT4)

> **WHAT:** Pull the "proactive alerts on saved searches" (previously scoped to Phase 2) forward and
> pin it as SS-M1..SS-M7. When a listing goes **ACTIVE** (moderation APPROVE → the `Listing.Activated`
> outbox event, already emitted in-tx), a worker-side consumer (`SavedSearchMatchConsumer`, the second
> entry in `OUTBOX_CONSUMERS`, distinct from the registry `NotificationConsumer`) matches it against
> users' `saved_searches` (`offering_type='ANIMAL_LISTING'`) and materialises **one IN_APP
> `saved_search_matched` notification per matching (saved_search, listing) pair** (read via
> `GET /v1/me/notifications`). Template seeded EMAIL ×(ru,en) in migration 0037 (*channel ≠ source*).
> No new endpoint, no new schema column.
> **WHY:** AUDIT4 flagged the platform had **no demand-side return loop** — a user saves a search and is
> never told when a matching listing appears (the highest-leverage retention signal for a two-sided
> marketplace). The event, the `saved_searches` table, the OfferingRef seam (0032), and the notification
> consumer infra (0030, ADR-0021) already existed; only the template row + the matcher were missing, so
> this is a small, additive slice — the textbook phase-by-cost-of-change case.
> **WHY-BETTER-for-the-whole-project:** consuming the already-emitted `Listing.Activated` (rather than
> matching inside the moderation transaction) keeps moderation ignorant of saved-search — a match failure
> only retries this consumer's delivery, it can **never** roll back a valid approval; a deterministic
> per-pair notification `idempotency_key` gives exactly-once with **zero** new schema (no marker column,
> no poll loop); and the ADR-0002 market split is enforced structurally in the match predicate (below).

| ID | Invariant (MUST) | Enforcement | Note |
|----|------------------|-------------|------|
| **SS-M1** | On `Listing.Activated`, a saved search is matched iff **all** of its present filters are satisfied by the listing. Evaluated subset: `market`, `species_id`, `breed_id`, `listing_type` (equality); `price_min`/`price_max` (bounds — a **priceless** listing never satisfies a price-bounded search); geo `radius_m`+`lat`/`lng` (exact Haversine — a **coordless** listing never satisfies a geo search). | `SavedSearchMatchConsumer.matchSql` (parameterized `$queryRaw` over `saved_searches` only). | reverse-query |
| **SS-M2** | **`q` free-text IS evaluated** server-side as a **case-insensitive substring** match (not stemmed/lexeme) over the activated listing's concatenated localized title + description of **both** locales (`title_localized`+`description_localized` → `ru`+`en`, **newline-joined** — a `q` never substring-matches across two different fields), computed on the already-loaded listing row (`strpos(lower(text), lower(q)) > 0`; bound param, no DDL, no index dependency). A **blank/whitespace-only `q`** is treated as **no constraint** (the search still matches on its other filters); a non-blank `q` MUST substring-hit the listing text AND all other filters must hold. **Limit:** substring only — no stemming/morphology (`собака` ≠ `собаки`), no ranking, no typo tolerance; a stemmed/ranked FTS (the `to_tsvector` GIN indexes power the *forward* `/listings` search — a reverse-direction tsvector match would need an ADR) is the Phase-2 upgrade behind this seam. | `matchSql` substring clause over both-locale text (bound param). | subset (substring FTS) |
| **SS-M3** | **ADR-0002 cross-market safety:** a search matches only when it is **market-anchored** to the listing's market — it pins `market` (== the listing's) **OR** pins `species_id`/`breed_id` (each lives in exactly one market and must equal the listing's). A **market-agnostic** search (no market/species/breed anchor) is **NOT** matched. An alert can never cross pet↔livestock. | `matchSql` anchor clause + equality clauses. | `422` n/a (read-side) |
| **SS-M4** | **Exactly-once per pair:** at most one `saved_search_matched` notification per `(saved_search, listing)` pair, ever — regardless of `Listing.Activated` at-least-once redelivery. | `notification_logs.idempotency_key = 'saved_search_matched:<savedSearchId>:<listingId>'` + `ON CONFLICT DO NOTHING`. | dedup |
| **SS-M5** | The **seller is never** alerted about their own listing. | `matchSql`: `s.user_id <> seller_id`. | self-exclusion |
| **SS-M6** | A saved-search alert is a **user-requested service** notification (opt-in by the act of saving) delivered over **IN_APP** → **transactional-always, NOT gated by `notification_prefs.promo`** (which governs future EMAIL/SMS *marketing* pushes). The opt-out is **deleting the saved search** (SS-2). | consumer writes IN_APP unconditionally, mirroring the ADR-0021 transactional-always discipline. | prefs decision |
| **SS-M7** | A listing that is **no longer ACTIVE** at relay time (e.g. sold/reversed before the near-real-time relay processed the event) is **not** alerted on; a deleted listing is skipped. | consumer re-loads the listing and gates on `status='ACTIVE'`. | staleness guard |

> **(round-N, normative — Slice H4 follow-ups resolved: `q` substring match · `SavedSearch.Matched` analytics event · per-recipient title localization; per-user daily-cap deliberately deferred) WHAT:** the four H4 follow-ups previously listed as "documented, not built" are resolved as follows. **(1) `q` free-text** is now evaluated server-side — see **SS-M2** (updated in place above): a case-insensitive **substring** match over the activated listing's concatenated localized title+description (both `ru`+`en`), computed on the already-loaded listing row (`strpos(lower(text), lower(q)) > 0`) — **no schema change, no index dependency**; a blank/whitespace `q` is a no-op filter. **(2) `SavedSearch.Matched`** is now emitted as an **analytics** outbox event (`aggregate_type='SavedSearch'`, `schemaVersion=1`, payload `{ savedSearchId, listingId, subjectUserId, market, matchedAt }`) in the **same DB transaction as — and only when — the per-pair notification row is newly inserted** (the `ON CONFLICT DO NOTHING` insert-won branch). So at-least-once `Listing.Activated` redelivery emits the event **exactly once per pair** (SS-M4-consistent: a redelivery re-runs the idempotent INSERT which affects 0 rows → no event). **No consumer is built** — the event feeds the future match→view→contact funnel a data-analyst will spec (see `event-catalog.md`). **(3) per-recipient title localization** — the alert body now interpolates `{{listing_title}}` in **the recipient's own language** (`users.preferred_language`) with **ru fallback**, resolved inside the shared `NotificationWriter` (which already selects the template language) via a reusable localized-context map; the prior ru-first behaviour is retained as the fallback. **(4) per-user daily cap is deliberately NOT built (deferred)** — the reason is in WHY-BETTER.
> **WHY:** the follow-ups were the honest tail of the H4 slice. A text search that silently ignored its own text term (`q`) was the most surprising gap for a user; the analytics event is the seam the demand-side funnel (match→view→contact) hangs off; and an en-preferred user seeing a ru-only alert body was a small but real localization defect. All three are additive, zero-new-schema refinements — the phase-by-cost-of-change case.
> **WHY-BETTER-for-the-whole-project:** (a) building `q` as an in-memory **substring** predicate (not a new `tsvector` column + GIN index) keeps this slice **zero-DDL** while remaining honest about its limits (no stemming/ranking) and leaving the stemmed-FTS upgrade behind an ADR seam; (b) emitting `SavedSearch.Matched` **inside the insert-won transaction** reuses the outbox pattern's atomic-with-the-DB-change guarantee, so exactly-once needs **no new dedup store**; (c) the localized-context map lives in `NotificationWriter`, so **every** future consumer localizes bodies the same way. **On the daily cap (why deferred, not skipped-forever):** the follow-up was gated on "only if trivially reusable from the quota lib" — and it is **not** trivial. The platform has **no shared quota service** (only the HTTP `@nestjs/throttler` guard and a hand-rolled per-market Redis `INCR` inside `listing.service` for contact-reveal); a correct saved-search daily cap must additionally (i) couple to the **insert-won** branch to stay idempotent under `Listing.Activated` redelivery (a naive per-materialize `INCR` would double-count on redelivery and exhaust the cap early), (ii) fix a **product cap number**, (iii) choose an **over-cap policy** (silently dropping matches harms the very retention loop this slice exists to build; a coalesced daily digest is the likely-correct alternative), and (iv) decide **durability** (a Redis counter resets on flush — weak for a spam guarantee). (i)–(iv) are product/architect/data-analyst decisions, so the cap is deferred to a future digest / notification-preferences slice. In the interim the anti-spam guarantee is **structural**: per-pair dedup (**SS-M4** — a given listing alerts a given user at most once, ever) + market anchoring (**SS-M3**). Escalation owner: **architect** + **data-analyst** (cap number, over-cap digest policy, durable-counter vs Redis).

## Near-me canon reconciliation + `geo_anchor` reservation (round-6, normative) — Wave D / D7

> **WHAT:** (1) Declare **`GET /v1/listings`** (the Slice-2 discovery path — `market` + `lat`/`lng`/`radius_km` +
> `sort=distance`, returning `distanceM`) the **single canonical near-me contract**. (2) Mark the **`/geo-search`**
> endpoint (`geo-search-api.yaml`) **deprecated — superseded, planned-removal**: it duplicates the same radius search,
> has **no controller** (`backend/src/modules/` has no geo module — grep-confirmed), and is retained only so the
> requirement is not silently dropped. (3) Mark **`/geo/geocode`** **planned (not implemented)** — address→coordinate
> geocoding is a future capability (spec §"Out of Scope": geocoding via external Maps API), distinct from radius search;
> it is neither a duplicate nor live. (4) Point Phase-2 saved-search re-execution at the **canonical `/listings`** path,
> not `/geo-search`. (5) Reserve **`geo_anchor`** as the offering-agnostic form of the search origin (see below). No
> schema change, no code change to the live `/listings` path, no touch to the live `/saved-searches` contract.
>
> **WHY:** the corpus carried **two conflicting near-me contracts** — `/geo-search` (`radius_m`, 1000–100000 m,
> `species:string`, dead yaml) and `/listings` discovery (`radius_km`, 1–100, `species_id:int`, LIVE in code). A
> developer or a Phase-2 mapping layer could not tell which one is authoritative, and the saved-search spec (§159, §201)
> still routes re-execution to the dead endpoint. Left unreconciled this forces a guess on the project's near-me surface.
>
> **WHY-BETTER-for-the-whole-project:** one authoritative discovery contract (no divergent radius unit / species type /
> `listing_type=leasing` gap to keep in sync); the dead `/geo-search` is flagged, not deleted, so the business
> requirement survives to a future dedicated geo domain if one is ever built; **reserving `geo_anchor` now** means the
> future *find-nearby-for-services/goods* (ecosystem vision) extends the same discovery key across offering subtypes
> **without an API rewrite** — the anti-rewrite phase rule applied to geo, mirroring the OfferingRef seam (ADR-0014).

**Canon (normative):**

| Concern | Canonical (LIVE) | Deprecated / Planned |
|---|---|---|
| Radius near-me search over listings | **`GET /v1/listings`** with `lat`,`lng`,`radius_km` (1–100), `market`, `sort=distance`, response `distanceM` | `GET /geo-search` (`radius_m`) — **deprecated, superseded, planned-removal; no controller (dead)** |
| Address → coordinates | — (none in MVP) | `GET /geo/geocode` — **planned (not implemented)**; future external-Maps proxy |
| Save/list/delete a search | **`/saved-searches`** (LIVE, SS-1..SS-6) — unchanged | — |

**Unit reconciliation (Phase-2 mapping, documented — supersedes §159/§201 routing):** a saved search stores `radius_m`
(meters); the canonical `/listings` path takes `radius_km`. Phase-2 re-execution/alerts MUST map the stored search to
**`/listings`** params: `radius_km = round(radius_m / 1000)`, `species → species_id` (int lookup), and handle the
`listing_type=leasing` value (present on `/listings`). The prior text that maps to `/geo-search` is retained above as the
historical record but is **no longer the target** — the target is the canonical `/listings` path.

### `geo_anchor` — offering-agnostic discovery-origin reservation (form-only; no implementation)

`geo_anchor` is the **reserved abstraction for "where the searcher is looking"**, kept offering-agnostic so future
find-nearby over **services / goods / expertise** (ecosystem vision) reuses one discovery key instead of re-deriving a
per-offering geo API.

- **Today's concrete form (the only implemented case):** a `geo_anchor` is a **point + radius** — the `lat`/`lng`/`radius_km`
  triple already on `GET /v1/listings`. Nothing changes in the live contract; the current params ARE the point-form of
  `geo_anchor`.
- **Reserved future forms (deferred, gated — NOT built here):** a **named place / city-or-region polygon**, a provider
  **service-area** (a seller/vet/groomer coverage zone), and a **PostGIS `geography`** backing store. These are Фаза 2+
  per ADR-0009 (PostGIS is explicitly Target, not MVP) and remain deferred/gated — this section reserves only the
  **shape and the name**, no column, no endpoint, no behaviour.
- **Invariants that MUST hold when any richer form ships:**
  - **G7-1 (market stays separated):** `geo_anchor` is offering-and-market-agnostic as a *location*, but discovery over
    it MUST still AND-intersect the `market` filter (ADR-0002) — a geo anchor never widens or crosses markets.
  - **G7-2 (one contract):** find-nearby for a new offering subtype extends the **canonical `/listings`-style**
    discovery contract (or its offering-generalised successor) — it MUST NOT resurrect a parallel `/geo-search`-style
    endpoint.
  - **G7-3 (OfferingRef pairing):** when discovery spans offerings, the `geo_anchor` result carries the polymorphic
    `offeringType`/`offeringId` (ADR-0014 OfferingRef, migration 0032) so one nearby-list can mix subtypes coherently.
  - **G7-4 (form-now, behaviour-deferred):** reserving `geo_anchor` grants **nothing** at runtime today — the only live
    behaviour is the existing point+radius on `/listings`. Richer anchors are behind future gates.

> Cross-refs: seam table in `docs/04-decisions/ECOSYSTEM_ADR_PLAN.md` (Wave D / **D7**, migration = none);
> `AUDIT3/architect.md` (geo_anchor RESERVE-NOW); OfferingRef `ADR-0014 §Amendment 2026-07-04`. A dedicated numbered
> ADR for `geo_anchor` is **not** minted here (D7 is contract/code-only, no schema); if a future richer form proves
> structural, escalate to **architect** for an ADR at that time.

## Related Documents

- [Glossary](glossary.md)
- [Geo-Search Eligibility (Gherkin)](business_logic/geo_search_eligibility.feature)
- [Pet Marketplace](03-pet-marketplace-domain.md)
- [Matching Domain](05-matching-domain.md)
- 🌐 RU mirror: [docsRU/specs/07-geo-search-service.md](../../docsRU/specs/07-geo-search-service.md)
