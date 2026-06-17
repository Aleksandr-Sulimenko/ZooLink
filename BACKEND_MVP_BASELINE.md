# ZooLink — Backend MVP Baseline (Definition of Ready for development)

> **Назначение:** единая точка входа для разработчика, начинающего бэкенд ZooLink. Сводит воедино канонический
> стек MVP после ремедиации аудита (`BACKEND_TECH_AUDIT.md`). Это **не** новое решение — это навигатор по
> утверждённым ADR и спекам.
> **Дата:** 2026-06-17 · **Фаза:** MVP (Фаза 1) · **Рынок:** РФ.

---

## 1. Канонический стек MVP (что строим)

| Слой | Выбор MVP | Источник решения |
|---|---|---|
| Язык / Runtime | Node.js 18+ (LTS) + TypeScript | [ADR-0001](docs/04-decisions/0001-tech-stack.md) |
| Framework | NestJS (модульный монолит) | ADR-0001, [ADR-0009](docs/04-decisions/0009-mvp-vs-target-architecture.md) |
| ORM | **Prisma (основной)** + Kysely/`$queryRaw` для гео и сложного JSONB | [ADR-0007](docs/04-decisions/0007-orm-strategy.md) |
| API | REST + OpenAPI 3.0 | ADR-0001 |
| AuthN/AuthZ | JWT (access 15м + refresh rotation) · RBAC через CASL + NestJS Guards | ADR-0001, `specs/security/security_specification.md` |
| БД | **PostgreSQL 16** · деньги = BIGINT (минорные единицы) | ADR-0001, `database_schema.sql` |
| Поиск | PostgreSQL FTS (`russian` + `pg_trgm`); гео = `lat`/`lng` Haversine | `storage.md`, `specs/07-geo-search-service.md` |
| Кэш / rate-limit | Redis 7 (AOF) · `@nestjs/throttler` + Redis-store | ADR-0001, `storage.md` |
| Объектное хранилище | S3-совместимое: MinIO (dev) / Yandex Object Storage (prod) | [ADR-0008](docs/04-decisions/0008-rf-provider-matrix.md) |
| События | Таблица `outbox_events`, вычитка фоновым `worker` (polling/`pg_notify`) — **без брокера** | ADR-0009 |
| Деплой MVP | Docker Compose (1–2 VM) + reverse proxy (Nginx/Caddy/Traefik) | ADR-0009, `deployment-diagram.md` |
| CI/CD | GitHub Actions + dependency scan / SAST / DAST | ADR-0001, `security_specification.md` |
| Мониторинг | Prometheus + Grafana; ошибки — Sentry (self-hosted) | ADR-0008 |

### Провайдеры под РФ (дефолты)
SMS = **SMS.RU** · Email = **Unisender** · Карты = **Yandex.Maps** · Платежи (Фаза 2+, за `feature_toggles.payments`) =
**ЮKassa + СБП** · CDN = **Yandex Cloud CDN**. Полная матрица и альтернативы — [ADR-0008](docs/04-decisions/0008-rf-provider-matrix.md).
**Запрещены (не работают в РФ):** Stripe, PayPal, Twilio, SendGrid, Datadog/New Relic, AWS/CloudFront/Cloudflare.

---

## 2. Что НЕ строим в MVP (Фаза 2+)

Согласно [ADR-0009](docs/04-decisions/0009-mvp-vs-target-architecture.md), отложено и **не** реализуется в MVP:
микросервисы, **gRPC**, отдельная шина событий/брокер (RabbitMQ/Kafka), **Kubernetes** + HPA/VPA, service mesh,
SSR Web Gateway, read-реплики, **Elasticsearch**, **PostGIS**, **NFT/on-chain** (только хуки схемы — см. [ADR-0010](docs/04-decisions/0010-nft-digital-assets-hooks.md)).

> Диаграммы `component-diagram.md` и `deployment-diagram.md` описывают **Target State (Фаза 2+)** и несут
> соответствующий баннер. В MVP читать их как логические модули внутри монолита.

---

## 3. Структура модулей (bounded contexts → NestJS-модули)

```
src/
  modules/
    identity/            # auth, профили, OAuth (Google/Apple/Telegram/VK), SMS-верификация
    animal/              # агрегатный корень (ADR-0004): CRUD, владение (XOR), родословная
    pet-marketplace/     # объявления рынка питомцев (ADR-0002 hard-split)
    livestock-marketplace/ # объявления с/х рынка
    moderation/          # премодерация (ADR-0003), очередь, решения (append-only)
    admin/               # справочники (species/breeds/cities), feature_toggles
    notification/        # email/SMS через провайдеры РФ (ADR-0008)
    payment/             # за feature_toggles.payments; Фаза 2+
  lib/                   # db (Prisma+Kysely), guards, DTO, validation, провайдер-адаптеры
  worker/                # outbox drain, cron, async jobs, очистка незавершённых загрузок
  app.module.ts
```

Межмодульное взаимодействие = in-process DI (никакого gRPC в MVP).

---

## 4. Данные

