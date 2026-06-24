---
name: audit-entityid-uuid-int-gap
description: getAuditLog/AuditLogEntry entityId is format:uuid but reference-data lookups are INT (entity_id_int) — INT ref-ids not filterable via /audit/log; contract-owner flag from D4
metadata:
  type: project
---

In `docs/03-architecture/api-contracts/admin-api.yaml`, both the `getAuditLog` `entityId` **query param** and the `AuditLogEntry.entityId` **response field** are `type: string, format: uuid`. But reference-data lookups (species/breeds/cities/health_certifications/genetic_markers) are **INT** (id-type convention) and their audit rows are keyed in `audit_log.entity_id_int` (A2 / migration 0018).

**Consequence:** audit entries for INT reference-data CRUD are *written* (entity_id_int) but **cannot be filtered or returned by id** through `/audit/log` — the contract has no INT-typed entity-id surface. `entityType=reference-data` filtering still works; only id-precise filtering is missing.

Surfaced during **D4** (spec 06 «Reference-data audit & operator security», 2026-06-24). I did NOT silently re-type the contract — this needs a decision (add `entityIdInt` query/field, or make entityId a union/string). Routed to the contract-owner (architect / admin-api owner), not a mechanical doc-keeper fix.

**Why:** doc↔contract drift — spec 06 now asserts reference edits are audit-readable via /audit/log, which is true at the entityType level but not the entity-id level.
**How to apply:** when admin-api audit filtering or AuditLogEntry shape is next touched, reconcile the UUID-only entityId against INT lookups; keep EN↔RU in sync. Related: [[b0-incidental-fixes]], [[reference-data-public-read]].
