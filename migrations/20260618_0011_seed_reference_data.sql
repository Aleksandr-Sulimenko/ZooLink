-- Migration: 20260618_0011_seed_reference_data
-- Purpose: seed MVP reference data (supported_languages, species, breeds, cities, feature_toggles)
--          on the incremental migration path. These rows already ship in database_schema.sql
--          (the consolidated baseline); this migration mirrors them 1:1 so a DB built purely from
--          migrations/*.sql is identical to a fresh database_schema.sql build. Idempotent.

BEGIN;

-- ===== Supported languages =====
INSERT INTO supported_languages (code, name_localized, is_active, display_order) VALUES
('ru', '{"ru": "Русский", "en": "Russian"}', true, 1),
('en', '{"ru": "Английский", "en": "English"}', true, 2),
('fr', '{"ru": "Французский", "en": "French"}', false, 3),
('es', '{"ru": "Испанский", "en": "Spanish"}', false, 4),
('zh', '{"ru": "Китайский", "en": "Chinese"}', false, 5)
ON CONFLICT (code) DO NOTHING;

-- ===== Core species =====
INSERT INTO species (code, name_ru, name_en) VALUES
('dog', 'Собака', 'Dog'),
('cat', 'Кошка', 'Cat'),
('cattle', 'Крупный рогатый скот', 'Cattle'),
('sheep', 'Овца', 'Sheep'),
('horse', 'Лошадь', 'Horse')
ON CONFLICT (code) DO NOTHING;

-- ===== Breeds (FK by species code) =====
INSERT INTO breeds (species_id, code, name_ru, name_en)
SELECT s.id, 'akita', 'Акита', 'Akita' FROM species s WHERE s.code = 'dog'
UNION ALL
SELECT s.id, 'german_shepherd', 'Немецкая овчарка', 'German Shepherd' FROM species s WHERE s.code = 'dog'
UNION ALL
SELECT s.id, 'persian', 'Персидская', 'Persian' FROM species s WHERE s.code = 'cat'
UNION ALL
SELECT s.id, 'holmstein', 'Голштинская', 'Holstein' FROM species s WHERE s.code = 'cattle'
ON CONFLICT (species_id, code) DO NOTHING;

-- ===== Initial cities =====
-- cities has no natural unique key, so ON CONFLICT cannot dedup; guard with NOT EXISTS to stay idempotent.
INSERT INTO cities (name_ru, name_en)
SELECT v.name_ru, v.name_en
FROM (VALUES ('Москва', 'Moscow'), ('Санкт-Петербург', 'Saint Petersburg')) AS v(name_ru, name_en)
WHERE NOT EXISTS (SELECT 1 FROM cities c WHERE c.name_ru = v.name_ru);

-- ===== Feature toggles (MVP: everything off except core) =====
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

COMMIT;