- **Источник истины схемы:** `database_schema.sql` (валидируется на живом PostgreSQL; 27 таблиц).
- **ERD-канон:** `ZooLink_ERD.mmd` (рендерить `mmdc` при правке).
- **Миграции:** `migrations/` — `20260617_0001_*` (ремедиация аудита), `20260617_0002_*` (digital_assets hooks).
- **Деньги:** BIGINT в минорных единицах (копейки), `currency CHAR(3)`. Никогда FLOAT/INTEGER.
- **ID:** бизнес-сущности — UUID; справочники (species/breed/city) — INT.
- **Локализация:** JSONB `*_localized` `{ "en": ..., "ru": ... }` + функции `get_localized()`/`has_translation()`.
- **Гео:** `lat`/`lng` (DOUBLE) + Haversine/bbox в MVP; `location_point GEOGRAPHY` зарезервирован под PostGIS (Фаза 2+).
- **Расширения PostgreSQL для MVP:** `uuid-ossp`/`pgcrypto`, `pg_trgm`, словари `russian`. Заложить `pgvector`
  на будущее (AI-агенты, ADR-0006) — `CREATE EXTENSION` дёшев.

---

## 5. Безопасность (минимум MVP)

bcrypt (cost ≥12) · JWT 15м + refresh rotation · RBAC (USER/MODERATOR/ADMIN/…) · object-level authorization ·
параметризованный SQL (включая raw — ADR-0007) · rate-limiting на auth и чувствительных эндпоинтах · TLS 1.2+ /
HSTS · аудит security-событий · dependency/SAST/DAST в CI. WAF (Nginx + ModSecurity/OWASP CRS) — добавить на
периметре. ПДн по **ФЗ-152** держать внутри РФ. Детали: `specs/security/security_specification.md`.

---

## 6. Нефункциональные цели (приёмка)

API: 95% < 1с / 99% < 2с (норма). Гео-поиск: 95% < 1.5с (радиус < 100км). 500 одновременных пользователей,
50 RPS среднее / 200 пик. Доступность 99.5%/мес. Полностью: `specs/performance_specification.md`.

---

## 7. Definition of Ready — чек-лист перед первым коммитом бэкенда

- [x] Стек MVP зафиксирован и непротиворечив (ADR-0001/0007/0008/0009/0010).
- [x] Схема БД исполняется на PostgreSQL 16; миграции идемпотентны.
- [x] Деньги = BIGINT во всех доках и схеме.
- [x] Санкционные провайдеры заменены на РФ-набор в доках.
- [x] Диаграммы размечены MVP vs Target State.
- [x] Хуки NFT (`digital_assets` + toggle) заложены без on-chain-кода.
- [x] Слой спеков/требований приведён к РФ-провайдерам + Prisma + MVP (payment/notification/identity/integrations/api-gateway/geo).
- [x] FK-индексы pedigree + `pg_trgm`/russian FTS в схеме (миграция `0003`, проверено на PG).
- [x] RBAC roles×resources матрица — `specs/security/rbac-matrix.md`.
- [x] Стейт-машины для `content_reports` и `digital_assets`; NFR-файлы availability/observability.
- [x] Конвенции API (error-envelope RFC7807, security, `x-required-roles`, пагинация) — `api-contracts/API_CONVENTIONS.md`.
- [x] Исполняемые ops-артефакты: `docker-compose.yml`, `backend/Dockerfile`, `.env.example`, `.gitignore`, `deploy/Caddyfile`, MVP-runbook `06-operations/deployment-mvp.md`.
- [ ] Завести репозиторий бэкенда, NestJS-скелет с модулями из §3 (в `./backend`).
- [ ] `schema.prisma` сгенерировать/сверить с `database_schema.sql`; типы Kysely.
- [ ] Применить `x-required-roles`/`Problem`-схему в каждый `*-api.yaml` по `API_CONVENTIONS.md` (нормативка готова).
- [ ] Реализовать адаптеры провайдеров (SmsProvider/EmailProvider/MapsProvider/ObjectStorage/PaymentProvider).
- [ ] CI: lint + типы + миграции + dependency/SAST scan (workflow security-гейтов).

---

## 8. Связанные документы

- Аудит и обоснования: [`BACKEND_TECH_AUDIT.md`](BACKEND_TECH_AUDIT.md)
- ADR: [0001](docs/04-decisions/0001-tech-stack.md) · [0007](docs/04-decisions/0007-orm-strategy.md) ·
  [0008](docs/04-decisions/0008-rf-provider-matrix.md) · [0009](docs/04-decisions/0009-mvp-vs-target-architecture.md) ·
  [0010](docs/04-decisions/0010-nft-digital-assets-hooks.md)
- Архитектура: `docs/03-architecture/{container,component,deployment}-diagram.md`, `data-model.md`, `storage.md`
- Спеки: `docs/specs/performance_specification.md`, `docs/specs/security/security_specification.md`,
  `docs/specs/07-geo-search-service.md`, `docs/specs/14-payment-domain.md`, `docs/specs/13-notification-domain.md`
