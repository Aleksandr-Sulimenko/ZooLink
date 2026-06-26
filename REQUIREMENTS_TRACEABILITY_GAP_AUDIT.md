---
version: "1.0"
lastUpdated: "2026-06-22"
author: "Orchestrator (traceability sweep)"
status: "Draft — для разбора перед планированием Admin Slice 2-4"
scope: "docs/00-project-brief.md + docs/02-requirements/** ↔ docs/specs/** + api-contracts/** + database_schema.sql + ADR"
---

# Requirements Traceability Gap Audit — ZooLink

Сквозная трассировка: какие **бизнес-требования и продуктовые идеи** из `00-project-brief.md` и
`02-requirements/**` **не покрыты** ни одной спекой/контрактом/схемой (❌) либо **описаны противоречиво** (⚠️).

> **Главный вывод.** Подавляющее большинство расхождений — это **дрейф**: BR-доки в `02-requirements/`
> остались на ранней редакции, тогда как спеки/схема/ADR ушли вперёд (passwordless, matching→stateless,
> FLAG→CHANGES_REQUESTED, ownership transfer внесён в scope). По иерархии истины (бизнес-требования на
> вершине — [[business-requirements-are-apex]]) разрыв чиним **в сторону требования**: либо актуализируем
> BR-док, либо явно трекаем (план/бэклог/ADR) с причиной. Молчаливых расхождений быть не должно.

Каждая находка снабжена тройкой **ЧТО / ПОЧЕМУ / ПОЧЕМУ ТАК ЛУЧШЕ**.
Источники указаны как `файл:строка`. «Истина» — где зафиксировано фактическое решение/состояние.

## Легенда
- ❌ **Uncovered** — требование/идея не имеет реализующего артефакта и не затрекано явно.
- ⚠️ **Contradiction** — требование описано, но конфликтует со спекой/контрактом/схемой/ADR.
- BR-ID — по `docs/specs/traceability Matrix.md`.

---

## Сводка по приоритету

| ID | Severity | Домен | BR | Тип | Краткое |
|----|----------|-------|----|----|---------|
| GAP-TRACE-001 | 🔴 High | Admin | BR-006 | ⚠️ | Модель reference-data: generic UUID-таблица в BR vs отдельные INT-таблицы в схеме |
| GAP-TRACE-002 | 🔴 High | Admin | BR-006 | ❌ | Datasets traits / health-certifications / genetic-markers / animal-statuses не существуют |
| GAP-TRACE-003 | 🔴 High | Matching | BR-005 | ⚠️ | `matching-api.yaml` обещает scoring/feedback/history, которых нет в MVP (spec 05/схема) |
| GAP-TRACE-004 | 🟠 Med | Identity/Admin | BR-001/006/017 | ⚠️ | Набор ролей рассинхронизирован в 3 доках (+ SUPER_ADMIN, BREEDER/FARMER) |
| GAP-TRACE-005 | 🟠 Med | Livestock | BR-004 | ⚠️ | LEASING описан как рабочий тип, но нет в `listing_type` enum/хуке |
| GAP-TRACE-006 | 🟠 Med | Admin/Moderation | BR-006/012 | ⚠️ | FLAG FOR REVIEW в BR vs CHANGES_REQUESTED в схеме/spec 12 |
| GAP-TRACE-007 | ✅ Resolved | Animal | BR-002 | ⚠️ | «Смена владельца запрещена в MVP» vs `ownership_transfers` в scope — **ратифицировано ADR-0013** |
| GAP-TRACE-008 | 🟠 Med | Organization | BR-011 | ⚠️ | `role_in_org` включает MODERATOR в BR, убран миграцией |
| GAP-TRACE-009 | 🟠 Med | Identity | BR-001 | ⚠️ | Пароль для end-users в BR vs passwordless (spec 01 round-4) |
| GAP-TRACE-010 | 🟠 Med | Identity | BR-001 | ⚠️ | Срок JWT 24h vs 15m/7d; хэш телефона bcrypt vs HMAC |
| GAP-TRACE-011 | 🟡 Low | Pet/Org | BR-003/011 | ❌ | Аналитика продавца и org-аналитика — нет эндпоинтов |
| GAP-TRACE-012 | 🟡 Low | Marketplace | BR-003/004 | ❌ | Авто-экспирация листингов (60/90 дней) — нет механизма |
| GAP-TRACE-013 | 🟡 Low | Identity/Security | BR-001 | ❌ | MFA-поле «готово», лимит сессий, история входов, PII-at-rest — нет |
| GAP-TRACE-014 | 🟡 Low | Cross-cutting | — | ❌ | Accessibility (WCAG 2.1 AA, ФЗ-381) не замаплен на артефакты |

