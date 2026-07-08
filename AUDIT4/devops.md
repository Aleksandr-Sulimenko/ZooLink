# ZooLink HYPER³ Audit — Round 3 · devops (resilience / migration-replay / machine-ops)

**Date:** 2026-07-08 · **Branch:** `backend` @ `0fcc182` · **Role:** devops
**Method:** independent re-derivation from live files (compose, ci.yml, perf-tests.yml, Dockerfile,
Caddyfile, env.validation, metrics guard/service/controller, health controller + indicators, outbox
relay + backoff, advisory-lock + both scheduler jobs, idempotency interceptor, rate-limit module,
migrations 0001–0034, check-rf-residency.sh), then a NEW/CONFIRMED/REFUTED/SEV-CHG/FIXED-VERIFIED
diff vs `AUDIT3/devops.md` + `AUDIT2/devops.md`. Round-3 adds **resilience / dependency-failure**,
**migration-replay + N-1**, and **machine-readable-ops-for-agents** axes rounds 1–2 never measured.
**Stack NOT brought up** (shared baseline; discipline). No destructive DB ops. Runtime endpoint
behaviour marked `requires manual` where a live env is needed.

Format: `[severity][criterion][axis][status] file:line → problem → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO. axis ∈ same|new|trash|strat.

---

## 0. Headline

- **P0 RF-residency blocker (ADR-0017) — FIXED-VERIFIED.** The standing P0 across AUDIT2/AUDIT3 is
  now a real 3-layer guardrail: boot `.superRefine` over every `*_REGION` (env.validation.ts:178–192,
  fail-closed in prod, dev bypass `RESIDENCY_ALLOW_NON_RF_DEV`), the **blocking** CI `residency` job
  (ci.yml:171–176 → `scripts/check-rf-residency.sh`, allowlist single-sourced from env.validation),
  and the documented pin (layer 3). This was the only *structural* infra launch-blocker; **it is
  closed.** No infra P0 remains open this round.
- **NEW headline (resilience):** the async heart is **crash-safe but blind, and can dead-letter
  HEALTHY events.** The outbox relay increments `attempts` on every *lease* (not every *delivery*),
  so a worker crash-loop or a transient PG blip burns the 8-attempt budget and dead-letters good
  events — with **no metric, no alert, no runbook** to see it (outbox.relay.ts:83 vs backoff.ts:6).
- **NEW headline (machine-ops for agents [NS]):** `/metrics` still exports **only Node defaults** —
  zero domain signal (queue depth, outbox lag, dead-letter count, SLA breach, escalation backlog).
  An agent-operator (ADR-0006) has **no programmatic read** of system health; everything is
  human-SQL-only. This is the biggest gap to an agent-run ops posture.
- **NEW headline (N-1):** CI proves idempotency (replay×2) but **never the real upgrade path**
  (populated N-1 DB + only-the-new-migration + OLD code). Three migrations are **N-1-unsafe**:
  **0028** (email→ciphertext breaks old plaintext login), **0033** (`listings.market NOT NULL`, no
  DEFAULT, breaks old listing INSERTs), **0029** (contact_reveals UNIQUE rejects old duplicate
  inserts). Safe under compose's stop-the-world restart; **unsafe under migrate-in-place-while-serving.**

---

## A. FIXED-VERIFIED (AUDIT2/AUDIT3 findings resolved by Wave-F ops-hardening + residency work)

- `[BLOCKER→RESOLVED][residency][same][FIXED-VERIFIED] env.validation.ts:15–25,178–192 + ci.yml:165–176
  + scripts/check-rf-residency.sh + backend/src/config` → the ADR-0017 P0 residency guardrail
  (AUDIT2-D / AUDIT3-B BLOCKER, open two rounds) is **built and correct**. Layer 1 boot refine scans
  ALL `*_REGION` vars generically (forward-safe for future managed-PG/replica/backup/DR/log-sink
  region vars), rejects non-RF at boot, unconditional in prod, strict-parsed dev bypass. Layer 2 CI
  job is **blocking** and derives its allowlist from the SAME `RF_ALLOWED_REGIONS` constant (layers
  cannot diverge) + a broad foreign-region-token net over compose/.env.example/Caddyfile. Real fix.
  Residual (INFO): `TODO(legal)` on the exact approved zone set (env.validation.ts:13) — confirm with legal.`
