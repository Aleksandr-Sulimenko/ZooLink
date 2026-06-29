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
  - **Scope:** saving/reusing searches and locations is **MVP** (persisted in the `saved_searches` table). Proactive **alerts** on new matching listings are **Phase 2** (see `01-discovery/future-features.md`).

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

## Related Documents

- [Glossary](glossary.md)
- [Geo-Search Eligibility (Gherkin)](business_logic/geo_search_eligibility.feature)
- [Pet Marketplace](03-pet-marketplace-domain.md)
- [Matching Domain](05-matching-domain.md)
- 🌐 RU mirror: [docsRU/specs/07-geo-search-service.md](../../docsRU/specs/07-geo-search-service.md)
