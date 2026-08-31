# MVP Deployment Runbook (Docker Compose)

> Binding for **MVP (Фаза 1)** per [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md). The Kubernetes
> material in `deployment.md` / `deployment_specification.md` is **Target State (Фаза 2+)**. Providers are RF-set
> per [ADR-0008](../04-decisions/0008-rf-provider-matrix.md).

## Topology
One or two VMs running Docker Compose (see repo-root `docker-compose.yml`): `proxy` (Caddy, TLS, public),
`api` (NestJS monolith, scalable), `worker` (outbox drain/cron/jobs), `postgres`, `redis`, `minio`.
Only `proxy` is published (80/443). `postgres`/`redis`/`minio` are on the internal Docker network and are
**never** exposed to the host or internet.

## Prerequisites
- A VM (≥2 vCPU / 4 GB for a small MVP), Docker Engine + Compose v2.
- A DNS A-record → VM IP for `PUBLIC_DOMAIN` (Caddy obtains TLS automatically).
- The backend repo present in `./backend` (NestJS app with `Dockerfile`, Prisma schema, `dist/main.js`, `dist/worker.js`).

## First deploy — step by step
The schema is **never** applied with `prisma migrate deploy` (ADR-0007: SQL-canonical + Prisma introspect — Prisma
Migrate is intentionally unused). On every `up` the one-shot **`provision`** service does it for you, in three steps:
1. applies the canonical `database_schema.sql` — **guarded, only on an empty DB** (that file is a fresh-bootstrap
   file and is not idempotent);
2. **replays every `migrations/*.sql` in order** — they are idempotent by construction, so this is a no-op on a DB
   that is already current and a **convergence step on one that has fallen behind**;
3. runs the **idempotent** seed (reference data: species, breeds, cities, supported_languages, feature_toggles,
   moderation reasons/templates, notification templates).

`api`/`worker` gate on `provision` completing successfully, so the stack comes up fully provisioned with **no manual
step** — and an **ageing volume cannot silently drift** away from the code. Step 2 exists because it did: a
five-week-old volume served `500 users.email_bidx does not exist` on registration while `/health/live`,
`/health/ready` and `GET /listings` all stayed green, because none of them touch the new columns. Both directions are
gated in CI (`provision-heals-stale-db`). If the `./migrations:/migrations:ro` bind mount is missing, `provision`
**fails loudly** rather than reporting success without converging.

