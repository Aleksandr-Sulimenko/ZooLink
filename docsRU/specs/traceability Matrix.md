---
version: "1.4"
lastUpdated: "2026-07-07"
author: "Системный аналитик"
status: "Approved"
#

# Матрица трассируемости

| ID бизнес‑требования | Источник (беклог) | Номер спецификации | Связанные разделы | Проверочные критерии | Связанный ADR | Связанная схема БД | Связанные API‑эндпоинты |
|----------------------|-------------------|--------------------|-------------------|----------------------|---------------|--------------------|-------------------------|
| BR-001 | BACKLOG-001 | 01-identity-domain.md | 2.1, 2.2, 2.3 | UC‑ID‑01, UC‑ID‑02, UC‑ID‑03, UC‑ID‑04, UC‑ID‑05, Perf‑ID‑01 | 0001-tech-stack.md, 0006-agent-as-principal, 0007-orm-strategy, 0008-rf-provider-matrix | users (id, phone_hash [HMAC, unique], oauth_*, full_name, city_id, avatar_url, email, email_verified, password_hash [только операторы], role, principal_type, status [источник истины], verification_attempts, notification_prefs, preferred_language, is_active [производное], last_login_at, suspended_at, deactivated_at, erased_at [ФЗ-152], created_at, updated_at), refresh_tokens, notification_logs [редактируется при стирании] | auth-api.yaml (POST /auth/register/phone, POST /auth/register/oauth/{provider}, POST /auth/verify-phone, POST /auth/refresh, POST /auth/logout, GET /me, PATCH /me, POST /me/deactivate, POST /me/reactivate, POST /auth/recover/email/request, POST /auth/recover/email/verify, PATCH /admin/users/{userId}/role, POST /admin/users/{userId}/rebind, POST /admin/users/{userId}/erase, POST /me/erase) — passwordless, без /auth/login (round-4); Slice-4 восстановление/повышение роли/стирание |
| BR-002 | BACKLOG-002 | 02-animal-domain.md | 3.1, 3.2 | UC‑AN‑01, UC‑AN‑02, UC‑AN‑03, UC‑AN‑04, UC‑AN‑05, Perf‑AN‑01 | 0001-tech-stack.md | animals (id, owner_id, organization_id, species_id, breed_id, breed_text, nickname, sex, date_of_birth, color_coat, microchip_id, tattoo_brand_id, is_active, health_records, reproductive_data, owned_since, mother_id, father_id, created_at, updated_at, deactivated_at), ownership_transfers, animal_ownership_history (ADR-0013) | animals-api.yaml (GET /animals, POST /animals, GET /animals/{id}, PATCH /animals/{id}, DELETE /animals/{id}, GET /animals/{id}/ownership-history, PATCH /animals/{id}/deactivate, PATCH /animals/{id}/reactivate); transfers-api.yaml (POST /animals/{id}/transfers, POST /transfers/{transferId}/accept, /decline, /cancel, GET /transfers, GET /transfers/{transferId}) — смена владельца, ADR-0013 |
| BR-003 | BACKLOG-003 | 03-pet-marketplace-domain.md | 4.1, 4.2, 4.3 | UC‑PM‑01, UC‑PM‑02, UC‑PM‑03, UC‑PM‑04, UC‑PM‑05, Perf‑PM‑01 | 0001-tech-stack.md | listings (для объявлений о животных, см. animal_id и listing_type) | listings-api.yaml (GET /listings, POST /listings, GET /listings/{id}, PATCH /listings/{id}, DELETE /listings/{id}) |
| BR-004 | BACKLOG-004 | 04-livestock-marketplace-domain.md | 5.1, 5.2 | UC‑LM‑01, UC‑LM‑02, UC‑LM‑03, UC‑LM‑04, UC‑LM‑05, Perf‑LM‑01 | 0001-tech-stack.md | listings (для объявлений о скоте, см. animal_id и listing_type) | listings-api.yaml (аналогично выше) |
| BR-005 | BACKLOG-005 | 05-matching-domain.md | 6.1 | UC‑MT‑01, UC‑MT‑02, UC‑MT‑03, UC‑MT‑04, UC‑MT‑05, Perf‑MT‑01 | 0001-tech-stack.md | animals (reproductive_data), listings (объявления о разведении) | matching-api.yaml (предполагаемые эндпоинты для подбора) |
| BR-006 | BACKLOG-006 | 06-admin-domain.md | 7.1, 7.2 | UC‑AD‑01, UC‑AD‑02, UC‑AD‑03, UC‑AD‑04, UC‑AD‑05 | 0001-tech-stack.md | organizations, branches, organization_users, feature_toggles, outbox_events | admin-api.yaml, organization-api.yaml, branch-api.yaml |
| BR-007 | BACKLOG-007 | 07-geo-search-service.md | 8.1 | UC‑GS‑01, UC‑GS‑02, UC‑GS‑03, Perf‑GS‑01 | 0001-tech-stack.md | listings (location_point, search_radius_m), cities | listings-api.yaml (параметры geo‑поиска в GET /listings) |
| BR-008 | BACKLOG-008 | 08-frontend-architecture.md | 9.1, 9.2 | UC‑FE‑01, UC‑FE‑02, Perf‑FE‑01 | 0001-tech-stack.md | (Н/Д) | Все API‑эндпоинты (фронтенд их использует) |
| BR-009 | BACKLOG-009 | 09-testing-strategy.md | 10.1 | UC‑TS‑01, UC‑TS‑02, UC‑TS‑03, UC‑TS‑04, UC‑TS‑05, Тест‑покрытие >90%, Нагрузочное тестирование | 0001-tech-stack.md | (Н/Д) | (Н/Д) |
| BR-010 | BACKLOG-010 | 10-implementation-roadmap.md | 11.1 | Этапы выполнения, Критерии успеха | 0001-tech-stack.md | (Н/Д) | (Н/Д) |
| BR-011 | BACKLOG-011 | 11-organization-domain.md | 12.1 | (см. User Stories спеки) | 0002-hard-split-markets.md | organizations, branches, organization_users (role_in_org), animals (organization_id) | organization-api.yaml, branch-api.yaml |
| BR-012 | BACKLOG-012 | 12-moderation-domain.md | 13.1 | (см. User Stories спеки) | 0003-pre-moderation-workflow.md, 0006-ai-agents-operate-platform.md | moderation_reasons, moderation_decisions (append-only), content_reports, listings.moderation_status | moderation-api.yaml |
| BR-013 | BACKLOG-013 | 13-notification-domain.md | 14.1 | (см. User Stories спеки) | 0001-tech-stack.md | notification_templates, notification_logs, users.notification_prefs | notification-api.yaml |
| BR-014 | BACKLOG-014 | 14-payment-domain.md | 15.1 | (см. User Stories спеки) | 0006-ai-agents-operate-platform.md | payment_transactions, refunds, listings.transaction_id, feature_toggles.payments | payment-api.yaml |
| BR-015 | BACKLOG-015 | 15-api-gateway-domain.md | 16.1 | (см. User Stories спеки) | 0001-tech-stack.md | (сквозное; auth, rate limiting) | auth-api.yaml + gateway-аспекты во всех контрактах |
| BR-016 | BACKLOG-016 | 03-pet-marketplace-domain.md, 07-geo-search-service.md | (MVP-добавления) | (избранное, сохранённые поиски, жалобы) | 0003-pre-moderation-workflow.md | favorites, saved_searches, content_reports | geo-search-api.yaml (/saved-searches); favorites-api.yaml (GET /favorites, POST/DELETE /listings/{id}/favorite) |
| BR-017 | BACKLOG-017 | 01-identity-domain.md, ADR-0006 | (ИИ-агенты-принципалы) | (принципал HUMAN/AGENT) | 0006-ai-agents-operate-platform.md | users.principal_type, moderation_decisions.moderator_id, service_credentials (миграция 0017) | auth-api.yaml; service_credentials — ФОРМА service-auth агента (хэш-секрет принципала AGENT, ротация/отзыв, gated, не сидится в MVP) |

