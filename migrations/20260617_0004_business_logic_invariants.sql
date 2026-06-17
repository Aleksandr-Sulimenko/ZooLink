-- Migration: 20260617_0004_business_logic_invariants
-- Purpose: enforce business-logic invariants found in the deep pre-dev audit (round 3):
--   1) Listing: status='ACTIVE' requires moderation_status='APPROVED' (pre-moderation gate, ADR-0003)
--   2) Animal: microchip_id / tattoo_brand_id must be unique (anti-fraud, prevents owner spoofing)
--   3) Listing: price >= 0, quantity >= 1, currency ISO-4217
--   4) Animal: nickname_localized must contain a non-empty 'en' OR 'ru' (localized required-language rule)
-- Idempotent (DROP ... IF EXISTS before ADD; IF NOT EXISTS on indexes).

BEGIN;

-- 1) ACTIVE requires APPROVED -----------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_listing_active_requires_approval() RETURNS trigger AS $$
BEGIN
    IF NEW.status = 'ACTIVE' AND NEW.moderation_status IS DISTINCT FROM 'APPROVED' THEN
        RAISE EXCEPTION 'Listing % cannot be ACTIVE unless moderation_status = APPROVED (got %)',
            NEW.id, NEW.moderation_status;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listing_active_requires_approval ON listings;
CREATE TRIGGER trg_listing_active_requires_approval
    BEFORE INSERT OR UPDATE ON listings
    FOR EACH ROW EXECUTE FUNCTION enforce_listing_active_requires_approval();

-- 2) Unique microchip / tattoo (replace the non-unique indexes) ---------------------------
DROP INDEX IF EXISTS idx_animals_microchip;
DROP INDEX IF EXISTS idx_animals_tattoo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_animals_microchip ON animals(microchip_id) WHERE microchip_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_animals_tattoo    ON animals(tattoo_brand_id) WHERE tattoo_brand_id IS NOT NULL;

-- 3) Listing value checks ----------------------------------------------------------------
ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_price_nonneg;
ALTER TABLE listings ADD  CONSTRAINT chk_listings_price_nonneg CHECK (price_cents IS NULL OR price_cents >= 0);
ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_quantity_pos;
ALTER TABLE listings ADD  CONSTRAINT chk_listings_quantity_pos CHECK (quantity IS NULL OR quantity >= 1);
ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_currency_iso;
ALTER TABLE listings ADD  CONSTRAINT chk_listings_currency_iso CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

-- 4) Animal nickname must have at least one non-empty language (en or ru) -----------------
ALTER TABLE animals DROP CONSTRAINT IF EXISTS chk_animals_nickname_lang;
ALTER TABLE animals ADD  CONSTRAINT chk_animals_nickname_lang CHECK (
    coalesce(nullif(trim(nickname_localized ->> 'en'), ''), nullif(trim(nickname_localized ->> 'ru'), '')) IS NOT NULL
);

COMMIT;