---

## Identity (BR-001, BR-017)

### GAP-TRACE-009 ⚠️ Пароль для end-users
- **Источник:** `docs/02-requirements/business-requirements/identity-domain.md:18,26,58,60,150-156` (UC-ID-05).
- **Истина:** passwordless — `docs/specs/01-identity-domain.md` (round-4); `database_schema.sql:108` (`password_hash` — operator-only, ADMIN/MODERATOR); `auth-api.yaml` (OTP/OAuth, нет `/auth/login`).
- **ЧТО:** Привести BR identity к passwordless: убрать «password required при phone-auth», смену/восстановление по паролю; оставить пароль только как operator-only механизм.
- **ПОЧЕМУ:** BR-док описывает несуществующий и сознательно отвергнутый флоу; новый разработчик/агент введёт в заблуждение.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Снижает PII/attack surface (нет паролей у конечных пользователей), согласуется с round-4, ФЗ-152-минимизацией и реализованным Identity-доменом.

### GAP-TRACE-010 ⚠️ Срок JWT и хэш телефона
- **Источник:** `identity-domain.md:18` (JWT 24h), `:56,162` (bcrypt); `nfr/security.md:34-37` (access 15m/refresh 7d), `:86` (bcrypt).
- **Истина:** access 15m / refresh 7d (реализация + security.md); телефон — **HMAC** (traceability matrix; bcrypt не индексируется для unique-lookup).
- **ЧТО:** Зафиксировать единый срок токенов (15m/7d) во всех BR-доках; заменить «bcrypt» на «HMAC» для `phone_hash`.
- **ПОЧЕМУ:** Внутри `02-requirements/` две взаимоисключающие цифры по токенам; bcrypt для телефона технически невозможен как unique-lookup.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Один источник правды по сессиям; корректная крипто-модель (HMAC = детерминированный поиск + защита, bcrypt = только проверка паролей).

### GAP-TRACE-004 ⚠️ Набор ролей (см. ниже, общий с Admin)

### GAP-TRACE-013 ❌ MFA / лимит сессий / история входов / PII-at-rest
- **Источник:** `nfr/security.md:31` (MFA-поле «подготовлено»), `:39` (лимит 5 сессий), `:81-95` (TDE/pgcrypto, email-encrypt); `identity-domain.md:150-156` (UC-ID-05: история входов, terminate session).
- **Истина:** В `database_schema.sql` нет MFA-поля; нет таблицы сессий/лимита; `refresh_tokens` без device/location; нет шифрования колонок.
- **ЧТО:** Либо затрекать в Фаза-2-бэклог с пометкой в самих доках, либо (для claim про MFA-поле) исправить ложное «infrastructure prepared».
- **ПОЧЕМУ:** Требования висят как «есть/готово», но артефактов нет — ложная уверенность в безопасности.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Честная карта безопасности; не закладываем фиктивную готовность в аудит-следы.

### ❌ Авто-очистка через 30 дней неактивности
- **Источник:** `identity-domain.md:52`. **Истина:** авто-purge нет; стирание — явное `erase_user` (ФЗ-152, миграция 0015).
- **ЧТО/ПОЧЕМУ/ЛУЧШЕ:** Убрать «purged after 30 days» из BR (или внести ADR на retention-job) → BR не должен обещать автоудаление, которого нет; явное стирание безопаснее и аудируемо.

---

## Animal (BR-002)

