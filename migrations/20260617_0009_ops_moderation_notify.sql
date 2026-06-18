-- Migration: 20260617_0009_ops_moderation_notify
-- Purpose: close round-5 operational P0/P1 (moderation queue ops, notification delivery, user language).
-- Idempotent.

BEGIN;

-- ===== Moderation queue: assignment/lock + SLA clock + FIFO index =====
ALTER TABLE listings ADD COLUMN IF NOT EXISTS moderation_enqueued_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS locked_at       TIMESTAMP WITH TIME ZONE;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS lock_expires_at TIMESTAMP WITH TIME ZONE;
-- FIFO queue scan (oldest pending first)
CREATE INDEX IF NOT EXISTS idx_listings_modqueue
    ON listings(moderation_enqueued_at) WHERE status = 'PENDING_MODERATION';

-- ===== Identity: notification language =====
ALTER TABLE users ADD COLUMN IF NOT EXISTS preferred_language CHAR(2) NOT NULL DEFAULT 'ru'
    REFERENCES supported_languages(code) ON DELETE RESTRICT;

-- ===== Notification delivery: provider receipt mapping + idempotency + suppression =====
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS provider_message_id VARCHAR(255);
ALTER TABLE notification_logs ADD COLUMN IF NOT EXISTS idempotency_key      VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_idempotency
    ON notification_logs(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_notification_provider_msg
    ON notification_logs(provider_message_id) WHERE provider_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS notification_suppressions (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    recipient  VARCHAR(255) NOT NULL,
    channel    VARCHAR(10) NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
    reason     VARCHAR(30) NOT NULL CHECK (reason IN ('HARD_BOUNCE', 'UNSUBSCRIBED', 'COMPLAINT')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE (recipient, channel)
);

COMMIT;
