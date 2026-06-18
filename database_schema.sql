-- ZooLink Database Schema fully aligned with documented domain models
-- MVP core with extensibility for future phases.
-- Adjustments made to match conceptual models from animal-domain.md and identity-domain.md
-- UPDATED: Added requested roles (veterinarian, groomer) for Priority 1 completion

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- pg_trgm: fuzzy/partial text search (typo tolerance) for the MVP search (ADR-0009, storage.md). Russian FTS uses the built-in 'russian' config.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Uncomment if PostGIS is available for geography type
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- ========== Reference Data (Admin Domain) ==========
CREATE TABLE species (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL UNIQUE, -- e.g., 'dog', 'cattle'
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE breeds (
    id SERIAL PRIMARY KEY,
    species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL,
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (species_id, code)
);

-- Optional: City directory for geo-search (managed by Admin)
CREATE TABLE cities (
    id SERIAL PRIMARY KEY,
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ========== Organization Domain ==========
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    inn VARCHAR(20), -- Tax ID
    kpp VARCHAR(20), -- Tax registration reason code
    address TEXT,
    phone VARCHAR(30),
    email VARCHAR(255),
    logo_url TEXT,
    name_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb, -- For extensibility (subscription tier, branding preferences, etc.)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);


CREATE TABLE branches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    city_id INTEGER NOT NULL REFERENCES cities(id) ON DELETE RESTRICT,
    address TEXT,
    phone VARCHAR(30),
    email VARCHAR(255),
    name_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    is_headquarters BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE organization_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL, -- FK to users(id) added via ALTER after users table is created (Identity Domain defined later)
    role_in_org VARCHAR(20) NOT NULL CHECK (role_in_org IN ('OWNER', 'ADMIN', 'STAFF', 'VET', 'MODERATOR')),
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at DATE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_organization_user UNIQUE (organization_id, user_id) -- prevent duplicate membership (M:N integrity)
);

-- Indexes for organization domain
CREATE INDEX idx_organizations_inn ON organizations(inn) WHERE inn IS NOT NULL;
CREATE INDEX idx_branches_organization ON branches(organization_id);
CREATE INDEX idx_branches_city ON branches(city_id);
CREATE INDEX idx_organization_users_org ON organization_users(organization_id);
CREATE INDEX idx_organization_users_user ON organization_users(user_id);
CREATE INDEX idx_organization_users_role ON organization_users(role_in_org);

-- ========== Identity Domain ==========
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_hash VARCHAR(60), -- bcrypt hash of phone number (nullable if OAuth-only)
    oauth_google_id VARCHAR(255),
    oauth_apple_id VARCHAR(255),
    oauth_telegram_id VARCHAR(255),
    oauth_vk_id VARCHAR(255),
    full_name VARCHAR(100) NOT NULL,
    city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL, -- for geo-search
    avatar_url TEXT,
    email VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(60), -- bcrypt hash if using phone auth (nullable if OAuth-only)
    role VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'MODERATOR', 'ADMIN', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER')) DEFAULT 'USER',
    -- Principal type: HUMAN or AGENT (ADR-0006). Operator roles (MODERATOR/ADMIN) may be held by an AI agent.
    -- Defaults to HUMAN; agents are inactive until explicitly enabled (feature-flagged).
    principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (principal_type IN ('HUMAN', 'AGENT')),
    -- Lifecycle state machine (spec docs/specs/statemachines/user_state_machine.md)
    status VARCHAR(25) NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (status IN ('UNVERIFIED', 'PENDING_VERIFICATION', 'VERIFIED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED')),
    suspended_at TIMESTAMP WITH TIME ZONE, -- set on transition to SUSPENDED
    verification_attempts INTEGER NOT NULL DEFAULT 0, -- supports MAX_ATTEMPTS transition
    -- Notification opt-in/out preferences (spec 13-notification-domain.md, owned by Identity Domain)
    notification_prefs JSONB NOT NULL DEFAULT '{"email": true, "sms": true, "promo": false}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for identity lookups
CREATE INDEX idx_users_phone_hash ON users(phone_hash) WHERE phone_hash IS NOT NULL;
CREATE INDEX idx_users_oauth_google ON users(oauth_google_id) WHERE oauth_google_id IS NOT NULL;
CREATE INDEX idx_users_oauth_apple ON users(oauth_apple_id) WHERE oauth_apple_id IS NOT NULL;
CREATE INDEX idx_users_oauth_telegram ON users(oauth_telegram_id) WHERE oauth_telegram_id IS NOT NULL;
CREATE INDEX idx_users_oauth_vk ON users(oauth_vk_id) WHERE oauth_vk_id IS NOT NULL;
CREATE INDEX idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_city ON users(city_id);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_agents ON users(principal_type) WHERE principal_type = 'AGENT';

-- Deferred FK: organization_users.user_id -> users(id) (users defined after Organization Domain block)
ALTER TABLE organization_users
    ADD CONSTRAINT fk_organization_users_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT;

