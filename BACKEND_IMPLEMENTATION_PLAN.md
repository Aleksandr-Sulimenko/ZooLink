# ZooLink — Backend Implementation Plan & Checklist

> Подробный, зависимостно-упорядоченный план реализации бэкенда. Следует
> [`IMPLEMENTATION_PLAYBOOK.md`](IMPLEMENTATION_PLAYBOOK.md) (код ↔ док) и
> [`BACKEND_MVP_BASELINE.md`](BACKEND_MVP_BASELINE.md). Каждый пункт — атомарный, проверяемый.
> Прогресс отмечаем галочками; каждый PR закрывается по Definition of Done (внизу).

## Размещение и структура
**`ZooLink/` — монорепо-корень** (доки/контракты/БД/инфра — общие активы). **Бэкенд = `ZooLink/backend/`** (NestJS).
`database_schema.sql` + `migrations/` + `ZooLink_ERD.mmd` остаются на уровне репо как **источник истины БД**.

```
backend/
├── src/
│   ├── main.ts            # bootstrap (Pino, validation, filters, swagger)
│   ├── worker.ts          # фоновый процесс: outbox-relay, cron, jobs
│   ├── app.module.ts
│   ├── config/            # env-валидация (zod/joi), типизированный ConfigService
│   ├── lib/               # db (Prisma+Kysely), errors (RFC7807), pagination, idempotency, etag,
│   │                      #   guards (Jwt/Roles/Policies-CASL), rate-limit, logging+PII-redaction, metrics
│   ├── providers/         # порты+адаптеры: sms(SMS.RU), email(Unisender), maps(Yandex),
│   │                      #   storage(S3/MinIO), payment(stub, gated), feature-toggles
│   ├── events/            # event-catalog типы, outbox writer, relay/consumers
│   └── modules/           # bounded contexts (см. Фазу 2)
├── prisma/                # schema.prisma (через db pull) — typed client; миграции НЕ здесь
├── test/                  # unit/integration (PG via Testcontainers), e2e
├── package.json  tsconfig.json  nest-cli.json  .eslintrc  Dockerfile (есть)
```
> SQL-миграции остаются в `ZooLink/migrations/` (канон). `backend/prisma/` — только `schema.prisma` (зеркало) + client.

## Рабочий процесс БД (выбран: SQL-канон + Prisma introspect)
- БД поднимается из `database_schema.sql` (fresh) или прогоном `migrations/*.sql` (существующая).
- `cd backend && npx prisma db pull` → генерит `schema.prisma` из реальной БД; `npx prisma generate` → typed client.
- **Новое изменение схемы:** правка `database_schema.sql` + новая идемпотентная `migrations/YYYYMMDD_NNNN_*.sql`
  + ERD + `data-model.md` + счётчики в `CLAUDE.md` → прогон на одноразовой PG (двойной) + негативные тесты →
  `prisma db pull` → `generate`. Prisma Migrate НЕ используется как генератор схемы.
- Доступ к данным: **Prisma Client** (CRUD) + **Kysely**/`$queryRaw` (гео-Haversine, рекурсивная родословная, сложный JSONB) — ADR-0007.

## Пины стека
Node 20 LTS · TypeScript · NestJS · Prisma + Kysely · PostgreSQL 16 (+pg_trgm) · Redis 7 · S3/MinIO ·
Pino (JSON+redaction) · class-validator · @nestjs/throttler+Redis · Jest + Testcontainers · OpenAPI 3.0 (Swagger).

---

