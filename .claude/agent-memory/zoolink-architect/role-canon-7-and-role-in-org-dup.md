---
name: role-canon-7-and-role-in-org-dup
description: Locked role canon (7 roles, additive, SUPER_ADMIN out, principal_type ⟂ role) + live role_in_org schema contradiction
metadata:
  type: project
---

Role canon anchored in ADR-0011 §7 (do not duplicate across BR docs):
- `users.role` = exactly 7: USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER (schema:109).
- Additive model (BREEDER/FARMER/VET/GROOMER = USER + extras, inherit USER perms via CASL composition).
- SUPER_ADMIN is NOT a users.role value (break-glass modelled outside the enum).
- `principal_type ⟂ role` (orthogonal) — anchored in ADR-0011, MUST NOT become a cross-column CHECK (that coupling would be a future rewrite point).
- `organization_users.role_in_org` = {OWNER, ADMIN, STAFF, VET}; MODERATOR is NOT valid (moderation = platform-operator role, not org membership).

**Live schema contradiction (flagged for backend migration-spec, ADR-0011 §D):**
- schema line ~79 inline CREATE TABLE CHECK INCLUDES 'MODERATOR'.
- schema line ~986 named `chk_org_user_role` ALTER DROPS MODERATOR (4-value) — this is the EFFECTIVE runtime state and the correct canon.
- comment line ~722 still lists MODERATOR (stale).
Fix: make the 4-value set the single source of truth — update inline CHECK :79, keep :986, fix comment :722.

**How to apply:** when any agent proposes a role enum change, this is the canon; the role_in_org fix is a backend task, not yet applied (as of 2026-06-23).