-- ========== Animal Domain ==========
CREATE TABLE animals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE RESTRICT, -- nullable if organization_id set
    organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT, -- nullable if owner_id set
    species_id INTEGER NOT NULL REFERENCES species(id) ON DELETE RESTRICT,
    breed_id INTEGER REFERENCES breeds(id) ON DELETE RESTRICT, -- nullable if custom/other; RESTRICT to avoid breaking chk_animals_breed_dep (XOR) on breed deletion
    breed_text_localized JSONB, -- custom breed text if breed_id is null (for moderator review)
    nickname_localized JSONB NOT NULL, -- display name (per animal-domain.md)
    sex VARCHAR(10) NOT NULL CHECK (sex IN ('Male', 'Female')), -- updated to match doc casing
    -- Ensure exactly one of breed_id or breed_text_localized is set
    CONSTRAINT chk_animals_breed_dep CHECK (
        (breed_id IS NOT NULL AND breed_text_localized IS NULL) OR
        (breed_id IS NULL AND breed_text_localized IS NOT NULL)
    ),
    date_of_birth DATE NOT NULL,
    color_coat VARCHAR(100),
    microchip_id VARCHAR(50),
    tattoo_brand_id VARCHAR(50), -- for livestock
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb, -- free text description
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- visible for new listings when true
    health_records JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of {type, detail, date, provider}
    reproductive_data JSONB NOT NULL DEFAULT '[]'::jsonb, -- for females: heat, mating, etc.
    owned_since DATE,
    mother_id UUID REFERENCES animals(id) ON DELETE SET NULL, -- future pedigree
    father_id UUID REFERENCES animals(id) ON DELETE SET NULL,
    -- Breeding attributes for Matching Domain (spec 05-matching-domain.md, UC-MT-02)
    pedigree_id VARCHAR(100), -- external pedigree/registration number
    health_test_results JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of {test, result, date, lab}
    show_titles JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of show/championship titles
    is_visible_in_breeding_search BOOLEAN NOT NULL DEFAULT TRUE, -- UC-MT-02 opt-out of breeding matches
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMP WITH TIME ZONE, -- when deactivated (soft delete)
    -- Ensure exactly one of owner_id or organization_id is set (not both null, not both set)
    CONSTRAINT chk_animal_ownership CHECK (
        (owner_id IS NOT NULL AND organization_id IS NULL) OR
        (owner_id IS NULL AND organization_id IS NOT NULL)
    )
);
COMMENT ON COLUMN animals.owned_since IS 'Дата, когда текущий владелец приобрел животное';
COMMENT ON COLUMN animals.mother_id IS 'Ссылка на мать для отслеживания pedigree';
COMMENT ON COLUMN animals.father_id IS 'Ссылка на отца для отслеживания pedigree';
COMMENT ON COLUMN animals.deactivated_at IS 'Отметка времени, когда животное было деактивировано (мягкое удаление)';

-- Indexes for animal search and integrity
CREATE INDEX idx_animals_owner ON animals(owner_id);
CREATE INDEX idx_animals_species_breed ON animals(species_id, breed_id);
CREATE INDEX idx_animals_microchip ON animals(microchip_id) WHERE microchip_id IS NOT NULL;
CREATE INDEX idx_animals_tattoo ON animals(tattoo_brand_id) WHERE tattoo_brand_id IS NOT NULL;
-- GIN indexes for JSONB querying
CREATE INDEX idx_animals_health_records ON animals USING GIN (health_records);
CREATE INDEX idx_animals_reproductive_data ON animals USING GIN (reproductive_data);
-- For searching by custom breed text
CREATE INDEX idx_animals_breed_text ON animals(breed_text_localized);
-- For active animal queries
CREATE INDEX idx_animals_active ON animals(is_active) WHERE is_active = true;
-- For ownership date range
CREATE INDEX idx_animals_owned_since ON animals(owned_since);
-- For breeding search visibility (Matching Domain)
CREATE INDEX idx_animals_breeding_visible ON animals(is_visible_in_breeding_search) WHERE is_visible_in_breeding_search = true;
-- Pedigree traversal (recursive CTE over parents) and ON DELETE SET NULL need these FK indexes
CREATE INDEX idx_animals_mother ON animals(mother_id) WHERE mother_id IS NOT NULL;
CREATE INDEX idx_animals_father ON animals(father_id) WHERE father_id IS NOT NULL;

-- ========== Ownership History (For traceability, regulatory) ==========
CREATE TABLE animal_ownership_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT, -- RESTRICT: preserve ownership trail (regulatory/traceability) even if animal removed
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE,
    transfer_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_aoh_animal ON animal_ownership_history(animal_id);
CREATE INDEX idx_aoh_owner ON animal_ownership_history(owner_id);
CREATE INDEX idx_aoh_dates ON animal_ownership_history(start_date, end_date);

-- ========== Marketplace/Listings Domain ==========
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL, -- nullable for personal listings
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL, -- nullable for personal listings or when branch not specified
    metadata JSONB DEFAULT '{}'::jsonb, -- For experimental attributes (social media links, video URL placeholder, etc.)
    listing_type VARCHAR(20) NOT NULL CHECK (listing_type IN ('sale', 'breeding', 'show', 'adoption', 'stud_service')),
    title_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    price_cents BIGINT, -- minor units (kopecks); BIGINT to accommodate high-value livestock. Nullable for non-price listings (e.g., breeding)
    currency CHAR(3) DEFAULT 'RUB',
    quantity INTEGER DEFAULT 1,
    -- Lifecycle state machine (spec docs/specs/statemachines/listing_state_machine.md)
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'PENDING_MODERATION', 'ACTIVE', 'EXPIRED', 'SOLD', 'DEACTIVATED')),
    -- Moderation state (spec docs/specs/12-moderation-domain.md)
    moderation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (moderation_status IN ('PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED')),
    published_at TIMESTAMP WITH TIME ZONE, -- set on transition to ACTIVE
    sold_at TIMESTAMP WITH TIME ZONE, -- set on transition to SOLD
    transaction_id UUID, -- FK to payment_transactions(id) added via ALTER after Payment Domain
    -- Geo location: lat/lng is MVP primary (per 07-geo-search-service.md); optional PostGIS
    -- column `location_point GEOGRAPHY(POINT,4326)` is added conditionally in the geo block below.
    lat DOUBLE PRECISION, -- MVP primary storage (Haversine + bounding box)
    lng DOUBLE PRECISION,
    search_radius_m INTEGER, -- meters for radius search
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_listings_latlng CHECK (
        (lat IS NULL AND lng IS NULL) OR
        (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
    ),
    -- For organizational listings: either organization_id or branch_id must be set (or both)
    -- For personal listings: both organization_id and branch_id must be NULL
    CONSTRAINT chk_listing_ownership CHECK (
        (organization_id IS NULL AND branch_id IS NULL) OR  -- Personal listing
        (organization_id IS NOT NULL)  -- Organizational listing (branch_id optional)
        -- Additionally: branch_id IS NOT NULL => organization_id IS NOT NULL
    )
);


