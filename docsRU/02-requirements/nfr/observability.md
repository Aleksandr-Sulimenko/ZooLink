# NFR: Наблюдаемость (NFR-OBS)

Ссылается из `specs/15-api-gateway-domain.md` и др. РФ-набор, self-hostable ([ADR-0008](../../04-decisions/0008-rf-provider-matrix.md)).

## Столпы (MVP, Фаза 1)
- **Метрики:** Prometheus + Grafana (или VictoriaMetrics). API отдаёт `/metrics` (RED: rate, errors, duration по
  маршрутам; плюс пул БД, Redis, глубина очереди). Дашборды под SLA из `performance_specification.md`.
- **Логи:** структурированные **JSON**-логи (Pino/Winston) в stdout, агрегируются драйвером логов хоста. **Маскирование
  ПДн обязательно** (ФЗ-152): не логировать телефон, email, токены, ФИО — маскировать/хэшировать (см. `nfr/security.md`).
  Каждый запрос несёт correlation/request id.
- **Трекинг ошибок:** Sentry (self-hosted) для исключений с release + correlation id.
- **Трейсинг:** проброс request-id в MVP; OpenTelemetry/Jaeger — Фаза 2+.

## Алертинг (MVP)
- Доля 5xx > 1% (5 мин), падение `/health/ready`, соединения БД > 80%, диск > 70%, рост бэклога очереди, всплеск
  ошибок платежей. Каналы: email/Telegram для дежурного.

## KPI
- Apdex ≥ 0.9 на критичных сценариях; доля 5xx < 0.5%; MTTD < 1 ч; alert→ack < 15 мин.

## Фаза 2+
ELK/OpenSearch аналитика логов, распределённый трейсинг (OTel/Jaeger), интеграция SIEM, UEBA — Target State.

## Верификация
- Дашборды есть под каждый SLA; алерты срабатывают в fault-injection тесте на staging; в логах нет ПДн (аудит).
