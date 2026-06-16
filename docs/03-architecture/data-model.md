# Logical Data Model (ERD)

This document describes the logical data model of the ZooLink system, which corresponds to the conceptual domain models and is implemented in the PostgreSQL schema.

## Overview

The logical data model is a structured representation of the system's data, including:
- Entities and their attributes
- Relationships between entities
- Constraints and business rules at the data level
- Indexes for performance
- Extensibility through JSONB and other mechanisms

The physical implementation of the data schema is located in the file [`database_schema.sql`](../../database_schema.sql).

## Core Modeling Principles

### 1. Alignment with the Domain Model (DDD)
- Tables and relationships reflect the aggregates, entities, and value objects from the domain models
- Each bounded context has a clearly expressed data structure
- Aggregate roots have global identifiers (UUID)
- Foreign keys establish relationships within and between aggregates

### 2. Extensibility
- Use of JSONB columns for attributes that may change or have a variable structure
- Metadata and extensible fields in key tables
- Multilingual support through localized JSONB fields

### 3. Data Integrity
- CHECK constraints for business rules at the database level
- Foreign keys for referential integrity
- Unique constraints where necessary
- Triggers for automatic maintenance of derived data

### 4. Performance
- Strategically chosen indexes for frequent query patterns
- Load distribution through appropriate index types (B-tree, GIN, GiST, GIST)
- Pre-computed or cacheable values where appropriate

### 5. Audit and Traceability
- Creation and update timestamps on all tables
- Dedicated tables for change history where full traceability is required
- Soft deletion instead of physical deletion for key entities
- Outbox event table for reliable integration

## Core Entities and Their Relationships

This model supports all bounded contexts of the ZooLink system:

### Identity Context
- `users` - the core user entity
- Relationships with authentication providers via dedicated columns
- Roles and access rights

### Organization Context
- `organizations` - organizations and companies
- `branches` - branches of organizations
- `organization_users` - association of users with organizations and their roles

### Animal Context (System Core)
- `animals` - the aggregate root, the central entity of the system
- `species` and `breeds` - reference data from the administration context
- `animal_ownership_history` - ownership change history
- Relationships to parents for pedigree tracking (planned extension)

### Listings Context (Marketplaces)
- `listings` - listings, linked to animals through a foreign key
- `listing_photos` - listing photos
- `location_point` - geospatial position for radius search
- Various listing types: sale, breeding, show, adoption, stud service

### Interactions Context
- `conversations` and `messages` - communication system between users (after moderation)
- Relationships with listings to contextualize communication

### Administration Context
- `cities` - city reference table for geo-search
- `feature_toggles` - management of functionality through toggles
- `outbox_events` - outbox event table for reliable integration
- `supported_languages` - management of supported languages

### Supporting Tables
- Tables for storing localized data (all *_localized JSONB columns)
- Tables for temporary data and cache (via the application)
- Tables for media files (via object storage, with references in the DB)

## Detailed Description of Key Tables

### animals Table (Animal Aggregate Root)
```sql
CREATE TABLE animals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
    species_id INT NOT NULL REFERENCES species(id) ON DELETE RESTRICT,
    breed_id INT REFERENCES breeds(id) ON DELETE SET NULL,
    breed_text_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    nickname_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    sex VARCHAR(10) NOT NULL CHECK (sex IN ('Male', 'Female')),
    date_of_birth DATE NOT NULL,
    color_coat VARCHAR(100),
    microchip_id VARCHAR(50),
    tattoo_brand_id VARCHAR(50),
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    health_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    reproductive_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    owned_since DATE,
    mother_id UUID REFERENCES animals(id) ON DELETE SET NULL,
    father_id UUID REFERENCES animals(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_animal_ownership CHECK (
        (owner_id IS NOT NULL AND organization_id IS NULL) OR
        (owner_id IS NULL AND organization_id IS NOT NULL)
    )
);
```

**Key points:**
- Exactly one owner (either a user or an organization) enforced through a CHECK constraint
- Immutable fields after creation: species_id, sex, date_of_birth, breed_id (via an application trigger)
- JSONB columns for extensible and localized data
- Relationships to parents for future pedigree tracking
- Soft deletion through the deactivated_at field

