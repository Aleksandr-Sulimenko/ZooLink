---
name: actor-badge-canon
description: The Actor agent-badge contract form (ADR-0011 §6 / API_CONVENTIONS §15) — what every actor-bearing response must carry.
metadata:
  type: project
---

ADR-0011 (Accepted 2026-06-23) fixes the actor-recording form. Contract mirror = API_CONVENTIONS.md **§15**.

**Rule:** any response/event naming an actor uses the shared `Actor` schema, never a bare uuid:
```
Actor: { actorId: uuid, principalType: enum[HUMAN,AGENT], actorDisplayName?: string }
```
`principalType` is the **write-time snapshot** of `users.principal_type` (mirrors schema cols `audit_log.actor_principal_type` / `moderation_decisions.actor_principal_type`, migration 0016). DEFAULT HUMAN in MVP.

**Moderation-decision ledger also carries the human-override chain** (ADR-0011 §2/§3):
`actorRole` (role snapshot), `supersedesDecisionId` + `isHumanOverride` (non-null together — biconditional `chk_moddec_override`). Override row's `actor.principalType` MUST be HUMAN.

**Where applied (B0.6 done):** `Actor` schema defined per-file in moderation-api.yaml AND admin-api.yaml (each contract is self-contained — no shared $ref file). Fields:
- moderation-api: `ModerationDecision.actor`(+actorRole/supersedes/isHumanOverride), `ContentReport.resolvedBy`
- admin-api: `ModerationLogEntry.actor`, `ModerationActionResponse.actor`, `AuditLogEntry.actor`, `SystemSetting.updatedBy`
- admin-api audit-log **query filter** `performedBy`→`actorId` (filters take the scalar id, not the object — §15 note).

**Easy to forget:** `Actor` must be added to BOTH yaml files' `components.schemas` (they don't share a components file). Query filters stay scalar `actorId`. `API_CONVENTIONS.md` has NO RU mirror — but the `.yaml` contracts DO (docsRU/03-architecture/api-contracts/). [[contract-files-mirror]] [[b0-incidental-fixes]]

ADR-0011 RU mirror: `docsRU/04-decisions/0011-agent-principal-actor-model.md` (created 2026-06-23; both READMEs updated to list it — architect had left both unindexed).
