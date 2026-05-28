---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# Spec: Pet Marketplace Domain

## Outcome
Enable listing, searching, and managing advertisements for companion animals (pets) such as dogs, cats, birds, etc. Support operations like sale, breeding, adoption, and exhibition. Ensure compliance with Russian regulations for pet trading and advertising.

## Scope & Boundaries
**In Scope:**
- Pet listings with attributes: title, description, price (or free), location (geo-coordinates), contact info (phone, social media links after moderation), media (photos/videos), listing type (sale, breeding, adoption, show), status (active, inactive, moderated, rejected, archived)
- Geo-search: radius-based search (1-100 km) from user location
- Filtering: by species, breed, age, sex, price, location, listing type
- Moderation workflow: pre-moderation (listing appears only after moderator approval)
- User actions: create, edit, delete own listings, favorites, share
- Integration with Animal Domain (link listing to animal entity)
- Integration with Identity Domain (seller/owner info)
- Compliance with Russian advertising laws and 152-ФЗ for personal data in listings

**Out of Scope:**
- Auction/bidding systems - deferred
- Payment processing (in-app transactions) - deferred to phase 2
- Delivery/shipping logistics - deferred
- User ratings/reviews for sellers - deferred
- Promoted listings/ads - deferred

## Constraints
- **Legal:** Must comply with Russian Federal Law "On Advertising", veterinary regulations for pet trade, and 152-ФЗ for processing personal data (phone numbers, names in listings).
- **Security:** Prevent spam, fraud, and malicious content in listings. Rate limiting on listing creation.
- **Performance:** Listing search with geo-radius < 2s under load (target <1s).
- **Scalability:** Support 100k+ active listings.
- **Technology:** Align with NestJS, TypeScript, PostgreSQL.
- **Usability:** Simple listing creation flow for mass market users; clear display of essential info.

## Prior Decisions
- Listing entity includes: id, title, description, price, location (latitude/longitude), listingType (enum), status (enum), sellerId (FK to User), animalId (FK to Animal, optional), createdAt, updatedAt, moderatedAt, rejectedReason (optional), viewsCount.
- Location stored as PostGIS point (or latitude/longitude doubles with indexing) for geo-search.
- Media: store URLs to object storage (S3) for images/videos.
- Moderation: listings have status: draft, pending, active, rejected, archived. Only active listings are publicly searchable.
- Geo-search: use PostgreSQL with PostGIS extension or lattice cube for radius queries.
- Price can be null (free adoption) or numeric.
- Contact info: after moderation, show phone number and social media links (Telegram, VK) provided by seller.

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `pet-marketplace` module
   - [ ] Define Listing entity with fields as above
   - [ ] Create reference table for ListingType (sale, breeding, adoption, show)
   - [ ] Implement geo-search using PostGIS or latitude/longitude with earthdistance
   - [ ] Create ListingController (CRUD, search, moderation actions)
   - [ ] Create ListingService (business logic: validation, geo-search, moderation workflow)
   - [ ] Set up database indexes: location (geo), status, listingType, speciesId (via animal), sellerId
   - [ ] Implement moderation endpoints (for moderator role)
   - [ ] Write unit and integration tests for listing lifecycle and search
   - [ ] Create OpenAPI docs for listing endpoints

2. **Frontend (React)**
   - [ ] Create listing pages: Create Listing, Edit Listing, Listing List (search/browse), Listing Detail
   - [ ] Implement map-based location selection (using Yandex Maps API)
   - [ ] Create listing form with dynamic fields based on listing type
   - [ ] Implement search filters and radius selector
   - [ ] Create listing card component for grid/list views
   - [ ] Implement favorites and sharing functionality
   - [ ] Integrate with Identity Domain to show seller info (limited to what's allowed post-moderation)
   - [ ] Write unit and e2e tests for listing flows

3. **Infrastructure**
   - [ ] Enable PostGIS extension in PostgreSQL (or use alternative geo-indexing)
   - [ ] Configure Prisma schema for Listing and related entities
   - [ ] Set up object storage bucket for listing media
   - [ ] Implement image upload via pre-signed URLs (frontend to storage)
   - [ ] Add caching layer for frequent search queries (Redis)
   - [ ] Implement rate limiting for listing creation endpoints

## Verification Criteria
- [ ] Unit tests >90% coverage for pet-marketplace module (backend)
- [ ] Integration tests cover: listing creation (valid/invalid), search by geo-radius, filtering, moderation workflow, status transitions
- [ ] E2E tests cover: user creates listing, searches for listing, views listing details, edits listing
- [ ] Manual testing: verify geo-search accuracy, moderation workflow, image upload
- [ ] Performance: geo-search with 100k listings returns in <1s for 95% of requests
- [ ] Compliance: listings do not expose personal data beyond what's allowed (phone/social media after moderation); adhere to Russian advertising laws
- [ ] Documentation: OpenAPI spec generated and available
