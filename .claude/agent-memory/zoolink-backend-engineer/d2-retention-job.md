---
name: d2-retention-job
description: D2 retention job behaviour (listing auto-expire + erase-after-grace) wired into B7 scheduler; worker-only, no auth-module dep
metadata:
  type: project
---

D2 retention behaviour (ADMIN_PHASE_ACTION_PLAN.md) is implemented in `backend/src/lib/scheduler/retention.service.ts`, scheduled by `RetentionExpireJob` (same file dir) under the B7 `AdvisoryLockService` (`AdvisoryLockKeys.RETENTION_EXPIRE_TICK`).

**Why a separate RetentionService (not reuse AdminUserService.eraseUser):** the canonical erase lives in `modules/identity/admin-user.service.ts` but it depends on `AuthService` → pulls the HTTP-coupled identity/auth graph that is NOT in `WorkerModule`. RetentionService depends only on worker-available primitives (`PrismaService`, `AuditLogService`, `AppConfigService`) and inlines the session-revoke (`refresh_tokens.updateMany {revoked_at, revoked_reason:'ERASED'}`) instead of calling `AuthService.logout`. **Gotcha:** the erase field-action set is DUPLICATED between the two services — if one changes, change both (DEFAULT_NOTIFICATION_PREFS/DEFAULT_CONTACT_PREFS, full_name→'[deleted]', contact_* etc.).

**Two passes, both idempotent:**
- (a) `expireListings()`: parametrized `$executeRaw UPDATE listings SET status='EXPIRED' WHERE status='ACTIVE' AND expires_at IS NOT NULL AND expires_at < now()`. The approval-gate trigger `enforce_listing_active_requires_approval` only restricts transitions INTO ACTIVE, so ACTIVE→EXPIRED passes. Dormant until Listings sets expires_at.
- (b) `eraseDeactivatedPastGrace()`: `users` where `status=DEACTIVATED, erased_at IS NULL, deactivated_at < now()-RETENTION_GRACE_DAYS` → erase. Within-grace rows NOT selected.

**Actor = system:** `actorId:null, actorRole:'SYSTEM'`, principal_type defaults HUMAN at DB (platform automation, NOT an AI-agent decision — do not stamp AGENT).

**Env:** `RETENTION_TICK_CRON` (default `0 * * * *`) is read at `@Cron` decorator-eval time via `process.env` (decorators can't read DI) — deploy-time constant; still declared in env.validation for shape. `RETENTION_GRACE_DAYS` (default 30) read via AppConfigService.

**Tests:** `backend/test/retention.e2e-spec.ts` (live PG, runs under jest-e2e config) — constructs RetentionService directly, seeds rows, verifies within-grace/within-expiry NOT touched + idempotency. Cleanup gotcha: `audit_log` is append-only (`trg_audit_log_append_only`) → CANNOT deleteMany; leave the test audit rows (entity_id has no FK so users delete is free).

See [[b7-b8-b10-admin-forms]] for the B7 skeleton this fills, [[adr-0011-actor-snapshot-invariants]] for actor_principal_type.
