-- Migration: 20260617_0006_integrity_and_cascades
-- Purpose: close P1 data-integrity & logic gaps from the deep audit (round 3):
--   1) animals.reproductive_status (enables breeding-eligibility predicate)
--   2) breed must belong to the animal's species (composite FK)
--   3) content_reports dedup (one OPEN report per reporter+entity)
--   4) cascade: deactivating an animal / user deactivates their live listings
-- Idempotent.

BEGIN;

-- 1) Reproductive status (breeding eligibility) -----------------------------------------
ALTER TABLE animals ADD COLUMN IF NOT EXISTS reproductive_status VARCHAR(20) NOT NULL DEFAULT 'UNKNOWN'
    CHECK (reproductive_status IN ('INTACT', 'NEUTERED', 'UNKNOWN'));

-- 2) breed_id must match species_id (composite FK; NULL breed_id is allowed via MATCH SIMPLE) ---
-- drop FK first (it depends on the unique constraint), then recreate both in dependency order
ALTER TABLE animals DROP CONSTRAINT IF EXISTS fk_animals_breed_species;
ALTER TABLE breeds  DROP CONSTRAINT IF EXISTS uq_breeds_id_species;
ALTER TABLE breeds  ADD  CONSTRAINT uq_breeds_id_species UNIQUE (id, species_id);
ALTER TABLE animals ADD  CONSTRAINT fk_animals_breed_species
    FOREIGN KEY (breed_id, species_id) REFERENCES breeds(id, species_id) ON DELETE RESTRICT;

-- 3) Content report dedup: one OPEN report per (reporter, entity) -------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_report_per_reporter_entity
    ON content_reports(reporter_id, entity_type, entity_id) WHERE status = 'OPEN';

-- 4) Deactivation cascades to live listings ---------------------------------------------
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

COMMIT;