### GAP-TRACE-007 ✅ RESOLVED (2026-06-26) — «Смена владельца запрещена в MVP»
- **Источник:** `business-requirements/animal-domain.md:56`.
- **Истина:** `ownership_transfers` (`database_schema.sql:490`) + `specs/statemachines/ownership_transfer_state_machine.md` + `specs/02-animal-domain.md` (transfer в scope).
- **ЧТО:** Обновить BR: ownership transfer — поддерживаемый флоу (через `ownership_transfers`), а не «создай новый профиль».
- **ПОЧЕМУ:** BR прямо запрещает то, что смоделировано и в плане реализации.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Формальный transfer сохраняет историю/родословную и предотвращает дубль-регистрации, ради которых запрет и вводился.
- **✅ Резолюция (2026-06-26):** BR↔схема/спека приведены в согласие. [ADR-0013](docs/04-decisions/0013-mvp-ownership-transfer.md) **ратифицирует transfer как in-MVP** (упрощённый прямой флоу `PENDING→COMPLETED`/`CANCELLED`); owner-lock relaxed до контролируемого пути (GUC `app.ownership_transfer`); тяжёлая верификация — за `feature_toggles.ownership_transfer_verification`. Стейт-машина (round-N), rbac-matrix (round-8) и `02-animal-domain.md` (round-6) реконсилированы EN↔RU. **Owed:** API-контракт трансфера (`animals-api.yaml`, авторство alpha-analyst) + миграция дельт `ownership_transfers` (backend) + OQ-1 (`animal_ownership_history` для org-owned) — трекаются в самом ADR-0013.

---

## Pet / Livestock Marketplace (BR-003, BR-004)

### GAP-TRACE-005 ⚠️ LEASING
- **Источник:** `livestock-marketplace.md:11-12,136-139` (core concept + §6), `matching-domain.md:21`, `specs/04-livestock-marketplace-domain.md:11` (purpose).
- **Истина:** `listing_type` enum (`database_schema.sql:236`) = `sale/breeding/show/adoption/stud_service`; `leasing` отсутствует, хука/тоггла нет.
- **ЧТО:** Решить явно: (а) добавить `leasing` в enum + правила, либо (б) пометить LEASING как Фаза 2+ во всех доках (как сделано с AUCTION/EMBRYO_TRANSFER).
- **ПОЧЕМУ:** §6 описывает LEASING-правила как действующие, но создать такой листинг нельзя.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Убирает «фантомный» тип; либо реальная фича, либо честно отложена — без ложного контракта.

### GAP-TRACE-011 ❌ Аналитика продавца / организации
- **Источник:** `pet-marketplace.md:254,292` (`GET /listings/{id}/analytics`), `organization-domain.md:76-78` (агрегаты по филиалам).
- **Истина:** В `listings-api.yaml`/`organization-api.yaml` эндпоинтов нет; есть только колонки `view_count`/`contact_shown_count`.
- **ЧТО:** Добавить контракты analytics-эндпоинтов (seller + org) или затрекать в бэклог.
- **ПОЧЕМУ:** UC и BR обещают «Views: 15, Contacts shown: 3» и org-сводку, но API нет.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Аналитика — ключевой retention-сигнал продавца; контракт нужен до фронтенда.

### GAP-TRACE-012 ❌ Авто-экспирация листингов
- **Источник:** `pet-marketplace.md:72` (60 дней), `livestock-marketplace.md:77` (90 дней).
- **Истина:** Статус `EXPIRED` в enum есть; механизма/воркера/спеки авто-перехода нет.
- **ЧТО:** Специфицировать scheduled-expirer (или зафиксировать ручную экспирацию в MVP).
- **ПОЧЕМУ:** Статус есть, но в него ничто не переводит — «мёртвое» состояние.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Свежесть выдачи и корректные метрики; явный owner у перехода EXPIRED.

---

## Matching (BR-005)