### listings Table (Entity Within the Animal Aggregate)
```sql
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    listing_type VARCHAR(20) NOT NULL CHECK (listing_type IN ('sale', 'breeding', 'show', 'adoption', 'stud_service')),
    title_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    price_cents INTEGER,
    currency CHAR(3) DEFAULT 'RUB',
    quantity INTEGER DEFAULT 1,
    location_point GEOGRAPHY(POINT, 4326),
    search_radius_m INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_listing_ownership CHECK (
        (organization_id IS NULL AND branch_id IS NULL) OR  -- Personal listing
        (organization_id IS NOT NULL)                       -- Organizational listing
    )
);
```

**Key points:**
- Mandatory relationship to an animal (each listing relates to a specific animal)
- The seller is always a user (even for organizational listings)
- Optional association with an organization/branch
- Geospatial position for radius search
- Various listing types through a CHECK constraint
- Ownership constraint: either a personal listing or an organizational listing

### users Table (Identity Context)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_hash VARCHAR(60),
    oauth_google_id VARCHAR(255),
    oauth_apple_id VARCHAR(255),
    oauth_telegram_id VARCHAR(255),
    oauth_vk_id VARCHAR(255),
    full_name VARCHAR(100) NOT NULL,
    city_id UUID REFERENCES cities(id) ON DELETE SET NULL,
    avatar_url TEXT,
    email VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(60),
    role VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'BREEDER', 'FARMER', 'MODERATOR', 'ADMIN')) DEFAULT 'USER',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Key points:**
- Multiple authentication methods (phone/SMS + OAuth providers)
- The user role determines access to system features
- Relationship with a city for geo-search by location
- Soft deletion through the deactivated_at field

## Relationships and Constraints