## Фаза 0 — Каркас и платформенный фундамент
- [x] `backend/` NestJS-скелет: package.json, tsconfig, nest-cli, eslint(flat v9)/prettier, npm-скрипты (start/build/lint/typecheck/test).
- [x] `config/`: zod-валидация всех env из `.env.example`; падать при отсутствии обязательных (fail-fast, типизированный `AppConfigService`).
- [x] `lib/db`: PrismaService (connection pool, graceful shutdown) + Kysely instance (выделенный pg-пул; Prisma свой пул не экспонирует — задокументировано); PgBouncer-совместимость.
- [x] `prisma db pull` из БД (database_schema.sql) → `schema.prisma` (31 модель); `generate`; команда зафиксирована в `backend/README.md`.
- [x] **RFC7807** global exception filter + `Problem` schema; `ValidationPipe` (whitelist); `PageMeta` util; `Idempotency-Key` интерсептор; `ETag`/`If-Match` хелпер; `@nestjs/throttler`+Redis.
- [x] Логирование Pino (request-id, **PII-redaction** по `data-governance.md`); `/metrics` (Prometheus, prom-client); Sentry init (no-op без DSN).
- [x] Health: `GET /health/live`, `GET /health/ready` (PG+Redis) — version-neutral, проверено `200`.
- [x] `worker.ts` каркас (отдельный bootstrap, `worker.module.ts`) + общий код с api.
- [x] Seed-runner (`npm run seed`, `src/seed.ts`): применяет идемпотентные seed-миграции — reference-data (новая `0011`) + `moderation_reasons`/`notification_templates` (`0010`); guard от прод-БД. Найден+исправлен баг идемпотентности `cities` (нет уникального ключа → `WHERE NOT EXISTS` в `0011` и `database_schema.sql`).
- [x] docker-compose dev поднимается: `docker compose up -d --build` → весь стек `healthy`, `https://localhost/health/ready` → 200. Исправлены баги канона: Dockerfile не доносил сгенерированный Prisma-клиент в runtime; proxy не получал `PUBLIC_DOMAIN` (Caddy крэшил); worker наследовал HTTP-healthcheck; `.env.example` JWT-плейсхолдеры <32; minio gating `service_started`.
- [x] CI `ci.yml` активирован: install→`db:generate`→lint→typecheck→build→unit(coverage)→apply `database_schema.sql`→**drift-check** `schema.prisma`→seed×2; отдельный security-джоб (npm audit/Semgrep/Trivy). Убран ошибочный `prisma migrate deploy` (мы на SQL-canon + introspect, ADR-0007).
- **DoD Фазы 0 ✅:** `docker compose up` → зелёный `/health/ready`; Prisma client типизирован из канон-схемы; CI-гейт активен (drift-check сторожит док↔код); seed идемпотентен. Testcontainers-тесты возможны (Docker установлен).

## Фаза 1 — Кросс-каттинг / платформа
- [x] **Auth-core:** JWT access(15м)/refresh(7д) с family-ротацией и reuse-detection (`refresh_tokens`); `JwtGuard`.
- [x] **AuthZ:** `RolesGuard` читает `x-required-roles`; `PoliciesGuard` (CASL) + object-level ownership по `rbac-matrix.md`.
- [x] **Провайдеры (порты+адаптеры):** `SmsProvider`(SMS.RU), `EmailProvider`(Unisender), `MapsProvider`(Yandex), `ObjectStorage`(S3/MinIO), `PaymentProvider`(stub, за `feature_toggles.payments`), `Metrics`(существующий `MetricsService`). Выбор вендора через env; пустой креденшл → адаптер уходит в stub-режим (комм-каналы), S3 всегда live (env-обязателен), payments всегда stub в MVP. `lib/providers/*` (порты+фабрики `@Global`), собственный SigV4-presigner для S3 (без AWS SDK) — **проверен round-trip PUT/GET на живом MinIO**. Новые env: `SMS_FROM`, `UNISENDER_LIST_ID`/`EMAIL_FROM`/`EMAIL_FROM_NAME`, `PAYMENT_PROVIDER`/`YOOKASSA_*` (синхронно в `env.validation.ts` + `.env.example`).
- [x] **Feature-toggle сервис:** `FeatureToggleService` (`lib/feature-toggle/`) — read-through кэш (TTL 30с), **детерминированный rollout** (`sha256(key:subject)%100`, монотонный); `flip` только ADMIN, атомарно в транзакции с записью в `audit_log`; partial-rollout не течёт на анонимов. `@Global` модуль.
- [x] **Outbox-инфра:** `OutboxService.publish(tx, event)` — транзакционный writer (`lib/outbox/`, `@Global`); `OutboxRelay` (worker-only, `OutboxRelayModule`) — polling-relay с **claim-with-lease** (atomic `UPDATE … FOR UPDATE SKIP LOCKED RETURNING`, обработка вне блокировки строки), at-least-once, идемпотентные консьюмеры (`OUTBOX_CONSUMERS`, регистрируются доменами Фазы 2), экспоненциальный **backoff** (10·2ⁿ, cap 1ч) + **parking**/dead-letter после 8 попыток. БД: миграция `0012` (+attempts/last_error/next_attempt_at/dead_lettered_at, `idx_outbox_ready`), **+bugfix**: снят ошибочный `updated_at`-триггер на `outbox_events` (ломал любой UPDATE relay). Claim/lease/process проверены на живом PG.
- [x] **Audit-log сервис:** `AuditLogService` (`lib/audit/`, `@Global`) — append-only INSERT, опц. tx-клиент для атомарности; ADR-0006 agent-as-principal (actor_id может быть AGENT-юзер). Инвариант append-only + rollout-CHECK проверены на живом PG (UPDATE/DELETE → `audit_log is append-only`; rollout=101 → reject).
- **DoD Фазы 1 — ✅ выполнен и подтверждён тестами:** auth/authz e2e (`test/auth.e2e-spec.ts`: 401/200/403/200 на `/v1/auth/whoami`+`operator-check`); outbox round-trip + идемпотентная переотправка на живом PG (`test/outbox.e2e-spec.ts`); провайдеры мокаются/стабятся в unit. Итог: **69 unit + 8 e2e** зелёные.
- **Code-review remediation (round-7, 2026-06-18, всё закрыто до Фазы 2):**
  - HIGH: `updated_at`-триггеры теперь по факту наличия колонки (миграция 0013) — починены `animal_ownership_history`/`messages`, добавлен `digital_assets`.
  - MEDIUM: `ProviderError` → RFC7807 **503 `UPSTREAM_UNAVAILABLE`** в `ProblemExceptionFilter` (сообщение апстрима только в лог, не клиенту) + unit-тест; интеграционные/e2e тесты добавлены и **подключены в CI** (PG+Redis сервисы, отдельный шаг).
  - LOW: снят избыточный `idx_outbox_unprocessed` (миграция 0014); добавлены комментарии-гарды «секрет в URL — не логировать» в SMS.RU/Yandex адаптеры.

