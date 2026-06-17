-- Migration: 20260617_0003_search_indexes_and_pedigree
-- Purpose: close data-layer gaps found in the pre-dev readiness audit:
--   1) FK indexes for pedigree traversal (animals.mother_id / father_id)
--   2) MVP full-text (russian/english) + pg_trgm fuzzy search indexes (declared mandatory in storage.md / BASELINE)
--   3) seed the 'digital_assets' feature toggle in baselines created before migration 0002's seed
-- Idempotent (IF NOT EXISTS / ON CONFLICT).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1) Pedigree FK indexes
CREATE INDEX IF NOT EXISTS idx_animals_mother ON animals(mother_id) WHERE mother_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_animals_father ON animals(father_id) WHERE father_id IS NOT NULL;

-- 2) Full-text (russian morphology) + trigram fuzzy search
CREATE INDEX IF NOT EXISTS idx_listings_fts_title_ru
    ON listings USING GIN (to_tsvector('russian', coalesce(title_localized ->> 'ru', '')));
CREATE INDEX IF NOT EXISTS idx_listings_fts_desc_ru
    ON listings USING GIN (to_tsvector('russian', coalesce(description_localized ->> 'ru', '')));
CREATE INDEX IF NOT EXISTS idx_listings_fts_title_en
    ON listings USING GIN (to_tsvector('english', coalesce(title_localized ->> 'en', '')));
CREATE INDEX IF NOT EXISTS idx_listings_trgm_title_ru
    ON listings USING GIN ((coalesce(title_localized ->> 'ru', '')) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_animals_trgm_nickname_ru
    ON animals USING GIN ((coalesce(nickname_localized ->> 'ru', '')) gin_trgm_ops);

-- 3) digital_assets toggle for older baselines
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('digital_assets', 'NFT / digital-asset tokenization (ADR-0010). Disabled until Фаза 2+.', FALSE, 0)
ON CONFLICT (key) DO NOTHING;

COMMIT;