- `[MAJOR→RESOLVED][observability][same][FIXED-VERIFIED] env.validation.ts:167,215–226 + metrics.guard.ts
  + metrics.controller.ts:11–15` → **METRICS_TOKEN prod-required** (Wave-F). Prod boot fails without a
  ≥16-char token (validateEnv:219–226 with an accurate WHY: behind Caddy every `req.ip` looks internal,
  so the IP fallback would make `/metrics` world-readable). MetricsGuard is fail-CLOSED, 404-no-leak,
  constant-time compare, loopback/RFC1918 fallback only when no token (metrics.guard.ts:27–34). The
  AUDIT3 "`@Public /metrics` is internal-only" note is now hardened with defence-in-depth. Verified.`
- `[CRITICAL→RESOLVED][ci][same][FIXED-VERIFIED] env.validation.ts:32–47` → **dev-token fail-OPEN chain
  closed.** `NODE_ENV` now defaults to `'production'` (fail-safe — a boot that forgets NODE_ENV lands
  locked-down, not permissive) and `ENABLE_DEV_TOKEN` is strict-enum fail-closed (`.default('false')`,
  rejects `'1'/'TRUE'/'yes'`). Dev-token route reachable ONLY when `ENABLE_DEV_TOKEN===true AND
  NODE_ENV!=='production'`. Fail-closed across NODE_ENV as the task asked. Verified.`
- `[MAJOR→RESOLVED][hygiene][same][FIXED-VERIFIED] ci.yml:210–234` → **Semgrep + Trivy are now BLOCKING**
  (Wave-F). Semgrep `--severity ERROR --error` blocks on high-confidence OWASP-Top-10 (+ full-severity
  advisory pass); Trivy `exit-code:1 severity:HIGH,CRITICAL ignore-unfixed:true` blocks. npm-audit prod
  tree still blocking; full-tree advisory. The AUDIT2/AUDIT3 `continue-on-error` MAJOR is closed.
  Residual (MINOR): SARIF upload / lower threshold still TODO (comment at :220) — non-blocking polish.`
- `[MAJOR→RESOLVED][ci][same][FIXED-VERIFIED] .github/workflows/performance-tests.yml:19,40,43,50,58,82`
  → the AUDIT3-A `prisma migrate deploy` violation in perf-tests is **gone**: pg16, `working-directory:
  backend`, checkout@v4/setup-node@v4/upload-artifact@v4, and an explicit "no `prisma migrate deploy`"
  comment bootstrapping from `database_schema.sql` like ci.yml. Repo-wide grep confirms `prisma migrate
  deploy` survives ONLY in audit/history prose, never in a workflow/script. ADR-0007 clean repo-wide now.`
