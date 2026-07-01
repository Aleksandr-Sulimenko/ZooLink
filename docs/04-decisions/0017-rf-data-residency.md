# ADR-0017: RF data residency — РФ-citizen PII primary, replicas, backups and DR stay in the Russian Federation

**Status**: Proposed — P0 go-live; awaiting owner go on RF topology/cost (owner reviewed Q1–Q6 2026-07-01)
**Date**: 2026-07-01
**Relates to**: [ADR-0008](0008-rf-provider-matrix.md) (RF-appropriate providers), [ADR-0009](0009-mvp-vs-target-architecture.md) (modular monolith), [ADR-0012](0012-pii-at-rest-encryption.md) (PII-at-rest), the Legal launch-compliance checklist **A3** (`docs/legal/launch-compliance-checklist.md`).
**Owner-actionable**: this is a **P0 go-live blocker** (legal A3). Legal set the *requirement*; this ADR fixes the *topology*; **devops** implements the deploy constraint + guardrail.

> **WHAT** — Mandate that all stores holding **personal data of RF citizens** — primary database, every replica, all backups, PII-bearing object storage, and any disaster-recovery/failover target — are physically located in the **Russian Federation**. Cross-region or cross-border processing is permitted **only** for data with PII removed (de-identified / aggregate), and even then subject to a separate ст.12 ФЗ-152 review with legal.
>
> **WHY** — ФЗ-152 ст.18 ч.5 requires that recording, systematisation, accumulation, storage, updating and retrieval of RF-citizens' personal data be performed **using databases located in the Russian Federation**. The deployment spec currently specifies cross-region replication / DR with **no RF-only constraint** (audit BLOCKER) → a РКН block / fine risk. This is a hard legal precondition for public launch (legal A3, ст.18 ч.5).
>
> **WHY-BETTER for the whole project** — Turns a legal requirement into a concrete, enforceable deployment invariant *before* any data exists, when it is free to satisfy — rather than after launch, when relocating a populated database across regions is a costly, risky migration. It composes cleanly with ADR-0008 (RF-appropriate third-party providers already chosen) and ADR-0012 (PII-at-rest): residency answers *where*, encryption answers *how-protected*. It keeps DR/HA achievable (multi-AZ **within** the RF) without surrendering compliance, and it adds an infra guardrail so a future config change can't silently ship PII abroad.

## Context and Problem Statement

The MVP is a modular monolith (ADR-0009) backed by PostgreSQL, Redis, and S3/MinIO, with RF-appropriate third-party providers already selected (ADR-0008). The deployment specification (`docs/specs/deployment/deployment_specification.md`) describes replication and DR but **nowhere constrains region**, and the audit flagged this as a go-live BLOCKER under ФЗ-152 ст.18 ч.5. Legal recorded the requirement in the launch-compliance checklist **A3** and explicitly handed the **topology decision to architect + devops**.

The PII inventory (`data-governance.md §1`, ADR-0012) — `users.{full_name,email,contact_*,avatar_url}`, `organizations.{inn,kpp,email,phone,address}`, notification recipients/content, and (Part B) provider documents and precise geo — is РФ-citizen personal data. Anywhere a copy of it can land (replica, backup, DR, object store, log sink) is in scope of ст.18 ч.5.

## Decision Drivers

1. **ФЗ-152 ст.18 ч.5** — primary recording/storage of RF-citizen PII must be in RF databases (the hard requirement; legal A3).
2. **All copies count** — replicas, backups, DR, object storage, and PII-bearing logs are equally in scope; "primary in RF, replica abroad" does not comply.
3. **DR/HA must remain achievable** — within the RF (multi-AZ / second RF region), not by exporting PII.
4. **Anti-rewrite / cost-of-change** — fix the topology before data exists; relocating a populated PII store later is a high-risk migration.
5. **Composes with ADR-0008 / ADR-0012** — RF providers + at-rest encryption already decided; residency is the missing *where*.
6. **Guardable** — the constraint must be enforced by infra config + a CI/deploy guardrail, not by hope.

## Considered Options

### Option 1: Single RF region, no cross-border anything (PII never leaves RF)
All primary, replicas, backups, object storage, DR within the RF; nothing PII-bearing crosses the border.

Pros:
- Unambiguously compliant with ст.18 ч.5; simplest to reason about and audit.
- No ст.12 cross-border-transfer notification needed.

Cons:
- DR limited to within-RF topology (acceptable: RF has multi-AZ / multi-region options).
- Cannot use a non-RF managed analytics/observability SaaS on raw PII (mitigated by de-identification — Option 3 carve-out).