## Статус реализации — Волны A–D (на 2026-07-07, HEAD `deb8b37`)

Строки выше — якоря BR→спека; слайсы ниже фиксируют, что с тех пор **построено** против этих BR. Каждый несёт свой ADR и миграцию, чтобы матрица оставалась живым контрактом, а не снимком. (Doc-only сводка; per-migration значение авторитетно в `ZooLink/CLAUDE.md`, БД = 37 таблиц, миграции 0001–0034.)

| BR | Слайс (Волна) | ADR / миграция | Статус |
|----|---------------|----------------|--------|
| BR-001 | Шов PII-at-rest crypto (шифрование email/phone + blind index) | ADR-0019 / 0028 | ✅ построено |
| BR-001 | Версионированная модель записи согласия + default контакт-prefs OFF (ст.10.1) | ADR-0020 / 0029 | ✅ построено |
| BR-001 / BR-017 | Junction мультиролей `user_roles` (**dormant** — `users.role` остаётся единственным источником authz) | ADR-0022 / 0034 | ✅ форма построена, поведение отложено |
| BR-002 | Смена владельца + обнаружение контрагента через **claim code** (генерируется получателем) | ADR-0013 / 0023 | ✅ построено |
| BR-002 / BR-013 | Путь уведомлений смены владельца (первый реальный outbox-consumer, канал IN_APP) | ADR-0021 / 0030 | ✅ построено |
| BR-003 / BR-004 | Захват **view-count** объявления (GAP-TRACE-006 — единственный необратимо теряемый сигнал) | 0031 | ✅ построено |
| BR-003 / BR-004 | Возрождение **contact-exchange** — dedup `contact_reveals` + UNIQUE единицы биллинга | ADR-0020 / 0029 | ✅ построено |
| BR-003 / BR-004 / BR-007 | **OfferingRef** полиморфный шов на favorites + saved_searches (`offering_type/offering_id`) | ADR-0014 / 0032 | ✅ форма построена (только ANIMAL_LISTING) |
| BR-003 / BR-004 / BR-007 | **derived-`market` cache** — развязка чтений discovery/модерации от `animals ⋈ species` | ADR-0018 / 0033 | ✅ построено (Part-2 D8/D8b done) |
| BR-007 | Согласование `geo_anchor` / near-me эндпоинтов (точечная форма; PostGIS gated) | ADR-0014 (D7) | ✅ согласовано |
| BR-012 | SLA-эскалация модерации (`Moderation.Escalated`, pet-4h/livestock-6h) | 0024 | ✅ построено |
| BR-016 | Контроллер favorites (`GET /favorites`, `POST/DELETE /listings/{id}/favorite`) | 0032 (D11) | ✅ построено |
| (future) | Резервирование спеки `monetization_type` `{LEAD_GEN,SUBSCRIPTION,TAKE_RATE,NONE}` | ADR-0014 §Amendment (D9) | ⏸ spec-only, модель отложена |

