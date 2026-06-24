-- Migration: 20260623_0018_reference_data_localized_provenance
-- Phase A2 (ADMIN_PHASE_ACTION_PLAN.md) — reference-data model: provenance + sort order,
-- flat→JSONB localization, and INT-entity audit support.
--
-- WHAT
--   1. species/breeds/cities: add sort_order (display ordering), created_by/updated_by (provenance,
--      agent-as-principal capable → FK users.id NULL).
--   2. Localization: migrate flat name_ru/name_en → name_localized JSONB {"ru":..,"en":..}
--      (canon: localization_specification.md + API_CONVENTIONS §6, owner-decision #3). Backfill from
--      the existing columns, enforce NOT NULL, add GIN indexes, then DROP the flat columns
--      (Single-Source-of-Truth: no dual-write drift).
--   3. audit_log: add entity_id_int INTEGER NULL for INT-keyed lookup entities (audit_log.entity_id is
--      UUID and cannot hold a SERIAL lookup id) → reference-data CRUD becomes auditable by entity id.
--
-- WHY
--   - GAP-001 / DIV-9 / C6: reference-data lacked provenance, ordering, and the contract already mandates
--     nameLocalized (LocalizedString) while the table carried flat name_ru/name_en — a doc↔code/schema drift.
--   - audit_log.entity_id is UUID, so INT reference-CRUD currently audits with entity_id = NULL (loses the
--     subject id). entity_id_int closes that without breaking the UUID path.
--
-- WHY BETTER (whole-project)
--   - JSONB localization matches the org/branch/animal name_localized canon already in the schema, the
--     localization_specification.md JSONB approach, and owner-decision #3; it lets us add a language with
--     NO schema change (extensibility principle) — flat columns would need a migration per language.
--   - Dropping name_ru/name_en (instead of keeping both) removes a dual-write divergence class and keeps
--     the lookup tables aligned with the get_localized()/has_translation() helpers used elsewhere.
--   - created_by/updated_by are nullable FK→users(id): forward-compatible with agent-as-principal (ADR-0006)
--     — an AGENT row can own a reference-data change with no further schema work.
--   - entity_id_int (vs entity_key TEXT): preserves integer typing symmetric with entity_id UUID, allows a
--     typed partial index, and avoids stringly-typed audit subjects.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS; backfill guarded by name_localized
-- presence; DROP COLUMN IF EXISTS. Safe to run twice (CI runs schema + every migration x2).

BEGIN;

-- ===== 1. provenance + ordering on the three managed lookup tables =====
ALTER TABLE species ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE species ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE species ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE breeds  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE breeds  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE breeds  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE cities  ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cities  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE cities  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES users(id) ON DELETE SET NULL;

-- ===== 2. flat name_ru/name_en -> name_localized JSONB {ru,en} =====
-- 2a. add the JSONB column (default empty bilingual object so a fresh insert is valid before backfill).
ALTER TABLE species ADD COLUMN IF NOT EXISTS name_localized JSONB NOT NULL DEFAULT '{"ru": "", "en": ""}'::jsonb;
ALTER TABLE breeds  ADD COLUMN IF NOT EXISTS name_localized JSONB NOT NULL DEFAULT '{"ru": "", "en": ""}'::jsonb;
ALTER TABLE cities  ADD COLUMN IF NOT EXISTS name_localized JSONB NOT NULL DEFAULT '{"ru": "", "en": ""}'::jsonb;

-- 2b. backfill from the flat columns IFF they still exist (guarded → idempotent on re-run after the drop).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'species' AND column_name = 'name_ru') THEN
    EXECUTE $sql$
      UPDATE species
         SET name_localized = jsonb_build_object('ru', name_ru, 'en', name_en)
       WHERE name_localized = '{"ru": "", "en": ""}'::jsonb
    $sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'breeds' AND column_name = 'name_ru') THEN
    EXECUTE $sql$
      UPDATE breeds
         SET name_localized = jsonb_build_object('ru', name_ru, 'en', name_en)
       WHERE name_localized = '{"ru": "", "en": ""}'::jsonb
    $sql$;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'cities' AND column_name = 'name_ru') THEN
    EXECUTE $sql$
      UPDATE cities
         SET name_localized = jsonb_build_object('ru', name_ru, 'en', name_en)
       WHERE name_localized = '{"ru": "", "en": ""}'::jsonb
    $sql$;
  END IF;
END $$;

-- 2c. drop the flat columns (single source of truth = name_localized JSONB).
ALTER TABLE species DROP COLUMN IF EXISTS name_ru;
ALTER TABLE species DROP COLUMN IF EXISTS name_en;
ALTER TABLE breeds  DROP COLUMN IF EXISTS name_ru;
ALTER TABLE breeds  DROP COLUMN IF EXISTS name_en;
ALTER TABLE cities  DROP COLUMN IF EXISTS name_ru;
ALTER TABLE cities  DROP COLUMN IF EXISTS name_en;

-- 2d. GIN indexes per-locale (mirrors organizations/branches/animals localization indexing).
CREATE INDEX IF NOT EXISTS idx_species_name_localized_en ON species USING GIN ((name_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_species_name_localized_ru ON species USING GIN ((name_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_breeds_name_localized_en  ON breeds  USING GIN ((name_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_breeds_name_localized_ru  ON breeds  USING GIN ((name_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_cities_name_localized_en  ON cities  USING GIN ((name_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_cities_name_localized_ru  ON cities  USING GIN ((name_localized -> 'ru'));

-- ===== 3. audit_log support for INT-keyed (lookup) entities =====
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_id_int INTEGER;
COMMENT ON COLUMN audit_log.entity_id_int IS
  'Integer entity id for INT-keyed lookup entities (species/breeds/cities). UUID entities use entity_id; INT lookups use this. Exactly one is populated per row.';
CREATE INDEX IF NOT EXISTS idx_audit_log_entity_int ON audit_log(entity_type, entity_id_int)
  WHERE entity_id_int IS NOT NULL;

COMMIT;