## Фаза 2 — Домены (порядок = MVP happy-path и зависимости)
1. [~] **Identity** (`auth-api`, спека 01): регистрация (SMS OTP), OAuth (G/Apple/TG/VK), сессии/recovery, роли, `erase_user`. Уникальность phone_hash(HMAC)/oauth.
   - [x] **Slice 1 — passwordless phone OTP:** `register/phone` (202, OTP via SmsProvider) + `verify-phone` (200, ACTIVE + session); phone_hash=HMAC-SHA256+pepper (base64url), OTP в Redis (TTL 5м/cooldown 60с/lockout 5×→15м); **per-IP rate-limit** на обоих эндпоинтах (5/15м register, 15/15м verify); **audit_log** на register/verify(ok/fail/lockout); verify только из {UNVERIFIED,PENDING} (race-guard); is_active синхронизируется со status. Контракт `auth-api` приведён к round-4 (passwordless, INT cityId, no phoneHash leak, 7 ролей) EN+RU; стейт-машина/traceability/data-model/glossary синхронизированы EN+RU. 91 unit + 12 e2e. Сессии (refresh/logout) — из Фазы 1.
   - [~] **Slice 2 — OAuth:** `POST /auth/register/oauth/:provider` (200 login / 201 register) через порт `OAuthProvider` + реестр (real-если-сконфигурён / stub-в-dev / **reject-в-prod** для несконфигуренных — безопасно); OAuth-identity = verified → юзер сразу `ACTIVE`; find-or-create по `oauth_<provider>_id` (unique, P2002-race→login), block SUSPENDED/DEACTIVATED (403), audit oauth_register/login, per-IP throttle (20/15м). **Telegram-адаптер реализован полностью** (HMAC-проверка, без сети, unit-тест). 100 unit + 15 e2e.
     - [ ] **Slice 2b (tracked, не выпало):** реальные адаптеры **Google** (id_token/JWKS), **Apple** (JWT/JWKS), **VK** (code exchange) — нужны живые секреты; сейчас stub-в-dev/reject-в-prod. Env `OAUTH_*` уже в контракте.
     - [ ] **Account-linking (tracked):** телефон-юзер и OAuth-юзер с одним email = пока РАЗНЫЕ аккаунты (email не unique); объединение/привязка — отдельное решение (ADR при реализации).
   - [ ] Slice 3 — профиль `/me` (GET/PATCH/deactivate/reactivate); Slice 4 — recovery + `erase_user` (ФЗ-152); role-elevation (admin-granted).