### Option 2: RF primary + foreign DR replica / backup
Primary in RF; DR replica or backup held in a foreign region for resilience.

Pros:
- Geographic DR diversity.

Cons:
- **A replica/backup holding RF-citizen PII abroad violates ст.18 ч.5** — replicas and backups are "storage." Non-compliant. Rejected.

### Option 3: Single RF region for all PII-bearing stores; cross-border permitted only for de-identified/aggregate data (Chosen)
As Option 1, plus an explicit, narrow carve-out: data with PII removed (aggregate analytics, de-identified metrics) MAY be processed cross-region — subject to a separate ст.12 ФЗ-152 review with legal (checklist C5) before any such flow is enabled.

Pros:
- Fully compliant for PII; preserves a lawful path for cross-border *aggregate* analytics if ever needed.
- Keeps the door open without weakening the PII guarantee.

Cons:
- Requires a documented de-identification boundary so nothing PII-bearing slips into the carve-out (security + legal review the boundary).

## Decision

Adopt **Option 3**. Normative topology constraints (P0 go-live):

1. **Primary PostgreSQL** holding RF-citizen PII is hosted in the **Russian Federation**.
2. **Every replica** (read replica, HA standby) containing PII is in the **RF**.
3. **All backups / snapshots** of PII-bearing stores are stored in the **RF** only.
4. **PII-bearing object storage** (S3/MinIO — provider documents, avatars, any attachment containing PII) is **RF-resident**.
5. **Disaster recovery / failover** is **within the RF** (multi-AZ or a second RF region). No PII-bearing DR target outside the RF.
6. **Log/observability sinks** that may contain PII are **RF-resident**; PII is redacted before any non-RF sink (Pino PII-redaction already exists — extend the boundary to log destinations).
7. **Cross-border processing is permitted only for de-identified / aggregate data**, and only after a **separate ст.12 ФЗ-152 transfer review with legal** (checklist C5). De-identification boundary documented and reviewed (security + legal).
8. **Infra guardrail**: the region constraint is enforced in deployment config (IaC) with a **CI/deploy check** that fails if any PII-bearing store, replica, backup, object store, or DR target is configured outside the RF. (devops owns the guardrail.)
9. **Composes with ADR-0012**: residency (this ADR) + at-rest encryption (ADR-0012) are complementary, both required; neither substitutes for the other.

## Consequences

### Positive
- Closes the go-live BLOCKER under ст.18 ч.5; removes РКН-block risk on residency grounds.
- Fixed before data exists → zero-cost compliance vs a costly post-launch migration.
- A CI/deploy guardrail prevents silent regression to a non-RF region.
- Preserves a lawful, narrow path for cross-border aggregate analytics (de-identified only).

### Negative
- DR/HA confined to RF topology (acceptable; RF multi-AZ/region available).
- Non-RF managed SaaS cannot touch raw PII → either RF-hosted equivalents (ADR-0008 spirit) or de-identification.

### Neutral
- ADR-0008 provider matrix already RF-appropriate; this ADR adds the residency invariant on top.
- No change to MVP application code; this is a deployment-topology + infra-guardrail constraint.

## Implementation Notes (devops)
- Encode region pinning in compose/IaC for PG, replicas, backups, object storage, DR; add the **CI/deploy guardrail** (fail-on-non-RF-region).
- Update `docs/specs/deployment/deployment_specification.md` (+ EN↔RU) to state the RF-residency constraint and remove/replace the unconstrained cross-region replication/DR language (the audit BLOCKER source at `:70,105`).
- Extend the PII-redaction boundary to cover log/observability destinations.
- Coordinate with **legal** before enabling any cross-border de-identified flow (ст.12 review, checklist C5).

## Related Decisions
- **ADR-0008** — RF-appropriate provider matrix (this ADR adds residency).
- **ADR-0012** — PII-at-rest encryption (complementary: where vs how-protected).
- **ADR-0009** — modular monolith (single deployable simplifies region pinning).

## References
- **ст.18 ч.5 ФЗ-152** (data localisation); **ст.12 ФЗ-152** (cross-border transfer); **ст.22 ФЗ-152** (РКН notification).
- `docs/legal/launch-compliance-checklist.md` **A3** (legal requirement → architect/devops topology ADR).
- `docs/specs/deployment/deployment_specification.md:70,105` (current unconstrained cross-region language — audit BLOCKER).
- `AUDIT_2026-06-30.md` Part A BLOCKER (RF residency).
