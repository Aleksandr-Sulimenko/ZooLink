---
name: reference-data-localized-divergence
description: RESOLVED 2026-06-23 (A2/migration 0018) — reference-data localized flat→JSONB name_localized, provenance+sort_order, audit entity_id_int; code now conforms to nameLocalized contract
metadata:
  type: project
---

**RESOLVED 2026-06-23 — A2 (ADMIN_PHASE_ACTION_PLAN), migration `20260623_0018_reference_data_localized_provenance.sql`.**

The flat-`name_ru`/`name_en` vs contract-`nameLocalized` divergence is closed. What shipped:

- **Schema (migration 0018, tables +0 → 32):** species/breeds/cities migrated flat `name_ru`/`name_en`
  → `name_localized JSONB {ru,en}` (backfilled, flat columns DROPPED — single source of truth, owner-decision #3);
  added `sort_order INTEGER DEFAULT 0`, `created_by`/`updated_by` (nullable `FK→users(id) ON DELETE SET NULL`,
  agent-as-principal ready); per-locale `GIN ((name_localized -> 'xx'))` indexes. Added `audit_log.entity_id_int INTEGER`
  (+ partial index) for INT-keyed lookup entities (entity_id is UUID; INT lookups now audited by real id).
  `created_by`/`updated_by` are added in the **bottom ALTER mirror block** of `database_schema.sql`, NOT inline in
  CREATE TABLE — species/breeds/cities are defined (line ~17) BEFORE `users` (line ~106), so an inline FK would
  break a fresh build. (`name_localized`/`sort_order` are safe inline; they have no forward FK.)

- **Code:** `modules/admin/dto/reference-data.dto.ts` now has `LocalizedStringDto` + `nameLocalized` (Create/Update/
  entry) + `sortOrder`; `reference-data.service.ts` resolves localization per API_CONVENTIONS §6 — ADMIN reads return
  `nameLocalized` (both locales), PUBLIC reads return resolved `name` string via `resolveLang(Accept-Language)`
  (en fallback, default ru). `getById` is `@Public() + @UseGuards(OptionalJwtGuard)` so an admin token still yields
  both locales; controller sets `Vary: Accept-Language`. Audit uses `entityIdInt` (added to `AuditEntry` + audit-log.service).
  JSONB search uses Prisma `{ name_localized: { path: ['ru'], string_contains } }`.

- **Contract:** `admin-api.yaml ReferenceDataEntry` now declares both `name` (resolved, public) and nullable
  `nameLocalized` (admin) + `sortOrder`; Create/Update gained `sortOrder`.

- **Seed:** `migrations/0011` + `database_schema.sql` seed blocks rewritten to insert `name_localized` JSONB;
  cities NOT-EXISTS dedup now matches on `name_localized->>'ru'`. `npm run seed` idempotent ×2 (CI runs seed×2).

Validation: migration ran ×2 idempotent on live PG; negative tests passed (name_localized NOT NULL reject,
created_by FK reject, audit append-only still rejects UPDATE, AGENT principal + entity_id_int accepted). Unit 180 green,
admin e2e 13 green, lint/typecheck/build clean.

Still flat-camelCase NOTE (out of A2 scope): the GET list/getById ops in admin-api.yaml carry `x-required-roles: [ADMIN]`
but rbac-matrix + code make reference reads PUBLIC — pre-existing contract divergence, flagged for B0/doc-keeper.
See [[adr-0011-actor-snapshot-invariants]].
