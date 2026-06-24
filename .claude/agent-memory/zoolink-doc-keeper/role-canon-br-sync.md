---
name: role-canon-br-sync
description: Role canon across BR docs — 7 users.role, 4 role_in_org, no SUPER_ADMIN; where each drifted and the fix
metadata:
  type: project
---

Role canon (source of truth: `database_schema.sql` + `docs/specs/security/rbac-matrix.md` + ADR-0011):
- `users.role` = **7 roles** `{USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER}`. Additive model (BREEDER/FARMER/VET/GROOMER = USER + extras). MODERATOR/ADMIN = operator roles.
- `organization_users.role_in_org` = **4 roles** `{OWNER, ADMIN, STAFF, VET}`. MODERATOR is NOT a valid role_in_org (it's a platform-operator role).
- **SUPER_ADMIN is NOT a `users.role` value** — break-glass/devops capability modelled outside the enum (ADR-0011 §7).
- `principal_type` (HUMAN|AGENT) is orthogonal to `role` (ADR-0006); operator roles may be held by an AI agent.

**BR drift fixed (ADMIN_PHASE_ACTION_PLAN A1, 2026-06-23) — GAP-TRACE-004 / 008:**
- `business-requirements/identity-domain.md:173` (+RU): role enum was missing BREEDER/FARMER → added.
- `business-requirements/admin-domain.md` (+RU): SUPER_ADMIN was in `users.role` prose (§3) → moved out-of-system; role enums in Core Concepts §3 + data-model "User Role Assignment" table expanded to 7; additive-role paragraph added.
- `business-requirements/organization-domain.md:44,129` (+RU): role_in_org enum listed MODERATOR → removed (4-canon).

**Note:** VET (role_in_org) ≡ VETERINARIAN (users.role) — same profession, two role systems. See glossary "VET ≡ VETERINARIAN".

Easy-to-miss: the role enum appears in BOTH the prose §3 AND the conceptual data-model table within the same BR file — fix both.
