# ADR-0004: Animal as Aggregate Root

**Status**: Accepted  
**Date**: 2026-05-30  

## Context and Problem Statement

In the ZooLink platform, animals are central to all business operations. Users create animal profiles, then create listings associated with those animals (for sale, breeding, shows, etc.). The same animal can have multiple listings over its lifetime (different sales, multiple breeding events, show participations).

We needed to decide how to model the relationship between animals and listings in our domain model. Specifically, we needed to determine whether:
- Animal should be an entity within the Listing aggregate
- Listing should be an entity within the Animal aggregate  
- Animal and Listing should be separate aggregates with a relationship
- Animal should be a value object within Listing

Initial considerations included modeling listings as the primary aggregate with animal details embedded, or treating animal and listing as separate entities with a simple foreign key relationship. However, we recognized that animals have a lifecycle independent of any particular listing, and that listings are transient events in an animal's life.

## Decision Drivers

1. **Lifespan Independence**: Animals exist before their first listing and may exist after their last listing
2. **Multiple Listings**: One animal can have many listings over its lifetime (sales, breedings, shows, etc.)
3. **Immutable Core Attributes**: Species, breed, sex, date of birth are fixed upon animal creation
4. **Mutable Attributes**: Nickname, color, health records, reproductive records can change
5. **Ownership Transfer**: Animals can change owners while retaining their identity
6. **Data Integrity**: Need to prevent conflicting listings about the same animal
7. **Query Patterns**: Frequent need to find all listings for a given animal
8. **Domain Logic**: Business rules about animal eligibility for certain listing types (e.g., neutered pets for breeding)

## Considered Options

### Option 1: Listing as Aggregate Root with Embedded Animal Details
Each listing contains all animal information embedded within it.

Pros:
- Simple data model for listing-centric views
- Atomic listing creation (no cross-aggregate transactions)
- Easy to snapshot animal state at time of listing

Cons:
- Data duplication when animal has multiple listings
- Inconsistency risk when animal attributes change between listings
- Difficult to maintain animal's complete history
- Complex ownership transfer (need to update all historical listings)
- Denies animal's independent existence and identity

### Option 2: Separate Aggregates with Foreign Key Relationship
Animal and Listing are separate aggregates linked by animal_id foreign key.