2. [ ] **Admin / reference-data** (`admin-api`, спека 06): species/breeds/cities/supported_languages/toggles CRUD (ADMIN), `audit_log` GET, seeding.
3. [ ] **Animal** (`animals-api`, спека 02): CRUD, иммутабельность, **pedigree-целостность**, JSONB-контракты, soft-delete + каскад на листинги.
4. [ ] **Media** (спека 17): `POST /uploads` (pre-signed), attach к листингу/аватару, валидация, варианты, **EXIF-strip**, orphan-cleanup (worker).
5. [ ] **Listings** (`listings-api`, спеки 03/04 + `market-differences`): pet/livestock, **стейт-машина** листинга, market-правила (quantity/price/type), `lat/lng`.
6. [ ] **Moderation** (`moderation-api`, спека 12): очередь FIFO + **claim/lock**, решения + reasons, ре-модерация, SLA/эскалация, content-reports.
7. [ ] **Notification** (`notification-api`, спека 13 + `event-catalog`): рендер шаблонов (Handlebars), consumer'ы outbox, retry, suppression, webhook receipt, prefs (transactional vs promo).
8. [ ] **Contact-exchange** (спека 16): `POST /listings/{id}/contact-reveal` + rate-limit + лог.
9. [ ] **Geo-search** (`geo-search-api`, спека 07): Haversine+bbox (Kysely), FTS(`russian`)+trgm, combined-query, result-контракт, saved-searches.
10. [ ] **Favorites + saved searches** (`favorites-api`).
11. [ ] **Organization / Branch** (`organization-api`/`branch-api`, спека 11): lifecycle, org-роли, invites, affiliation, 1-HQ, archival-каскад.
12. [ ] **Matching** (`matching-api`, спека 05): stateless eligibility-предикат (reproductive_status/sex/species/visibility/radius).
13. [ ] **Payment** (`payment-api`, спека 14): только интерфейс/контур за `feature_toggles.payments` (off) — без живой интеграции в MVP.
- **DoD каждого домена:** контракт `*.yaml` приведён к `API_CONVENTIONS.md` (security/roles/Problem/pagination/§10-14); сервис соблюдает инварианты БД; unit+integration (PG) ≥90%; негативные тесты инвариантов; EN↔RU док актуальны; событие/нотификации по `event-catalog`.

## Фаза 3 — Харднинг и предзапуск
- [ ] E2E критических флоу (register→verify→animal→listing→moderate→publish→search→contact-reveal).
- [ ] Contract-тесты (schemathesis/dredd) против реализации; матрица негативных тестов всех инвариантов 0004/0006/0008/0009.
- [ ] Perf (k6): baseline/peak/geo с seed 50k; проверка SLA (гео <1.5с, API 95%<1с).
- [ ] Security: gates зелёные (npm audit/Semgrep/Trivy), ZAP baseline на staging; проверка PII-маскирования логов.
- [ ] Observability: дашборды Grafana под SLA; алерты; Sentry.
- [ ] Deploy-runbook `deployment-mvp.md` прогон «с нуля» на staging; бэкап/restore тренировка.
- **DoD Фазы 3:** все perf/security/E2E цели достигнуты; runbook воспроизводим; READY к продакшену.

---

## Глобальный Definition of Done (из playbook, на каждый PR)
- [ ] Код соответствует канону (схема/контракт/спека/ADR); расхождений нет.
- [ ] Менялся контракт → обновлены доки + тройка **ЧТО / ПОЧЕМУ / ПОЧЕМУ ТАК ЛУЧШЕ** (ADR или секция спеки + коммит).
- [ ] Схема/миграции идемпотентны на живом PG; есть негативные тесты инвариантов; `prisma db pull` выполнен.
- [ ] EN↔RU синхронны; ERD/счётчики обновлены.
- [ ] API соответствует `API_CONVENTIONS.md`.
- [ ] Ничего из Фазы 2+ не «протекло» в MVP.
- [ ] Коммит/пуш — только по явной просьбе пользователя.

## ⚠️ Security & Hardening backlog (round-6, 2026-06-18)
Запущен режим «Исследование-доработка» backend-агента по Фазе 0. Устранены HIGH-CVE в прод-дереве (kysely→0.29, multer→2.2),
добавлены порог покрытия и политика security-гейта CI, нормативная Kysely-заметка в ADR-0007. **Остаток (should-fix + defer-Phase-2) —
в [`SECURITY_HARDENING_BACKLOG.md`](SECURITY_HARDENING_BACKLOG.md):** заменить заглушку Kysely `DB` на codegen-типы до гео/JSONB;
ratchet покрытия ≥90%/домен; дожать прод-moderate CVE; SARIF/пороги для Semgrep/Trivy; гейт `/metrics`; CSP/CORS; audit_log+agent-as-principal при первом домене.

## Связанное
[`IMPLEMENTATION_PLAYBOOK.md`](IMPLEMENTATION_PLAYBOOK.md) · [`BACKEND_MVP_BASELINE.md`](BACKEND_MVP_BASELINE.md) ·
`docs/specs/*` · `docs/03-architecture/api-contracts/API_CONVENTIONS.md` · `database_schema.sql` · `migrations/`
