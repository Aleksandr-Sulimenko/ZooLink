-- Migration: 20260704_0030_notification_in_app_channel
-- ADR-0021 (first outbox consumer — the in-app notification path). Sub-wave C4.
--
-- WHAT
--   1. Widen `notification_logs.type` CHECK from ('EMAIL','SMS') to ('EMAIL','SMS','IN_APP') so the
--      first real outbox consumer (NotificationConsumer, worker-only) can materialize durable in-app
--      notification rows (channel = IN_APP). The auto-named inline constraint is replaced by a stable,
--      explicitly-named one (chk_notiflog_type) to end schema↔migration drift (fix-wave 1.1 lesson).
--   2. Seed the missing EMAIL notification templates for the ownership-transfer lifecycle
--      (transfer_initiated / _accepted / _declined / _cancelled / _expired, ru+en). IN_APP reuses the
--      EMAIL template row as its content source (notification_logs.type is the CHANNEL, template.type
--      is the SOURCE) — so no separate IN_APP-typed template is seeded (ADR-0021 Impl Notes).
--   No table added or removed (36 tables unchanged).
--
-- WHY
--   The transactional outbox (ADR-0009) has zero consumers: moderation/transfer outcomes are produced
--   and silently marked processed — the seller/counterparty is never told (AUDIT3 P1.2, ADR-0021 §1).
--   IN_APP is the one channel that needs no external provider and no consent (transactional ≠ advertising,
--   ФЗ-38), so it ends the silence with the smallest, reversible change. The transfer templates did not
--   exist (the transfer lifecycle events are new to the catalog in this slice), hence the seed here.
--
-- WHY-BETTER-for-the-whole-project
--   - A named CHECK (chk_notiflog_type) keeps database_schema.sql and migrations byte-identical, so the
--     migration-drift CI gate stays green (fix-wave 1.1 promoted it to blocking).
--   - Widening an existing CHECK (vs a new column/table) is the minimal, forward-compatible move; the
--     idempotency infra (uq_notification_idempotency, migration 0009) is already present, so at-least-once
--     outbox redelivery yields exactly one row with no further schema work.
--   - Seeding transfer templates as EMAIL (not IN_APP) keeps the email/SMS provider slice (ADR-0008,
--     form-now) a pure add-on: it reuses the very same rows the day it ships.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS (both the auto-name and the new name) then ADD; template seed is
-- ON CONFLICT (name,type,language) DO NOTHING. Safe to run twice. Negative test: an IN_APP insert now
-- succeeds and a bogus channel (e.g. 'PUSH') is still rejected by chk_notiflog_type.

DO $$
BEGIN
  ALTER TABLE notification_logs DROP CONSTRAINT IF EXISTS notification_logs_type_check;
  ALTER TABLE notification_logs DROP CONSTRAINT IF EXISTS chk_notiflog_type;
  ALTER TABLE notification_logs
    ADD CONSTRAINT chk_notiflog_type CHECK (type IN ('EMAIL', 'SMS', 'IN_APP'));
END $$;

-- Ownership-transfer lifecycle templates (EMAIL source rows; IN_APP renders from these).
INSERT INTO notification_templates (name, type, subject_template, body_template, language, is_active) VALUES
 ('transfer_initiated', 'EMAIL', 'Предложена передача владения',
    'Вам предложена передача владения животным (заявка {{transfer_id}}). Подтвердите или отклоните её в личном кабинете.', 'ru', TRUE),
 ('transfer_initiated', 'EMAIL', 'Ownership transfer offered',
    'You have been offered an ownership transfer (request {{transfer_id}}). Accept or decline it in your account.', 'en', TRUE),
 ('transfer_accepted', 'EMAIL', 'Передача владения принята',
    'Передача владения (заявка {{transfer_id}}) принята получателем.', 'ru', TRUE),
 ('transfer_accepted', 'EMAIL', 'Ownership transfer accepted',
    'Your ownership transfer (request {{transfer_id}}) was accepted by the recipient.', 'en', TRUE),
 ('transfer_declined', 'EMAIL', 'Передача владения отклонена',
    'Передача владения (заявка {{transfer_id}}) отклонена получателем.', 'ru', TRUE),
 ('transfer_declined', 'EMAIL', 'Ownership transfer declined',
    'Your ownership transfer (request {{transfer_id}}) was declined by the recipient.', 'en', TRUE),
 ('transfer_cancelled', 'EMAIL', 'Передача владения отменена',
    'Передача владения (заявка {{transfer_id}}) отменена инициатором.', 'ru', TRUE),
 ('transfer_cancelled', 'EMAIL', 'Ownership transfer cancelled',
    'The ownership transfer (request {{transfer_id}}) was cancelled by the initiator.', 'en', TRUE),
 ('transfer_expired', 'EMAIL', 'Срок передачи владения истёк',
    'Срок передачи владения (заявка {{transfer_id}}) истёк без ответа.', 'ru', TRUE),
 ('transfer_expired', 'EMAIL', 'Ownership transfer expired',
    'The ownership transfer (request {{transfer_id}}) expired without a response.', 'en', TRUE)
ON CONFLICT (name, type, language) DO NOTHING;
