# NFR: Observability (NFR-OBS)

Referenced by `specs/15-api-gateway-domain.md` and others. RF-appropriate, self-hostable stack ([ADR-0008](../../04-decisions/0008-rf-provider-matrix.md)).

## Pillars (MVP, Фаза 1)
- **Metrics:** Prometheus + Grafana (or VictoriaMetrics). The API exposes `/metrics` (RED: rate, errors, duration
  per route; plus DB pool, Redis, queue depth). Dashboards for the perf SLAs in `performance_specification.md`.
- **Logging:** structured **JSON** logs (Pino/Winston) to stdout, aggregated by the host log driver. **PII redaction
  is mandatory** (ФЗ-152): never log phone, email, tokens, full names — mask/hash (see `nfr/security.md`).
  Every request carries a correlation/request id.
- **Error tracking:** Sentry (self-hosted) for exceptions with release + correlation id.
- **Tracing:** request-id propagation in MVP; OpenTelemetry/Jaeger is Фаза 2+.

## Alerting (MVP)
- 5xx error rate > 1% (5 min), `/health/ready` failing, DB connections > 80%, disk > 70%, queue backlog growing,
  payment failure spike. Channels: email/Telegram for the on-call.

## KPIs
- Apdex ≥ 0.9 on critical journeys; error rate < 0.5% 5xx; MTTD < 1h; alert→ack < 15 min.

## Фаза 2+
ELK/OpenSearch log analytics, distributed tracing (OTel/Jaeger), SIEM integration, UEBA — Target State.

## Verification
- Dashboards exist for each perf SLA; alerts fire in a staging fault-injection test; logs contain no PII (audited).
