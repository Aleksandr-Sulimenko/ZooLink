---
name: project-db-schema-audit
description: DB schema vs docs audit (2026-06-16) — which domains/state machines are NOT yet in database_schema.sql
metadata:
  type: project
---

Audit of `database_schema.sql` vs `docs/` (EN canon) on 2026-06-16. The schema covers ~55-60% of documented domains.

**Why:** ZooLink is in spec phase; schema is source of truth (not *_fixed/*.backup2). Knowing the gaps avoids re-discovering them every audit.

**How to apply:** When asked about DB coverage, state machines, or "is X persisted", check these known gaps first, then verify against current `database_schema.sql` (it may have changed).

Known gaps (as of 2026-06-16 — RE-VERIFY before acting):
- **Whole domains absent from schema:** Payment (PaymentTransaction/Refund per specs/14), Notification (NotificationLog/Template per specs/13), Moderation (ModerationDecision + immutable audit per specs/12), Matching results (matches table w/ NUMERIC(5,2) scores per 02-requirements/business-requirements/matching-domain.md). Also no general admin `audit_log` table (admin-api.yaml GET /audit/log).
- **Stateless entities:** `listings` and `users` have only `is_active BOOLEAN` — no `status` column, so listing_state_machine (6 states) and user_state_machine (6 states) are NOT realizable. Same for organizations/branches/organization_users (state machines exist in specs/11 but schema has only is_active).
- **No ownership_transfers process table** — only `animal_ownership_history` (append journal), insufficient for ownership_transfer_state_machine.
- **Geo-search:** no fallback lat/lng columns; only `location_point GEOGRAPHY` with GIST index gated behind PostGIS, which is commented out (line 8). Geo-search spec (specs/07) explicitly wants lat/lng columns.
- **Broken SQL in schema itself (3 DDL blockers, confirmed 2026-06-16):** (a) lines 366-368 `CHECK (... breed_text ...)` references non-existent column `breed_text` (real col `breed_text_localized`); (b) `organization_users` (line 73) FKs `users(id)` but `users` is created later (line 93) — forward FK fails; (c) `COMMENT ON COLUMN organizations.name_ru/name_en` (lines 419-420) target columns that don't exist (only `name_localized`). Script won't run as-is.
- **Money type:** `listings.price_cents INTEGER` + `currency CHAR(3)` is correct minor-units (NOT float), matches listings-api.yaml. But INTEGER caps ~21.5M RUB → recommend BIGINT for livestock; future Payment amounts must be BIGINT minor-units, never FLOAT.
- **Missing constraints:** no UNIQUE on `organizations.inn` (spec ORG-001 needs it); no UNIQUE on `organization_users(organization_id,user_id)` (ORGU-002); `branches.metadata` column missing though COMMENT + glossary reference it.
- **ON DELETE issues:** `animals.breed_id` SET NULL conflicts with immutability trigger (should be RESTRICT); `listings.animal_id` CASCADE conflicts with no-hard-delete MVP rule.

ERD `ZooLink_ERD.mmd` drift: draws `organizations }o..o{ branches` (should be 1:N), a non-existent `animals -> branches "kept at"` relation, and omits `listings.metadata`.
