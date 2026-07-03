# ZooLink HYPER² Audit — Round 3 · devops (OPS/CI/forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` @ `4533e78` (not pushed) · **Role:** devops
**Method:** independent re-derivation from live files (compose, both workflows, Dockerfile, Caddyfile,
provision.ts, worker.*, outbox relay, scheduler, metrics/health controllers, logger, env.validation,
ADR-0017), then a NEW/CONFIRMED/REFUTED/SEV-CHG diff against `AUDIT2/devops.md`. Stack NOT brought up
this session (no Docker run) — runtime endpoint behaviour still deferred to probes P4/P7 (`require manual`).

Format: `[severity][criterion][status] file:line → problem → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO. Criterion ∈ ci · observability · hygiene · residency ·
forward-compat · fix-verify.

---

## 0. Headline

- **P0 infra blocker (RF residency guardrail, ADR-0017) — STILL UNBUILT.** No change since round 2. It
  remains the single *structural* infra blocker to public launch; everything else is operability debt.
- **NEW: `prisma migrate deploy` IS still in the repo** — `performance-tests.yml:57` — which **REFUTES
  AUDIT2 finding A3's claim** that "No `prisma migrate deploy` anywhere in the repo," and it means the
  ADR-0007 regression-guard probe P6 is not merely nice-to-have but would fail *today*.

---

## A. NEW findings (not in AUDIT2)

- `[MAJOR][ci][NEW] .github/workflows/performance-tests.yml:57 → runs `npx prisma migrate deploy` — a
  direct ADR-0007 violation (schema is SQL-canonical + introspect, Prisma Migrate is never used). This
  workflow is NOT dormant: it triggers on `push: [main, performance]` and `pull_request: [main]`
  (`:6-10`). It will also always FAIL for unrelated reasons — `npm ci`/`prisma generate` run at the repo
  ROOT (no `working-directory: backend`, `:52`), and there is no `prisma/migrations/` directory
  (verified absent), so `migrate deploy` has nothing to apply. Additional drift in the same file:
  `postgres:14` (`:19`, vs the pinned `postgres:16-alpine` everywhere else), and stale
  `actions/checkout@v3` / `setup-node@v3` / `upload-artifact@v3` (`:38,42,86`). → Rewrite the DB-setup
  step to the canonical path (`psql -f database_schema.sql` + `npm run seed`, same as ci.yml), fix
  working-directory + pg16 + action pins, or delete the draft until k6 perf tests exist. Whichever —
  the `prisma migrate deploy` line must go (enforce with probe P6 as a blocking grep gate).`

- `[MAJOR][ci][NEW] docs/specs/09-testing-strategy.md:220 (+ docsRU:219) → the testing-strategy contract
  still describes ci.yml as `lint + typecheck + prisma migrate deploy check + …`. This contradicts
  ADR-0007 and the actual ci.yml (which has no such step). Doc=contract: a spec that names a forbidden
  step will be copied into the next workflow edit. → Fix the document first (WHAT: replace "prisma
  migrate deploy check" with "apply database_schema.sql + schema.prisma drift-check + seed×2 +
  migration-drift replay×2"; WHY: ADR-0007 SQL-canonical; WHY-BETTER: the spec then matches the only
  supported bootstrap and stops re-seeding the violation), EN↔RU in lockstep.`

- `[MINOR][forward-compat][NEW] backend/src/lib/outbox/outbox.relay.ts:129-137 → the relay marks an event
  `processed_at = NOW()` even when ZERO consumers match (`if (matched.length === 0) … marked processed`).
  Events are published NOW (`Listing.Sold`, `ContactReveal.Created`, `Moderation.Decided`,
  `Listing.Activated`) but no consumer is registered anywhere (grep for a non-`@Optional` `OUTBOX_CONSUMERS`
  provider = none). So today every business event is drained to /dev/null with `processed_at` set. This is
  fine for correctness NOW (notifications are sent inline via providers, not via the outbox — verified in
  identity/recovery/moderation services), but it is a forward-compat trap: when the first analytics /
  notification consumer is later registered, there is **no replay/backfill** — all historical events are
  already `processed`. → Before wiring the first consumer, decide the semantic: either (a) don't mark
  consumer-less events processed until at least one consumer is deployed, or (b) accept
  at-least-once-from-registration and document that pre-consumer events are intentionally not replayed.
  Cheap to decide now, a data-loss surprise later.`

- `[INFO][residency][NEW] backend/src/config/env.validation.ts:23 → `S3_REGION: z.string().min(1).default('ru-central1')`
  accepts ANY string — `S3_REGION=us-east-1` boots clean. This is the *concrete cheapest MVP form* of the
  ADR-0017 §8 guardrail that round-2 P3 asked for: a zod `.refine()` asserting `S3_REGION ∈ {ru-central1,
  ru-central1-a/b/d, …}` (fail-fast at boot) + a compose/CI lint that no foreign replica/backup/DR host is
  configured. Boot-time enforcement is a 3-line change and closes the "silent config drift ships PII
  abroad" hole for the object store at least. → Add the refine as step 1 of the ADR-0017 guardrail
  (D-BLOCKER below is the full guardrail; this is its smallest first slice).`

- `[INFO][observability][NEW-positive] deploy/Caddyfile (no `/metrics` route — 0 matches) + docker-compose.yml
  (api publishes no host ports, only proxy 80/443) → `/metrics` is `@Public @SkipThrottle` in
  metrics.controller.ts:7-9 but is reachable ONLY inside the docker networks, never through the edge. So
  the `@Public` on `/metrics` is NOT an internet-exposure risk in this topology — Prometheus would scrape
  it over the internal network. No action; recorded so a future reviewer doesn't misfile `@Public /metrics`
  as a leak. (If the SPA/Caddy ever proxies `/metrics`, revisit.)`

---

## B. CONFIRMED (AUDIT2 findings that still hold, re-verified against live files)

- `[BLOCKER][residency][CONFIRMED] ADR-0017 (Status: Proposed) + docker-compose.yml (no region pin) +
  .github/workflows (no residency job) + env.validation.ts:23 (S3_REGION unconstrained) → the P0
  RF-residency guardrail ADR-0017 §8 assigns to devops is NOT implemented. `S3_REGION=ru-central1` is a
  default value, not an enforced invariant; nothing fails on a non-RF region for PG/replica/backup/object-
  store/DR. ФЗ-152 ст.18 ч.5 exposure open. → build the fail-on-non-RF guardrail (env refine + compose/CI
  lint, probe P3), pin regions in compose/IaC, extend Pino redaction to log sinks. **P0 — unchanged.**`
- `[MAJOR][ci][CONFIRMED] .github/workflows/ci.yml:148-163 → migration-drift diff is DDL-only; seed/
  reference-DATA idempotency is asserted only as "runs twice without error" (:75, :142), never as
  row-count/hash stability. → add data-level snapshot assertion (probe P2).`
- `[MAJOR][ci][CONFIRMED] .github/workflows/ci.yml:134-142 → no from-N-1 upgrade path tested; Path 2
  replays ALL migrations on the CURRENT head schema (idempotency-against-head), never the real production
  update (populated N-1 DB, apply only the new migration). → add a `migration-upgrade` job (probe P1).`
- `[MAJOR][observability][CONFIRMED] backend/src/worker.module.ts + worker.ts:11-15 → worker runs
  `createApplicationContext` (no HTTP listener); WorkerModule imports no MetricsModule. It hosts the outbox
  relay + BOTH schedulers (retention + moderation-escalation) yet exposes no /metrics and no /health, and
  compose disables its healthcheck (liveness = process-up only). A stalled relay/scheduler is invisible. →
  add a minimal metrics/health listener to the worker (or push-gateway); export relay lag + last-tick
  timestamps.`
- `[MAJOR][observability][CONFIRMED] backend/src/lib/metrics/metrics.service.ts + audit.metrics.ts →
  registry = collectDefaultMetrics + exactly ONE domain counter. None of the SLO signals exist
  (ModerationQueueDepth, moderation-SLA pet<4h/livestock<6h, geo latency, HTTP histogram, outbox depth/lag,
  contact-reveal rate). monitoring.md alerts consume metrics that are never fed → alert config is fiction.
  → instrument the domain metrics before wiring Alertmanager.`
- `[MAJOR][observability][CONFIRMED] docs/06-operations/monitoring.md → Draft (2026-06-13) documents a
  K8s/ELK/Jaeger/Grafana target stack + NodeDown/PodCrashLooping + PG/Redis replication-lag alerts for
  replicas that don't exist (single-VM compose MVP). → split "MVP-now" (prom-client + Pino + Sentry) vs
  "Target (Phase 2+)"; drop K8s/replica alerts from the MVP section. (`require manual` on exact line refs —
  I did not re-open monitoring.md this round; round-2 cites :219-235,452-457.)`
- `[MAJOR][observability][CONFIRMED] docs/06-operations/runbooks/ → only README; no concrete procedures.
  ADR-0006 (agent-operated) needs agent-drivable step-lists. → author high-latency / moderation-backlog /
  DB-conn-exhaustion / failed-deploy / restore runbooks. (`require manual` — not re-listed this round.)`
- `[MAJOR][observability][CONFIRMED] docker-compose.yml (no backup service) + deployment-mvp.md (manual
  pg_dump one-liner) → no automated backup/retention/restore-drill; RPO aspirational. → add a backup
  sidecar/cron → RF object store (30d/12w per ADR-0017) + periodic restore-verify.`
- `[MAJOR][hygiene][CONFIRMED] .github/workflows/ci.yml:191,195 → Semgrep (SAST) + Trivy (fs) are
  `continue-on-error: true` (advisory); only `npm audit --omit=dev --audit-level=high` (:180) is blocking.
  → tune rules + SARIF upload, then flip to blocking (the comment at :186-187 already promises it).`
- `[MINOR][hygiene][CONFIRMED] .idea/.gitignore, .idea/ZooLink.iml, .idea/modules.xml, .idea/vcs.xml →
  tracked despite .gitignore `.idea/` (gitignore doesn't untrack). Verified via `git ls-files .idea/`. →
  `git rm -r --cached .idea` and commit.`
- `[INFO][forward-compat][CONFIRMED] outbox.relay.ts:44 (@Optional OUTBOX_CONSUMERS default []) → fan-out
  seam ready; new consumers are a registration, not a re-platform. (See NEW A finding on the
  processed-before-consumer wrinkle.)`
- `[MINOR][forward-compat][CONFIRMED] docker-compose.yml:91 postgres:16-alpine (vanilla) → geo-search
  (North-star) needs PostGIS; a `postgis/postgis:16` image swap + `CREATE EXTENSION postgis`. Low cost,
  not staged. → document the swap in deployment-mvp; reserve the extension line.`
- `[INFO][hygiene][CONFIRMED] docker-compose.yml minio pinned RELEASE.2025-09-07T16-13-09Z; community repo
  archived Oct 2025 (end-of-line) → reinforces ADR-0008 prod swap to Yandex Object Storage. Node 20 across
  Dockerfile/ci.yml (perf-tests too, once fixed). Both good.`

---

## C. Fix-verification (round-2's three verified fixes — re-checked)

- `[fix-verify][CONFIRMED] CI migration-drift guard — ci.yml:94-163 present and correct (throwaway
  canonical+migrated DBs, replay pass1+pass2 HARD idempotency, BLOCKING DDL diff). 28 migrations
  0001-0028 present. Stands.`
- `[fix-verify][CONFIRMED] Self-provisioning compose — provision service (compose:34-73) + provision.ts
  guard `to_regclass('public.users')` applies non-idempotent database_schema.sql only on empty DB, then
  idempotent seed; api/worker gate on `service_completed_successfully`. Real & idempotent. Stands.`
- `[fix-verify][SEV-CHG] deployment-mvp.md off `prisma migrate deploy` — TRUE *for deployment-mvp.md and
  ci.yml*, but AUDIT2 A3 over-generalised to "No `prisma migrate deploy` anywhere in the repo." That is
  REFUTED: `performance-tests.yml:57` + `docs/specs/09-testing-strategy.md:220` + `docsRU:219` still carry
  it (see NEW A). The ADR-0007-clean status is scoped to ci.yml + deployment-mvp, NOT repo-wide.`

---

## D. REFUTED / resolved since AUDIT2

- `[hygiene][REFUTED] AUDIT2 C-residual (env.validation.ts AGENT_SERVICE_SIGNING_SECRET "требует ручной
  проверки that .env.example documents it") → RESOLVED. .env.example carries the key + a precise comment
  ("FORM ONLY in MVP … Optional in dev/test; REQUIRED (>=32 chars) in production"), and env.validation.ts
  enforces prod-required min-32 (:48,118-121). No gap. Likewise PII_DATA_KEY / PII_BLIND_INDEX_KEY are in
  .env.example with rotation notes and validated min-32 (:41-42). The .env-drift risk is limited to a
  pre-existing prod .env that predates these keys (operator concern, not a repo gap).`

---

## E. Task hot-spot answers (direct)

- **(a) ADR-0017 region-pin + CI guardrail:** NOT built. ADR still Proposed; S3_REGION is an unenforced
  default; no residency CI/deploy check. **P0 open.** (D-BLOCKER)
- **(b) migration-drift guard:** validates 0001-0028 replay + idempotency ×2 + BLOCKING DDL diff — solid.
  But it is DDL-only: **no seed-DATA idempotency assertion** and **no N-1 upgrade path**. (2× MAJOR)
- **(c) self-provisioning compose:** REAL — auto schema (guarded, empty-DB only) + idempotent seed on boot,
  api/worker gate on it. deployment-mvp.md does NOT teach `prisma migrate deploy` (correct) — but two OTHER
  files still do (NEW A).
- **(d) image pins / secrets / SAST:** minio + pg16 + node20 pinned (good); perf-tests.yml uses pg14
  (drift). Secrets: env fail-fast min-32 for JWT/PII/agent (good); no automated rotation (documented
  manual). Semgrep + Trivy `continue-on-error` (advisory); npm-audit prod tree blocking.
- **(e) worker/scheduler/outbox:** relay + retention (hourly) + moderation-escalation (*/15) run in the
  worker under advisory locks — they DO run. Outbox has NO registered consumers → events marked-processed
  with no side effect (correctness OK today because notifications are inline; forward-compat wrinkle — NEW
  A). Worker is observability-blind (MAJOR).
- **(f) observability:** `/metrics @Public` is internal-only (not routed by Caddy, no host port) — safe.
  `principal_type` IS stamped on request logs (logger.module.ts:30-38, B8 customProps: principalType /
  actorId / actorRole) and Pino redaction covers auth/PII (:40-58). Metrics carry no principal label
  (aggregate-only — good for PII). Gap is metric *breadth*, not principal tagging.

---

## Diff counter (vs AUDIT2/devops.md)

- **NEW:** 5  (2 MAJOR, 1 MINOR, 2 INFO)
- **CONFIRMED:** 13  (1 BLOCKER, 7 MAJOR, 3 MINOR/INFO forward-compat, 2 INFO hygiene) + 2 fix-verify
- **REFUTED:** 2  (AUDIT2 A3 "no migrate deploy anywhere" ; AUDIT2 env.example residual now resolved)
- **SEV-CHG:** 1  (A3 scope downgraded: ADR-0007-clean = ci.yml + deployment-mvp only, not repo-wide)

## P0 infra-blocker status
**1 open — unchanged:** ADR-0017 RF data-residency guardrail (region pin + fail-on-non-RF CI/deploy
check). Cheapest first slice = a zod `.refine()` on `S3_REGION` at boot (env.validation.ts:23). Everything
else this round is operability/CI debt, not a launch-structural blocker.

*Scope note:* live files read & verified; stack not run — runtime endpoint behaviour (P4/P7) still
`require manual`. No infra/code edits, no commit; this file is my sole output.