### Экосистемное расширение (видение многосторонней платформы) — где отслеживается

Видение многосторонней экосистемы (услуги + товары + экспертиза + find-nearby) **продвинуто за пределы discovery**: стратегический разбор живёт в `docs/01-discovery/future-features.md` §Ecosystem Expansion, и декомпозирован в отслеживаемый ADR-план в **`docs/04-decisions/ECOSYSTEM_ADR_PLAN.md`** (ADR-0014 offering seam, ADR-0015 market_scope, ADR-0016 provider tier, ADR-0018 cross-aggregate rule, ADR-0022 multi-role). **Открыто для architect/alpha-analyst:** формальных apex-строк бизнес-требований (BR-018+) в этой матрице и в `docs/02-requirements/business-requirements/` пока нет — видение отслеживается как ADR, ещё не как нумерованные BR. Это gap уровня decision-tier, помеченный для **architect**, а не механический фикс doc-keeper.

### Известные расхождения — отслеживаются, ещё не согласованы

- **D10 — асимметрия authz read-scope животного.** `animal.getById` применяет CASL-guard **только-владелец**, тогда как **list**-scope животного допускает чтение **org-admin**. Пользователь, видящий животное в списке, может получить отказ на by-id fetch. Это **известное поведенческое расхождение**, всплывшее в Волне D10 (общая точка authz read-scope); зафиксировано здесь как отслеживаемая проблема для решения **architect/security** (задумано ли org-admin by-id чтение?) — **не** изменение кода в этом doc-свипе. Ни одно требование не потеряно: более безопасный (узкий) guard только-владелец сейчас держится на чувствительном пути.
- **Server-URL контрактов vs префикс runtime.** Все 13 OpenAPI-контрактов объявляют `servers: url: /api/v1`; NestJS-runtime использует URI-версионирование `/v1/*` без префикса `/api` (`backend/src/main.ts`). Это **кросс-контрактный** канон-вопрос (задуманный reverse-proxy префикс `/api` или выравнивание всех 13 на `/v1`?) для **architect/backend** — намеренно **не** пропатчено на одном контракте, что лишь сломало бы его паритет с остальными двенадцатью.