# Memory Index

- [ADR-0011 actor-snapshot invariants](adr-0011-actor-snapshot-invariants.md) — migration 0016 actor_principal_type/override-chain/role_in_org canon + negative-test recipe (live PG, gen_random_uuid, DO-block append-only)
- [Reference-data localized divergence](reference-data-localized-divergence.md) — RESOLVED (A2/migration 0018): name_localized JSONB + sort_order/created_by/updated_by + audit entity_id_int; §6 admin-both/public-resolved
- [Authenticator chain + service_credentials (ADR-0011 A0b)](authenticator-chain-adr0011.md) — RequestAuthenticator chain in lib/auth, gated agent stub, migration 0017 service_credentials form, AGENT_SERVICE_SIGNING_SECRET env
- [B7/B8/B10 admin forms](b7-b8-b10-admin-forms.md) — decision_templates (migration 0022, 35 tables, seed-order gotcha); @nestjs/schedule v6 + PG advisory-lock skeleton (worker-only); audit principal_type + prom counter + Pino customProps
- [D2 retention job](d2-retention-job.md) — listing auto-expire + erase-after-grace in lib/scheduler/RetentionService (worker-only, no auth-module dep); actor=system; erase field-actions DUPLICATED w/ AdminUserService; RETENTION_GRACE_DAYS/TICK_CRON env
