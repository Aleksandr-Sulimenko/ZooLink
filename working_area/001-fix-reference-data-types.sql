-- Migration script to fix Priority 1 issues identified in database audit
-- Fixes incorrect foreign key data types and role definitions

-- 1. Fix reference data foreign key types: Change species table id from UUID to SERIAL
BEGIN;

-- Temporarily drop foreign key constraints that depend on species.id
ALTER TABLE breeds DROP CONSTRAINT IF EXISTS breeds_species_id_fkey;
ALTER TABLE animals DROP CONSTRAINT IF EXISTS animals_species_id_fkey;

-- Change species.id from UUID to SERIAL
ALTER TABLE species
    ALTER COLUMN id DROP DEFAULT,
    ALTER COLUMN id TYPE INTEGER USING (nextval('species_id_seq'::regclass)),
    ALTER COLUMN id SET DEFAULT nextval('species_id_seq');

-- Recreate the sequence if it doesn't exist (should already exist from original UUID approach)
-- Actually, since we had UUID with uuid_generate_v4(), we need to create a proper sequence
DROP SEQUENCE IF EXISTS species_id_seq;
CREATE SEQUENCE species_id_seq;
ALTER TABLE species ALTER COLUMN id SET DEFAULT nextval('species_id_seq');
SELECT setval('species_id_seq', COALESCE((SELECT MAX(id) FROM species), 1));

-- Now update breeds.species_id to reference the new INTEGER type
ALTER TABLE breeds
    ALTER COLUMN species_id TYPE INTEGER USING (species_id::INTEGER),
    ADD CONSTRAINT breeds_species_id_fkey FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE RESTRICT;

-- Update animals.species_id to reference the new INTEGER type
ALTER TABLE animals
    ALTER COLUMN species_id TYPE INTEGER USING (species_id::INTEGER),
    ADD CONSTRAINT animals_species_id_fkey FOREIGN KEY (species_id) REFERENCES species(id) ON DELETE RESTRICT;

-- 2. Fix breeds table: change id from UUID to SERIAL and species_id to INTEGER
-- Drop FK that references breeds.id
ALTER TABLE animals DROP CONSTRAINT IF EXISTS animals_breed_id_fkey;

-- Change breeds.id from UUID to SERIAL
ALTER TABLE breeds
    ALTER COLUMN id DROP DEFAULT,
    ALTER COLUMN id TYPE INTEGER USING (nextval('breeds_id_seq'::regclass)),
    ALTER COLUMN id SET DEFAULT nextval('breeds_id_seq');

DROP SEQUENCE IF EXISTS breeds_id_seq;
CREATE SEQUENCE breeds_id_seq;
ALTER TABLE breeds ALTER COLUMN id SET DEFAULT nextval('breeds_id_seq');
SELECT setval('breeds_id_seq', COALESCE((SELECT MAX(id) FROM breeds), 1));

-- Update animals.breed_id to reference the new INTEGER type
ALTER TABLE animals
    ALTER COLUMN breed_id TYPE INTEGER USING (breed_id::INTEGER),
    ADD CONSTRAINT animals_breed_id_fkey FOREIGN KEY (breed_id) REFERENCES breeds(id) ON DELETE SET NULL;

-- 3. Fix cities table: change id from UUID to SERIAL
-- Drop FKs that reference cities.id
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_city_id_fkey;
ALTER TABLE branches DROP CONSTRAINT IF EXISTS branches_city_id_fkey;

-- Change cities.id from UUID to SERIAL
ALTER TABLE cities
    ALTER COLUMN id DROP DEFAULT,
    ALTER COLUMN id TYPE INTEGER USING (nextval('cities_id_seq'::regclass)),
    ALTER COLUMN id SET DEFAULT nextval('cities_id_seq');

DROP SEQUENCE IF EXISTS cities_id_seq;
CREATE SEQUENCE cities_id_seq;
ALTER TABLE cities ALTER COLUMN id SET DEFAULT nextval('cities_id_seq');
SELECT setval('cities_id_seq', COALESCE((SELECT MAX(id) FROM cities), 1));

-- Update users.city_id to reference the new INTEGER type
ALTER TABLE users
    ALTER COLUMN city_id TYPE INTEGER USING (city_id::INTEGER),
    ADD CONSTRAINT users_city_id_fkey FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE SET NULL;

-- Update branches.city_id to reference the new INTEGER type
ALTER TABLE branches
    ALTER COLUMN city_id TYPE INTEGER USING (city_id::INTEGER),
    ADD CONSTRAINT branches_city_id_fkey FOREIGN KEY (city_id) REFERENCES cities(id) ON DELETE RESTRICT;

-- 4. Fix role definition in users table: remove BREEDER and FARMER from allowed values
ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check,
    ADD CONSTRAINT users_role_check CHECK (role IN ('USER', 'MODERATOR', 'ADMIN'));

COMMIT;

-- Note: After running this migration, application code that expects UUID values for
-- species_id, breed_id, and city_id will need to be updated to handle INTEGER values.
-- The localization fields (breed_text_localized, nickname_localized) remain as JSONB
-- as this was deemed an acceptable enhancement for MVP.