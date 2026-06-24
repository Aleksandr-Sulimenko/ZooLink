-- Migration: 20260624_0022_decision_templates
-- Phase B10 (ADMIN_PHASE_ACTION_PLAN.md) — moderation decision-templates dictionary.
-- Spec: docs/specs/12-moderation-domain.md §"Decision-templates = controlled dictionary (TABLE, not enum)".
--
-- WHAT
--   New INT-keyed, Admin-extensible lookup table `decision_templates` in the A2/A3 reference-data shape:
--     id SERIAL PK; code UNIQUE per market; body_localized JSONB {ru,en} (canned decision notes — free
--     prose, NOT the moderation_reasons taxonomy); applies_to_decision (REJECTED|CHANGES_REQUESTED);
--     market (ADR-0002 pet/livestock hard split); related_reason_code (optional FK → moderation_reasons.code);
--     sort_order; is_active (soft-delete); created_by/updated_by (nullable FK→users, agent-as-principal ready);
--     created_at/updated_at; per-locale GIN indexes; updated_at trigger.
--   Seed: 3 idempotent starter templates.
--
-- WHY
--   Spec 12 (round-5) models canned REJECT/CHANGES_REQUESTED notes as a controlled, business-editable
--   dictionary surfaced by `GET /moderation/decision-templates` and selected via
--   `ModerationActionRequest.templateCode`. The contract round flagged the backing TABLE for the
--   backend-engineer (NOT implemented in that round). This migration is the FORM; the behaviour
--   (selecting a template at decision time, owner-facing rendering) ships with the Moderation domain.
--
-- WHY BETTER (whole-project)
--   - Phasing rule (IMPLEMENTATION_PLAYBOOK §5, rewrite-test = YES): an enum would force a contract +
--     schema rewrite every time an operator adds/edits a template; a table makes a new template one data
--     row with zero schema/contract change. Form-now / behaviour-later is mandated.
--   - Identical to the A2/A3 lookup shape (name_localized→body_localized; sort_order; provenance; market;
--     soft-delete; per-locale GIN; (market, code) uniqueness) → the reference-data registry can absorb it
--     with no new CRUD/audit/localization/concurrency code.
--   - body_localized JSONB (not flat columns): a new language is one JSON key, no schema change (A2 canon).
--   - related_reason_code FK ON DELETE SET NULL: links a template to its reason taxonomy when one applies,
--     without coupling the two lifecycles (a reason can be retired without dropping a template row).
--   - applies_to_decision CHECK {REJECTED, CHANGES_REQUESTED}: APPROVED needs no canned note (mirrors
--     spec 12 — templates are for negative outcomes). The decision enum lives on moderation_decisions.
--   - Soft-delete via is_active (no row deletion) → forward-safe; the AGENT picks templates by stable code.
--
-- Idempotent: CREATE TABLE/INDEX IF NOT EXISTS; trigger DROP+CREATE; seed ON CONFLICT (market, code) DO NOTHING.
-- Safe to run twice (CI runs schema once + every migration x2). No data is destroyed on re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS decision_templates (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) NOT NULL,
    body_localized JSONB NOT NULL DEFAULT '{"ru": "", "en": ""}'::jsonb,
    applies_to_decision VARCHAR(20) NOT NULL
        CHECK (applies_to_decision IN ('REJECTED', 'CHANGES_REQUESTED')),
    market VARCHAR(10) NOT NULL DEFAULT 'pet' CHECK (market IN ('pet', 'livestock')),
    related_reason_code VARCHAR(50) REFERENCES moderation_reasons(code) ON DELETE SET NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (market, code)
);

-- per-locale GIN indexes (mirror species/breeds/cities/health_certifications/genetic_markers)
CREATE INDEX IF NOT EXISTS idx_decision_templates_body_localized_en
    ON decision_templates USING GIN ((body_localized -> 'en'));
CREATE INDEX IF NOT EXISTS idx_decision_templates_body_localized_ru
    ON decision_templates USING GIN ((body_localized -> 'ru'));

-- updated_at trigger (update_updated_at_column() defined at the top of database_schema.sql; naming
-- matches the update_<tbl>_updated_at convention / migration 0013). Idempotent (DROP IF EXISTS).
DROP TRIGGER IF EXISTS update_decision_templates_updated_at ON decision_templates;
CREATE TRIGGER update_decision_templates_updated_at BEFORE UPDATE ON decision_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ===== seed (idempotent: ON CONFLICT (market, code) DO NOTHING) =====
-- Starter canned notes; related_reason_code links to existing moderation_reasons (migration 0010).
INSERT INTO decision_templates (code, body_localized, applies_to_decision, market, related_reason_code, sort_order) VALUES
  ('incomplete_info_changes',
   '{"ru": "Пожалуйста, дополните объявление недостающей информацией (порода, возраст, документы) и отправьте на повторную модерацию.", "en": "Please complete the listing with the missing details (breed, age, documents) and resubmit for moderation."}'::jsonb,
   'CHANGES_REQUESTED', 'pet', 'incomplete_info', 10),
  ('poor_photos_changes',
   '{"ru": "Замените фотографии на качественные и оригинальные снимки самого животного.", "en": "Please replace the photos with high-quality, original images of the animal itself."}'::jsonb,
   'CHANGES_REQUESTED', 'pet', 'poor_photos', 20),
  ('prohibited_species_reject',
   '{"ru": "Объявление отклонено: продажа данного вида запрещена правилами платформы и законодательством.", "en": "Listing rejected: the sale of this species is prohibited by platform rules and applicable law."}'::jsonb,
   'REJECTED', 'pet', 'prohibited_species', 30)
ON CONFLICT (market, code) DO NOTHING;

COMMIT;
