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

1. **Клонировать и сконфигурировать** — `deploy/gen-env.sh` — **единственный** документированный путь провижининга
   env. Он чеканит все секреты через `openssl rand -hex` (длины ≥ требований валидатора), пишет `.env` с правами
   `600` и печатает только **имена** ключей — никогда значения.
   ```bash
   git clone <repo> && cd zoolink
   deploy/gen-env.sh --domain zoolink.example.ru      # создаёт .env — только если .env ОТСУТСТВУЕТ
   # Затем заполнить креды провайдеров, которые генератор намеренно оставляет ПУСТЫМИ (пусто = stub-режим):
   #   SMSRU_API_ID · UNISENDER_API_KEY/UNISENDER_LIST_ID · EMAIL_FROM · YANDEX_MAPS_API_KEY · OAUTH_* · YOOKASSA_*
   ```
   На **существующем** `.env` он не трогает файл вообще: печатает имена недостающих prod-обязательных ключей и
   выходит с ненулевым кодом (код `0` и ноль изменений, если файл полон) — поэтому его безопасно вызывать как
   предполётную проверку. Дополнить существующий файл:
   ```bash
   deploy/gen-env.sh --fill-missing   # чеканит/заполняет ТОЛЬКО отсутствующие-или-пустые ключи; существующие значения не переминчиваются
   ```

   > **`.env.example` — это ФОРМА, а не путь провижининга.** Это комментированная *опись* всех ключей — что есть,
   > что значит, какой формы. Дословное копирование даёт **пустой `METRICS_TOKEN`** и секреты `__change_me__`,
   > поэтому старт с `NODE_ENV=production` **падает** в `backend/src/config/env.validation.ts`
   > (`METRICS_TOKEN: required in production`). `cp .env.example .env` делать **не надо**. Обе половины
   > проверяются: CI-job `edge-smoke` провизионирует env через `deploy/gen-env.sh` и держит **негатив-контроль**,
   > утверждающий, что путь `cp` отвергается при старте; unit-тест `backend/src/config/gen-env.spec.ts` исполняет
   > настоящий генератор против настоящего `validateEnv` и выводит набор обязательных ключей из zod-схемы —
   > так эти два не могут разойтись.
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
`.env` — единственное хранилище секретов в MVP — генерируется `deploy/gen-env.sh`, вне git (`.gitignore`), права
`600`. Ротация: удалить строку ключа (или обнулить значение) и выполнить `deploy/gen-env.sh --fill-missing`, затем
`docker compose up -d`. Помнить о связанных ротациях: `POSTGRES_PASSWORD`/`REDIS_PASSWORD` должны идти в паре с
`DATABASE_URL`/`REDIS_URL` (генератор выводит эти два из найденных кредов, поэтому строку URL ротировать вместе со
строкой пароля), `PII_DATA_KEY` требует миграции перешифрования, а `PII_BLIND_INDEX_KEY` — бэкфилла `email_bidx`.
Vault/secret-manager — Фаза 2+.

## Наблюдаемость (MVP)
Prometheus + Grafana для метрик, Sentry (self-hosted) для ошибок, структурированные JSON-логи с маскированием ПДн
(ФЗ-152) — см. [ADR-0008](../04-decisions/0008-rf-provider-matrix.md) и `monitoring.md`.

## Аварийное восстановление (single-VM MVP)
Восстановление = переподнять VM → `docker compose up -d` → восстановить последний `pg_dump` → перенаправить DNS.
RPO ≤ 24 ч (ежедневный дамп; ужесточить WAL-архивированием при необходимости). Cross-region/standby — Target (Фаза 2+).

## Связанное
- `docker-compose.yml`, `backend/Dockerfile`, `deploy/Caddyfile` в корне
- `deploy/gen-env.sh` — **провижинер** env (документированный путь) · `.env.example` — **ФОРМА** env (опись ключей,
  только справка) · `backend/src/config/env.validation.ts` — контракт env, проверяемый при старте
- [BACKEND_MVP_BASELINE.md](../../BACKEND_MVP_BASELINE.md) · [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md)
- 🌐 EN: [docs/06-operations/deployment-mvp.md](../../docs/06-operations/deployment-mvp.md)