### Core Relationships
1. `animals.species_id → species.id` (animal species)
2. `animals.breed_id → breeds.id` (animal breed)
3. `animals.owner_id → users.id` (individual owner)
4. `animals.organization_id → organizations.id` (organizational owner)
5. `listings.animal_id → animals.id` (listing relates to an animal)
6. `listings.seller_id → users.id` (who posted the listing)
7. `listings.organization_id → organizations.id` (organization that posted the listing)
8. `listings.branch_id → branches.id` (branch of the organization)
9. `users.city_id → cities.id` (user's city for geo-search)
10. `organization_users.organization_id → organizations.id`
11. `organization_users.user_id → users.id`

### Integrity Constraints
- **CHK_CONSTRAINT_ON_ANIMAL_OWNERSHIP:** An animal must have either an individual owner or be owned by an organization (not both and not neither)
- **CHK_CONSTRAINT_ON_LISTING_OWNERSHIP:** A listing is either personal (without an organization/branch) or organizational (with an organization)
- **ROLE_CONSTRAINTS:** Constraints on user roles and their roles within organizations
- **IMMUTABLE_FIELDS_TRIGGER:** A trigger that prevents changing an animal's immutable fields after creation
- **OWNERSHIP_CHANGE_LOCK_MVP:** A trigger that blocks ownership changes during the MVP phase

## Indexes for Performance

### animals Table
- `idx_animals_owner` - search by owner (individual or organizational)
- `idx_animals_species_breed` - search by species and breed (frequent filter)
- `idx_animals_microchip` / `idx_animals_tattoo` - search by identifiers
- GIN indexes on JSONB columns (`health_records`, `reproductive_data`) - search by content
- `idx_animals_active` - partial index only for active animals
- `idx_animals_owned_since` - search by acquisition date

### listings Table
- `idx_listings_animal` - search for listings of a specific animal
- `idx_listings_seller` - search for listings of a specific seller
- `idx_listings_type_active` - composite index for searching active listings by type
- `idx_listings_price` - search by price (only for listings with a price)
- GIST index on `location_point` (if PostGIS is available) - efficient geo-search
- `idx_listings_expires` - search for listings that have not yet expired
- `idx_listing_photos_listing` - relationship of photos to listings

### Other Important Indexes
- Indexes on the users table for fast lookup by different authentication methods
- Indexes on reference tables (species, breeds, cities)
- Indexes on ownership history tables and organization association tables

## Extensibility Mechanisms

### JSONB Columns
Used for:
- Localized strings (all *_localized columns)
- Extensible attributes with a complex structure (medical records, reproductive data)
- Metadata and experimental fields
- Storing data with a variable schema without the need for migrations

### Table Metadata
- A `metadata` column in key tables (organizations, listings, feature_toggles)
- For storing experimental or temporary attributes
- Allows adding new features without changing the DB schema

### feature_toggles Table
- Management of functionality through toggles
- Progressive rollout of features (rollout_percentage)
- Easy enabling/disabling of features without a deployment

## Patterns for Handling Special Data

### Geospatial Data
- Primary: a `location_point` column of type GEOGRAPHY(POINT, 4326) (requires PostGIS)
- Fallback option: separate latitude/longitude columns (not included in the current schema, but can be added via ALTER TABLE)
- Search radius: a `search_radius_m` column in meters
- Indexes: a GIST index for efficient Distance Within operations and KNN search
- Units: Meters for distances, SRID 4326 (WGS84) for coordinates

### Multilingualism
- All text fields requiring localization are represented as JSONB columns
- Structure: {"en": "English text", "ru": "Russian text"}
- DB functions: `get_localized()` and `has_translation()` for working with localized data
- Indexes: GIN indexes on specific language components for searching localized text

### Change History and Audit
- Soft deletion: `deactivated_at` fields in key tables
- Animal ownership history: a dedicated `animal_ownership_history` table
- Outbox events: an `outbox_events` table for reliable integration
- Timestamps: `created_at` and `updated_at` on all tables via triggers
- Planned extension: a dedicated audit table for critical operations

## Related Decisions

- [ADR-0001: Technology stack selection](../04-decisions/0001-tech-stack.md)
- [ADR-0002: Hard split of markets](../04-decisions/0002-hard-split-markets.md)
- [ADR-0003: Pre-moderation workflow](../04-decisions/0003-pre-moderation-workflow.md)
- [ADR-0004: Animal as the aggregate root](../04-decisions/0004-animal-as-aggregate.md)
- [ADR-0005: No built-in chat in the MVP](../04-decisions/0005-no-chat-mvp.md)

## ERD Diagram

A textual representation of the core relationships:

```
users 1 ○───────○ many organization_users
        │                     │
        │                     ○───────○ many ────┐
        │                                          │
        │                     ┌───────○ organizations 1 ○───────○ many branches
        │                     │                     │           │
        │                     │                     │           ○───────○ many organization_users
        │                     │                     │
species 1 ○───────○ many breeds ○...................○ animals ◄─────┘
        │                     │                     │
        │                     │                     ○───────○ many listings
        │                     │                     │           │
        │                     │                     │           ○───────○ many listing_photos
        │                     │                     │
        │                     │                     ○───────○ many conversations
        │                     │                     │                     │
        │                     │                     │                     ○───────○ many messages
        │                     │                     │
        │                     ○───────○ cities ◄────┘
        │
        ○───────○ many listings (seller_id)
```

Where:
- 1 = one
- many = many
- ○ = optional relationship
- ● = mandatory relationship
- .................. = relationship through other tables or a complex condition

## Maintenance Instructions

### When Changing the Schema
1. Always update `database_schema.sql` as the source of truth
2. Update this document to reflect changes in the logical model
3. Consider backward compatibility when adding/changing fields
4. Add migration scripts for existing data
5. Update related documents (domain specifications, API contracts)

### When Adding New Features
1. Consider using JSONB columns before changing the schema
2. Use the `feature_toggles` table for gradual feature enablement
3. Add the necessary indexes for new query patterns
4. Ensure that constraints and business rules are correctly represented at the DB level
5. Add comments and documentation for new tables and columns

### Performance and Monitoring
1. Periodically review and update indexes based on real query patterns
2. Monitor slow queries and adjust indexes accordingly
3. Consider partitioning large tables (listings, messages) by time
4. Set up alerts for DB resource usage and query execution time
