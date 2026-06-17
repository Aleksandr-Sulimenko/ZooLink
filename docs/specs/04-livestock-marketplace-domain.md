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

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Livestock search by ear tag/passport < 500ms; geo-search < 2s (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Listings do not expose personal data beyond what's allowed (phone/social media after moderation); adhere to Russian livestock trading laws and identification requirements (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Marketplace UI follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)

## User Stories

### Livestock Marketplace Management
**UC-LM-01:** As a farmer or livestock owner, I want to easily create and manage my livestock listings so that I can efficiently sell, breed, or showcase my animals.
- Acceptance Criteria:
  - Listing creation form loads in <2s
  - Species and breed selection uses searchable dropdowns with livestock-specific options
  - Dynamic form adjusts fields based on selected species (ear tags, passport info, health certificates, etc.)
  - Clear visual feedback when form is valid/invalid
  - Success confirmation with listing ID shown immediately
  - Ability to skip optional fields and return to them later
  - Map-based location selection with radius search
  - Photo upload with preview and optimization

**UC-LM-02:** As a livestock buyer or breeder, I want to easily discover livestock that match my criteria so that I can find suitable animals for purchase, breeding, or show efficiently.
- Acceptance Criteria:
  - Livestock attributes visible in listing cards (species, breed, age, sex, photos, price, location)
  - Filtering options prominent and easy to apply (species, breed, age, sex, price, location, listing type)
  - Map-based search with radius selector (1-100 km)
  - Search results load quickly (<1s) with infinite scroll
  - Clear indication of searchable attributes vs. private data
  - Saved searches for frequently used criteria
  - Sorting options (newest, price, distance)
  - Direct contact reveal after moderation (phone, Telegram/VK links)

### Moderation & Quality Assurance
**UC-LM-03:** As a moderator, I want to efficiently review livestock listings so that I can ensure quality, compliance, and safety in the marketplace.
- Acceptance Criteria:
  - Moderation queue loads in <2s with clear status indicators
  - Listing details show all required livestock attributes for review (ear tag, passport, health certificates)
  - One-click approval/rejection with optional comments
  - Bulk moderation options for similar listings
  - Clear compliance checklist for Russian livestock trading regulations
  - Notification system for users when listing status changes
  - Audit trail of moderation actions for accountability
  - Ability to request additional information from seller

**UC-LM-04:** As a user concerned about privacy and control, I want to manage my livestock listings' visibility and ownership status so that I can protect my information and comply with personal preferences.
- Acceptance Criteria:
  - Clear toggle between active/inactive listing states
  - Visual indication when listing is inactive (grayed out, label)
  - Simple reactivation process with confirmation
  - Clear explanation of what happens to listing data when deactivated
  - Ability to add/remove livestock identification information easily
  - Control over what personal information is visible post-moderation (phone, social media links)
  - Easy deletion of completed/expired listings

**UC-LM-05:** As a livestock trader or farmer, I want to track important health and productivity information so that I can make informed decisions about my livestock's care and trading potential.
- Acceptance Criteria:
  - Structured input for vaccinations, tests, treatments
  - Productivity metrics tracking (milk yield, weight gain, offspring count)
  - Health summary visible at a glance on listing
  - Integration with animal health records from Animal Domain
  - Export capability for health and productivity records (future enhancement)
  - Reminders for upcoming health checks or treatments (future enhancement)

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
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented

---

## Related Documents

- [Glossary](glossary.md)
- [Listing State Machine](statemachines/listing_state_machine.md)
- [Listings API](../03-architecture/api-contracts/listings-api.yaml)
- [Animal Domain](02-animal-domain.md)
- [Matching Domain](05-matching-domain.md)
- [Business Requirements](../02-requirements/business-requirements/livestock-marketplace.md)
- 🌐 RU mirror: [docsRU/specs/04-livestock-marketplace-domain.md](../../docsRU/specs/04-livestock-marketplace-domain.md)
