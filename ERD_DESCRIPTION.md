# ZooLink Database Entity-Relationship Diagram (ERD) - Textual Description

This document describes the Entity-Relationship Diagram for the ZooLink database schema as defined in `database_schema.sql`. The schema follows Domain-Driven Design principles with bounded contexts for Identity, Animal, and Marketplace domains.

## Overview

The database consists of 15 core tables organized into functional domains:
- **Reference Data**: species, breeds, cities
- **Identity Domain**: users
- **Animal Domain**: animals, animal_ownership_history
- **Organization Domain**: organizations, branches, organization_users
- **Marketplace/Listings Domain**: listings, listing_photos, conversations, messages
- **Extensibility/System**: feature_toggles, outbox_events

## Tables and Relationships

### 1. Reference Data Tables

#### species
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `code` VARCHAR(50) NOT NULL UNIQUE (e.g., 'dog', 'cattle')
  - `name_ru` VARCHAR(100) NOT NULL
  - `name_en` VARCHAR(100) NOT NULL
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE
- **Relationships**: 
  - Referenced by `breeds.species_id` (one-to-many)
  - Referenced by `animals.species_id` (one-to-many)

#### breeds
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `species_id` UUID NOT NULL REFERENCES species(id) ON DELETE RESTRICT
  - `code` VARCHAR(50) NOT NULL
  - `name_ru` VARCHAR(100) NOT NULL
  - `name_en` VARCHAR(100) NOT NULL
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE
- **Constraints**: UNIQUE (`species_id`, `code`)
- **Relationships**:
  - References `species` (many-to-one)
  - Referenced by `animals.breed_id` (one-to-many)

#### cities (Optional for geo-search)
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `name_ru` VARCHAR(100) NOT NULL
  - `name_en` VARCHAR(100) NOT NULL
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE
- **Relationships**:
  - Referenced by `users.city_id` (one-to-many, optional)

### 2. Organization Domain

#### organizations
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `name_ru` VARCHAR(200) NOT NULL
  - `name_en` VARCHAR(200) NOT NULL
  - `inn` VARCHAR(20) (Tax ID)
  - `kpp` VARCHAR(20) (Tax registration reason code)
  - `address` TEXT
  - `phone` VARCHAR(30)
  - `email` VARCHAR(255)
  - `logo_url` TEXT
  - `is_active` BOOLEAN NOT NULL DEFAULT TRUE
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Relationships**:
  - References by `organization_users.organization_id` (one-to-many)
  - References by `branches.organization_id` (one-to-many)
  - References by `listings.organization_id` (one-to-many, optional)
  - References by `animals.organization_id` (one-to-many, optional)

#### branches
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `organization_id` UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
  - `city_id` UUID NOT NULL REFERENCES cities(id) ON DELETE RESTRICT
  - `address` TEXT
  - `phone` VARCHAR(30)
  - `email` VARCHAR(255)
  - `is_headquarters` BOOLEAN NOT NULL DEFAULT FALSE
  - `is_active` BOOLEAN NOT NULL DEFAULT TRUE
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Relationships**:
  - References `organizations` (many-to-one)
  - References `cities` (many-to-one)
  - References by `listings.branch_id` (one-to-many, optional)

