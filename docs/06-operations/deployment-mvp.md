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

1. **Clone & configure**
   ```bash
   git clone <repo> && cd zoolink
   cp .env.example .env
   # edit .env: set strong POSTGRES_PASSWORD/REDIS_PASSWORD, JWT secrets (≥32 chars), provider keys, PUBLIC_DOMAIN.
   # Env is zod-validated at boot (fail-fast) — keep .env consistent with backend/src/config/env.validation.ts.
   chmod 600 .env
   ```
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
`.env` is the only secret store in MVP — kept out of git (`.gitignore`), mode `600`. Rotate by editing `.env` and
`docker compose up -d`. Vault/secret-manager is Фаза 2+.

## Observability (MVP)
Prometheus + Grafana for metrics, Sentry (self-hosted) for errors, structured JSON logs with PII redaction
(ФЗ-152) — see [ADR-0008](../04-decisions/0008-rf-provider-matrix.md) and `monitoring.md`.

## Disaster recovery (single-VM MVP)
Restore = re-provision VM → `docker compose up -d` → restore latest `pg_dump` → re-point DNS. RPO ≤ 24h (daily dump;
tighten with WAL archiving if needed). Cross-region/standby is Target (Фаза 2+).

## Related
- repo-root `docker-compose.yml`, `backend/Dockerfile`, `.env.example`, `deploy/Caddyfile`
- [BACKEND_MVP_BASELINE.md](../../BACKEND_MVP_BASELINE.md) · [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md)
- 🌐 RU mirror: [docsRU/06-operations/deployment-mvp.md](../../docsRU/06-operations/deployment-mvp.md)
