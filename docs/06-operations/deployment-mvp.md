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
Migrate is intentionally unused). On a fresh stack the one-shot **`provision`** service does it for you: it applies
the canonical `database_schema.sql` (guarded — only on an empty DB) then runs the **idempotent** seed (reference
data: species, breeds, cities, supported_languages, feature_toggles, moderation reasons/templates). `api`/`worker`
gate on `provision` completing successfully, so the stack comes up fully provisioned with **no manual step**.

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
   > what exists, what it means, what shape it takes. Copying it verbatim produces an **empty
   > `METRICS_TOKEN`** and `__change_me__` secrets, so a `NODE_ENV=production` boot **fails fast** in
   > `backend/src/config/env.validation.ts` (`METRICS_TOKEN: required in production`). Do **not**
   > `cp .env.example .env`. Both halves of this are under test: the CI `edge-smoke` job provisions its env
   > with `deploy/gen-env.sh` and keeps a **negative control** asserting the `cp` path is rejected at boot;
   > the unit test `backend/src/config/gen-env.spec.ts` runs the real generator against the real
   > `validateEnv` and derives the required-key set from the zod schema, so the two cannot drift.
2. **Bring the whole stack up** — Compose orders it: `postgres` healthy → `provision` (schema + seed) exits 0 →
   `api`/`worker` start → `proxy` last.
   ```bash
   docker compose up -d --build
   ```
3. **Verify** (`provision` should have exited 0; everything else healthy)
   ```bash
   docker compose ps                               # provision = Exited (0); proxy/api/worker/postgres/redis/minio healthy
   docker compose logs provision                   # "✓ canonical schema applied" + "✓ provisioning complete"
   curl -fsS https://$PUBLIC_DOMAIN/health/ready   # expect 200 (PG + Redis reachable, through the edge)
   ```

> A fresh `down -v && up` reprovisions from scratch; a plain `up` on an existing volume is a no-op (schema apply is
> skipped because the DB is non-empty; the seed re-runs but is idempotent). No `prisma migrate deploy`, no manual psql.

## Health endpoints (must be implemented by the API)
- `GET /health/live` — process up.
- `GET /health/ready` — DB + Redis reachable (used by Compose healthchecks and the uptime monitor).

## Schema changes on update (roll-forward, SQL-canonical)
The `provision` service applies the **full** `database_schema.sql` only on an *empty* DB, so on a populated volume a
new schema change is applied by **replaying the new idempotent migration(s)** (ADR-0007 — roll-forward only, never
`prisma migrate deploy`, never edit an applied migration). Take a backup first (below):
```bash
git pull
# apply each NEW idempotent migration added since the last deploy, in order:
for f in migrations/<new-NNNN>_*.sql; do
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$f"
done
docker compose up -d --build api worker        # ships the new image (Prisma client baked in)
docker compose run --rm provision              # optional: re-runs the idempotent seed (schema apply is skipped)
```
Migrations are idempotent (CI replays `migrations/*` twice + diffs the two bootstrap paths — see the
`migration-drift` job in `.github/workflows/ci.yml`), so a re-run is safe.

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

## Observability (MVP)
Prometheus + Grafana for metrics, Sentry (self-hosted) for errors, structured JSON logs with PII redaction
(ФЗ-152) — see [ADR-0008](../04-decisions/0008-rf-provider-matrix.md) and `monitoring.md`.

## Disaster recovery (single-VM MVP)
Restore = re-provision VM → `docker compose up -d` → restore latest `pg_dump` → re-point DNS. RPO ≤ 24h (daily dump;
tighten with WAL archiving if needed). Cross-region/standby is Target (Фаза 2+).

## Related
- repo-root `docker-compose.yml`, `backend/Dockerfile`, `deploy/Caddyfile`
- `deploy/gen-env.sh` — the env **provisioner** (the documented path) · `.env.example` — the env **FORM**
  (key inventory / reference only) · `backend/src/config/env.validation.ts` — the boot-time env contract
- [BACKEND_MVP_BASELINE.md](../../BACKEND_MVP_BASELINE.md) · [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md)
- 🌐 RU mirror: [docsRU/06-operations/deployment-mvp.md](../../docsRU/06-operations/deployment-mvp.md)
