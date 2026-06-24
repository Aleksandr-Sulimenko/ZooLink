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
1. **Клонировать и сконфигурировать**
   ```bash
   git clone <repo> && cd zoolink
   cp .env.example .env
   # отредактировать .env: задать сильные POSTGRES_PASSWORD/REDIS_PASSWORD, JWT-секреты, ключи провайдеров, PUBLIC_DOMAIN
   chmod 600 .env
   ```
2. **Собрать и запустить данные + приложение**
   ```bash
   docker compose up -d postgres redis minio
   docker compose up -d --build api worker
   ```
3. **Прогнать миграции** (схема — `database_schema.sql`; миграции в `migrations/`). Либо:
   ```bash
   # Prisma (предпочтительно, когда schema.prisma зеркалит database_schema.sql):
   docker compose exec api npx prisma migrate deploy
   # …либо применить SQL напрямую для канонической схемы + миграций:
   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" < database_schema.sql
   ```
4. **Засеять справочники** (species, breeds, cities, supported_languages, feature_toggles).
5. **Запустить proxy**
   ```bash
   docker compose up -d proxy
   ```
6. **Проверить**
   ```bash
   curl -fsS https://$PUBLIC_DOMAIN/health/ready   # ожидаем 200
   docker compose ps                               # все healthy
   ```

## Health-эндпоинты (реализует API)
- `GET /health/live` — процесс жив.
- `GET /health/ready` — БД + Redis доступны (для healthcheck Compose и uptime-монитора).

## Миграции при обновлении
```bash
git pull
docker compose up -d --build api worker
docker compose exec api npx prisma migrate deploy
```
Только вперёд; не редактировать применённую миграцию. Бэкап БД перед каждым деплоем (ниже).

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
