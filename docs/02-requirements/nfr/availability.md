# NFR: Availability (NFR-AVAIL)

Referenced by `specs/14-payment-domain.md`, `specs/15-api-gateway-domain.md` and others.

## Targets (MVP, Фаза 1)
- **Uptime:** 99.5% monthly (excludes announced maintenance) — max ~3.6h downtime/month.
- **Planned maintenance:** announced ≥24h ahead; off-peak window.
- **RPO (data loss):** ≤ 24h in MVP (daily `pg_dump`); tighten with WAL archiving as needed.
- **RTO (recovery):** ≤ 4h for full restore on a single-VM MVP.

## Mechanisms (MVP)
- Stateless API behind a reverse proxy; run ≥2 `api` replicas so a crash/redeploy is non-fatal.
- Compose `restart: unless-stopped` + healthchecks (`/health/live`, `/health/ready`); unhealthy containers restart.
- Graceful degradation: external-provider failures (SMS/email/maps/payment) must not crash core flows — queue,
  retry with backoff, and surface a clear error (see `error_handling/standard_error_format.md`).
- Idempotency on write paths that touch external providers (payments) to survive retries.
- Daily off-box backups (Yandex Object Storage); tested restore (see `06-operations/deployment-mvp.md`).

## Фаза 2+
Read replicas, multi-zone Kubernetes, automated failover (replica→primary), cross-region backups, 99.9%+ target —
see `deployment-diagram.md` (Target State) and `06-operations/disaster-recovery-plan.md`.

## Verification
- Synthetic uptime monitor on `/health/ready`.
- Quarterly restore drill from backup.
- Chaos check: kill one `api` replica under load → no user-visible outage.
