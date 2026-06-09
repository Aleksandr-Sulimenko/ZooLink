---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# Spec: Livestock Marketplace Domain

## Outcome
Enable listing, searching, and managing advertisements for agricultural livestock (cattle, horses, sheep, goats, pigs, poultry, etc.). Support operations like sale, breeding, leasing, and exhibition. Ensure compliance with Russian livestock trading regulations and animal identification requirements.

## Scope & Boundaries
**In Scope:**
- Livestock listings with species-specific attributes (ear tag, passport, birth certificate, health test results, productivity metrics)
- Geo-search: radius-based search (1-100 km) from user location
- Filtering: by species, breed, age, sex, price, location, listing type (sale, breeding, show, adoption, stud_service)
- Moderation workflow: pre-moderation (listing appears only after moderator approval)
- User actions: create, edit, delete own listings, favorites, share
- Integration with Animal Domain (link listing to animal entity)
- Integration with Identity Domain (seller/owner info)
- Compliance with Russian livestock trading laws, veterinary regulations, and 152-ФЗ for personal data

**Out of Scope:**
- Auction/bidding systems - deferred
- Payment processing (in-app transactions) - deferred to phase 2
- Delivery/shipping logistics for livestock - deferred (specialized transport)
- User ratings/reviews for sellers - deferred
- Livestock movement tracking/transport logs - deferred to phase 2
- Integration with state systems like "Merкурий" - deferred

## Constraints
- **Legal:** Must comply with Russian Federal Law "On Veterinary Medicine", livestock identification regulations, and 152-ФЗ for processing personal data.
- **Data Integrity:** Prevent duplicate livestock records (ear tag/passport uniqueness).
- **Extensibility:** Support species-specific attributes via JSONB or extension entities.
- **Performance:** Livestock search by ear tag/passport < 500ms; geo-search < 2s.
- **Scalability:** Support 50k+ active livestock listings (lower volume than pets but higher value).
- **Technology:** Align with NestJS, TypeScript, PostgreSQL.
- **Usability:** UI must accommodate complex livestock attributes (ear tags, health certificates).

## Prior Decisions
- Livestock is treated similarly to pets in the Animal Domain but with different attribute requirements.
- Species and breed reference data shared between Pet and Livestock Marketplaces (managed via Admin Domain).
- Livestock attributes vary significantly by species (e.g., cattle need ear tags and poultry need different tracking).
- Russian regulations require ear tagging/passporting for most livestock species.
- We store minimal owner personal data in listings (just userId reference) to comply with 152-ФЗ; full owner details are in Identity Domain.
- Listing entity structure is shared between Pet and Livestock Marketplaces but with different validation rules and attribute sets.

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `livestock-marketplace` module
   - [ ] Define Listing entity (shared structure with pet-marketplace but different validation)
   - [ ] Implement species-specific validation rules (e.g., if species=cattle, earTagId required; if species=poultry, different rules)
   - [ ] Create ListingController (CRUD, search, moderation actions)
   - [ ] Create ListingService (business logic: validation, geo-search, moderation workflow)
   - [ ] Set up database indexes: location (geo), status, listingType, speciesId (via animal), sellerId
   - [ ] Implement moderation endpoints (for moderator role)
   - [ ] Write unit and integration tests for listing lifecycle and search
   - [ ] Create OpenAPI docs for listing endpoints

2. **Frontend (React)**
   - [ ] Create listing pages: Create Listing, Edit Listing, Listing List (search/browse), Listing Detail
   - [ ] Implement dynamic form that adjusts fields based on selected species/breed (livestock-specific)
   - [ ] Implement map-based location selection (using Yandex Maps API)
   - [ ] Create listing card component for grid/list views
   - [ ] Implement search filters and radius selector
   - [ ] Implement favorites and sharing functionality
   - [ ] Integrate with Identity Domain to show seller info (limited to what's allowed post-moderation)
   - [ ] Write unit and e2e tests for listing flows

3. **Infrastructure**
   - [ ] Enable PostGIS extension in PostgreSQL (or use alternative geo-indexing)
   - [ ] Configure Prisma schema for Listing and related entities (shared with pet-marketplace)
   - [ ] Set up object storage bucket for listing media
   - [ ] Implement image upload via pre-signed URLs (frontend to storage)
   - [ ] Add caching layer for frequent search queries (Redis)
   - [ ] Implement rate limiting for listing creation endpoints

## Verification Criteria
- [ ] Unit tests >90% coverage for livestock-marketplace module (backend)
- [ ] Integration tests cover: listing creation (valid/invalid per species), search by geo-radius, filtering, moderation workflow, status transitions
- [ ] E2E tests cover: user creates listing, searches for listing, views listing details, edits listing
- [ ] Manual testing: verify geo-search accuracy, species-dependent validation, moderation workflow, image upload
- [ ] Performance: geo-search with 50k listings returns in <1s for 95% of requests
- [ ] Compliance: listings do not expose personal data beyond what's allowed (phone/social media after moderation); adhere to Russian livestock trading laws and identification requirements
- [ ] Documentation: OpenAPI spec generated and available
