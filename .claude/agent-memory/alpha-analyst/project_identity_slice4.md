---
name: identity-slice4-patterns
description: Identity Slice 4 (recovery/erase/role-elevation) design decisions & reconciliations worth reusing
metadata:
  type: project
---

Identity domain closed with Slice 4 (2026-06-19): email-OTP recovery, ФЗ-152 `erase_user`, ADMIN role-elevation/rebind.

**Why these matter for future specs:**

- **Schema NOT NULL beats spec prose (truth hierarchy).** `data-governance.md §1` says NULL `users.phone_hash`/`notification_logs.recipient` on erasure, but both columns are NOT NULL in `database_schema.sql`. Resolution = **tombstone** (`full_name`→`'[deleted]'`, `recipient`→`'[erased]'`) not NULL. Always check column nullability in `database_schema.sql` before specifying a NULL-on-erase action.
  **How to apply:** when a governance/erase spec says "NULL field X", grep the column def first; if NOT NULL, spec a tombstone and note the reconciliation triple.

- **OtpService is namespace-parameterised.** `issue/verify/attempts(subject, ns='otp')` — default `ns` keeps phone-registration keys (`otp:*`) unchanged; recovery uses `recover:email`. Reuse this for ANY new OTP flow (don't duplicate the Redis lifecycle).

- **Recovery = no account enumeration.** `/auth/recover/email/request` ALWAYS returns 202 and only actually sends/issues an OTP when a recoverable verified-email account exists. Verify returns uniform 400 for both wrong-code and no-account. Reuse this convention for any "request a code by identifier" endpoint.

- **`erase_user` is anonymise-in-place, keep UUID** (FK RESTRICT integrity). Marker column `users.erased_at` (migration 0015) makes erase idempotent and distinguishes erased from merely DEACTIVATED. `status` stays the single state-machine source of truth; `erased_at`/`deactivated_at` are derived facts, NOT new states (no CHECK change).

- **Round-4 session rules enforced everywhere actor/role/status changes:** role change (`AdminUserService.setRole`) and identifier rebind both call `auth.logout(userId)` to revoke ALL refresh families. Any future privileged mutation of a user's role/status/identifier MUST revoke sessions.

- **Tracked (apex, not silently dropped) in `BACKEND_IMPLEMENTATION_PLAN.md`:** (a) no grace-scheduler in MVP — `/me/erase` deactivates + records request, anonymisation run by ADMIN/retention-job later; (b) ObjectStorage port has NO `delete` → avatar S3 object not physically deleted (only `avatar_url` NULLed); (c) recovery anti-enumeration is best-effort, not constant-time.

Related: [[business-requirements-are-apex]], [[id-type-convention]]
