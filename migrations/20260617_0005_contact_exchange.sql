-- Migration: 20260617_0005_contact_exchange
-- Purpose: implement the MVP "contact the seller" mechanism (ADR-0005: no chat in MVP).
--   - displayable contact fields + sharing prefs on users
--   - contact_reveals log (audit + rate-limit source; ФЗ-152 traceability)
-- Idempotent.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_phone    VARCHAR(30);
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_telegram VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS contact_prefs    JSONB NOT NULL
    DEFAULT '{"show_phone": true, "show_telegram": false}'::jsonb;

CREATE TABLE IF NOT EXISTS contact_reveals (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    listing_id  UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    viewer_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seller_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_contact_reveals_viewer_time ON contact_reveals(viewer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_contact_reveals_listing ON contact_reveals(listing_id);

COMMENT ON TABLE contact_reveals IS 'Audit + rate-limit source for seller-contact reveals (ADR-0005, no-chat MVP). Hard rate-limit enforced in Redis.';
COMMENT ON TABLE conversations IS 'Фаза 2+ only — chat is out of MVP (ADR-0005). Reserved schema; not used by MVP backend.';
COMMENT ON TABLE messages IS 'Фаза 2+ only — chat is out of MVP (ADR-0005). Reserved schema; not used by MVP backend.';

COMMIT;
