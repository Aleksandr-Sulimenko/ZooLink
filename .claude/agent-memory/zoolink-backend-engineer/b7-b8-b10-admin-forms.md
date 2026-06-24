---
name: b7-b8-b10-admin-forms
description: B7 scheduler-form (@nestjs/schedule v6 + PG advisory-lock), B8 observability (audit principal_type + prom counter + Pino customProps), B10 decision_templates table (migration 0022, 35 tables)
metadata:
  type: project
---

Shipped 2026-06-24 (ADMIN_PHASE_ACTION_PLAN B7/B8/B10 "form now / behaviour later"). UNCOMMITTED.

**B10 — `decision_templates` (migration 0022, tables 34 → 35):**
- INT SERIAL id; `body_localized` JSONB {ru,en} (NOT name_localized — it's prose notes); `applies_to_decision`
  CHECK {REJECTED, CHANGES_REQUESTED}; `market` CHECK {pet,livestock}; `related_reason_code` nullable
  FK→moderation_reasons(code) ON DELETE SET NULL; sort_order/is_active/created_by/updated_by; UNIQUE (market, code);
  per-locale GIN on body_localized; `update_decision_templates_updated_at` trigger. Same A2/A3 lookup shape.
- **GOTCHA (fresh-build ordering):** the SEED references moderation_reasons(code), so in `database_schema.sql`
  the decision_templates **CREATE TABLE** block lives in the A3 area (after users + moderation_reasons CREATE)
  but its **seed INSERT** had to be moved DOWN to right after the moderation_reasons SEED block (~line 1283),
  else a fresh full-schema build hits the FK before reasons exist. Migration 0022 is self-contained (runs after
  0010 in numeric order; seed runner order is 0011, 0010, 0022).
- Seed runner: added 0022 to `src/seed.ts` SEED_FILES (after 0010) + COUNT_TABLES. `npm run seed` ×2 idempotent.
- Validation: migration ×2 idempotent on live PG; fresh-schema build clean; negatives all rejected
  (bad applies_to_decision, bad market, dup (market,code), bad related_reason_code FK); same-code-diff-market OK;
  updated_at trigger fires. Behaviour (templateCode selection at decision) = Moderation domain, not built.

**B7 — scheduler form (`src/lib/scheduler/`):**
- `@nestjs/schedule` v4/v5 are NestJS≤10 only — on NestJS 11 you MUST use **^6.x** (peer ^10||^11). Installed 6.1.3.
- `AdvisoryLockService.runExclusive(key, work)` = `pg_try_advisory_lock(bigint)` (non-blocking, session-level,
  auto-released on crash) → exactly one worker instance runs a tick when scaled out. Keys in `AdvisoryLockKeys`
  (RETENTION_EXPIRE_TICK=4201n). Always unlocks in finally (incl. on throw).
- `RetentionExpireJob` = `@Cron(EVERY_HOUR)` skeleton, no-op log, `if (config.isTest) return`. D2 work goes inside
  the runExclusive callback later. The callback returns Promise.resolve() (NOT async — eslint require-await).
- `SchedulerModule` (ScheduleModule.forRoot() + DbModule) registered in **WorkerModule ONLY** — never AppModule
  (double-fire). Worker.ts log updated.

**B8 — observability of agent actions:**
- `AuditEntry.actorPrincipalType?: PrincipalType` added; `AuditLogService` now writes `actor_principal_type`
  (defaults 'HUMAN') AND increments `AuditMetrics`. Constructor gained AuditMetrics (no spec instantiates it
  directly — all mock the service, so no test breakage).
- `AuditMetrics` (`src/lib/audit/audit.metrics.ts`): prom Counter `zoolink_audit_actions_total{principal_type,action}`.
  MetricsService injected `@Optional()` — registered in API only (owns /metrics); in worker it degrades to no-op.
  Low-cardinality labels only (no PII).
- Pino `customProps` in logger.module.ts stamps `{principalType, actorId, actorRole}` from req.user onto every
  request log line (eval at response time, after guards). x-request-id (reqId) already there = correlation id for
  agent→override chains. PII redact block unchanged — verified live in e2e logs (authorization REDACTED, principalType shown).

Tests: 187 unit (was 180; +3 advisory-lock, +2 audit.metrics, +2 audit-log.service) + 42 e2e green.
typecheck/lint/build clean. db:sync done. Counts bumped to 35 in both CLAUDE.md + data-model + ERD.
See [[adr-0011-actor-snapshot-invariants]], [[reference-data-localized-divergence]].