#### organization_users
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `organization_id` UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT
  - `user_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `role_in_org` VARCHAR(20) NOT NULL CHECK (role_in_org IN ('OWNER', 'ADMIN', 'STAFF', 'VET', 'MODERATOR'))
  - `is_primary` BOOLEAN NOT NULL DEFAULT FALSE
  - `joined_at` DATE
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Relationships**:
  - References `organizations` (many-to-one)
  - References `users` (many-to-one)

### 2. Identity Domain

#### users
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `phone_hash` VARCHAR(60) (bcrypt hash, nullable for OAuth-only)
  - `oauth_google_id` VARCHAR(255)
  - `oauth_apple_id` VARCHAR(255)
  - `oauth_telegram_id` VARCHAR(255)
  - `oauth_vk_id` VARCHAR(255)
  - `full_name` VARCHAR(100) NOT NULL
  - `city_id` UUID REFERENCES cities(id) ON DELETE SET NULL (for geo-search)
  - `avatar_url` TEXT
  - `email` VARCHAR(255)
  - `email_verified` BOOLEAN DEFAULT FALSE
  - `password_hash` VARCHAR(60) (bcrypt hash if using phone auth)
  - `role` VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'MODERATOR', 'ADMIN')) DEFAULT 'USER'
  - `is_active` BOOLEAN NOT NULL DEFAULT TRUE
  - `last_login_at` TIMESTAMP WITH TIME ZONE
  - `deactivated_at` TIMESTAMP WITH TIME ZONE
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE
- **Indexes**:
  - `idx_users_phone_hash` (partial: WHERE phone_hash IS NOT NULL)
  - `idx_users_oauth_google` (partial: WHERE oauth_google_id IS NOT NULL)
  - `idx_users_oauth_apple` (partial: WHERE oauth_apple_id IS NOT NULL)
  - `idx_users_oauth_telegram` (partial: WHERE oauth_telegram_id IS NOT NULL)
  - `idx_users_oauth_vk` (partial: WHERE oauth_vk_id IS NOT NULL)
  - `idx_users_email` (partial: WHERE email IS NOT NULL)
  - `idx_users_role`
  - `idx_users_city`
- **Relationships**:
  - References `cities` (optional, many-to-one)
  - References by `animals.owner_id` (one-to-many)
  - References by `animal_ownership_history.owner_id` (one-to-many)
  - References by `listings.seller_id` (one-to-many)
  - References by `conversations.participant_a_id` (one-to-many)
  - References by `conversations.participant_b_id` (one-to-many)
  - References by `messages.sender_id` (one-to-many)
  - References by `messages.recipient_id` (one-to-many)

### 3. Animal Domain

#### animals
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `owner_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `species_id` UUID NOT NULL REFERENCES species(id) ON DELETE RESTRICT
  - `breed_id` UUID REFERENCES breeds(id) ON DELETE SET NULL (nullable if custom/other)
  - `breed_text` VARCHAR(100) (custom breed text if breed_id is null)
  - `nickname` VARCHAR(50) (display name)
  - `sex` VARCHAR(10) NOT NULL CHECK (sex IN ('Male', 'Female'))
  - `date_of_birth` DATE NOT NULL
  - `color_coat` VARCHAR(100)
  - `microchip_id` VARCHAR(50)
  - `tattoo_brand_id` VARCHAR(50) (for livestock)
  - `is_active` BOOLEAN NOT NULL DEFAULT TRUE (visible for new listings when true)
  - `health_records` JSONB NOT NULL DEFAULT '[]'::jsonb (array of {type, detail, date, provider})
  - `reproductive_data` JSONB NOT NULL DEFAULT '[]'::jsonb (for females: heat, mating, etc.)
  - `owned_since` DATE
  - `mother_id` UUID REFERENCES animals(id) ON DELETE SET NULL (future pedigree)
  - `father_id` UUID REFERENCES animals(id) ON DELETE SET NULL
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE
  - `deactivated_at` TIMESTAMP WITH TIME ZONE (when deactivated - soft delete)
- **Indexes**:
  - `idx_animals_owner`
  - `idx_animals_species_breed`
  - `idx_animals_microchip` (partial: WHERE microchip_id IS NOT NULL)
  - `idx_animals_tattoo` (partial: WHERE tattoo_brand_id IS NOT NULL)
  - `idx_animals_health_records` (GIN)
  - `idx_animals_reproductive_data` (GIN)
  - `idx_animals_breed_text`
  - `idx_animals_active` (partial: WHERE is_active = true)
  - `idx_animals_owned_since`
- **Relationships**:
  - References `users` (many-to-one, via owner_id)
  - References `species` (many-to-one)
  - References `breeds` (optional, many-to-one)
  - Self-referential: `mother_id` (many-to-one, optional)
  - Self-referential: `father_id` (many-to-one, optional)
  - References by `animal_ownership_history.animal_id` (one-to-many)
  - References by `listings.animal_id` (one-to-many)

#### animal_ownership_history (For traceability, regulatory)
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `animal_id` UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE
  - `owner_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `start_date` DATE NOT NULL
  - `end_date` DATE
  - `transfer_reason` TEXT
  - `created_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Indexes**:
  - `idx_aoh_animal`
  - `idx_aoh_owner`
  - `idx_aoh_dates` (on start_date, end_date)
- **Relationships**:
  - References `animals` (many-to-one)
  - References `users` (many-to-one)

### 4. Marketplace/Listings Domain

#### listings
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `animal_id` UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE
  - `seller_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `listing_type` VARCHAR(20) NOT NULL CHECK (listing_type IN ('sale', 'breeding', 'show', 'adoption'))
  - `title` VARCHAR(255) NOT NULL
  - `description` TEXT
  - `price_cents` INTEGER (nullable for non-price listings)
  - `currency` CHAR(3) DEFAULT 'RUB'
  - `quantity` INTEGER DEFAULT 1
  - `location_point` GEOGRAPHY(POINT, 4326) (requires PostGIS; if not available, use lat/lng columns)
  - `search_radius_m` INTEGER (meters for radius search)
  - `is_active` BOOLEAN NOT NULL DEFAULT TRUE
  - `expires_at` TIMESTAMP WITH TIME ZONE
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE
- **Indexes**:
  - `idx_listings_animal`
  - `idx_listings_seller`
  - `idx_listings_type_active` (partial: WHERE is_active = true)
  - `idx_listings_price` (partial: WHERE price_cents IS NOT NULL)
  - `idx_listings_location` (GIST, conditional on PostGIS availability)
  - `idx_listings_expires` (partial: WHERE expires_at > NOW())
- **Relationships**:
  - References `animals` (many-to-one)
  - References `users` (many-to-one, via seller_id)
  - References by `listing_photos.listing_id` (one-to-many)
  - References by `conversations.listing_id` (one-to-many)

#### listing_photos
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `listing_id` UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE
  - `url` TEXT NOT NULL
  - `order_index` INTEGER NOT NULL DEFAULT 0
  - `created_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Indexes**:
  - `idx_listing_photos_listing`
