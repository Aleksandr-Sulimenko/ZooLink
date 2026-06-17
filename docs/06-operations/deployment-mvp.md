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
1. **Clone & configure**
   ```bash
   git clone <repo> && cd zoolink
   cp .env.example .env
   # edit .env: set strong POSTGRES_PASSWORD/REDIS_PASSWORD, JWT secrets, provider keys, PUBLIC_DOMAIN
   chmod 600 .env
   ```
2. **Build & start data + app**
   ```bash
   docker compose up -d postgres redis minio
   docker compose up -d --build api worker
   ```
3. **Run migrations** (schema is `database_schema.sql`; migrations in `migrations/`). Either:
   ```bash
   # Prisma (preferred once schema.prisma mirrors database_schema.sql):
   docker compose exec api npx prisma migrate deploy
   # …or apply the SQL directly for the canonical schema + migrations:
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < database_schema.sql
   ```
4. **Seed reference data** (species, breeds, cities, supported_languages, feature_toggles).
5. **Start proxy**
   ```bash
   docker compose up -d proxy
   ```
6. **Verify**
   ```bash
   curl -fsS https://$PUBLIC_DOMAIN/health/ready   # expect 200
   docker compose ps                               # all healthy
   ```

## Health endpoints (must be implemented by the API)
- `GET /health/live` — process up.
- `GET /health/ready` — DB + Redis reachable (used by Compose healthchecks and the uptime monitor).

## Migrations on update
```bash
git pull
docker compose up -d --build api worker
docker compose exec api npx prisma migrate deploy
```
Roll forward only; never edit an applied migration. Take a DB backup before each deploy (below).

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
