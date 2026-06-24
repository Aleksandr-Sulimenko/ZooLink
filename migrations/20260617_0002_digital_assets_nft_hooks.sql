-- Migration: 20260617_0002_digital_assets_nft_hooks
-- Purpose: add the digital_assets table (NFT/tokenization readiness hook) per ADR-0010.
-- Scope: schema hook only — no minting, contracts, wallets, or indexer in MVP.
--        Behavior is gated by feature_toggles ('digital_assets'). PostgreSQL remains source of truth.
-- Idempotent (IF [NOT] EXISTS guards).

BEGIN;

CREATE TABLE IF NOT EXISTS digital_assets (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id        UUID REFERENCES animals(id) ON DELETE RESTRICT,
    asset_type       VARCHAR(30) NOT NULL CHECK (asset_type IN ('PEDIGREE', 'CERTIFICATE', 'OWNERSHIP')),
    chain            VARCHAR(20) NOT NULL DEFAULT 'TON' CHECK (chain IN ('TON', 'POLYGON')),
    contract_address VARCHAR(120),
    token_id         VARCHAR(120),
    ipfs_cid         VARCHAR(120),
    metadata_uri     TEXT,
    tx_hash          VARCHAR(120),
    mint_status      VARCHAR(20) NOT NULL DEFAULT 'NONE'
                     CHECK (mint_status IN ('NONE', 'PENDING', 'MINTED', 'TRANSFERRED', 'FAILED')),
    created_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_digital_assets_animal ON digital_assets(animal_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_digital_asset_per_type ON digital_assets(animal_id, asset_type)
    WHERE mint_status IN ('PENDING', 'MINTED', 'TRANSFERRED');

-- Feature flag (disabled by default; NFT is Фаза 2+)
INSERT INTO feature_toggles (key, description, is_enabled, rollout_percentage)
VALUES ('digital_assets', 'NFT / digital-asset tokenization (ADR-0010). Disabled until Фаза 2+.', FALSE, 0)
ON CONFLICT (key) DO NOTHING;

COMMIT;