- **Relationships**:
  - References `listings` (many-to-one)

#### conversations
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `listing_id` UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE
  - `participant_a_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `participant_b_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Indexes**:
  - `idx_conversations_listing`
- **Relationships**:
  - References `listings` (many-to-one)
  - References `users` (many-to-one, via participant_a_id)
  - References `users` (many-to-one, via participant_b_id)
  - References by `messages.conversation_id` (one-to-many)

#### messages
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `conversation_id` UUID REFERENCES conversations(id) ON DELETE SET NULL
  - `sender_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `recipient_id` UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT
  - `body` TEXT NOT NULL
  - `sent_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
  - `read_at` TIMESTAMP WITH TIME ZONE
  - `created_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Indexes**:
  - `idx_messages_conversation`
  - `idx_messages_sender`
  - `idx_messages_recipient`
  - `idx_messages_sent_at`
- **Relationships**:
  - References `conversations` (many-to-one, optional)
  - References `users` (many-to-one, via sender_id)
  - References `users` (many-to-one, via recipient_id)

### 5. Extensibility / System Tables

#### feature_toggles
- **Primary Key**: `key` VARCHAR(100)
- **Attributes**:
  - `description` TEXT
  - `is_enabled` BOOLEAN NOT NULL DEFAULT FALSE
  - `rollout_percentage` INTEGER CHECK (rollout_percentage BETWEEN 0 AND 100) DEFAULT 0
  - `created_at`, `updated_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()

#### outbox_events
- **Primary Key**: `id` (UUID)
- **Attributes**:
  - `aggregate_type` VARCHAR(50) NOT NULL (e.g., 'Animal', 'Listing', 'UserProfile')
  - `aggregate_id` UUID NOT NULL
  - `event_type` VARCHAR(100) NOT NULL (e.g., 'Animal.Created', 'Listing.Updated')
  - `payload` JSONB NOT NULL
  - `processed_at` TIMESTAMP WITH TIME ZONE
  - `created_at` TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
- **Indexes**:
  - `idx_outbox_unprocessed` (partial: WHERE processed_at IS NULL)

## Triggers

Automatic `updated_at` maintenance via trigger function `update_updated_at_column()` applied to:
- users
- species
- breeds
- cities
- animals
- animal_ownership_history
- listings
- conversations
- messages
- feature_toggles
- outbox_events

## Initial Data

The schema includes initial data for:
- Core species: dog, cat, cattle, sheep, horse
- Sample breeds: Akita, German Shepherd, Persian, Holstein
- Initial cities: Moscow, Saint Petersburg
- Feature toggles (all disabled for MVP): premium_profiles, boosted_listings, vet_leadgen, service_marketplace, health_passport_api, genetics_portal, regulatory_integration

## Key Design Notes

1. **Extensibility**: JSONB columns (`health_records`, `reproductive_data`, `payload`) allow flexible attribute storage without schema changes.

2. **Soft Deletes**: `deactivated_at` columns in users and animals tables support soft deletion patterns.

3. **Geo-Search**: PostGIS GEOGRAPHY type for location-based queries with fallback strategy documented.

4. **Audit Trail**: `animal_ownership_history` provides complete ownership history for regulatory compliance.

5. **Breed Handling**: Supports both directory breeds (`breed_id`) and custom text (`breed_text`) with application-level validation required.

6. **Roles**: Simple role-based access control with USER, MODERATOR, ADMIN roles.

7. **MVP Constraints**: Comments indicate application-level validations needed for:
   - Breed validation: if breed_id IS NULL THEN breed_text IS NOT NULL
   - Immutable fields: species_id, breed_id (if from directory), sex, date_of_birth cannot be changed after creation
   - Ownership changes blocked during MVP phase

## Relationship Summary

**One-to-Many Relationships**:
- species → breeds
- species → animals
- breeds → animals
- users → animals (as owner)
- users → animal_ownership_history (as owner)
- users → listings (as seller)
- users → conversations (as participant_a or participant_b)
- users → messages (as sender or recipient)
- animals → animal_ownership_history
- animals → listings
- listings → listing_photos
- listings → conversations
- conversations → messages

**Many-to-One Relationships** (inverse of above):
- animals → species
- animals → breeds
- animals → users (owner)
- animal_ownership_history → animals
- animal_ownership_history → users (owner)
- listings → animals
- listings → users (seller)
- conversations → listings
- conversations → users (participant_a)
- conversations → users (participant_b)
- messages → conversations
- messages → users (sender)
- messages → users (recipient)

**Self-Referencing**:
- animals → animals (mother_id)
- animals → animals (father_id)

**Optional Relationships**:
- users → cities (for geo-search)
- animals → breeds (nullable for custom breeds)
- animals → mother_id/father_id (pedigree, nullable)
- listings → location_point (geo-search, nullable without PostGIS)
- messages → conversation_id (nullable, set on delete)

This ERD provides a solid foundation for ZooLink's MVP with clear extensibility paths for future professional user features, monetization, and regulatory integration as outlined in the project documentation.