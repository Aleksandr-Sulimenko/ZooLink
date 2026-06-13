---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# Spec: Geo-Search Service

## Outcome
Provide efficient geographic search capabilities for finding animals and listings within a specified radius (1-100 km) from a user's location. Support accurate distance calculations and filtering to enable location-based discovery across all marketplace domains (Pet, Livestock, Matching).

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
- Use PostgreSQL with earthdistance cube extension or PostGIS for geo-indexing (to be decided based on performance testing).
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
