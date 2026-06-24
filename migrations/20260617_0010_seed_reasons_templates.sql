-- Migration: 20260617_0010_seed_reasons_templates
-- Purpose: seed MVP moderation reasons (REJECT/CHANGES require a reason FK) and notification templates
--          (referenced by event-catalog.md). Idempotent (ON CONFLICT DO NOTHING).

BEGIN;

-- ===== Moderation reasons (MVP set) =====
INSERT INTO moderation_reasons (code, description_localized, applies_to, is_active) VALUES
 ('prohibited_species', '{"ru":"Запрещённый к продаже вид","en":"Prohibited species"}',                 'LISTING', TRUE),
 ('incomplete_info',    '{"ru":"Недостаточно информации","en":"Incomplete information"}',                 'LISTING', TRUE),
 ('poor_photos',        '{"ru":"Некачественные или чужие фото","en":"Poor-quality or non-original photos"}','LISTING', TRUE),
 ('suspected_fraud',    '{"ru":"Подозрение на мошенничество","en":"Suspected fraud"}',                    'LISTING', TRUE),
 ('price_violation',    '{"ru":"Нарушение правил цены","en":"Pricing policy violation"}',                 'LISTING', TRUE),
 ('wrong_category',     '{"ru":"Неверная категория/рынок","en":"Wrong category/market"}',                 'LISTING', TRUE),
 ('duplicate',          '{"ru":"Дубликат объявления","en":"Duplicate listing"}',                          'LISTING', TRUE),
 ('animal_welfare',     '{"ru":"Нарушение благополучия животных","en":"Animal-welfare violation"}',        'LISTING', TRUE),
 ('policy_violation',   '{"ru":"Иное нарушение правил","en":"Other policy violation"}',                   'LISTING', TRUE)
ON CONFLICT (code) DO NOTHING;

-- ===== Notification templates (MVP events x EN/RU) =====
-- Handlebars placeholders; variable contract is documented in specs/13-notification-domain.md.
INSERT INTO notification_templates (name, type, subject_template, body_template, language, is_active) VALUES
 ('user_verify_code', 'SMS', NULL, 'ZooLink: код подтверждения {{code}}. Действует {{ttl_min}} мин.', 'ru', TRUE),
 ('user_verify_code', 'SMS', NULL, 'ZooLink: your verification code is {{code}}. Valid for {{ttl_min}} min.', 'en', TRUE),
 ('listing_approved', 'EMAIL', 'Ваше объявление одобрено', 'Объявление «{{listing_title}}» одобрено и опубликовано.', 'ru', TRUE),
 ('listing_approved', 'EMAIL', 'Your listing is approved', 'Your listing "{{listing_title}}" was approved and published.', 'en', TRUE),
 ('listing_rejected', 'EMAIL', 'Объявление отклонено', 'Объявление «{{listing_title}}» отклонено. Причина: {{reason}}.', 'ru', TRUE),
 ('listing_rejected', 'EMAIL', 'Your listing was rejected', 'Your listing "{{listing_title}}" was rejected. Reason: {{reason}}.', 'en', TRUE),
 ('listing_changes_requested', 'EMAIL', 'Требуются изменения', 'По объявлению «{{listing_title}}» нужны правки: {{reason}}.', 'ru', TRUE),
 ('listing_changes_requested', 'EMAIL', 'Changes requested', 'Your listing "{{listing_title}}" needs changes: {{reason}}.', 'en', TRUE),
 ('listing_expired', 'EMAIL', 'Срок объявления истёк', 'Объявление «{{listing_title}}» истекло. Продлите его в личном кабинете.', 'ru', TRUE),
 ('listing_expired', 'EMAIL', 'Your listing expired', 'Your listing "{{listing_title}}" has expired. Renew it in your account.', 'en', TRUE),
 ('report_resolved', 'EMAIL', 'Ваша жалоба рассмотрена', 'Жалоба на {{entity_type}} рассмотрена. Решение: {{decision}}.', 'ru', TRUE),
 ('report_resolved', 'EMAIL', 'Your report was reviewed', 'Your report on the {{entity_type}} was reviewed. Decision: {{decision}}.', 'en', TRUE)
ON CONFLICT (name, type, language) DO NOTHING;

COMMIT;
