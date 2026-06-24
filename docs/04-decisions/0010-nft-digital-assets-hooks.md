# ADR-0010: Digital-asset (NFT) readiness — schema hooks now, on-chain in Фаза 2+

**Status**: Accepted
**Date**: 2026-06-17

## Context and Problem Statement

Tokenization (NFT) is a plausible future for ZooLink: verifiable **pedigree**, **breed/show certificates**, and
**ownership** of animals. The current stack has **no Web3 element**. The audit (`BACKEND_TECH_AUDIT.md`,
Sub-agent 4) concluded NFT is **correctly out of MVP scope**, but recommended laying **cheap schema/architecture
hooks now** so a Фаза 2+ implementation does not require breaking changes.

The schema already provides the substrate: pedigree (`animals.mother_id/father_id`, `pedigree_id`,
`show_titles`, `health_test_results`), ownership process (`ownership_transfers`, `animal_ownership_history`),
and reliable outbound integration (`outbox_events`). Telegram OAuth is already integrated — which makes **TON**
a natural, RF-friendly chain choice.

## Decision Drivers

- **No MVP cost/scope creep**: hooks must be near-free; no on-chain code in Фаза 1.
- **No future rework**: a Фаза 2 mint/transfer must fit existing aggregates and the outbox pattern.
- **RF fit**: chain and wallet UX must suit the RF mass market.
- **PII safety (ФЗ-152)**: no personal data in public on-chain metadata.

## Considered Options

### Chain
- **TON** — Telegram-native (Telegram OAuth already present), popular in RF, low fees. **Chosen default.**
- **Polygon (PoS)** — EVM, huge tooling/talent, low fees. **Accepted alternative.**
- Ethereum L1 — rejected (gas cost, overkill for certificates).

### Metadata storage
- **IPFS (pinned) / Arweave** for metadata+media, with **PostgreSQL remaining the source of truth**. Chosen.
- Fully on-chain media — rejected (cost; and would risk PII on-chain).

### Indexer (chain → app sync)
- **The Graph (subgraph)** for EVM, or a **custom listener worker** (TON: toncenter SSE; EVM: viem/ethers) that
  writes back through an inbox/outbox table. Decide at implementation time.

## Decision

Lay **hooks only** now; implement on-chain in Фаза 2+:

1. Add a **`digital_assets`** table (see Implementation Notes) linking an on-chain token to an animal/certificate.
2. **Reuse `outbox_events`** for app→chain mint/transfer intents; add an indexer worker for chain→app sync in Фаза 2.
3. Default chain **TON** (alt: Polygon); metadata on **IPFS/Arweave**; **PostgreSQL stays source of truth**.
4. **Custodial / account-abstraction wallets** for mass-market UX (users do not manage seed phrases); the
   platform may sponsor gas (gasless meta-transactions / TON Connect custodial mode).
5. On-chain metadata contains **only public, verifiable facts** (origin, titles) — **never** owner PII.

No minting, contracts, wallets, or indexer are built in the MVP. The table ships nullable/empty and gated by a
`feature_toggles` flag.

## Consequences

### Positive
- Фаза 2 tokenization fits existing aggregates and the outbox pattern with no schema break.
- Chain choice (TON) leverages the already-integrated Telegram identity.

### Negative
- One unused table + a feature flag carried through MVP (negligible cost).

### Neutral
- Whether to ever ship NFT remains a business decision; the hooks impose no obligation.

## Implementation Notes

Proposed table (DDL lands in `database_schema.sql`; ERD updated):

```sql
CREATE TABLE digital_assets (
    id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id         UUID REFERENCES animals(id) ON DELETE RESTRICT,
    asset_type        VARCHAR(30) NOT NULL CHECK (asset_type IN ('PEDIGREE','CERTIFICATE','OWNERSHIP')),
    chain             VARCHAR(20) NOT NULL DEFAULT 'TON' CHECK (chain IN ('TON','POLYGON')),
    contract_address  VARCHAR(120),
    token_id          VARCHAR(120),
    ipfs_cid          VARCHAR(120),
    metadata_uri      TEXT,
    tx_hash           VARCHAR(120),
    mint_status       VARCHAR(20) NOT NULL DEFAULT 'NONE'
                      CHECK (mint_status IN ('NONE','PENDING','MINTED','TRANSFERRED','FAILED')),
    created_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
-- one live token per (animal, asset_type)
CREATE UNIQUE INDEX uq_digital_asset_per_type
    ON digital_assets(animal_id, asset_type)
    WHERE mint_status IN ('PENDING','MINTED','TRANSFERRED');
```

- Gate all behavior behind `feature_toggles` (key e.g. `digital_assets`).
- Chain→app sync writes through the outbox/inbox; never trust chain state without confirmation depth.

## Related Decisions

- [ADR-0004](0004-animal-as-aggregate.md): animal is the aggregate root the token attaches to.
- [ADR-0008](0008-rf-provider-matrix.md): RF provider posture (TON via Telegram).
- [ADR-0009](0009-mvp-vs-target-architecture.md): Фаза 2+ is where minting/indexer live.

## References

- `BACKEND_TECH_AUDIT.md` — Sub-agent 4 (Web3 & NFT Expert).
- `ZooLink_ERD.mmd`, `database_schema.sql`, `specs/statemachines/ownership_transfer_state_machine.md`.
