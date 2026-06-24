---
name: b0-incidental-fixes
description: Doc↔schema drift fixes made during B0 contract pass that go beyond pure casing/Problem/etc.
metadata:
  type: project
---

During the B0 conformance pass (2026-06-23) several latent doc↔schema/convention bugs were corrected alongside the mechanical changes. These are flagged for the orchestrator to reconcile against code/CAPABILITY_DIGEST:

- **UUID→INT for lookups in contract bodies:** `speciesId`/`breedId`/`cityId` were `format: uuid` in matching-api (AnimalSummary/SpeciesSummary/BreedSummary), admin-api (ModerationQueueItem/AnimalSummary/UserSummary/UserRoleInfo). Changed to `type: integer` per id-type convention (lookups=INT) — they must match `database_schema.sql`. [[api-conformance-b0]]
- **admin-api `sortBy`/`sortOrder` → `sort`:** API_CONVENTIONS §12 supersedes camelCase sort params with `sort=<field>:<asc|desc>` (snake_case field). Applied to moderation/queue and audit/log.
- **admin-api system-settings PATCH path bug:** PATCH had a `{key}` path param but the path was `/system/settings` (no `{key}`). Moved to `/system/settings/{key}`.
- **AnimalUpdate (animals-api) localized-field mismatch:** used flat `nickname`/`color_coat` while Animal/AnimalCreate used localized maps. Unified to `nicknameLocalized`/`descriptionLocalized` LocalizedString.
- **B0.6 DONE (2026-06-23, ADR-0011 §6 landed):** shared `Actor {actorId, principalType, actorDisplayName?}` schema added to moderation-api + admin-api. Applied: moderation-api `ModerationDecision.actor` (+`actorRole`,`supersedesDecisionId`,`isHumanOverride` for human-override chain), `ContentReport.resolvedBy`; admin-api `ModerationLogEntry.actor`, `ModerationActionResponse.actor`, `AuditLogEntry.actor` (folded `performedByName`→`actor.actorDisplayName`), `SystemSetting.updatedBy`. Audit-log filter param `performedBy`→`actorId`. Rule is now API_CONVENTIONS §15 + Conformance-status flipped to done. EN+RU synced. See [[actor-badge-canon]].

If code already shipped any of these as UUID/old-casing, that's a CAPABILITY_DIGEST divergence for the orchestrator to sweep.