### GAP-TRACE-003 ⚠️ Контракт vs MVP-scope
- **Источник:** `api-contracts/matching-api.yaml` (без фазовой пометки): `find-matches` c `compatibility_score`, `/matching/{id}`, `/feedback`, `/history`. BR `matching-domain.md` целиком (scoring 0-100; веса genetic/health/repro/production/logistics; data-model таблица `matches`; feedback).
- **Истина:** `specs/05-matching-domain.md:48-50` (normative): MVP = **stateless search/filter**, таблиц `matches`/`match_history`/`match_feedback` нет (Фаза 2+). В схеме — только `is_visible_in_breeding_search` + `reproductive_status`.
- **ЧТО:** Привести `matching-api.yaml` к MVP (eligible/not по hard-predicates), пометить scoring/feedback/history как Фаза 2+; синхронизировать BR с spec 05.
- **ПОЧЕМУ:** Контракт обещает персистентность и оценки, которых в MVP не существует.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Контракт перестаёт врать о возможностях; фронтенд/потребители не закладывают несуществующие поля.

---

## Organization (BR-011)

### GAP-TRACE-008 ⚠️ `role_in_org` включает MODERATOR
- **Источник:** `organization-domain.md:44,129` (enum с MODERATOR).
- **Истина:** `database_schema.sql:986` сузил до `{OWNER,ADMIN,STAFF,VET}`.
- **ЧТО:** Убрать MODERATOR из org-роли в BR (организационная модерация — Фаза 2+, если нужна).
- **ПОЧЕМУ:** BR перечисляет роль, которой в схеме нет.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Чистое разделение платформенной модерации и org-ролей; меньше путаницы с RBAC.

---

## Admin (BR-006)

### GAP-TRACE-001 ⚠️ Модель reference-data
- **Источник:** `admin-domain.md:175-189` — единая generic UUID-таблица `reference_data(dataset, code, name_localized, sort_order, metadata, created_by/updated_by, versioned)`.
- **Истина:** `database_schema.sql:13-42` — отдельные INT-таблицы `species/breeds/cities` без `created_by/updated_by`, `sort_order`, `description`, версионирования.
- **ЧТО:** Согласовать модель: переписать §Data Model admin-BR под фактические INT lookup-таблицы (см. [[zoolink-id-type-convention]]) — или ADR на generic-подход (не рекомендуется для MVP).
- **ПОЧЕМУ:** Admin Slice 2-4 строится именно на reference-data; концептуальная модель в BR не совпадает со схемой.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** INT-справочники дешевле/быстрее и уже валидированы на PG; generic-таблица — преждевременная гибкость.

### GAP-TRACE-002 ❌ Datasets traits / health-certifications / genetic-markers / animal-statuses
- **Источник:** `admin-domain.md:19-24`; зависят фильтры: `health_certifications`/`genetic_flags`/`production_tags` (`livestock:89-93`), `temperament_tags`/`health_flags` (`pet:86-87`).
- **Истина:** Таблиц нет; контролируемых словарей нет.
- **ЧТО:** Решить по каждому словарю: реализовать lookup-таблицу (если фильтр в MVP) или пометить фильтр как свободный текст/Фаза 2.
- **ПОЧЕМУ:** Поиск-фильтры BR ссылаются на справочники, которых нет → фильтры нереализуемы как задумано.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Явное решение «словарь vs текст vs отложено» снимает скрытую зависимость marketplace↔admin.

### GAP-TRACE-006 ⚠️ FLAG FOR REVIEW
- **Источник:** `admin-domain.md:47-50` + data-model action `('APPROVE','REJECT','FLAG')` (`:197`).
- **Истина:** `database_schema.sql:379` decision `{APPROVED,REJECTED,CHANGES_REQUESTED}`; `specs/12-moderation-domain.md` (FLAG отброшен, введён CHANGES_REQUESTED; appeals — Фаза 2).
- **ЧТО:** Заменить в admin-BR FLAG → CHANGES_REQUESTED; описать его как «исправимый путь».
- **ПОЧЕМУ:** BR описывает действие модератора, которого нет, и не описывает реальное.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Согласует admin-BR с моделью модерации; CHANGES_REQUESTED даёт пользователю фиксируемый путь без отдельной FLAG-машины.

### ⚠️ SUPER_ADMIN
- **Источник:** `admin-domain.md:94`. **Истина:** `users.role` (`schema:109`) не содержит SUPER_ADMIN.
- **ЧТО/ПОЧЕМУ/ЛУЧШЕ:** Либо описать SUPER_ADMIN как внесистемную/devops-роль (не `users.role`), либо убрать → не плодить незакреплённую роль; разделение «системная эксплуатация vs прикладная роль» чище.

