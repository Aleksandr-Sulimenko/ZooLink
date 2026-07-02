# ZooLink HYPER Audit — Phase 2 · devops (OPS/CI under forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Role:** devops · **Method:** verified the
2026-07-01 fix commits against live code/CI/compose, then swept observability, hygiene and forward-compat
(residency, PostGIS, object-store, event fan-out). Grounded in actual files, not the stale 2026-06-30 audit.

Finding format: `[severity][criterion][devops] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ ci · observability · hygiene · residency ·
forward-compat · fix-verify.

---

## A. Fix-verification (the three 2026-07-01 fixes) — all REAL and correct

### A1. CI `migration-drift` guard (commit addb377) — ✅ VERIFIED REAL & CORRECT
`.github/workflows/ci.yml:107-163`. A dedicated `migration-drift` job:
- creates throwaway `canonical` + `migrated` DBs (`:127`);
- Path 1 = fresh `database_schema.sql` (`:132`); Path 2 = schema + replay all `migrations/*.sql` pass 1 (`:135`),
  then **pass 2 idempotency** replay (HARD GATE, `:142` — same discipline as seed×2);
- **BLOCKING** normalized `pg_dump --schema-only` DDL diff canonical vs migrated (`:148-163`).
Confirmed 28 migrations present (`0001…0028`), `database_schema.sql` present (91 KB). The claim "replays 0001-0028
idempotent ×2 + diffs vs schema dump" is accurate. Good gate; genuinely catches drift (0023 CHECK-name drift was
its first catch, reconciled in 0026).

### A2. Self-provisioning compose (commit 082a85f) — ✅ VERIFIED REAL & CORRECT
`docker-compose.yml:34-51` one-shot `provision` service (built from Dockerfile `build` target, internal net, no
ports, `restart: "no"`); `api`/`worker` gate on it via `service_completed_successfully` (`:60,85`).
`backend/src/provision.ts` guards with `to_regclass('public.users')` (`:49-52`) — applies the non-idempotent
`database_schema.sql` ONLY on empty DB, then always runs idempotent `npm run seed` (`SEED_FORCE=true`). Mirrors the
CI sequence, single-sources the seed-file list in seed.ts. Correct and idempotent on re-run.

### A3. `deployment-mvp.md` off `prisma migrate deploy` (ADR-0007) — ✅ VERIFIED REAL & CORRECT
`docs/06-operations/deployment-mvp.md:18-23,52-66` — first-deploy = `docker compose up` (provision bootstrap);
"schema changes on update" = replay NEW idempotent migrations, explicitly "never `prisma migrate deploy`". EN↔RU
mirror present (`docsRU/06-operations/deployment-mvp.md`). No `prisma migrate deploy` anywhere in the repo.

### Residual gaps in the fixes (reviewer-qa flags confirmed)
- `[MAJOR][ci][devops] .github/workflows/ci.yml:148 → the drift diff is DDL-only (pg_dump --schema-only); seed/reference-DATA idempotency is asserted only as "runs twice without error" (seed×2 :75, migration pass2 :142), never as row-count/content stability. A seed statement that is non-ON-CONFLICT or an UPDATE-drift would pass silently → add a data-level assertion: snapshot key reference tables (species/breeds/cities/feature_toggles/moderation reasons) row-count + hash after run 1 vs run 2 and diff (see Ops probe P2).`
- `[MAJOR][ci][devops] .github/workflows/ci.yml:135 → no from-N-1 upgrade path is tested. Path 2 replays ALL migrations on top of the CURRENT full database_schema.sql, proving idempotency-against-head — but the REAL production update (a populated DB at release N-1, apply ONLY the new migration) is never exercised. A migration that assumes a fresh/head schema, or depends on rows a prior migration created, would ship untested → add a job that builds an older tagged schema (or schema-minus-last-migration) and applies only the newest migration(s) (Ops probe P1).`

---

## B. Observability gaps (audit)

- `[MAJOR][observability][devops] backend/src/worker.module.ts:20 → the worker is observability-blind: WorkerModule imports no MetricsModule and runs no HTTP server (worker.ts:11-18 = createApplicationContext, no listen), so it exposes NO /metrics and NO /health. The worker hosts the outbox relay + scheduler (the async heart of the system) yet cannot be scraped or health-probed; docker-compose.yml:82 disables its healthcheck (liveness = process up only). A stalled relay/scheduler is invisible → add a minimal metrics/health HTTP listener to the worker (or a push-gateway), export relay lag + scheduler tick as metrics.`
- `[MAJOR][observability][devops] backend/src/lib/metrics/metrics.service.ts:8-13 → near-zero custom metrics: the registry has collectDefaultMetrics (Node runtime) + exactly ONE domain metric (audit.metrics.ts:22 Counter). None of the SLO signals the product needs exist: ModerationQueueDepth (PENDING count), moderation-SLA (pet<4h/livestock<6h), geo-search latency, HTTP request histogram, outbox depth/lag, contact-reveal rate. monitoring.md:241-244 DEFINES alerts (ModerationQueueDepth, GeoSearchSLAViolation, ModerationSLA*) whose metrics are never fed → the alert config is fiction → instrument the domain counters/gauges/histograms these alerts consume before wiring Alertmanager.`
- `[MAJOR][observability][devops] docs/06-operations/monitoring.md:1-4,78,218-223,225-235 → the doc (Status Draft, dated 2026-06-13) specifies a Kubernetes/ELK/Jaeger/Grafana stack that is NOT deployed (MVP is compose, ADR-0009). It alerts on NodeDown/PodCrashLooping/CPUThrottling (:219-223) and Postgres/Redis REPLICATION LAG (:228,235) for replicas that DO NOT EXIST (single-VM MVP, no replicas). References ADR-0001/0002/… with wrong titles (:452-457). Documents a target-state observability platform as if current → split into "MVP-now" (prom-client /metrics + Pino JSON + Sentry, per deployment-mvp.md:85) vs "Target (Фаза 2+)"; drop replica/K8s alerts from the MVP section.`
- `[MAJOR][observability][devops] docs/06-operations/runbooks/ → runbooks are empty: only README.md (1.2 KB) exists; monitoring.md:433-441 lists runbook TITLES with no procedures. ADR-0006 (agent-operated platform) needs agent-drivable runbooks → author the concrete high-latency / moderation-backlog / DB-connection-exhaustion / failed-deploy / restore runbooks as deterministic step lists.`
- `[MAJOR][observability][devops] docker-compose.yml (no backup service) + deployment-mvp.md:68-79 → backups are manual (a documented pg_dump one-liner "cron on host or worker", not wired). No automated backup service, no retention enforcement, no restore drill. RPO is aspirational → add a backup sidecar/cron (pg_dump → RF object store, 30d/12w retention per ADR-0017) and a periodic restore-verify.`

---

## C. Hygiene

- `[MINOR][hygiene][devops] .idea/.gitignore, .idea/ZooLink.iml, .idea/modules.xml, .idea/vcs.xml → committed IDE files despite .gitignore:22 having `.idea/` (gitignore does not untrack already-tracked files) → `git rm -r --cached .idea` and commit.`
- `[MAJOR][hygiene][devops] .github/workflows/ci.yml:191,195 → Semgrep (SAST) and Trivy (fs scan) are continue-on-error:true (advisory). Supply-chain/SAST findings never block a merge. npm-audit prod tree IS blocking (:180, good) → tune rules + SARIF upload, then flip continue-on-error→false to make them gates (comment at :186-187 already promises this).`
- `[INFO][hygiene][devops] docker-compose.yml:125 minio pinned to RELEASE.2025-09-07T16-13-09Z (was floating :latest) → ✅ FIXED. Note: MinIO archived the community repo (Oct 2025), so this is end-of-line — reinforces ADR-0008 production swap to Yandex Object Storage.`
- `[INFO][hygiene][devops] backend/Dockerfile:5,13,19 + ci.yml:44 + performance-tests.yml:45 all Node 20 → ✅ Node 18↔20 drift RESOLVED (perf-tests bumped in addb377).`
- `[INFO][hygiene][devops] backend/src/config/env.validation.ts:48,118 AGENT_SERVICE_SIGNING_SECRET is optional in dev, REQUIRED min-32 in production (fail-fast). Pattern is sound; ensure .env.example carries a placeholder + comment so the prod-required contract is discoverable → требует ручной проверки that .env.example documents it.`

---

## D. FORWARD-COMPAT (main) — infra readiness verdict

- `[BLOCKER][residency][devops] ADR-0017 (Proposed) + docker-compose.yml (no region pinning) + .github/workflows (no residency job) → the RF data-residency region-pinning + CI guardrail that ADR-0017 declares a P0 go-live blocker (and explicitly assigns to devops, §Implementation Notes) is NOT implemented. .env.example:25 has S3_REGION=ru-central1 as a value but nothing ENFORCES it; no CI/deploy check fails on a non-RF region for PG/replicas/backups/object-store/DR; deployment_specification.md still carries unconstrained cross-region language (ADR-0017:105 → :70,105). ФЗ-152 ст.18 ч.5 exposure remains open → implement the fail-on-non-RF-region guardrail (Ops probe P3) + encode region pins in compose/IaC + extend Pino PII-redaction to log sinks before public launch.`
- `[INFO][forward-compat][devops] backend/src/lib/outbox/outbox.relay.ts:44 + outbox.types.ts:27 → event fan-out seam is READY: worker-only polling relay injects @Optional() OUTBOX_CONSUMERS[] (defaults to []); domain modules contribute consumers under the token. Listing.Sold / ContactReveal.Created events are already written. The wiring the ecosystem needs (notification/analytics consumers) is a registration, not a re-platform → good forward-compat; just no consumers registered yet.`
- `[MINOR][forward-compat][devops] docker-compose.yml:91 postgres:16-alpine (vanilla) → geo-search (North-star) needs PostGIS; enabling it is a DB image swap (postgis/postgis:16) + `CREATE EXTENSION postgis` in database_schema.sql. Low cost but not staged. The single-image swap point should be noted so it isn't discovered late → document the PostGIS swap in deployment-mvp + reserve the extension line.`
- `[INFO][forward-compat][devops] docker-compose.yml:53-88 api/worker share one image from backend/Dockerfile → adding new service modules (favorites, geo, org, notification, ServiceOffering) is pure code in the monolith; compose absorbs it with no topology change (ADR-0009). Object-store residency swap (MinIO→Yandex) is an env/provider swap (ADR-0008 adapters exist, sigv4 targets storage.yandexcloud.net). Infra will NOT need a re-platform to absorb the ecosystem — the one hard gap is the residency guardrail (D-BLOCKER above).`

**Forward-compat infra verdict:** the monolith topology, shared image, outbox fan-out seam, and provider-adapter
swap points mean the ecosystem's new modules / object-store / event consumers land WITHOUT a re-platform. The single
structural blocker is the **unbuilt RF-residency guardrail (P0)**; PostGIS is a cheap image-swap to stage.

---

## Ops probes (concrete CI/infra checks for Phase-3 / CI)

> Runnable assertions. Each names WHAT to run and the PASS condition. `require manual` where a live env is needed.

- **P1 — Migration replay from N-1 (real upgrade path).** Build the schema at the previous release (git checkout the
  prior `database_schema.sql`, or apply `database_schema.sql` minus the last N migrations), then apply ONLY the new
  `migrations/00NN_*.sql` on top. PASS = applies clean + resulting DDL == fresh-head canonical. Closes the untested
  upgrade gap (B-residual). Add as a `migration-upgrade` CI job alongside `migration-drift`.
- **P2 — Seed DATA idempotency.** After `npm run seed` run 1, snapshot `SELECT count(*)` + `md5(array_agg(...))`
  for species, breeds, cities, supported_languages, feature_toggles, moderation reasons/templates. Run seed again;
  PASS = every count and hash identical. Extends CI seed×2 from "no error" → "no drift".
- **P3 — RF-residency assertion (ADR-0017 guardrail).** A deploy/CI lint that parses compose/IaC + provider config
  and FAILS if any PII-bearing store (PG, replica, backup target, S3 bucket region, DR target) resolves to a non-RF
  region. MVP form: assert `S3_REGION` ∈ {ru-central1,…} and no foreign replica/backup host is configured. This is
  the missing P0 guardrail (D-BLOCKER).
- **P4 — Health & metric presence.** After `docker compose up`: `curl -f /health/live` ⇒ 200, `/health/ready` ⇒ 200
  (PG+Redis), `/metrics` ⇒ 200 text/plain with `process_cpu` present. EXTEND: assert the domain metrics exist once
  instrumented (`zoolink_moderation_queue_depth`, geo-latency histogram, outbox depth) — today they are ABSENT
  (documents B-metrics gap). Add worker `/metrics` once the worker gets a listener.
- **P5 — Image-pin lint.** grep compose for any `image:` ending in `:latest` or with no tag ⇒ FAIL. Guards against
  regression of the minio pin and future services. One-liner CI step.
- **P6 — No `prisma migrate deploy` guard.** grep repo (workflows, docs, scripts) for `prisma migrate deploy` ⇒ FAIL
  if present (enforces ADR-0007). Cheap regression lock on the A3 fix.
- **P7 — Worker liveness beyond "process up".** require manual: assert the outbox relay actually drains (write an
  event, poll that it's dispatched within the poll interval) — today only process-up is proven (compose disables the
  worker healthcheck).

---

*Scope note:* I read CI/compose/provision/ops-docs/ADR-0017 and verified against live code; I did NOT bring the stack
up (no Docker run this session) — health/metric endpoint RUNTIME behaviour is asserted by probes P4/P7, marked
`require manual` where a live env is needed. No product/infra edits, no commit; this file is my sole output.