1. **Clone & configure** — `deploy/gen-env.sh` is the **one** documented env path. It mints every secret with
   `openssl rand -hex` (lengths ≥ what the validator demands), writes `.env` mode `600`, and prints key
   **names** only — never a value.
   ```bash
   git clone <repo> && cd zoolink
   deploy/gen-env.sh --domain zoolink.example.ru      # creates .env — only when .env is ABSENT
   # Then fill the provider credentials the generator deliberately leaves EMPTY (empty = stub mode):
   #   SMSRU_API_ID · UNISENDER_API_KEY/UNISENDER_LIST_ID · EMAIL_FROM · YANDEX_MAPS_API_KEY · OAUTH_* · YOOKASSA_*
   ```
   Run on an **existing** `.env` it does not touch the file at all: it lists the missing prod-required keys
   by name and exits non-zero (exit `0` and zero changes when the file is complete) — so it is safe in a
   pre-deploy check. To top an existing file up:
   ```bash
   deploy/gen-env.sh --fill-missing   # mints/fills ONLY absent-or-empty keys; existing values are never re-minted
   ```

   > **`.env.example` is a FORM, not a provisioning path.** It is the commented *inventory* of every key —
   > what exists, what it means, what shape it takes. It therefore carries **`NODE_ENV=development`**:
   > an inventory is never a production configuration, and **production-ness is MINTED by
   > `deploy/gen-env.sh`, never inherited from the form**. Copying the form verbatim produces
   > `__change_me__` placeholders, so a production boot **fails fast** in
   > `backend/src/config/env.validation.ts`. Do **not** `cp .env.example .env`. Both halves of this are
   > under test: the CI `edge-smoke` job provisions its env with `deploy/gen-env.sh` and keeps a
   > **negative control** asserting the `cp` path is rejected at boot; the unit test
   > `backend/src/config/gen-env.spec.ts` runs the real generator against the real `validateEnv` and
   > derives the required-key set from the zod schema, so the two cannot drift.
   >
   > **Why a *filled* placeholder is refused BY NAME (2026-08-31, finding №176-family / №174).**
   > **What changed:** in production `validateEnv` now rejects a `METRICS_TOKEN` whose value contains
   > `change_me` (case-insensitive), naming the variable and the reason. Previously the only barrier
   > was *shape* — the token had to be present and ≥16 characters.
   > **Scope stated aloud:** this covers `METRICS_TOKEN` only (holder's decision, 2026-08-31).
   > Extending the same rule to every secret is a separate decision, not something this line
   > already delivers.
   >
   > **`NODE_ENV` comes from the ARGUMENT, never from the file (2026-08-31, holder's decision).**
   > **What:** `deploy/gen-env.sh` writes `NODE_ENV` from `--node-env` (default `production`) in
   > **both** modes — creating a file and `--fill-missing`. It is the one key exempt from
   > "an existing value is never overwritten"; when the value actually changes, the run says so out
   > loud. Every secret and `PUBLIC_DOMAIN` keep that promise unchanged.
   > **Why:** the form now says `development`, so without this the canonical repair path
   > (`cp` + `--fill-missing`) would hand a **production server a development-mode config** —
   > silently disabling every production-only check at once (required `METRICS_TOKEN`, the agent
   > signing secret, the Apple set, the placeholder refusal above). Measured, not feared: before
   > this change that path produced `NODE_ENV=development` verbatim.
   > **Why better:** a mode flag is not a secret. Losing an operator's minted secret would be
   > irreversible; re-stating the mode they asked for on the command line is not, it is announced,
   > and `--node-env development` states the other intent explicitly. The dangerous direction —
   > production silently weakened — is the one that is now impossible.
   > **Why:** on 2026-08-29 the template was made to start verbatim (an operator-facing requirement:
   > a contract that does not boot teaches nothing), which filled `METRICS_TOKEN` with the 30-character
   > placeholder `__change_me_32_hex_or_longer__`. Shape alone was then satisfied, the production boot
   > stopped failing, and the two negative controls above went red unnoticed.
   > **Why this is better — measured, not argued:** `MetricsGuard` branches on *whether a token is
   > configured*. With **no** token it falls back to INTERNAL-ONLY (loopback / private ranges, 404 for
   > everything else). With a token **configured** it admits anyone who presents it — and this one is
   > published in the repository. So the filled placeholder made the lock **weaker than its own
   > absence**, and did it silently: the boot succeeded. Refusing by name restores the loud failure
   > while keeping the template startable in dev — the only state in which both requirements hold at
   > once. The placeholder in `.env.example` is deliberately left as it is: it must stay impassable
   > for production.
2. **Bring the whole stack up** — Compose orders it: `postgres` healthy → `provision` (schema + seed) exits 0 →
   `api`/`worker` start → `proxy` last.
   ```bash
   docker compose up -d --build
   ```
3. **Verify** (`provision` should have exited 0; everything else healthy)
   ```bash
   docker compose ps                               # provision = Exited (0); proxy/api/worker/postgres/redis/minio healthy
   docker compose logs provision                   # "✓ canonical schema applied" + "✓ migrations replayed (…)" + "✓ provisioning complete"
   curl -fsS https://$PUBLIC_DOMAIN/health/ready   # expect 200 (PG + Redis reachable, through the edge)
   ```

> A fresh `down -v && up` reprovisions from scratch; a plain `up` on an existing volume **re-converges** it — the
> canon apply is skipped (the DB is non-empty), the idempotent migrations replay, the seed re-runs as an upsert. It is
> a no-op when the volume is already current and a repair when it is not. No `prisma migrate deploy`, no manual psql.

## Health endpoints (must be implemented by the API)
- `GET /health/live` — process up.
- `GET /health/ready` — DB + Redis reachable (used by Compose healthchecks and the uptime monitor).

## Schema changes on update (roll-forward, SQL-canonical)
Schema changes are **roll-forward only** (ADR-0007 — never `prisma migrate deploy`, never edit an applied migration).
On a populated volume the new migration(s) are applied by `provision`, which replays **all** of them on every `up`.
There is **no manual replay step**: an operator who forgets one is exactly how a volume goes stale. Take a backup
first (below), then:
```bash
git pull
docker compose up -d --build                   # provision re-runs first (replays migrations), then api/worker start
docker compose logs provision                  # expect "✓ migrations replayed (…0001… … …NNNN…)" + "✓ provisioning complete"
```
Replaying the whole set is safe and cheap: every migration is idempotent, and CI gates that as a HARD requirement —
the `migration-drift` job replays `migrations/*` **twice** on one DB and diffs the two bootstrap paths, and
`provision-heals-stale-db` proves the replay converges a deliberately-lagging DB (and that a second `provision` on an
already-current one stays green). See `.github/workflows/ci.yml`.

> **The derived Prisma artifact has a provisioning path too — `npm run db:sync`** (`scripts/db-sync-canon.sh`).
> It builds its OWN database from `database_schema.sql` and introspects THAT, and it **refuses** to run against a dev
> database: a dev DB differs from the canon in column order, so the diff against it collapses — clean locally while CI,
> which builds from the canon, stays RED. `npm run db:sync:check` is the same assertion CI makes.

> **Reference data has a declared-divergence registry — `scripts/seed-parity-known-divergences.txt`.**
> The `seed-parity` gate compares the reference DATA of both bootstrap paths, and also values the two
> artefacts carry DIFFERENTLY (invisible in any database, because `ON CONFLICT DO NOTHING` + canon-first
> means a migration's text never lands). A deliberate divergence must be DECLARED there, with a verdict
> and a reason; the registry is a TWO-SIDED contract — an undeclared divergence is RED, and an entry that
> no longer matches reality is ALSO RED ("stale"), so the file cannot rot into a forgotten allow-list.
> If your change makes the gate red: either fix the artefacts, or add an entry and say WHY in it. Do not
> silence the gate — its own output declares what it does and does NOT see (a row living only in the
> canon), so an operator can tell a real green from a blind one.

## Backups & restore (MVP)
- **Daily** logical backup (cron on host or `worker`):
  ```bash
  docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-$(date +%F).sql.gz
  ```
  Ship off-box (Yandex Object Storage). Retention: 30 daily / 12 weekly.
- **Restore:**
  ```bash
  gunzip -c backup-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  docker compose restart api worker
  ```
- **MinIO/objects:** enable versioning; mirror bucket to Yandex Object Storage. Redis is cache-only (not backed up).

## Secrets
`.env` is the only secret store in MVP — generated by `deploy/gen-env.sh`, kept out of git (`.gitignore`), mode
`600`. Rotate by deleting the key's line (or emptying its value) and running `deploy/gen-env.sh --fill-missing`,
then `docker compose up -d`. Mind the coupled rotations: `POSTGRES_PASSWORD`/`REDIS_PASSWORD` must stay in step
with `DATABASE_URL`/`REDIS_URL` (the generator derives those two from the credentials it finds, so rotate the URL
line together with the password line), `PII_DATA_KEY` needs a re-encrypt migration and `PII_BLIND_INDEX_KEY` an
`email_bidx` backfill. Vault/secret-manager is Фаза 2+.

## Edge client-IP contract (do not break when editing `deploy/Caddyfile`)
The API's rate-limit buckets are keyed on the `X-Real-IP` header, so the Caddyfile is **half of a security
control** (AUDIT5 §F1b). Two rules, both load-bearing:
1. Every `handle` that proxies to `api` must go through the `(api_upstream)` snippet, which does
   `header_up X-Real-IP {remote_host}` — a plain `reverse_proxy api:3000` is a hole.
2. The site-level `request_header -X-Real-IP` must stay. Caddy overwrites XFF by default but knows nothing
   about `X-Real-IP`: an inbound client value otherwise reaches the API verbatim, letting a client choose its
   own bucket. With the strip in place, a handle that forgets rule 1 delivers *no* header, and the API falls
   back to the socket address (degraded, not spoofable).

`scripts/check-edge-client-ip.sh` fails CI if either half goes missing, or if `trusted_proxies` is configured
(the rewrite uses `{remote_host}`, the real TCP peer, and must not become ambiguous). If another proxy is ever
placed **in front of** Caddy, `{remote_host}` becomes that proxy and this contract must be revisited.

**Runtime alarm — the rule is `zoolink_ratelimit_tracker_fallback_total{source="absent",peer="network"} == 0`.**
The counter records every request whose bucket had to fall back to the socket address. Labels:
- `source` — `absent` (no `X-Real-IP` at all) or `malformed` (present, but not a single IP literal — the shape
  a spoof attempt takes).
- `peer` — `network` or `loopback`, read off the **TCP connection**, which no header can alter. It carries no
  subnet constants on purpose: a hard-coded "our edge network" CIDR would go stale against Docker's dynamic
  subnets and then mislabel *silently*.

**The premise the rule rests on, stated so it cannot rot:** "non-zero `absent` = the edge stopped writing the
header" is only true while a second invariant holds — **no internal component calls the API over HTTP.** True
today. Add one (an ops `curl` inside the container, a smoke script, an in-container cron) and the baseline
becomes permanently non-zero → the signal becomes noise → the noise gets muted → a *real* loss of the edge
header becomes invisible. The `peer` split makes the rule immune: a loopback caller cannot raise the alarm
series, and a new **network-side** internal caller trips it once, loudly, forcing a deliberate decision instead
of silent erosion. If the counter is ever absent from the scrape entirely, the API logs that at boot
(`RateLimitMetrics`: "…is BLIND in this process") rather than degrading quietly.

## Observability (MVP)
Prometheus + Grafana for metrics, Sentry (self-hosted) for errors, structured JSON logs with PII redaction
(ФЗ-152) — see [ADR-0008](../04-decisions/0008-rf-provider-matrix.md) and `monitoring.md`.

**Health probes never depend on Redis.** `/health/live` and `/health/ready` are `@SkipThrottle` (AUDIT5 §F1c):
the global rate-limit guard keeps its counters in Redis and used to turn a dependency-free liveness probe into
a 500, which — with the `Dockerfile` HEALTHCHECK plus `restart: unless-stopped` — made a Redis blip a restart
loop. The API and worker also survive booting with Redis unreachable (they degrade and keep reconnecting), and
`/health/ready` reports an honest **503** while a dependency is down. Note: with Redis down, ordinary throttled
routes still return 500 — choosing the rate limiter's failure direction is tracked separately (AUDIT5 §F2).

## Disaster recovery (single-VM MVP)
Restore = re-provision VM → `docker compose up -d` → restore latest `pg_dump` → re-point DNS. RPO ≤ 24h (daily dump;
tighten with WAL archiving if needed). Cross-region/standby is Target (Фаза 2+).

## Related
- repo-root `docker-compose.yml`, `backend/Dockerfile`, `deploy/Caddyfile`
- `deploy/gen-env.sh` — the env **provisioner** (the documented path) · `.env.example` — the env **FORM**
  (key inventory / reference only) · `backend/src/config/env.validation.ts` — the boot-time env contract
- [BACKEND_MVP_BASELINE.md](../../BACKEND_MVP_BASELINE.md) · [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md)
- 🌐 RU mirror: [docsRU/06-operations/deployment-mvp.md](../../docsRU/06-operations/deployment-mvp.md)