### ❌ Версионирование/аудит изменений reference-data; политики паролей/сессий операторов
- **Источник:** `admin-domain.md:27` (versioned), `:168,170` (min-12 пароль, session-timeout 15m).
- **Истина:** Общий `audit_log` есть (`schema:1081`, append-only, before/after/ip/ua), но reference-CRUD-аудит не специфицирован; политики пароля/таймаута операторов не специфицированы; MFA — Фаза 2.
- **ЧТО/ПОЧЕМУ/ЛУЧШЕ:** Специфицировать аудит reference-изменений через `audit_log` и operator-password-policy в spec 06/01 → закрывает реальные требования без новой инфраструктуры (таблица аудита уже есть).

---

## Роли — сводный конфликт

### GAP-TRACE-004 ⚠️ Три разных набора ролей
- **Источники/истина:**
  - `identity-domain.md:173` = `{USER,MODERATOR,ADMIN,VETERINARIAN,GROOMER}` (нет BREEDER/FARMER).
  - `database_schema.sql:109` / `glossary.md:112` = `{USER,MODERATOR,ADMIN,BREEDER,FARMER,VETERINARIAN,GROOMER}` (канон).
  - `admin-domain.md:85-96` = `{USER,MODERATOR,ADMIN}` + **SUPER_ADMIN** (проза).
- **ЧТО:** Принять `database_schema.sql`/`glossary` как канон ролей; синхронизировать identity-BR (добавить BREEDER/FARMER) и admin-BR (убрать SUPER_ADMIN из `users.role`, явно описать additive-модель).
- **ПОЧЕМУ:** Три источника правды по ролям — прямой риск для RBAC, который и есть предмет Admin-домена.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Один канон ролей (валидированный на PG) → RBAC-матрица, гварды и миграции опираются на одно множество. См. [[zoolink-mission-and-ai-agent-vision]] (principal_type HUMAN|AGENT — ортогонален роли, сохранить).

---

## Cross-cutting / NFR

### GAP-TRACE-014 ❌ Accessibility
- **Источник:** `nfr/accessibility.md` целиком (WCAG 2.1 AA, ФЗ-381).
- **Истина:** Фронтенд — Фаза 2; бэкенд-покрытия нет; в спеках лишь вскользь (`specs/05:71`).
- **ЧТО:** Оставить как Фаза-2-требование, но завести явный маппинг (чеклист/DoD) на фронтенд-фазу, чтобы не «растворилось».
- **ПОЧЕМУ:** Объёмное требование без единой точки трассировки рискует выпасть при старте фронтенда.
- **ПОЧЕМУ ТАК ЛУЧШЕ:** Доступность дешевле закладывать с первого фронтенд-спринта, чем ретрофитить.

### Корректно затрекано (проверено, не gap)
- Security: WAF/SAST/DAST/pentest/SIEM/bug-bounty — помечены Фаза 2 **в самом** `security.md`.
- Performance: read-replicas / PostGIS / sharding — Фаза 2 в `performance.md`.
- Marketplace: AUCTION / EMBRYO_TRANSFER — placeholder Фаза 2 (BR + specs `02/03/04` «deferred»).
- Organization: verification badge (`GAP-ORG-003`), geo-координаты филиалов (`GAP-ORG-005`) — Фаза 2.
- Brief: web-only + native Фаза 2; no-chat (ADR-0005); feature toggles; S3; geo-radius; pre-moderation — покрыты.
  Таблицы `conversations`/`messages` (`schema:282,291`) — намеренный хук при ADR-0005, не gap.

---

## Рекомендация по порядку
Перед планированием **Admin Slice 2-4** закрыть 🔴-блокеры **GAP-TRACE-001/002/004** (reference-data модель + словари +
канон ролей) — на них прямо опирается Admin-домен. **GAP-TRACE-003** (matching-контракт) — независимо, но критично для
честности контрактов. Остальные ⚠️ (005-010) — пакетная актуализация BR-доков через `zoolink-doc-keeper` (EN↔RU
синхронно). 🟡 (011-014) — в бэклог с явной фазовой пометкой.