Pros:
- Clear separation of concerns
- Animal maintains independent identity and lifecycle
- No data duplication of core animal attributes
- Easy to query all listings for an animal
- Straightforward ownership transfer (update animal's owner_id)

Cons:
- Requires cross-aggregate transactions for listing creation (validate animal exists and is owned by user)
- Potential for orphaned listings if animal is deleted (mitigated by soft delete)
- Slightly more complex initial listing creation

### Option 3: Animal as Value Object within Listing
Animal details are treated as immutable values copied into each listing.

Pros:
- Simplest implementation initially
- Listing is self-contained for display purposes

Cons:
- Same drawbacks as Option 1 but worse for mutability
- Completely denies animal identity across listings
- Impossible to track animal's lifetime history
- Poor fit for domain reality where animals persist beyond individual transactions

### Option 4: Animal as Aggregate Root with Listings as Child Entities (Chosen)
Animal is the aggregate root, and listings are entities within the animal aggregate that reference back to it.

Pros:
- Matches domain reality: animals exist independently and have many listing events
- Centralizes animal identity and lifecycle management
- Prevents inconsistent animal data across listings
- Enforces ownership rules at animal aggregate level
- Natural fit for querying animal history and current status
- Supports business rules like "neutered animals cannot be listed for breeding"
- Clear transactional boundary for animal-related operations

Cons:
- Slightly more complex to implement listing-centric queries (need to go through animal)
- Requires careful design to avoid loading entire animal history when only listing data is needed
- Potential for large aggregates if animal has many listings (mitigated by pagination and access patterns)

## Decision

We will model **Animal as an aggregate root** with Listing as an entity within the animal aggregate. This means:

1. **Animal Aggregate Root**:
   - Global identity (animal_id) that persists across all listings
   - Contains immutable attributes: species, breed, sex, date of birth (approx)
   - Contains mutable attributes: nickname, color/coat, chip/tattoo, basic health/repro records (stored as JSONB)
   - Ownership information (owner_id linking to user or organization)
   - Soft delete flag for deactivated animals
   - Validation rules for attribute combinations (e.g., species-appropriate fields)

2. **Listing Entity** (within Animal aggregate):
   - Local identity within animal context (listing_id)
   - References parent animal (animal_id)
   - Contains listing-specific data: title, description, price, location, photos, status
   - Contains listing-type specific fields (sales terms, breeding conditions, show details, etc.)
   - Moderation status and audit trail
   - Timestamps for creation, moderation, publication

3. **Invariants and Business Rules**:
   - Animal's immutable attributes (species, breed, sex, dob) cannot change after creation
   - Ownership changes must go through animal aggregate (update owner_id)
   - Listing creation validates that animal exists and is owned by the current user/organization
   - Certain listing types require animal to meet criteria (e.g., intact for breeding, neutered for pet adoption promotions)
   - Soft delete of animal hides all associated listings from public view
   - Hard delete prohibited; use soft delete for data integrity

4. **Query Patterns Supported**:
   - Get animal profile with recent listings
   - Get all listings for an animal (filtered by status/type/date)
   - Get listings by owner (via animal ownership)
   - Search listings across animals (denormalized search index for performance)
   - Get animal's lifetime listing history for analytics

## Consequences

### Positive
- Accurately reflects domain reality where animals have independent existence
- Prevents data inconsistency for core animal attributes
- Simplifies ownership transfer and animal lifecycle management
- Enforces business rules at the appropriate aggregate level
- Supports rich querying of animal history and listing patterns
- Clear transactional boundaries for animal-related operations

### Negative
- Listing-centric queries require joining through animal aggregate
- Need to design read models/search indexes for efficient listing searches
- Potential for large animal aggregates (mitigated by CQRS and access patterns)
- Initial learning curve for developers familiar with listing-centric approaches

### Neutral
- Does not prevent eventual consistency patterns for read-heavy operations
- Core infrastructure (database, caching) unchanged
- API contracts remain listing-focused while internally respecting aggregate boundaries

## Implementation Notes

1. **Data Model**:
   - `animals` table with columns for identity, immutable/mutable attributes, ownership, soft delete
   - `listings` table with foreign key to animals, listing-specific data, status, timestamps
   - Indexes on `animals.owner_id` for ownership-based queries
   - Indexes on `listings.animal_id` for animal-specific listing queries
   - Search indexes (PostgreSQL GIN/GiST or Elasticsearch) for listing search denormalized from animal + listing data

2. **API Design**:
   - Animal-focused endpoints: `/animals/{id}`, `/animals/{id}/listings`
   - Listing-focused endpoints: `/listings` (search/filter), `/listings/{id}`
   - Internal services enforce aggregate boundaries (e.g., ListingService validates animal ownership via AnimalService)
   - Events published for animal lifecycle events (created, ownership changed, deactivated)

3. **Domain Logic Enforcement**:
   - Animal aggregate root validates immutable field constraints
   - Animal aggregate validates ownership transitions
   - Listing factory/service validates animal eligibility for listing type
   - Moderation workflow operates on listings but relies on animal data for validation

4. **Performance Considerations**:
   - Read-optimized search indexes for listing queries (denormalized animal + listing data)
   - Caching of frequently accessed animal profiles
   - Pagination for animal listing history
   - Batch operations for ownership transfers affecting many listings

## Related Decisions

- **ADR-0002**: Hard split between pet and livestock marketplaces (animal aggregate serves both domains)
- **ADR-0003**: Pre-Moderation Workflow (listings transition through moderation states)
- **ADR-0005**: No chat in MVP (contact reveal happens after moderation, tied to listing status)
- **ADR-0001**: Tech stack choice (NestJS supports DDD principles with modules and services)

## References

- Project Brief Section 3: Animal as Entity (aggregate root)
- Animal Domain Specification (central entity definition, immutable/mutable attributes)
- Pet Marketplace Domain Specification (listing association with animal)
- Livestock Marketplace Domain Specification (similar)
- Matching Domain Specification (references animal attributes for compatibility scoring)
- Database Schema: `database_schema.sql` (animals and listings tables with foreign key constraint)
- Domain-Driven Design: Aggregates and Transaction Boundaries (Evans)
