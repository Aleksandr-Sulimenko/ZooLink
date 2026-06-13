---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# Spec: Matching Domain

## Outcome
Enable specialized logic for matching animals for breeding (mating) based on various criteria such as breed, pedigree, health status, location, and owner preferences. Facilitate communication between interested parties (to be implemented via contact sharing post-moderation in MVP, with chat deferred to phase 2).

## Scope & Boundaries
**In Scope:**
- Animal profiles optimized for breeding/search (showing relevant traits: pedigree, health certifications, titles, etc.)
- Matching algorithms: breed compatibility, health screening, location proximity, owner preferences
- Search/filter interface for finding potential mating partners
- Integration with Animal Domain (animal data)
- Integration with Identity Domain (owner info, with privacy controls)
- Listing integration: ability to convert animal profile to breeding listing
- Pre-moderation for breeding listings (same as other listing types)
- Basic contact sharing after moderation (phone, social media links)

**Out of Scope:**
- Genetic analysis/predictive breeding - deferred to phase 2
- Pedigree chart generation and management - deferred
- Health record integration with veterinary systems - deferred
- Automated mating recommendations/AI matching - deferred
- Payment for breeding services - deferred
- Chat/messaging system - deferred to phase 2

## Constraints
- **Legal:** Must comply with Russian animal breeding regulations and 152-ФЗ for personal data.
- **Data Quality:** Matching accuracy depends on complete and verified animal profiles.
- **Performance:** Matching search should return results in <2s.
- **Scalability:** Support matching across 50k+ breeding-capable animals.
- **Technology:** Align with NestJS, TypeScript, PostgreSQL.
- **Usability:** Interface must be intuitive for breeders (may not be technical experts).

## Prior Decisions
- Matching will initially be based on searchable criteria rather than complex algorithms.
- We'll use the same listing/moderation infrastructure for breeding listings (listing type = "breeding").
- Animal Domain will store breeding-relevant attributes: pedigree ID, health test results, show titles, etc.
- Privacy: owner contact information is only shared after moderation approves the breeding listing.
- Location-based matching uses same geo-search as marketplace domains.
- We distinguish between "breeding" listings (animals for mating) and "sale" listings (offspring for sale).

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Breeding search with 50k animals returns in <1s for 95% of requests (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Adheres to Russian breeding regulations; owner PII protected until after moderation (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Matching interface follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)

## User Stories

### Breeding & Matching Management
**UC-MT-01:** As a breeder or farmer, I want to easily find suitable breeding partners for my animals so that I can improve my breeding program and genetic diversity.
- Acceptance Criteria:
  - Matching search loads in <2s
  - Search filters include species, breed, age, sex, health status, pedigree, location, and owner preferences
  - Map-based search with radius selector (1-100 km)
  - Search results display key breeding attributes (pedigree, health certifications, show titles)
  - Clear indication of match quality/compatibility score
  - Ability to save searches and set up alerts for new matches
  - Direct contact reveal after moderation (phone, Telegram/VK links)
  - Option to convert animal profile to breeding listing with one click

**UC-MT-02:** As a user concerned about privacy and control, I want to manage my animal's visibility in breeding searches so that I can protect my information and comply with personal preferences.
- Acceptance Criteria:
  - Clear toggle to include/exclude animal from breeding search results
  - Visual indication when animal is hidden from search
  - Simple process to make animal visible again
  - Control over what breeding information is visible (pedigree, health tests, titles)
  - Ability to block specific users from seeing animal in search
  - Audit trail of who viewed animal profile (future enhancement)

**UC-MT-03:** As a moderator, I want to efficiently review breeding listings so that I can ensure quality, compliance, and safety in the breeding marketplace.
- Acceptance Criteria:
  - Moderation queue loads in <2s with clear status indicators
  - Breeding listing details show all required attributes for review (pedigree, health certificates, titles)
  - One-click approval/rejection with optional comments
  - Bulk moderation options for similar listings
  - Clear compliance checklist for Russian animal breeding regulations
  - Notification system for users when listing status changes
  - Audit trail of moderation actions for accountability
  - Ability to request additional information from seller

**UC-MT-04:** As a livestock trader or farmer, I want to track important health and pedigree information so that I can make informed decisions about my animals' breeding potential and value.
- Acceptance Criteria:
  - Structured input for health tests, vaccinations, treatments
  - Pedigree tracking with mother/father references
  - Health and pedigree summary visible at a glance on animal profile
  - Integration with animal health records from Animal Domain
  - Export capability for health and pedigree records (future enhancement)
  - Reminders for upcoming health checks or treatments (future enhancement)

**UC-MT-05:** As a user new to breeding, I want to access educational resources and guidance so that I can make informed decisions about animal breeding practices.
- Acceptance Criteria:
  - Access to breeding guidelines and best practices
  - Information about Russian breeding regulations and requirements
  - Health testing recommendations for different species
  - Pedigree explanation and importance
  - Links to veterinary resources and breeding associations
  - FAQ section covering common breeding questions

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Enhance Animal entity with breeding-specific fields: pedigreeId, healthTestResults (JSONB), showTitles, breedingRestrictions, etc.
   - [ ] Ensure ListingType includes "breeding" as valid type
   - [ ] Create matching search service that extends geo-search with breeding filters
   - [ ] Create MatchingController (search, animal profile views)
   - [ ] Create MatchingService (business logic: search algorithms, filtering)
   - [ ] Set up database indexes for breeding-specific fields
   - [ ] Write unit and integration tests for matching/search functionality
   - [ ] Create OpenAPI docs for matching endpoints

2. **Frontend (React)**
   - [ ] Create animal profile page optimized for breeding display
   - [ ] Create breeding search page with filters (species, breed, health, location, pedigree)
   - [ ] Create breeding listing creation flow (similar to other listings but with breeding-specific fields)
   - [ ] Implement map-based location selection for search
   - [ ] Create animal card component for breeding search results
   - [ ] Integrate with Identity Domain to show limited owner info post-moderation
   - [ ] Write unit and e2e tests for matching flows

3. **Infrastructure**
   - [ ] Configure Prisma schema for breeding-specific animal fields
   - [ ] Ensure database indexes support combined geo + attribute searches
   - [ ] Set up caching for frequent matching searches
   - [ ] Implement rate limiting for matching search endpoints

## Verification Criteria
- [ ] Unit tests >90% coverage for matching-related functionality (backend)
- [ ] Integration tests cover: breeding search (various filters), animal profile display, breeding listing creation
- [ ] E2E tests cover: user searches for breeding partner, views animal profile, creates breeding listing
- [ ] Manual testing: verify search accuracy, breeding-specific validation, moderation workflow
- [ ] Performance: breeding search with 50k animals returns in <1s for 95% of requests
- [ ] Compliance: adheres to Russian breeding regulations; owner PII protected until after moderation
- [ ] Documentation: OpenAPI spec generated and available
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented
