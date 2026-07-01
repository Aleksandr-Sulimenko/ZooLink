# Architecture Decision Records

This directory contains all the Architecture Decision Records (ADRs) for the ZooLink project.

## ADR list

- [ADR-0001: Technology stack selection](0001-tech-stack.md)
- [ADR-0002: Hard split between the pet and livestock markets](0002-hard-split-markets.md)
- [ADR-0003: Pre-moderation workflow for listings](0003-pre-moderation-workflow.md)
- [ADR-0004: Animal as the aggregate root](0004-animal-as-aggregate.md)
- [ADR-0005: No built-in chat in the MVP](0005-no-chat-mvp.md)
- [ADR-0006: AI agents as platform operators (moderation, admin, and beyond)](0006-ai-agents-operate-platform.md)
- [ADR-0007: ORM strategy — Prisma primary with a typed raw-SQL escape hatch](0007-orm-strategy.md)
- [ADR-0008: RF-appropriate third-party provider matrix](0008-rf-provider-matrix.md)
- [ADR-0009: MVP architecture is a modular monolith — defer microservices/K8s to Фаза 2+](0009-mvp-vs-target-architecture.md)
- [ADR-0010: Digital-asset (NFT) readiness — schema hooks now, on-chain in Фаза 2+](0010-nft-digital-assets-hooks.md)
- [ADR-0011: Agent-Principal Actor Model — actor snapshot, human-override, forward-compatible service-auth](0011-agent-principal-actor-model.md)
- [ADR-0012: PII-at-rest encryption](0012-pii-at-rest-encryption.md)
- [ADR-0013: MVP Ownership Transfer — simplified direct transfer, controlled owner-lock path, deferred verification gates](0013-mvp-ownership-transfer.md)
- [ADR-0014: Offering supertype — polymorphic discovery + moderation seam (anti-god-table)](0014-offering-supertype-polymorphic-seam.md) *(Accepted — ratified 2026-07-01, jointly w/ 0015)*
- [ADR-0015: `market_scope` — refine the ADR-0002 hard split for species-less offerings](0015-market-scope-refines-0002.md) *(Accepted — ratified 2026-07-01, jointly w/ 0014)*
- [ADR-0016: Provider model — org-backed | individual | agent-provider](0016-provider-model.md) *(Proposed — awaiting security+legal verification matrix)*
- [ADR-0017: RF data residency — РФ-citizen PII stays in the Russian Federation](0017-rf-data-residency.md) *(Proposed — P0 go-live; awaiting owner go on RF topology/cost)*
- [ADR-0018: Cross-aggregate access rule — route animal reads through AnimalService (reaffirm ADR-0004)](0018-cross-aggregate-access-rule.md) *(Proposed — ready; awaiting owner nod)*
- [ADR-0019: PII-at-rest — enforce the ADR-0012 form now (blind-index + crypto seam), stage rollout](0019-pii-at-rest-form-enforcement.md) *(Proposed — awaiting security+legal at-rest sign-off)*

> **Decision memo:** [Ecosystem ADR Plan & Open-Decision Memo (Q1–Q6)](ECOSYSTEM_ADR_PLAN.md) — architect's brief; **Q1–Q6 owner-ratified 2026-07-01** (0014+0015 Accepted jointly; 0016–0019 stay Proposed with explicit awaiting-conditions).

## Template

Use the [ADR template](template.md) to create new architecture decisions.

## Related documents

- [Domain specifications](../specs/)
- [Requirements](../02-requirements/)
- [Architecture](../03-architecture/)
