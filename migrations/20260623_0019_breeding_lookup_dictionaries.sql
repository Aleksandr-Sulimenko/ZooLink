-- Migration: 20260623_0019_breeding_lookup_dictionaries
-- Phase A3 (ADMIN_PHASE_ACTION_PLAN.md, GAP-TRACE-002) — breeding reference dictionaries.
--
-- WHAT
--   Two new INT-keyed, admin-managed lookup tables, in the SAME shape as the A2 reference-data canon
--   (species/breeds/cities — migration 0018):
--     1. health_certifications — livestock health-status certificates (e.g. TB-free, Brucellosis-free).
--     2. genetic_markers       — livestock genetic markers/flags (e.g. polled, coat-colour, disease markers).
--   Each table: id SERIAL PK; code UNIQUE per market; name_localized JSONB {ru,en}; sort_order;
--   is_active (soft-delete); created_by/updated_by (nullable FK→users, agent-as-principal ready); market
--   (ADR-0002 pet/livestock hard split); created_at/updated_at; per-locale GIN indexes; updated_at trigger.
--
-- WHY
--   - GAP-TRACE-002: livestock search filters (`health_certifications`, `genetic_flags`) in
--     business-requirements/livestock-marketplace.md:89-91 reference controlled dictionaries that had NO
--     backing table — the filters were unrealizable. The round-9 admin note deferred these to Фаза 2; A3
--     supersedes that for the SHAPE (table now) while keeping the BEHAVIOUR (marketplace filtering) deferred.
--   - Phasing rule (IMPLEMENTATION_PLAYBOOK §5, rewrite-test): the table FORM is the irreversible artifact;
--     deferring it would force a schema migration on a future phase. Form-now / behaviour-later is mandated.
--
-- WHY BETTER (whole-project)
--   - Identical to the A2 lookup shape → the dataset registry (DATASETS + CAPS) absorbs them with NO change
--     to the CRUD/audit/localization/concurrency code. That is the extensibility property A2 was built for:
--     "add a lookup table = add it to DATASETS + a CAPS entry + a Prisma delegate" (data-model.md A2 note).
--   - market column (ADR-0002): these dictionaries are livestock-domain; market keeps the hard pet/livestock
--     split queryable and lets a future pet-side dictionary reuse the same table without a fork.
--   - code UNIQUE per (market, code) (not globally): symmetric with breeds' (species_id, code) — a code may
--     legitimately recur across markets while staying unique within one.
--   - name_localized JSONB (not flat columns): a new language is one JSON key, no schema change (A2 canon).
--   - Soft-delete via is_active (no row deletion) → forward-safe if listings/animals ever FK these later.
--   - NOT created here (deliberate, tracked): temperament_tags/health_flags (pet) = free text/JSONB, lookup
--     added additively in Фаза 2 (no rewrite); animal-statuses = a state CHECK enum, not a dataset;
--     decision-templates = deferred to the moderation contract (B10), coupled to the moderation shape.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; ADD COLUMN IF NOT EXISTS; trigger DROP+CREATE.
-- Safe to run twice (CI runs schema once + every migration x2). No data is destroyed on re-run.

BEGIN;

-- ===== 1. health_certifications =====
CREATE TABLE IF NOT EXISTS health_certifications (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    name_localized JSONB NOT NULL DEFAULT '{"ru": "", "en": ""}'::jsonb,
    market VARCHAR(10) NOT NULL DEFAULT 'livestock' CHECK (market IN ('pet', 'livestock')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (market, code)
);

-- ===== 2. genetic_markers =====
CREATE TABLE IF NOT EXISTS genetic_markers (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    name_localized JSONB NOT NULL DEFAULT '{"ru": "", "en": ""}'::jsonb,
    market VARCHAR(10) NOT NULL DEFAULT 'livestock' CHECK (market IN ('pet', 'livestock')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (market, code)
);

-- ===== per-locale GIN indexes (mirror species/breeds/cities) =====
CREATE INDEX IF NOT EXISTS idx_health_certifications_name_localized_en
    ON health_certifications USING GIN ((name_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_health_certifications_name_localized_ru
    ON health_certifications USING GIN ((name_localized -> 'ru'));
CREATE INDEX IF NOT EXISTS idx_genetic_markers_name_localized_en
    ON genetic_markers USING GIN ((name_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_genetic_markers_name_localized_ru
    ON genetic_markers USING GIN ((name_localized -> 'ru'));

-- ===== updated_at triggers =====
-- update_updated_at_column() + the update_<tbl>_updated_at naming match the schema convention
-- (database_schema.sql:581 / migration 0013). Migration 0013 only auto-attaches to tables that existed
-- when it ran, so these two new tables get their trigger explicitly here. Idempotent (DROP IF EXISTS).
DROP TRIGGER IF EXISTS update_health_certifications_updated_at ON health_certifications;
CREATE TRIGGER update_health_certifications_updated_at BEFORE UPDATE ON health_certifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_genetic_markers_updated_at ON genetic_markers;
CREATE TRIGGER update_genetic_markers_updated_at BEFORE UPDATE ON genetic_markers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===== seed (idempotent: ON CONFLICT (market, code) DO NOTHING) =====
-- Livestock health certificates (livestock-marketplace.md:91).
INSERT INTO health_certifications (code, name_localized, market, sort_order) VALUES
  ('tb_free',           '{"ru": "Свободно от туберкулёза", "en": "TB-free"}'::jsonb,            'livestock', 10),
  ('brucellosis_free',  '{"ru": "Свободно от бруцеллёза",  "en": "Brucellosis-free"}'::jsonb,   'livestock', 20),
  ('johnes_negative',   '{"ru": "Йоне-негативный",          "en": "Johnes-negative"}'::jsonb,    'livestock', 30),
  ('vq_status',         '{"ru": "VQ-статус",                "en": "VQ-status"}'::jsonb,           'livestock', 40)
ON CONFLICT (market, code) DO NOTHING;

-- Livestock genetic markers/flags (livestock-marketplace.md:90).
INSERT INTO genetic_markers (code, name_localized, market, sort_order) VALUES
  ('polled',             '{"ru": "Комолость (polled)",          "en": "Polled"}'::jsonb,                    'livestock', 10),
  ('horned',             '{"ru": "Рогатость",                    "en": "Horned"}'::jsonb,                     'livestock', 20),
  ('coat_color',         '{"ru": "Ген окраса шерсти",            "en": "Coat-colour gene"}'::jsonb,           'livestock', 30),
  ('disease_resistance', '{"ru": "Маркер устойчивости к болезни","en": "Disease-resistance marker"}'::jsonb,  'livestock', 40)
ON CONFLICT (market, code) DO NOTHING;

COMMIT;
