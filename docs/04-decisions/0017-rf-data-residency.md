# ADR-0017: RF data residency — РФ-citizen PII primary, replicas, backups and DR stay in the Russian Federation

**Status**: Accepted — owner gave the go on RF-only topology (Option 3) 2026-07-02; RF-confined DR/HA and its cost accepted. Legal A3 P0 residency blocker closed **at the decision level**; **devops** now implements the region-pin + fail-on-non-RF guardrail (see *Guardrail specification*). Lineage: Proposed 2026-07-01 → **Accepted 2026-07-02**.
**Date**: 2026-07-01 (accepted 2026-07-02)
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

## Guardrail specification (devops handoff — normative)
Three complementary guards enforce clause 8. All three read **one canonical RF-region allowlist** (a single source of truth, e.g. a `RF_ALLOWED_REGIONS` constant) — never two divergent lists.

**(a) Runtime config validation (fail-at-boot).**
- Validate **every region-bearing env var**, at minimum `S3_REGION`, and any `*_REGION` / provider-region variable introduced for managed-PG, the backup target, the DR/failover target, and any log/observability sink.
- Enforce in the config schema with **zod `.refine()`** against `RF_ALLOWED_REGIONS` (an allowlist of approved RF region identifiers). A value not in the allowlist **throws at application boot** — the service must refuse to start rather than run against a non-RF store.
- **MinIO `us-east-1` trap (must-handle):** self-hosted S3/MinIO defaults its region string to `us-east-1` even when physically in the RF. The deployment MUST set `S3_REGION` to an **approved RF identifier**; the `us-east-1` default is therefore rejected by the refine — this is intended, and forces a deliberate, reviewed region-pin instead of a silent default.
- The exact allowlist identifiers derive from the **ADR-0008** chosen provider (e.g. Yandex Cloud `ru-central1*`); devops + legal confirm the identifier set. Because a region *string* is not proof of physical location, the allowlist is a config-hygiene guard layered on top of provider choice (ADR-0008) — not a substitute for it.

**(b) CI step (fail-on-non-RF, blocking).**
- A CI job parses the deploy config/IaC/env for the **prod** environment (and any staging that carries real PII) and **fails the pipeline** if any region-bearing value — for PG, replica, backup, object store, DR target, or PII-bearing log sink — is outside `RF_ALLOWED_REGIONS`.
- Same allowlist source as (a); **blocking**, not advisory (promote from advisory only once green, consistent with the migration-drift gate precedent).

**(c) Documented region-pin (deploy-runbook).**
- Record the region-pin as an **explicit, reviewed value** in `docs/specs/deployment/deployment_specification.md` (+ EN↔RU): state the RF-residency constraint, name the approved RF region identifier, and **remove/replace** the unconstrained cross-region replication/DR language at `:70,105` (the audit BLOCKER source). This runbook entry is the canonical documented pin that (a) and (b) enforce.

Guard chain: **runbook (documented) → CI (pre-deploy) → boot refine (runtime)** — defense in depth, single allowlist.

### Clause 6 — how the observability sink is closed (implemented 2026-08-09, security)
Clause 6 was **not** covered by (a)/(b) above: they scan region-bearing values, and the error sink is named by a **host**, not a region — so `SENTRY_DSN=https://<key>@o0.ingest.sentry.io/1` carried no `*_REGION` and no foreign-region token, and all three layers reported green while stack traces (PII-bearing) shipped abroad. Now closed by:
- **`SENTRY_DSN` host allowlist in `backend/src/config/env.validation.ts`** — canonical constant `RF_ALLOWED_TELEMETRY_HOST_SUFFIXES` (a code constant, deliberately **not** an env var: an allowlist the same `.env` could widen is not a guard). Empty DSN = sink disabled (permitted). Non-empty must resolve, by a **real URL parse** (the DSN's public key sits before the host, so substring checks are trivially defeated), to a self-hosted host (loopback / RFC1918 / IPv6-ULA / single-label service name) or an RF domain — otherwise the boot is blocked. Unparseable is rejected too (fail-closed). `RESIDENCY_ALLOW_NON_RF_DEV` relaxes it outside production only; in production it is ignored, as in the region rule.
- **Enforced a second time inside `initSentry` (`lib/observability/sentry.ts`)** — `main.ts` initialises Sentry from raw `process.env` **before** Nest, hence before the validator; a boot-only check would arrive after the very "invalid residency config" report had been delivered to the foreign ingest by the process guard.
- **CI gate `scripts/check-rf-residency.sh`** — new axis (3) reads the same constant and fails on a non-RF or unparseable DSN, so layer 2 can no longer be green while layer 1 would refuse.

## Related Decisions
- **ADR-0008** — RF-appropriate provider matrix (this ADR adds residency).
- **ADR-0012** — PII-at-rest encryption (complementary: where vs how-protected).
- **ADR-0009** — modular monolith (single deployable simplifies region pinning).

## References
- **ст.18 ч.5 ФЗ-152** (data localisation); **ст.12 ФЗ-152** (cross-border transfer); **ст.22 ФЗ-152** (РКН notification).
- `docs/legal/launch-compliance-checklist.md` **A3** (legal requirement → architect/devops topology ADR).
- `docs/specs/deployment/deployment_specification.md:70,105` (current unconstrained cross-region language — audit BLOCKER).
- `AUDIT_2026-06-30.md` Part A BLOCKER (RF residency).