- `[INFO→RESOLVED][observability][same][FIXED-VERIFIED] env.validation.ts:78–84` → `MEDIA_CDN_HOST`
  seam added (Wave-F): optional prod CDN host folded into the media-URL allowlist alongside S3 host.
  Shape-only at boot; allowlist build in lib/media. Confirmed present as described.`

---

## B. NEW findings (resilience / N-1 / machine-ops — not in prior rounds)

- `[MAJOR][observability][new][NEW] backend/src/lib/scheduler/advisory-lock.ts:41–52 → session-level
  advisory lock across a POOLED Prisma client. pg_try_advisory_lock (line 43), work() queries, and
  pg_advisory_unlock (line 51) are three SEPARATE $queryRaw calls; Prisma's default pool routes each to
  an ARBITRARY backend connection. A session-level advisory lock is bound to the backend that acquired
  it — so the unlock can land on a DIFFERENT connection (no-op, returns false) while the lock stays held
  on the acquiring connection until that pool member is recycled. Effect on a single instance: subsequent
  ticks become nondeterministic ("lock held by another instance" false-skips) and the lock count drifts;
  under pool churn the scheduled retention/escalation tick can wedge silently. Only masked today because
  ticks are idempotent and infrequent. → run the acquire+work+unlock on ONE dedicated connection (a
  pinned client / `$transaction` interactive tx / a session-pinned raw connection), or use a
  transaction-level lock (`pg_try_advisory_xact_lock`, auto-released at tx end — no manual unlock, no
  cross-connection hazard). requires manual verification of the effective Prisma pool size (default > 1).`

- `[MAJOR][observability][new][NEW] backend/src/lib/outbox/outbox.relay.ts:80–93 (claim increments
  attempts on lease) vs backoff.ts:6 (MAX_ATTEMPTS=8) → `attempts` conflates "delivery attempts" with
  "lease acquisitions". claim() does `SET attempts = attempts + 1` on every lease BEFORE dispatch, and
  onFailure dead-letters at attempts>=8 (relay.ts:127). So a worker that OOM/crash-loops after claiming
  but before dispatch (or 8 transient PG blips) burns the whole budget and **dead-letters a perfectly
  healthy event** — an infra outage becomes permanent data loss with no side effect ever attempted.
  There is no metric/alert on `dead_lettered_at` (see NEW machine-ops finding), so it is invisible. →
  separate lease-count from delivery-attempt-count (only increment attempts inside the failure path, or
  add a `leases`/`delivered_attempts` split), and/or dead-letter on a poison-signal (deterministic
  handler error) rather than raw lease count. At minimum expose a dead-letter gauge + alert.`

- `[MAJOR][observability][strat][NEW][NS] backend/src/lib/metrics/metrics.service.ts:9–12 →
  `/metrics` exports ONLY `collectDefaultMetrics` (Node runtime) + one audit counter (unchanged since
  AUDIT2). For an agent-run ops future (ADR-0006), an agent-operator needs a PROGRAMMATIC read of
  system state — but NONE of the operational signals are machine-readable: moderation queue depth,
  moderation-SLA breach (pet<4h/livestock<6h), **outbox depth / relay lag / dead-letter count**,
  escalation backlog, contact-reveal rate, HTTP latency histogram. Today the ONLY way an operator (human
  or agent) learns "the queue is backing up" or "the relay stalled" is an ad-hoc SQL query. → instrument
  the domain gauges/counters/histograms (queue depth, outbox `COUNT(*) WHERE processed_at IS NULL`,
  oldest-unprocessed age, dead-letter count, last-tick timestamps) and expose them at `/metrics` so an
  agent can poll health/queue/escalation state without DB access. This is the headline agent-ops gap.`

- `[MAJOR][observability][strat][CONFIRMED→SEV-CHG][NS] backend/src/worker.module.ts (no MetricsModule,
  no HTTP listener) + docker-compose.yml:82–83 (worker healthcheck disabled) → the worker hosts the
  outbox relay + BOTH schedulers (the async heart) yet exposes NO /metrics and NO /health; liveness =
  process-up only. AUDIT3 rated this MAJOR-observability; under the agent-ops lens it is **strategic**:
  the async subsystem an agent-operator most needs to watch is exactly the black-box one. A stalled
  relay/scheduler on a live process is undetectable programmatically. → add a minimal metrics+health
  listener to the worker (or a push-gateway) exporting relay lag + last-tick timestamps + queue depth.`

- `[MINOR][observability][new][NEW] backend/src/lib/http/idempotency.interceptor.ts:74–80 +
  backend/src/lib/rate-limit/rate-limit.module.ts:17–18 → Redis-down request-path degradation is
  fail-CLOSED-to-500, undocumented. The idempotency reservation `SET … NX` (line 74) has no try/catch,
  so a Redis outage throws → 500 on every unsafe POST carrying an Idempotency-Key. The throttler is
  backed by `ThrottlerStorageRedisService` (rate-limit.module.ts:18), which on a Redis outage throws →
  the guard 500s ALL throttled routes. For a marketplace this fail-closed stance is defensible (better
  than double-charging or un-throttled abuse) but it is a total request-path outage on a Redis blip,
  not a graceful degrade, and there is no runbook. → decide + document the policy per surface
  (idempotency: fail-closed OK; throttler: consider fail-open-with-alarm so a Redis blip doesn't 503
  the whole API), and add a "Redis down" runbook. requires manual verification of throttler throw
  behaviour under a real Redis kill.`

- `[MINOR][ci][new][NEW] .github/workflows/ci.yml (no migration-upgrade / N-1 job) + migrations
  0028,0029,0033 → CI's migration-drift job replays all migrations twice on the CURRENT head schema
  (idempotency-against-head — solid, GREEN) but NEVER the real upgrade: a populated N-1 DB with ONLY the
  new migration applied while OLD code still serves. Three migrations break that window (details in §D).
  Safe today because compose does stop-the-world (provision applies schema, then api/worker start
  fresh), but deployment-mvp.md's "replay new migrations on update" invites migrate-in-place. → add the
  AUDIT2/AUDIT3 probe P1 `migration-upgrade` job (schema-minus-last-N + apply newest only + assert
  clean) AND flag 0028/0033/0029 in the deploy runbook as "stop app before migrate / no in-place".`

- `[INFO][ci][new][NEW] .github/workflows/ci.yml:75–78 → seed×2 still asserts only "runs twice without
  error", not row-count/hash stability (AUDIT2/AUDIT3 probe P2, still not implemented). An UPDATE-drift
  or non-ON-CONFLICT seed statement passes silently. Low risk (all seeds verified ON CONFLICT) but the
  guard is shallow. → snapshot count(*)+md5(array_agg) of reference tables after run 1 vs run 2.`

---

## C. CONFIRMED (still hold, re-verified) / REFUTED

- `[MAJOR][observability][same][CONFIRMED] docker-compose.yml (no backup service) + deployment-mvp.md
  (manual pg_dump) → still no automated backup/retention/restore-drill. RPO aspirational. → backup
  sidecar/cron → RF object store (30d/12w per ADR-0017) + periodic restore-verify.`
- `[MAJOR][observability][same][CONFIRMED] docs/06-operations/runbooks/ → still only README.md; no
  concrete procedures. ADR-0006 agent-operated ops needs agent-drivable step-lists (high-latency /
  moderation-backlog / DB-conn-exhaustion / **Redis-down** / **outbox-stall+dead-letter** / failed-deploy
  / restore). The resilience findings above each imply a missing runbook.`
- `[MAJOR][observability][same][CONFIRMED] docs/06-operations/monitoring.md (Draft, K8s/ELK/Jaeger/
  replica-lag alerts for infra that doesn't exist in single-VM compose) → still needs "MVP-now" vs
  "Target Phase-2+" split; alerts consume metrics that are never fed (fiction until §B machine-ops fix).`
- `[MINOR][forward-compat][same][CONFIRMED] outbox.relay.ts:104–118 → consumer-less events still marked
  `processed_at` with no side effect. Migration 0030 registered ONE real consumer (NotificationConsumer,
  scoped eventTypes, NOT '*'), so events it does NOT match (e.g. Listing.Sold, ContactReveal.Created)
  are still drained to /dev/null with no replay/backfill. AUDIT3-A wrinkle persists for non-matched types
  → keep the "no replay before a consumer exists" decision documented before wiring analytics consumers.`
- `[MINOR][forward-compat][same][CONFIRMED] docker-compose.yml:91 postgres:16-alpine (vanilla) →
  geo-search (North-star) needs PostGIS; stage the `postgis/postgis:16` swap + `CREATE EXTENSION`.`
- `[INFO][hygiene][same][CONFIRMED] docker-compose.yml:125 minio pinned to an end-of-line community tag
  (repo archived Oct 2025) → reinforces ADR-0008 prod swap to Yandex Object Storage. Node 20 everywhere.`
- `[MINOR][hygiene][same][CONFIRMED/requires manual] .idea/* tracked despite .gitignore → re-run
  `git ls-files .idea/`; if still tracked, `git rm -r --cached .idea`. Not re-checked live this round.`
- `[hygiene][same][REFUTED] AUDIT3 "perf-tests.yml carries prisma migrate deploy + pg14 + stale actions"
  → REFUTED, all fixed (see §A FIXED-VERIFIED). ADR-0007 is now clean repo-wide (workflows+scripts).`

---

## D. Migration-replay + N-1 assessment (0001→0034)

**Idempotency (replay×2): PASS across the board.** The CI migration-drift job replays every migration
twice on the canonical schema with a blocking DDL diff, and the migrations consistently use
`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, DO-block `DROP CONSTRAINT IF EXISTS`+re-ADD,
`CREATE OR REPLACE FUNCTION`, `SET DEFAULT` no-ops, and no-op-on-rerun backfills/dedup DELETEs. Verified
by reading 0028/0029/0033 headers + bodies; the ledger confirms the suite is GREEN. **No idempotency
defect found.** Seed×2 also idempotent (ON CONFLICT), though asserted only as "no error" (§B INFO).

**N-1 (populated release-N-1 DB + only-new-migration + OLD code still serving): 3 UNSAFE migrations.**
CI does not test this path at all.

| Migration | Idempotent? | N-1 (old code vs new schema) | Verdict |
|---|---|---|---|
| **0028** email→AES ciphertext + `email/phone` VARCHAR→TEXT + drop `idx_users_email`→bidx (+ backfill encrypts existing rows) | YES | Old code does `WHERE email = $plaintext` for login/lookup; new writes + backfill store `enc:v1:` ciphertext. Old code **cannot match any user** → login/recovery break during the window. | **N-1 UNSAFE** — requires stop-app-before-migrate or a dual-read compat window. |
| **0033** `listings.market VARCHAR(9) NOT NULL` (no DEFAULT; backfill then SET NOT NULL) | YES | Old code INSERTs a listing without `market` → **NOT NULL violation (23502) → 500** on every create. | **N-1 UNSAFE** — old code cannot create listings against the new schema. |
| **0029** add `UNIQUE(viewer_id, listing_id)` on `contact_reveals` | YES | Old code inserts a repeat reveal that was previously allowed → **23505 → 500** on that path. | **N-1 friction (MINOR)** — degrades one endpoint, not core. |
| 0031 `view_count BIGINT NOT NULL DEFAULT 0` | YES | Has DEFAULT → old INSERTs succeed. | N-1 SAFE. |
| 0034 `user_roles` junction (dormant) + backfill | YES | Additive table, no code reads it. | N-1 SAFE. |
| 0023 ownership-transfer trigger "block-all"→GUC-gated | YES | Old code never sets `app.ownership_transfer` GUC → updates stay blocked (== prior behaviour). | N-1 SAFE. |
| 0016/0026 principal_type CHECK reconciliation | YES | Constraint-name only; values unchanged. | N-1 SAFE. |

**Net:** idempotency is CI-guaranteed and clean; the **untested axis is N-1**. For today's compose
(stop-the-world recreate) the N-1 window doesn't exist, so 0028/0033/0029 are effectively safe. The
risk is entirely **migrate-in-place-while-serving**, which deployment-mvp.md's "replay new migrations on
update" language does not forbid. Fix: (1) add the P1 `migration-upgrade` CI job; (2) add a deploy-order
rule to the runbook — "apply migrations only with the app stopped (or new schema is code-compatible);
0028/0033/0029 are explicitly stop-the-world"; both are cheap now, a data/auth incident later.

---

## E. Resilience-degradation table (dependency down → expected safe behavior → guaranteed?)

| Dependency down | Path | Expected SAFE behaviour | Guaranteed? |
|---|---|---|---|
| **PG down** | `/health/ready` | flip to 503 (indicator down) | **YES** — prisma.health try/catch → `down()` |
| PG down | `/health/live` | stay 200 (no deps) | **YES** — health.controller.ts:19–22 |
| PG down | outbox relay tick | catch → log → return 0, no crash, resume next tick | **YES** — relay.ts:70–77 |
| PG down | scheduler tick (retention/escalation) | tick fails, logs, next `@Cron` retries; no stuck lock | **PARTIAL** — cross-connection advisory unlock hazard (§B) + requires manual re: `@Cron` promise rejection handling |
| PG drop mid-dispatch | outbox event | re-leased after 60s, re-dispatched at-least-once, consumer idempotent | **YES** for NotificationConsumer (idempotency_key ON CONFLICT DO NOTHING, ledger 0030) |
| PG blip ×8 / worker crash-loop | outbox event | transient failure retried, NOT dead-lettered | **NO** — lease-count == attempt-count dead-letters healthy events (§B) |
| **Redis down** | `/health/ready` | flip to 503 (indicator down) | **YES** — redis.health.ts try/catch |
| Redis down | throttled routes | degrade (fail-open-with-alarm) OR documented fail-closed | **NO/undocumented** — ThrottlerStorageRedis throws → 500 all throttled routes (requires manual) |
| Redis down | idempotent POST | reject cleanly, no double-execute | fail-closed → **500** (no guard, idempotency.interceptor.ts:74) — safe but undocumented |
| Redis down | listing view-count | best-effort, never throws, read still served | **YES** — ledger 0031 (captureView swallows) |
| **MinIO down** | API readiness | not gated; API stays ready | **YES by design** — compose depends_on `service_started` only (compose:64–65) |
| MinIO down | media upload | fail that request only (5xx), rest of API up | **likely** — requires manual |
| **Duplicate outbox delivery** (at-least-once) | notification write | idempotent, no double-send | **YES** — ON CONFLICT(idempotency_key) DO NOTHING (ledger 0030) |

**Trash-lens (failure-injection design for Phase-3):** to *assert* the SAFE column, inject: (1) `docker
kill postgres` mid-load → assert `/health/ready`→503, `/health/live`→200, relay resumes on PG return,
no partial writes (tx-bounded); (2) `docker kill redis` → assert `/health/ready`→503 and **decide+assert**
whether throttled/idempotent routes 503 (fail-closed) or degrade — today undocumented; (3) PG latency
injection (toxiproxy) → assert no advisory-lock wedge and no false dead-lettering; (4) worker SIGKILL
mid-dispatch → assert the leased event re-appears and is delivered exactly-once at the consumer. Tag
**→ security**: the Redis-down throttler behaviour is also an availability/abuse surface (throttler
fail-OPEN would remove rate-limiting during a Redis outage) — security should rule on fail-open vs
fail-closed for the rate limiter before it is decided on operability grounds alone.

---

## F. Strategic lens

- `[strat][NS] Machine-readable ops is the gating capability for agent-run operations.` The single
  biggest lever for ADR-0006 is exposing queue depth / outbox lag+dead-letter / escalation backlog /
  SLA-breach as `/metrics` gauges (§B). Until then, an agent-operator must run privileged SQL to know
  system state — which is both a capability gap and a blast-radius/PII risk (→ security). Lay this seam
  now: the metrics registry already exists (metrics.service.ts), it just has nothing domain-specific in it.
- `[strat][PERSP] Cheaper-now seams before Phase-2 deploy/scale:` (1) the worker metrics+health listener
  and the domain-metric instrumentation are far cheaper to add while the modules are small than after
  Phase-2 fan-out; (2) the advisory-lock connection-pinning fix (§B) MUST land before the worker scales
  past one instance — a stuck cross-connection lock is exactly the multi-instance hazard the advisory
  lock exists to prevent; (3) the P1 N-1 CI job + deploy-order runbook rule are one-time cheap now and
  prevent a data/auth incident the first time an operator does a live in-place migration.

---

## Diff counter (vs AUDIT3/devops.md)

- **FIXED-VERIFIED:** 6 (1 BLOCKER residency, 1 MAJOR metrics-token, 1 CRITICAL dev-token, 1 MAJOR
  scanners, 1 MAJOR perf-tests/migrate-deploy, 1 INFO media-cdn)
- **NEW:** 7 (2 MAJOR resilience [advisory-lock pool, outbox dead-letter], 1 MAJOR [NS] machine-ops,
  2 MINOR [Redis-down degrade, N-1 CI], 1 INFO seed-data, + worker-observability SEV-CHG→strat)
- **CONFIRMED:** 7 (backup, runbooks, monitoring-doc, outbox-no-replay wrinkle, PostGIS, minio-EOL,
  .idea)
- **REFUTED:** 1 (perf-tests migrate-deploy — now fixed)

## Infra P0 status
**0 open.** The two-round P0 (ADR-0017 residency) is FIXED-VERIFIED. Everything this round is
operability / resilience / agent-ops debt, not a launch-structural blocker. Top forward risks:
machine-readable ops for agents (strat/NS), the advisory-lock connection-pool hazard + outbox
healthy-event dead-lettering (resilience), and the untested N-1 upgrade path (0028/0033/0029).

*Scope note:* live files read & verified; stack not run; no destructive DB ops, no src edits, no
commit. This file is my sole output. `requires manual` flags: Prisma pool size, throttler throw-under-
Redis-kill, `@Cron` rejection handling, .idea tracked-state.
