-- ZooLink Database Schema fully aligned with documented domain models
-- MVP core with extensibility for future phases.
-- Adjustments made to match conceptual models from animal-domain.md and identity-domain.md

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- Uncomment if PostGIS is available for geography type
-- CREATE EXTENSION IF NOT EXISTS postgis;

-- ========== Reference Data (Admin Domain) ==========
CREATE TABLE species (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE, -- e.g., 'dog', 'cattle'
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE breeds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    species_id UUID NOT NULL REFERENCES species(id) ON DELETE RESTRICT,
    code VARCHAR(50) NOT NULL,
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (species_id, code)
);

-- Optional: City directory for geo-search (managed by Admin)
CREATE TABLE cities (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name_ru VARCHAR(100) NOT NULL,
    name_en VARCHAR(100) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ========== Identity Domain ==========
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_hash VARCHAR(60), -- bcrypt hash of phone number (nullable if OAuth-only)
    oauth_google_id VARCHAR(255),
    oauth_apple_id VARCHAR(255),
    oauth_telegram_id VARCHAR(255),
    oauth_vk_id VARCHAR(255),
    full_name VARCHAR(100) NOT NULL,
    city_id UUID REFERENCES cities(id) ON DELETE SET NULL, -- for geo-search
    avatar_url TEXT,
    email VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(60), -- bcrypt hash if using phone auth (nullable if OAuth-only)
    role VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'MODERATOR', 'ADMIN')) DEFAULT 'USER',
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

-- ========== Animal Domain ==========
CREATE TABLE animals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    species_id UUID NOT NULL REFERENCES species(id) ON DELETE RESTRICT,
    breed_id UUID REFERENCES breeds(id) ON DELETE SET NULL, -- nullable if custom/other
    breed_text VARCHAR(100), -- custom breed text if breed_id is null (for moderator review)
    nickname VARCHAR(50), -- display name (per animal-domain.md)
    sex VARCHAR(10) NOT NULL CHECK (sex IN ('Male', 'Female')), -- updated to match doc casing
    date_of_birth DATE NOT NULL,
    color_coat VARCHAR(100),
    microchip_id VARCHAR(50),
    tattoo_brand_id VARCHAR(50), -- for livestock
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- visible for new listings when true
    health_records JSONB NOT NULL DEFAULT '[]'::jsonb, -- array of {type, detail, date, provider}
    reproductive_data JSONB NOT NULL DEFAULT '[]'::jsonb, -- for females: heat, mating, etc.
    owned_since DATE,
    mother_id UUID REFERENCES animals(id) ON DELETE SET NULL, -- future pedigree
    father_id UUID REFERENCES animals(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMP WITH TIME ZONE -- when deactivated (soft delete)
);

-- Indexes for animal search and integrity
CREATE INDEX idx_animals_owner ON animals(owner_id);
CREATE INDEX idx_animals_species_breed ON animals(species_id, breed_id);
CREATE INDEX idx_animals_microchip ON animals(microchip_id) WHERE microchip_id IS NOT NULL;
CREATE INDEX idx_animals_tattoo ON animals(tattoo_brand_id) WHERE tattoo_brand_id IS NOT NULL;
-- GIN indexes for JSONB querying
CREATE INDEX idx_animals_health_records ON animals USING GIN (health_records);
CREATE INDEX idx_animals_reproductive_data ON animals USING GIN (reproductive_data);
-- For searching by custom breed text
CREATE INDEX idx_animals_breed_text ON animals(breed_text);
-- For active animal queries
CREATE INDEX idx_animals_active ON animals(is_active) WHERE is_active = true;
-- For ownership date range
CREATE INDEX idx_animals_owned_since ON animals(owned_since);

-- ========== Ownership History (For traceability, regulatory) ==========
CREATE TABLE animal_ownership_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
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
    listing_type VARCHAR(20) NOT NULL CHECK (listing_type IN ('sale', 'breeding', 'show', 'adoption')),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price_cents INTEGER, -- nullable for non-price listings (e.g., breeding)
    currency CHAR(3) DEFAULT 'RUB',
    quantity INTEGER DEFAULT 1,
    location_point GEOGRAPHY(POINT, 4326), -- requires PostGIS; if not available, use lat/lng columns
    search_radius_m INTEGER, -- meters for radius search
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
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
-- GIST index for geography if PostGIS enabled; otherwise create btree on lat/lng
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM pg_extension WHERE extname = 'postgis') > 0 THEN
        EXECUTE 'CREATE INDEX idx_listings_location ON listings USING GIST (location_point) WHERE location_point IS NOT NULL';
    ELSE
        -- If PostGIS not available, we assume we added lat/lng columns (not in this script)
        -- For now, skip; user can alter table to add lat/lng and index.
        RAISE NOTICE 'PostGIS not found; skip geography index. Consider adding lat/lng columns.';
    END IF;
END $$;
CREATE INDEX idx_listings_expires ON listings(expires_at) WHERE expires_at > NOW();
CREATE INDEX idx_listing_photos_listing ON listing_photos(listing_id);
CREATE INDEX idx_conversations_listing ON conversations(listing_id);
CREATE INDEX idx_messages_conversation ON messages(conversation_id);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_recipient ON messages(recipient_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at);

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
          AND tablename IN ('users', 'species', 'breeds', 'cities', 'animals',
                            'animal_ownership_history', 'listings', 'conversations',
                            'messages', 'feature_toggles', 'outbox_events')
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
('boosted_listings', 'Платное продвижение объявлений в поиске', false, 0),
('vet_leadgen', 'Генерация лидов для ветеринарных клиник', false, 0),
('service_marketplace', 'Рынок услуг (ветеринары, тренеры, перевозчики)', false, 0),
('health_passport_api', 'Доступ к цифровому паспорту здоровья через API', false, 0),
('genetics_portal', 'Портал генетики и ДНК‑тестов', false, 0),
('regulatory_integration', 'Интеграция с Меркурий/ВетИС для отслеживания перемещения скота', false, 0)
ON CONFLICT (key) DO NOTHING;

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

-- Note: Application-level validations required per documentation:
-- 1. Validate breed_id/breed_text: if breed_id IS NULL THEN breed_text IS NOT NULL
-- 2. Prevent changes to immutable fields after creation: species_id, breed_id (if from directory), sex, date_of_birth
-- 3. Block ownership changes during MVP phase (documented: "Changing ownership is not allowed on MVP")