CREATE TABLE listing_photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    order_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    participant_a_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    participant_b_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    recipient_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    body TEXT NOT NULL,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for listings
CREATE INDEX idx_listings_animal ON listings(animal_id);
CREATE INDEX idx_listings_seller ON listings(seller_id);
CREATE INDEX idx_listings_type_active ON listings(listing_type, is_active) WHERE is_active = true;
CREATE INDEX idx_listings_price ON listings(price_cents) WHERE price_cents IS NOT NULL;
CREATE INDEX idx_listings_status ON listings(status);
CREATE INDEX idx_listings_moderation_status ON listings(moderation_status);
-- At most one ACTIVE listing of a given type per animal (prevents duplicate active listings;
-- still allows e.g. an active 'sale' and an active 'stud_service' on the same animal)
CREATE UNIQUE INDEX uq_active_listing_per_type ON listings(animal_id, listing_type) WHERE status = 'ACTIVE';
-- Geo: always index lat/lng (MVP primary). If PostGIS is enabled, also add the GEOGRAPHY column + GiST index.
CREATE INDEX idx_listings_latlng ON listings(lat, lng) WHERE lat IS NOT NULL;
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM pg_extension WHERE extname = 'postgis') > 0 THEN
        EXECUTE 'ALTER TABLE listings ADD COLUMN IF NOT EXISTS location_point GEOGRAPHY(POINT, 4326)';
        EXECUTE 'CREATE INDEX idx_listings_location ON listings USING GIST (location_point) WHERE location_point IS NOT NULL';
    ELSE
        RAISE NOTICE 'PostGIS not found; using lat/lng columns + btree index (MVP Haversine path).';
    END IF;
END $$;
-- Plain index on expires_at (cannot use WHERE expires_at > NOW(): NOW() is not IMMUTABLE in an index predicate)
CREATE INDEX idx_listings_expires ON listings(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX idx_listing_photos_listing ON listing_photos(listing_id);
CREATE INDEX idx_conversations_listing ON conversations(listing_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_recipient ON messages(recipient_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);
-- Composite index for paginated message feed per conversation
CREATE INDEX idx_messages_conversation_sent ON messages(conversation_id, sent_at);

-- ========== Favorites (MVP, spec docs/specs/03-pet-marketplace-domain.md) ==========
-- A user's saved/favorited listings.
CREATE TABLE favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_favorite_user_listing UNIQUE (user_id, listing_id)
);
CREATE INDEX idx_favorites_user ON favorites(user_id);
CREATE INDEX idx_favorites_listing ON favorites(listing_id);

-- ========== Saved Searches (MVP; alerts deferred to Phase 2 — UC-GS-03) ==========
CREATE TABLE saved_searches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100),
    filters JSONB NOT NULL DEFAULT '{}'::jsonb, -- species/breed/price/listing_type/etc.
    lat DOUBLE PRECISION,
    lng DOUBLE PRECISION,
    radius_m INTEGER,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_saved_searches_latlng CHECK (
        (lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180)
    )
);
CREATE INDEX idx_saved_searches_user ON saved_searches(user_id);

-- ========== Moderation Domain (spec docs/specs/12-moderation-domain.md) ==========
-- Predefined, Admin-configurable reason codes (12-moderation:48,66)
CREATE TABLE moderation_reasons (
    code VARCHAR(50) PRIMARY KEY,
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    applies_to VARCHAR(20) NOT NULL DEFAULT 'ANY' CHECK (applies_to IN ('LISTING', 'ANIMAL', 'ANY')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Append-only audit trail of moderation decisions (12-moderation:40 immutability requirement)
CREATE TABLE moderation_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('LISTING', 'ANIMAL')),
    entity_id UUID NOT NULL, -- polymorphic ref (listings.id or animals.id); not a hard FK by design
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED')),
    reason VARCHAR(50) REFERENCES moderation_reasons(code) ON DELETE RESTRICT,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    -- NOTE: no updated_at — append-only. UPDATE/DELETE blocked by trigger below.
);
CREATE INDEX idx_moddec_entity ON moderation_decisions(entity_type, entity_id);
CREATE INDEX idx_moddec_moderator ON moderation_decisions(moderator_id, created_at);

-- Immutability guard: moderation_decisions is append-only
CREATE OR REPLACE FUNCTION trg_block_modify_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION '% is append-only; UPDATE/DELETE is not allowed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_moderation_decisions_immutable
BEFORE UPDATE OR DELETE ON moderation_decisions
FOR EACH ROW EXECUTE FUNCTION trg_block_modify_append_only();

-- User-submitted reports/flags on content (MVP; feeds moderation queue) — 06-admin:87
CREATE TABLE content_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID REFERENCES users(id) ON DELETE SET NULL, -- keep report if reporter deleted
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('LISTING', 'ANIMAL', 'USER', 'MESSAGE')),
    entity_id UUID NOT NULL,
    reason VARCHAR(50) NOT NULL, -- e.g., SPAM, ABUSE, FRAUD, INAPPROPRIATE
    notes TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN'
        CHECK (status IN ('OPEN', 'REVIEWED', 'DISMISSED', 'ACTIONED')),
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL, -- moderator who handled it
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_content_reports_entity ON content_reports(entity_type, entity_id);
CREATE INDEX idx_content_reports_status ON content_reports(status);
CREATE INDEX idx_content_reports_reporter ON content_reports(reporter_id) WHERE reporter_id IS NOT NULL;

-- ========== Payment Domain (spec docs/specs/14-payment-domain.md) ==========
CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    gateway_transaction_id VARCHAR(255), -- external PSP reference
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0), -- minor units (kopecks); NEVER FLOAT
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'DISPUTED')),
    purpose_type VARCHAR(40) NOT NULL, -- e.g., ListingPromotion, PremiumSubscription
    purpose_id UUID, -- entity the payment relates to (e.g., listings.id)
    idempotency_key VARCHAR(255) UNIQUE, -- 14-payment:78 idempotent gateway calls
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_paytx_user ON payment_transactions(user_id);
CREATE INDEX idx_paytx_purpose ON payment_transactions(purpose_type, purpose_id);
CREATE INDEX idx_paytx_status ON payment_transactions(status);

CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_transaction_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
    gateway_refund_id VARCHAR(255),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refunds_paytx ON refunds(payment_transaction_id);

-- Deferred FK: listings.transaction_id -> payment_transactions(id)
ALTER TABLE listings
    ADD CONSTRAINT fk_listings_transaction
    FOREIGN KEY (transaction_id) REFERENCES payment_transactions(id) ON DELETE SET NULL;

-- ========== Notification Domain (spec docs/specs/13-notification-domain.md) ==========
CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('EMAIL', 'SMS')),
    subject_template TEXT, -- nullable for SMS
    body_template TEXT NOT NULL,
    language CHAR(2) NOT NULL, -- FK to supported_languages(code) added via ALTER (table defined later)
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (name, type, language)
);

