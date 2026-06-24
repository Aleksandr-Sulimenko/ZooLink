-- Migration: 20260617_0007_species_market
-- Purpose: enable the pet/livestock hard split (ADR-0002, market-differences.md) at the data level.
-- A species belongs to exactly one market; a listing's market is derived from its animal's species.
-- Idempotent.

BEGIN;

ALTER TABLE species ADD COLUMN IF NOT EXISTS market VARCHAR(10) NOT NULL DEFAULT 'pet'
    CHECK (market IN ('pet', 'livestock'));

-- Seed markets for known demo species by code (no-op if codes differ; admin sets the rest).
UPDATE species SET market = 'livestock'
 WHERE code IN ('cattle', 'cow', 'bull', 'sheep', 'goat', 'pig', 'horse', 'poultry', 'chicken');

COMMIT;
