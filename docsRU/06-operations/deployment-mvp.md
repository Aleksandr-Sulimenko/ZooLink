# Runbook развёртывания MVP (Docker Compose)

> Обязательно для **MVP (Фаза 1)** по [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md). Материал по
> Kubernetes в `deployment.md` / `deployment_specification.md` — **Target State (Фаза 2+)**. Провайдеры — РФ-набор
> по [ADR-0008](../04-decisions/0008-rf-provider-matrix.md).

## Топология
Одна-две VM с Docker Compose (см. `docker-compose.yml` в корне): `proxy` (Caddy, TLS, публичный), `api` (монолит
NestJS, масштабируемый), `worker` (вычитка outbox/cron/задачи), `postgres`, `redis`, `minio`. Публикуется только
`proxy` (80/443). `postgres`/`redis`/`minio` — во внутренней Docker-сети, **никогда** не выставлены наружу.

## Предпосылки
- VM (≥2 vCPU / 4 ГБ для небольшого MVP), Docker Engine + Compose v2.
- DNS A-запись → IP VM для `PUBLIC_DOMAIN` (Caddy получает TLS автоматически).
- Репозиторий бэкенда в `./backend` (приложение NestJS с `Dockerfile`, Prisma-схемой, `dist/main.js`, `dist/worker.js`).

## Первое развёртывание — по шагам
Схема **никогда** не применяется через `prisma migrate deploy` (ADR-0007: SQL-канон + интроспекция Prisma — Prisma
Migrate намеренно не используется). На свежем стеке это делает за вас одноразовый сервис **`provision`**: он применяет
канонический `database_schema.sql` (с защитой — только на пустой БД), затем запускает **идемпотентный** seed
(справочники: species, breeds, cities, supported_languages, feature_toggles, причины/шаблоны модерации). `api`/`worker`
ждут успешного завершения `provision`, поэтому стек поднимается полностью провизионированным **без ручных шагов**.

1. **Клонировать и сконфигурировать**
   ```bash
   git clone <repo> && cd zoolink
   cp .env.example .env
   # отредактировать .env: задать сильные POSTGRES_PASSWORD/REDIS_PASSWORD, JWT-секреты (≥32 символов), ключи
   # провайдеров, PUBLIC_DOMAIN. Env валидируется zod при старте (fail-fast) — держать .env в соответствии с
   # backend/src/config/env.validation.ts.
   chmod 600 .env
   ```
2. **Поднять весь стек** — Compose упорядочивает: `postgres` healthy → `provision` (схема + seed) выходит с 0 →
   старт `api`/`worker` → `proxy` последним.
   ```bash
   docker compose up -d --build
   ```
3. **Проверить** (`provision` должен выйти с кодом 0; остальное — healthy)
   ```bash
   docker compose ps                               # provision = Exited (0); proxy/api/worker/postgres/redis/minio healthy
   docker compose logs provision                   # "✓ canonical schema applied" + "✓ provisioning complete"
   curl -fsS https://$PUBLIC_DOMAIN/health/ready   # ожидаем 200 (PG + Redis доступны, через edge)
   ```

> Свежий `down -v && up` провизионирует заново; обычный `up` на существующем томе — no-op (применение схемы
> пропускается, т.к. БД непустая; seed перезапускается, но идемпотентен). Без `prisma migrate deploy`, без ручного psql.

## Health-эндпоинты (реализует API)
- `GET /health/live` — процесс жив.
- `GET /health/ready` — БД + Redis доступны (для healthcheck Compose и uptime-монитора).

## Изменения схемы при обновлении (roll-forward, SQL-канон)
Сервис `provision` применяет **полный** `database_schema.sql` только на *пустой* БД, поэтому на заполненном томе новое
изменение схемы применяется **прогоном новой идемпотентной миграции(й)** (ADR-0007 — только вперёд, никогда
`prisma migrate deploy`, никогда не редактировать применённую миграцию). Сначала бэкап (ниже):
```bash
git pull
# применить каждую НОВУЮ идемпотентную миграцию, добавленную с последнего деплоя, по порядку:
for f in migrations/<new-NNNN>_*.sql; do
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$f"
done
docker compose up -d --build api worker        # выкатывает новый образ (Prisma-клиент уже в нём)
docker compose run --rm provision              # опц.: перезапускает идемпотентный seed (применение схемы пропускается)
```
Миграции идемпотентны (CI прогоняет `migrations/*` дважды + диффит два пути bootstrap — см. job `migration-drift`
в `.github/workflows/ci.yml`), поэтому повторный прогон безопасен.

## Бэкапы и восстановление (MVP)
- **Ежедневный** логический бэкап (cron на хосте или `worker`):
  ```bash
  docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > backup-$(date +%F).sql.gz
  ```
  Вывозить off-box (Yandex Object Storage). Ретенция: 30 дней / 12 недель.
- **Восстановление:**
  ```bash
  gunzip -c backup-YYYY-MM-DD.sql.gz | docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
  docker compose restart api worker
  ```
- **MinIO/объекты:** включить версионирование; зеркалить бакет в Yandex Object Storage. Redis — только кэш (не бэкапится).

## Секреты
`.env` — единственное хранилище секретов в MVP — вне git (`.gitignore`), права `600`. Ротация: правка `.env` и
`docker compose up -d`. Vault/secret-manager — Фаза 2+.

## Наблюдаемость (MVP)
Prometheus + Grafana для метрик, Sentry (self-hosted) для ошибок, структурированные JSON-логи с маскированием ПДн
(ФЗ-152) — см. [ADR-0008](../04-decisions/0008-rf-provider-matrix.md) и `monitoring.md`.

## Аварийное восстановление (single-VM MVP)
Восстановление = переподнять VM → `docker compose up -d` → восстановить последний `pg_dump` → перенаправить DNS.
RPO ≤ 24 ч (ежедневный дамп; ужесточить WAL-архивированием при необходимости). Cross-region/standby — Target (Фаза 2+).

## Связанное
- `docker-compose.yml`, `backend/Dockerfile`, `.env.example`, `deploy/Caddyfile` в корне
- [BACKEND_MVP_BASELINE.md](../../BACKEND_MVP_BASELINE.md) · [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md)
- 🌐 EN: [docs/06-operations/deployment-mvp.md](../../docs/06-operations/deployment-mvp.md)