CREATE TABLE notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('EMAIL', 'SMS')),
    template_id UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
    recipient VARCHAR(255) NOT NULL,
    content TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SENT'
        CHECK (status IN ('SENT', 'DELIVERED', 'FAILED', 'BOUNCED')),
    provider_response JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notiflog_user ON notification_logs(user_id);
CREATE INDEX idx_notiflog_status ON notification_logs(status);

-- ========== Ownership Transfer (spec docs/specs/statemachines/ownership_transfer_state_machine.md) ==========
-- Process entity for the transfer state machine (distinct from animal_ownership_history, which is the settled log).
-- NOTE: animal ownership changes are locked during MVP (see trg_animals_immutable_and_owner); this table
-- supports the documented post-MVP transfer workflow.
CREATE TABLE ownership_transfers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE RESTRICT,
    from_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    to_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED')),
    from_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    to_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    payment_confirmed BOOLEAN NOT NULL DEFAULT FALSE, -- guard for ownership_transfer_state_machine
    failure_reason TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_owntransfer_animal ON ownership_transfers(animal_id);
CREATE INDEX idx_owntransfer_status ON ownership_transfers(status);

-- ========== Digital Assets / NFT readiness (ADR-0010) ==========
-- Schema hook only: no minting/contracts/indexer in MVP. Behavior gated by feature_toggles ('digital_assets').
-- PostgreSQL stays the source of truth; on-chain is a verifiable mirror. No owner PII in on-chain metadata.
CREATE TABLE digital_assets (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id        UUID REFERENCES animals(id) ON DELETE RESTRICT,
    asset_type       VARCHAR(30) NOT NULL CHECK (asset_type IN ('PEDIGREE', 'CERTIFICATE', 'OWNERSHIP')),
    chain            VARCHAR(20) NOT NULL DEFAULT 'TON' CHECK (chain IN ('TON', 'POLYGON')),
    contract_address VARCHAR(120),
    token_id         VARCHAR(120),
    ipfs_cid         VARCHAR(120),
    metadata_uri     TEXT,
    tx_hash          VARCHAR(120),
    mint_status      VARCHAR(20) NOT NULL DEFAULT 'NONE'
                     CHECK (mint_status IN ('NONE', 'PENDING', 'MINTED', 'TRANSFERRED', 'FAILED')),
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_digital_assets_animal ON digital_assets(animal_id);
-- At most one live token per (animal, asset_type)
CREATE UNIQUE INDEX uq_digital_asset_per_type ON digital_assets(animal_id, asset_type)
    WHERE mint_status IN ('PENDING', 'MINTED', 'TRANSFERRED');

-- ========== Extensibility / System Tables ==========
CREATE TABLE feature_toggles (
    key VARCHAR(100) PRIMARY KEY,
    description TEXT,
    is_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    rollout_percentage INTEGER CHECK (rollout_percentage BETWEEN 0 AND 100) DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    aggregate_type VARCHAR(50) NOT NULL, -- e.g., 'Animal', 'Listing', 'UserProfile'
    aggregate_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL, -- e.g., 'Animal.Created', 'Listing.Updated'
    payload JSONB NOT NULL,
    processed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_outbox_unprocessed ON outbox_events(processed_at) WHERE processed_at IS NULL;

-- ========== Triggers for updated_at ==========
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('users', 'species', 'breeds', 'cities', 'organizations', 'branches', 'organization_users',
                            'animals', 'animal_ownership_history', 'listings', 'conversations',
                            'messages', 'feature_toggles', 'outbox_events',
                            'payment_transactions', 'refunds', 'notification_templates',
                            'notification_logs', 'ownership_transfers',
                            'saved_searches', 'content_reports')
    LOOP
        EXECUTE format('
            CREATE TRIGGER update_%I_updated_at
            BEFORE UPDATE ON %I
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
        ', tbl, tbl);
    END LOOP;
END $$;

-- ========== Initial Data (examples) ==========
-- Insert core species and breeds
INSERT INTO species (code, name_ru, name_en) VALUES
('dog', 'Собака', 'Dog'),
('cat', 'Кошка', 'Cat'),
('cattle', 'Крупный рогатый скот', 'Cattle'),
('sheep', 'Овца', 'Sheep'),
('horse', 'Лошадь', 'Horse')
ON CONFLICT (code) DO NOTHING;

INSERT INTO breeds (species_id, code, name_ru, name_en)
SELECT s.id, 'akita', 'Акита', 'Akita' FROM species s WHERE s.code = 'dog'
UNION ALL
SELECT s.id, 'german_shepherd', 'Немецкая овчарка', 'German Shepherd' FROM species s WHERE s.code = 'dog'
UNION ALL
SELECT s.id, 'persian', 'Персидская', 'Persian' FROM species s WHERE s.code = 'cat'
UNION ALL
SELECT s.id, 'holmstein', 'Голштинская', 'Holstein' FROM species s WHERE s.code = 'cattle'
ON CONFLICT (species_id, code) DO NOTHING;

-- Initial cities (optional)
INSERT INTO cities (name_ru, name_en) VALUES
('Москва', 'Moscow'),
('Санкт-Петербург', 'Saint Petersburg')
ON CONFLICT DO NOTHING;

-- Initial feature toggles (MVP: everything off except core)
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage) VALUES
('premium_profiles', 'Включить премиум‑профили с расширенной галереей и аналитикой', false, 0),
('payments', 'Внутриплатёжные платежи (продвижение, premium и т.п.) — таблицы Payment-домена определены, но выключены до пост-MVP', false, 0),
('digital_assets', 'NFT / токенизация цифровых активов (ADR-0010). Выключено до Фазы 2+.', false, 0),
('boosted_listings', 'Платное продвижение объявлений в поиске', false, 0),
('vet_leadgen', 'Генерация лидов для ветеринарных клиник', false, 0),
('service_marketplace', 'Рынок услуг (ветеринары, тренеры, перевозчики)', false, 0),
('health_passport_api', 'Доступ к цифровому паспорту здоровья через API', false, 0),
('genetics_portal', 'Портал генетики и ДНК‑тестов', false, 0),
('regulatory_integration', 'Интеграция с Меркурий/ВетИС для отслеживания перемещения скота', false, 0)
ON CONFLICT (key) DO NOTHING;

-- ========== Application-level validations ==========
-- breed_id / breed_text dependency is enforced by chk_animals_breed_dep (XOR) on the animals table.
-- (Removed the broken chk_animals_breed CHECK: it referenced a non-existent column `breed_text`
--  and duplicated/conflicted with chk_animals_breed_dep.)

-- Immutable fields after creation & MVP ownership lock
CREATE OR REPLACE FUNCTION trg_animals_immutable_and_owner()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Immutable fields
        IF OLD.species_id IS DISTINCT FROM NEW.species_id THEN
            RAISE EXCEPTION 'species_id cannot be changed after creation.';
        END IF;
        IF OLD.sex IS DISTINCT FROM NEW.sex THEN
            RAISE EXCEPTION 'sex cannot be changed after creation.';
        END IF;
        IF OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth THEN
            RAISE EXCEPTION 'date_of_birth cannot be changed after creation.';
        END IF;
        IF OLD.breed_id IS DISTINCT FROM NEW.breed_id THEN
            RAISE EXCEPTION 'breed_id cannot be changed after creation.';
        END IF;

        -- MVP ownership lock
        IF OLD.owner_id IS DISTINCT FROM NEW.owner_id THEN
            RAISE EXCEPTION 'Changing ownership is not allowed during MVP phase.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_animals_immutable_and_owner ON animals;
CREATE TRIGGER trg_animals_immutable_and_owner
BEFORE UPDATE ON animals
FOR EACH ROW
EXECUTE FUNCTION trg_animals_immutable_and_owner();

COMMENT ON TABLE species IS 'Справочник видов животных.';
COMMENT ON TABLE breeds IS 'Справочник пород, связанный со species.';
COMMENT ON TABLE cities IS 'Справочник городов для геопоиска.';
COMMENT ON TABLE users IS 'Пользователи системы; аутентификация через телефон (SMS) или OAuth.';
COMMENT ON TABLE animals IS 'Основная сущность животного; агрегат‑корень Animal Domain.';
COMMENT ON TABLE animal_ownership_history IS 'Журнал смены владельца для ветеринарного и регуляторного учета.';
COMMENT ON TABLE listings IS 'Объявления о продаже, разведении, показе или усыновлении животных.';
COMMENT ON TABLE listing_photos IS 'Фотографии, привязанные к объявлению.';
COMMENT ON TABLE conversations IS 'Диалог между двумя пользователями по конкретному объявлению.';
COMMENT ON TABLE messages IS 'Сообщения внутри диалога.';
COMMENT ON TABLE feature_toggles IS 'Переключатели функций для поэтапного включения платных/экспериментальных возможностей.';
COMMENT ON TABLE outbox_events IS 'Таблица исходящих событий для надежной интеграции с внешними системами (pattern Outbox).';

-- Column comments for organizations
COMMENT ON COLUMN organizations.id IS 'Первичный ключ';
COMMENT ON COLUMN organizations.name_localized IS 'Локализованное название организации (JSONB, ключи en/ru/...)';
COMMENT ON COLUMN organizations.description_localized IS 'Локализованное описание организации (JSONB)';
COMMENT ON COLUMN organizations.inn IS 'ИНН (Идентификатор налогоплательщика)';
COMMENT ON COLUMN organizations.kpp IS 'КПП (Код причины постановки на учет)';
COMMENT ON COLUMN organizations.address IS 'Адрес головного офиса';
COMMENT ON COLUMN organizations.phone IS 'Контактный телефон';
COMMENT ON COLUMN organizations.email IS 'Контактный email';
COMMENT ON COLUMN organizations.logo_url IS 'URL логотипа организации';
COMMENT ON COLUMN organizations.metadata IS 'JSONB поле для расширяемых атрибутов (уровень подписки, предпочтения брендинга и т.д.)';
COMMENT ON COLUMN organizations.is_active IS 'Флаг активности организации';
COMMENT ON COLUMN organizations.created_at IS 'Время создания записи';
COMMENT ON COLUMN organizations.updated_at IS 'Время последнего обновления';

-- Column comments for branches
COMMENT ON COLUMN branches.id IS 'Первичный ключ';
COMMENT ON COLUMN branches.organization_id IS 'Внешний ключ к организации';
COMMENT ON COLUMN branches.city_id IS 'Внешний ключ к городу для гео-поиска';
COMMENT ON COLUMN branches.address IS 'Подробный адрес филиала';
COMMENT ON COLUMN branches.phone IS 'Телефон филиала';
COMMENT ON COLUMN branches.email IS 'Email филиала';
COMMENT ON COLUMN branches.name_localized IS 'Локализованное название филиала (JSONB)';
COMMENT ON COLUMN branches.description_localized IS 'Локализованное описание филиала (JSONB)';
COMMENT ON COLUMN branches.is_headquarters IS 'Флаг, указывающий головной офис организации';
COMMENT ON COLUMN branches.is_active IS 'Флаг активности филиала';
COMMENT ON COLUMN branches.created_at IS 'Время создания записи';
COMMENT ON COLUMN branches.updated_at IS 'Время последнего обновления';

-- Column comments for organization_users
COMMENT ON COLUMN organization_users.id IS 'Первичный ключ';
COMMENT ON COLUMN organization_users.organization_id IS 'Внешний ключ к организации';
COMMENT ON COLUMN organization_users.user_id IS 'Внешний ключ к пользователю';
COMMENT ON COLUMN organization_users.role_in_org IS 'Роль пользователя в организации: OWNER, ADMIN, STAFF, VET, MODERATOR';
COMMENT ON COLUMN organization_users.is_primary IS 'Флаг основной организации для уведомлений';
COMMENT ON COLUMN organization_users.joined_at IS 'Дата присоединения пользователя к организации';
COMMENT ON COLUMN organization_users.created_at IS 'Время создания записи';
COMMENT ON COLUMN organization_users.updated_at IS 'Время последнего обновления';

-- Note: Application-level validations required per documentation:
-- 1. Validate breed_id/breed_text: if breed_id IS NULL THEN breed_text IS NOT NULL
-- 2. Validate animal ownership: Exactly one of owner_id or organization_id must be set (not both null, not both set)
-- 3. Prevent changes to immutable fields after creation: species_id, breed_id (if from directory), sex, date_of_birth
-- 4. Block ownership changes during MVP phase (documented: "Changing ownership is not allowed on MVP")

-- ========== Localization Support (added enhancement) ==========

-- Таблица поддерживаемых языков для централизованного управления
CREATE TABLE supported_languages (
    code CHAR(2) PRIMARY KEY,  -- ISO 639-1 код языка
    name_localized JSONB NOT NULL,  -- локализованное название языка
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Функция для получения перевода на указанном языке с fallback
CREATE OR REPLACE FUNCTION get_localized(
    data JSONB,
    lang TEXT DEFAULT current_setting('app.current_language', true),
    fallback_lang TEXT DEFAULT 'en'
) RETURNS TEXT AS $$
BEGIN
    RETURN COALESCE(
        data->>lang,
        data->>fallback_lang,
        ''  -- окончательный fallback
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Функция для проверки наличия перевода
CREATE OR REPLACE FUNCTION has_translation(
    data JSONB,
    lang TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    RETURN (data->>lang) IS NOT NULL AND (data->>lang) <> '';
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Функция для установки текущего языка приложения (для удобства)
CREATE OR REPLACE FUNCTION set_app_language(lang_code TEXT)
RETURNS VOID AS $$
BEGIN
    PERFORM set_config('app.current_language', lang_code, true);
END;
$$ LANGUAGE plpgsql;

-- Пример данных для поддерживаемых языков
INSERT INTO supported_languages (code, name_localized, is_active, display_order) VALUES
('ru', '{"ru": "Русский", "en": "Russian"}', true, 1),
('en', '{"ru": "Английский", "en": "English"}', true, 2),
('fr', '{"ru": "Французский", "en": "French"}', false, 3),
('es', '{"ru": "Испанский", "en": "Spanish"}', false, 4),
('zh', '{"ru": "Китайский", "en": "Chinese"}', false, 5)
ON CONFLICT (code) DO NOTHING;

-- Индексы для улучшенного поиска по переводам
-- Создаем индексы для наиболее часто используемых полей и языков

-- Для организаций
CREATE INDEX IF NOT EXISTS idx_organizations_name_localized_en
ON organizations USING GIN ((name_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_organizations_name_localized_ru
ON organizations USING GIN ((name_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_organizations_description_localized_en
ON organizations USING GIN ((description_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_organizations_description_localized_ru
ON organizations USING GIN ((description_localized -> 'ru'));

-- Для филиалов
CREATE INDEX IF NOT EXISTS idx_branches_name_localized_en
ON branches USING GIN ((name_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_branches_name_localized_ru
ON branches USING GIN ((name_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_branches_description_localized_en
ON branches USING GIN ((description_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_branches_description_localized_ru
ON branches USING GIN ((description_localized -> 'ru'));

-- Для животных
CREATE INDEX IF NOT EXISTS idx_animals_nickname_localized_en
ON animals USING GIN ((nickname_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_animals_nickname_localized_ru
ON animals USING GIN ((nickname_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_animals_breed_text_localized_en
ON animals USING GIN ((breed_text_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_animals_breed_text_localized_ru
ON animals USING GIN ((breed_text_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_animals_description_localized_en
ON animals USING GIN ((description_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_animals_description_localized_ru
ON animals USING GIN ((description_localized -> 'ru'));

-- Для объявлений
CREATE INDEX IF NOT EXISTS idx_listings_title_localized_en
ON listings USING GIN ((title_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_listings_title_localized_ru
ON listings USING GIN ((title_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_listings_description_localized_en
ON listings USING GIN ((description_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_listings_description_localized_ru
ON listings USING GIN ((description_localized -> 'ru'));

-- ========== MVP full-text & fuzzy search (ADR-0009, storage.md) ==========
-- Russian-morphology FTS on listing titles/descriptions (ru + en). The GIN indexes above match a JSONB key;
-- these support actual word search via to_tsvector. pg_trgm indexes add typo/partial tolerance.
CREATE INDEX IF NOT EXISTS idx_listings_fts_title_ru
ON listings USING GIN (to_tsvector('russian', coalesce(title_localized ->> 'ru', '')));
CREATE INDEX IF NOT EXISTS idx_listings_fts_desc_ru
ON listings USING GIN (to_tsvector('russian', coalesce(description_localized ->> 'ru', '')));
CREATE INDEX IF NOT EXISTS idx_listings_fts_title_en
ON listings USING GIN (to_tsvector('english', coalesce(title_localized ->> 'en', '')));
-- Trigram (fuzzy) on the most-searched text: listing title (ru) and animal nickname (ru)
CREATE INDEX IF NOT EXISTS idx_listings_trgm_title_ru
ON listings USING GIN ((coalesce(title_localized ->> 'ru', '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_animals_trgm_nickname_ru
ON animals USING GIN ((coalesce(nickname_localized ->> 'ru', '')) gin_trgm_ops);

COMMENT ON TABLE supported_languages IS 'Таблица поддерживаемых языков для локализации интерфейса и контента';
COMMENT ON COLUMN supported_languages.code IS 'Код языка по ISO 639-1 (например, ru, en, fr)';
COMMENT ON COLUMN supported_languages.name_localized IS 'Локализованное название самого языка в формате JSONB';
COMMENT ON COLUMN supported_languages.is_active IS 'Флаг активности языка (доступен для выбора пользователями)';
COMMENT ON COLUMN supported_languages.display_order IS 'Порядок отображения в списках языков';
COMMENT ON COLUMN supported_languages.created_at IS 'Дата добавления языка в систему';

COMMENT ON FUNCTION get_localized(jsonb, text, text) IS 'Получить локализованное значение с fallback механизмом. Принимает JSONB с переводами, код желаемого языка и код языка fallback.';
COMMENT ON FUNCTION has_translation(jsonb, text) IS 'Проверить наличие неперевода для указанного языка. Возвращает true если перевод существует и не пустой.';
COMMENT ON FUNCTION set_app_language(text) IS 'Установить текущий язык приложения для текущей сессии. Используется функцией get_localized для определения языка по умолчанию.';

-- ========== Deferred FKs (targets defined later in the script) ==========
-- notification_templates.language -> supported_languages(code)
ALTER TABLE notification_templates
    ADD CONSTRAINT fk_notification_templates_language
    FOREIGN KEY (language) REFERENCES supported_languages(code) ON DELETE RESTRICT;

-- ========== Business-logic invariants (audit round 3; mirrored in migration 0004) ==========
-- Listing: ACTIVE requires moderation_status APPROVED (pre-moderation gate, ADR-0003)
CREATE OR REPLACE FUNCTION enforce_listing_active_requires_approval() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'ACTIVE' AND NEW.moderation_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Listing % cannot be ACTIVE unless moderation_status = APPROVED (got %)',
            NEW.id, NEW.moderation_status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_listing_active_requires_approval ON listings;
CREATE TRIGGER trg_listing_active_requires_approval
    BEFORE INSERT OR UPDATE ON listings
    FOR EACH ROW EXECUTE FUNCTION enforce_listing_active_requires_approval();

-- Animal: microchip / tattoo uniqueness (anti-fraud; replaces the non-unique indexes above)
DROP INDEX IF EXISTS idx_animals_microchip;
DROP INDEX IF EXISTS idx_animals_tattoo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_animals_microchip ON animals(microchip_id) WHERE microchip_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_animals_tattoo    ON animals(tattoo_brand_id) WHERE tattoo_brand_id IS NOT NULL;

-- Listing value checks
ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_price_nonneg;
ALTER TABLE listings ADD  CONSTRAINT chk_listings_price_nonneg CHECK (price_cents IS NULL OR price_cents >= 0);
ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_quantity_pos;
ALTER TABLE listings ADD  CONSTRAINT chk_listings_quantity_pos CHECK (quantity IS NULL OR quantity >= 1);
ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_currency_iso;
ALTER TABLE listings ADD  CONSTRAINT chk_listings_currency_iso CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

-- Animal nickname must carry at least one non-empty language (en or ru)
ALTER TABLE animals DROP CONSTRAINT IF EXISTS chk_animals_nickname_lang;
ALTER TABLE animals ADD  CONSTRAINT chk_animals_nickname_lang CHECK (
    coalesce(nullif(trim(nickname_localized ->> 'en'), ''), nullif(trim(nickname_localized ->> 'ru'), '')) IS NOT NULL
);

-- ========== Contact exchange (MVP, no chat — ADR-0005; mirrored in migration 0005) ==========
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_phone    VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_telegram VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_prefs    JSONB NOT NULL
    DEFAULT '{"show_phone": true, "show_telegram": false}'::jsonb;

CREATE TABLE IF NOT EXISTS contact_reveals (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    viewer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_reveals_viewer_time ON contact_reveals(viewer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_reveals_listing ON contact_reveals(listing_id);
COMMENT ON TABLE contact_reveals IS 'Audit + rate-limit source for seller-contact reveals (ADR-0005, no-chat MVP).';
COMMENT ON TABLE conversations IS 'Фаза 2+ only — chat is out of MVP (ADR-0005). Reserved schema; unused by MVP backend.';
COMMENT ON TABLE messages IS 'Фаза 2+ only — chat is out of MVP (ADR-0005). Reserved schema; unused by MVP backend.';

-- ========== Integrity & cascades (audit round 3, P1; mirrored in migration 0006) ==========
-- Reproductive status for breeding eligibility (matching domain)
ALTER TABLE animals ADD COLUMN IF NOT EXISTS reproductive_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (reproductive_status IN ('INTACT', 'NEUTERED', 'UNKNOWN'));

-- breed must belong to the animal's species (composite FK; NULL breed_id allowed via MATCH SIMPLE)
ALTER TABLE animals DROP CONSTRAINT IF EXISTS fk_animals_breed_species;
ALTER TABLE breeds  DROP CONSTRAINT IF EXISTS uq_breeds_id_species;
ALTER TABLE breeds  ADD  CONSTRAINT uq_breeds_id_species UNIQUE (id, species_id);
ALTER TABLE animals ADD  CONSTRAINT fk_animals_breed_species
    FOREIGN KEY (breed_id, species_id) REFERENCES breeds(id, species_id) ON DELETE RESTRICT;

-- Content report dedup: one OPEN report per (reporter, entity)
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_report_per_reporter_entity
    ON content_reports(reporter_id, entity_type, entity_id) WHERE status = 'OPEN';

-- Deactivation cascades to live listings
CREATE OR REPLACE FUNCTION cascade_animal_deactivation() RETURNS trigger AS $$
BEGIN
    IF NEW.deactivated_at IS NOT NULL AND OLD.deactivated_at IS NULL THEN
        UPDATE listings SET status = 'DEACTIVATED', updated_at = now()
         WHERE animal_id = NEW.id AND status NOT IN ('DEACTIVATED', 'SOLD', 'EXPIRED');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cascade_animal_deactivation ON animals;
CREATE TRIGGER trg_cascade_animal_deactivation AFTER UPDATE ON animals
    FOR EACH ROW EXECUTE FUNCTION cascade_animal_deactivation();

CREATE OR REPLACE FUNCTION cascade_user_deactivation() RETURNS trigger AS $$
BEGIN
    IF NEW.deactivated_at IS NOT NULL AND OLD.deactivated_at IS NULL THEN
        UPDATE listings SET status = 'DEACTIVATED', updated_at = now()
         WHERE seller_id = NEW.id AND status NOT IN ('DEACTIVATED', 'SOLD', 'EXPIRED');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_cascade_user_deactivation ON users;
CREATE TRIGGER trg_cascade_user_deactivation AFTER UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION cascade_user_deactivation();

-- Pet/livestock hard split: a species belongs to exactly one market (ADR-0002; mirrored in migration 0007)
ALTER TABLE species ADD COLUMN IF NOT EXISTS market VARCHAR(10) NOT NULL DEFAULT 'pet'
    CHECK (market IN ('pet', 'livestock'));
UPDATE species SET market = 'livestock'
 WHERE code IN ('cattle', 'cow', 'bull', 'sheep', 'goat', 'pig', 'horse', 'poultry', 'chicken');

-- ========== Round-4 integrity (org / identity / pedigree / governance; mirrored in migration 0008) ==========
-- Organization lifecycle + invariants
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS status VARCHAR(25) NOT NULL DEFAULT 'PENDING_VERIFICATION'
    CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'ARCHIVED'));
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verified_at  TIMESTAMP WITH TIME ZONE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMP WITH TIME ZONE;
DROP INDEX IF EXISTS idx_organizations_inn;
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_inn ON organizations(inn) WHERE inn IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_branch_one_hq ON branches(organization_id) WHERE is_headquarters;
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('PENDING_INVITE', 'ACTIVE', 'REVOKED', 'EXPIRED'));
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS invitation_token      VARCHAR(100);
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE organization_users ADD COLUMN IF NOT EXISTS invited_by_user_id    UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE organization_users DROP CONSTRAINT IF EXISTS chk_org_user_role;
ALTER TABLE organization_users ADD  CONSTRAINT chk_org_user_role CHECK (role_in_org IN ('OWNER', 'ADMIN', 'STAFF', 'VET'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_user_primary ON organization_users(user_id) WHERE is_primary;

-- Identity uniqueness + session model
DROP INDEX IF EXISTS idx_users_phone_hash;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_phone_hash     ON users(phone_hash)       WHERE phone_hash IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_google   ON users(oauth_google_id)  WHERE oauth_google_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_apple    ON users(oauth_apple_id)   WHERE oauth_apple_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_telegram ON users(oauth_telegram_id) WHERE oauth_telegram_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_oauth_vk       ON users(oauth_vk_id)      WHERE oauth_vk_id IS NOT NULL;
COMMENT ON COLUMN users.phone_hash IS 'Deterministic HMAC-SHA256(phone, server_pepper) for unique lookup — NOT bcrypt (per-row salt would defeat uniqueness).';

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   VARCHAR(255) NOT NULL UNIQUE,
    family_id    UUID NOT NULL,
    device_label VARCHAR(120),
    issued_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at   TIMESTAMP WITH TIME ZONE NOT NULL,
    rotated_from UUID,
    revoked_at   TIMESTAMP WITH TIME ZONE
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_family ON refresh_tokens(family_id);

-- Animal: relaxed breed normalization + org-ownership MVP lock
CREATE OR REPLACE FUNCTION trg_animals_immutable_and_owner()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF OLD.species_id IS DISTINCT FROM NEW.species_id THEN
            RAISE EXCEPTION 'species_id cannot be changed after creation.';
        END IF;
        IF OLD.sex IS DISTINCT FROM NEW.sex THEN
            RAISE EXCEPTION 'sex cannot be changed after creation.';
        END IF;
        IF OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth THEN
            RAISE EXCEPTION 'date_of_birth cannot be changed after creation.';
        END IF;
        IF OLD.breed_id IS NOT NULL AND OLD.breed_id IS DISTINCT FROM NEW.breed_id THEN
            RAISE EXCEPTION 'breed_id cannot be changed after creation (only custom->directory normalization is allowed).';
        END IF;
        IF OLD.owner_id IS DISTINCT FROM NEW.owner_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
            RAISE EXCEPTION 'Changing ownership is not allowed during MVP phase.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Animal: pedigree integrity (no self-parent, parent sex/species/DOB, cycle prevention)
CREATE OR REPLACE FUNCTION enforce_pedigree_integrity()
RETURNS TRIGGER AS $$
DECLARE v_sex text; v_species int; v_dob date; has_cycle boolean;
BEGIN
    IF NEW.mother_id = NEW.id OR NEW.father_id = NEW.id THEN
        RAISE EXCEPTION 'An animal cannot be its own parent.';
    END IF;
    IF NEW.mother_id IS NOT NULL THEN
        SELECT sex, species_id, date_of_birth INTO v_sex, v_species, v_dob FROM animals WHERE id = NEW.mother_id;
        IF v_sex IS DISTINCT FROM 'Female' THEN RAISE EXCEPTION 'mother_id must reference a Female animal.'; END IF;
        IF v_species IS DISTINCT FROM NEW.species_id THEN RAISE EXCEPTION 'mother must be the same species as the offspring.'; END IF;
        IF v_dob IS NOT NULL AND NEW.date_of_birth IS NOT NULL AND v_dob >= NEW.date_of_birth THEN
            RAISE EXCEPTION 'mother must be born before the offspring.'; END IF;
    END IF;
    IF NEW.father_id IS NOT NULL THEN
        SELECT sex, species_id, date_of_birth INTO v_sex, v_species, v_dob FROM animals WHERE id = NEW.father_id;
        IF v_sex IS DISTINCT FROM 'Male' THEN RAISE EXCEPTION 'father_id must reference a Male animal.'; END IF;
        IF v_species IS DISTINCT FROM NEW.species_id THEN RAISE EXCEPTION 'father must be the same species as the offspring.'; END IF;
        IF v_dob IS NOT NULL AND NEW.date_of_birth IS NOT NULL AND v_dob >= NEW.date_of_birth THEN
            RAISE EXCEPTION 'father must be born before the offspring.'; END IF;
    END IF;
    IF NEW.mother_id IS NOT NULL OR NEW.father_id IS NOT NULL THEN
        WITH RECURSIVE anc(id, depth) AS (
            SELECT id, 1 FROM animals WHERE id IN (NEW.mother_id, NEW.father_id)
            UNION ALL
            SELECT p.pid, anc.depth + 1
            FROM anc
            JOIN animals a ON a.id = anc.id
            CROSS JOIN LATERAL (VALUES (a.mother_id), (a.father_id)) AS p(pid)
            WHERE p.pid IS NOT NULL AND anc.depth < 64
        )
        SELECT EXISTS (SELECT 1 FROM anc WHERE id = NEW.id) INTO has_cycle;
        IF has_cycle THEN RAISE EXCEPTION 'Pedigree cycle detected (animal would be its own ancestor).'; END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_enforce_pedigree_integrity ON animals;
CREATE TRIGGER trg_enforce_pedigree_integrity
    BEFORE INSERT OR UPDATE OF mother_id, father_id ON animals
    FOR EACH ROW EXECUTE FUNCTION enforce_pedigree_integrity();

-- Governance: append-only audit log + reference-data lifecycle
CREATE TABLE IF NOT EXISTS audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role  VARCHAR(20),
    action      VARCHAR(100) NOT NULL,
    entity_type VARCHAR(40),
    entity_id   UUID,
    before_data JSONB,
    after_data  JSONB,
    ip_address  INET,
    user_agent  TEXT,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log(actor_id, created_at);
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'audit_log is append-only'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_audit_log_append_only ON audit_log;
CREATE TRIGGER trg_audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

ALTER TABLE species ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE breeds  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE cities  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE feature_toggles ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;