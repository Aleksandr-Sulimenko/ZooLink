---
title: "Аудит схемы БД ZooLink"
auditor: "Senior System Analyst / DBA"
date: "2026-06-16"
sources:
  - database_schema.sql (источник истины)
  - ZooLink_ERD.mmd
  - docs/ (EN-канон)
status: "Final"
---

# Аудит схемы БД ZooLink против документации

> ## ✅ Статус ремедиации (2026-06-17)
> Бо́льшая часть находок устранена и **проверена на живом PostgreSQL 14** (схема применяется чисто, миграция идемпотентна):
> - **P0 (блокеры):** удалён битый `chk_animals_breed`; FK `organization_users→users` вынесен в ALTER; мёртвые `COMMENT` на `organizations.name_ru/name_en` и `branches.metadata` убраны; невалидный `idx_listings_expires` (NOW() в предикате) исправлен; PostGIS сделан опциональным + добавлены `listings.lat/lng`; добавлены статус-колонки `listings.status`/`users.status`; созданы домены **Moderation** (append-only audit + триггер immutability), **Payment**, **Notification**, и `ownership_transfers`.
> - **P1:** `breed_id`/`animal_ownership_history` FK → RESTRICT; UNIQUE на `organization_users(org,user)`; `price_cents`/`amount_minor` = BIGINT; breeding-атрибуты `animals`; синхронизированы дефекты документации (`city_id` INT в API-контрактах; `users.role` + nullability в `data-model.md`).
> - **Артефакты:** `database_schema.sql` (исполняется), `migrations/20260617_0001_schema_audit_remediation.sql` (идемпотентна), обновлённый `ZooLink_ERD.mmd`, разделы в `data-model.md` (EN+RU).
> - **Открытые вопросы владельцу** (см. конец отчёта) НЕ закрывались: семантика владения животным (XOR vs «at least one»), MVP-скоуп статус-доменов, «один активный листинг на животное». Схема оставлена в текущем (XOR) виде.


> Объём аудита: `database_schema.sql` (570 строк) vs `ZooLink_ERD.mmd`, `docs/03-architecture/data-model.md`, доменные спеки `docs/specs/01..15`, стейт-машины `docs/specs/statemachines/*`, бизнес-требования `docs/02-requirements/business-requirements/*`, API-контракты `docs/03-architecture/api-contracts/*.yaml`.
> Эталон конвенции ID (решение владельца): бизнес-сущности = UUID; lookup-справочники (`species`, `breeds`, `cities`) = INT. Расхождения ERD/контрактов с этой конвенцией трактуются как дефект документации, не схемы.

---

### 1. Резюме (Executive Summary)

**Степень соответствия: ~55–60%** (качественно — «частичное соответствие, MVP-ядро покрыто, четыре документированных домена физически отсутствуют»).

Схема корректно и полно реализует **MVP-ядро**: Identity (`users`), Animal (`animals`, `animal_ownership_history`), Organization (`organizations`, `branches`, `organization_users`), Listings/Interactions (`listings`, `listing_photos`, `conversations`, `messages`), Admin/справочники (`species`, `breeds`, `cities`, `feature_toggles`, `outbox_events`, `supported_languages`). Конвенция ID соблюдена в самой схеме безупречно (UUID для сущностей, INT для всех трёх справочников). JSONB-локализация, GIN-индексы, мягкое удаление, outbox-паттерн и триггеры `updated_at` реализованы согласованно с `data-model.md`.

**Ключевые риски:**

| # | Риск | Уровень |
|---|------|---------|
| R1 | Скрипт **не исполняется**: `ALTER TABLE animals ADD CONSTRAINT chk_animals_breed ... breed_text` (строка 368) ссылается на несуществующую колонку `breed_text` (есть только `breed_text_localized`). DDL падает на этой строке. | P0 (Blocker) |
| R2 | Порядок DDL: `organization_users` (стр. 73) ссылается на `users(id)`, но таблица `users` создаётся позже (стр. 93). FK к ещё не созданной таблице → ошибка выполнения. | P0 (Blocker) |
| R3 | **4 документированных домена отсутствуют в схеме**: Payment (`payment_transactions`, `refunds`), Moderation (`moderation_decisions` + статус-поля), Notification (`notification_logs`, `notification_templates`, user-preferences), и статус-сущности стейт-машин (`ownership_transfer`). Требования из спек 12/13/14 физически нереализуемы. | P0/P1 |
| R4 | **Отсутствуют статусные колонки** для стейт-машин listing/user. Есть только `is_active` (boolean), а спеки требуют 6 состояний listing (DRAFT/PENDING_MODERATION/ACTIVE/EXPIRED/SOLD/DEACTIVATED) и 6 состояний user. Стейт-машины нереализуемы. | P0 |
| R5 | Дрейф контракта `city_id`: схема и конвенция = INT, но `organization-api.yaml`/`branch-api.yaml` объявляют `city_id` как `string/uuid`. Дефект документации (S2). | P1 |
| R6 | PostGIS-зависимость: `location_point GEOGRAPHY(POINT,4326)` хардкодит тип, но расширение PostGIS закомментировано (стр. 8). `CREATE TABLE listings` упадёт без PostGIS. Fallback lat/lng в схеме отсутствует, хотя geo-spec его требует как основной вариант. | P0 |

---

### 2. Критические несоответствия (Blockers)

#### B1 — DDL не исполняется: ссылка на несуществующую колонку `breed_text`
- **Где:** `database_schema.sql:366-368`
  ```sql
  ALTER TABLE animals
  ADD CONSTRAINT chk_animals_breed
      CHECK ( breed_id IS NOT NULL OR breed_text IS NOT NULL );
  ```
- **Проблема:** в таблице `animals` колонки `breed_text` нет — есть `breed_text_localized JSONB` (стр. 131). Выполнение скрипта прерывается с `ERROR: column "breed_text" does not exist`.
- **Дополнительно:** этот ALTER избыточен — ограничение уже выражено через `chk_animals_breed_dep` (стр. 135-138), причём *строже* (XOR вместо OR). Два ограничения конфликтуют по семантике (OR допускает оба NOT NULL, XOR — нет).
- **Спека:** `animal-domain` / `data-model.md:97` (там `breed_text_localized JSONB NOT NULL DEFAULT`).

#### B2 — Нарушен порядок создания таблиц (FK вперёд)
- **Где:** `database_schema.sql:73-76` (`organization_users.user_id ... REFERENCES users(id)`) при том, что `CREATE TABLE users` — на `database_schema.sql:93`.
- **Проблема:** на момент создания `organization_users` таблица `users` ещё не существует → `ERROR: relation "users" does not exist`. Блок Organization Domain нужно разместить **после** Identity Domain, либо вынести FK в отдельные `ALTER TABLE`.

#### B3 — Жёсткая зависимость от PostGIS при выключенном расширении
- **Где:** `database_schema.sql:8` (`-- CREATE EXTENSION ... postgis` закомментировано) vs `:208` (`location_point GEOGRAPHY(POINT, 4326)`).
- **Проблема:** тип `GEOGRAPHY` доступен только при установленном PostGIS. `CREATE TABLE listings` упадёт с `ERROR: type "geography" does not exist`. Блок `DO $$ ... pg_extension` (стр. 258-267) обрабатывает только индекс, но не саму колонку.
- **Спека:** `docs/specs/07-geo-search-service.md:38,41` — Prior Decision явно требует **«separate latitude and longitude floating-point columns»** как способ хранения для MVP (Haversine + bounding box), а PostGIS — «to be decided». Схема же сделала PostGIS обязательным и не добавила fallback lat/lng, который `data-model.md:263` называет опциональным. Прямое противоречие geo-спеке.

#### B4 — Отсутствуют статусные колонки для стейт-машин (listing/user)
- **Спеки:** `docs/specs/statemachines/listing_state_machine.md` (6 состояний), `user_state_machine.md` (6 состояний).
- **Где в схеме:** `listings` (стр. 195-221) и `users` (стр. 93-112) имеют только `is_active BOOLEAN` — двузначность вместо 6-значного перечисления.
- **Проблема:** невозможно различить DRAFT vs PENDING_MODERATION vs EXPIRED vs SOLD vs DEACTIVATED; аналогично UNVERIFIED/PENDING_VERIFICATION/VERIFIED/SUSPENDED. Пре-модерация (ADR-0003), истечение, продажа, приостановка пользователя — нереализуемы на уровне данных. Также отсутствуют сопутствующие timestamp-поля переходов (`published_at`, `sold_at`, `suspended_at`).

#### B5 — Домен Moderation отсутствует целиком
- **Спека:** `docs/specs/12-moderation-domain.md:45,62` — требует таблицу с `status (PENDING/APPROVED/REJECTED/CHANGES_REQUESTED)` и **immutable append-only audit trail** (`ModerationDecision`: id, moderatorId, entityType, entityId, decision, reason, notes, createdAt).
- **Где в схеме:** таблиц нет. У `listings`/`animals` нет `moderation_status`. Audit-таблицы нет.
- **Проблема:** констрейнт спеки «Moderation decisions and audit logs must be stored immutably (append-only)» (12-moderation:40) не реализуем. Pre-moderation workflow (ADR-0003) нереализуем.

#### B6 — Домен Payment отсутствует целиком
- **Спека:** `docs/specs/14-payment-domain.md:72-73` — требует `PaymentTransaction` (id, userId, gatewayTransactionId, amount, currency, status ∈ PENDING/COMPLETED/FAILED/REFUNDED/DISPUTED, purposeType, purposeId, ...) и `Refund` (id, paymentTransactionId, gatewayRefundId, amount, reason, status).
- **Где в схеме:** таблиц нет.
- **Проблема:** стейт-машина `listing_state_machine.md:28` (`ACTIVE→SOLD` по `Payment status = CONFIRMED`) и `ownership_transfer_state_machine.md:22` (`payment_confirmed = TRUE`) ссылаются на платёжный статус, которого негде хранить.
- **Тип денег (особое внимание):** в `listings` сумма хранится как `price_cents INTEGER` + `currency CHAR(3)` — это **корректный** minor-units подход (не FLOAT). При добавлении Payment-таблиц сумму также следует хранить как `amount_minor BIGINT` (или `NUMERIC(18,2)`), **не** FLOAT/DOUBLE. Спека (14-payment:72) называет поле `amount` без типа — требуется зафиксировать тип явно (см. рекомендацию P1-9).

#### B7 — Домен Notification отсутствует целиком
- **Спека:** `docs/specs/13-notification-domain.md:68-69` — `NotificationLog` (id, userId, type EMAIL/SMS, templateId, recipient, content, status SENT/DELIVERED/FAILED/BOUNCED, providerResponse, attempts, ...) и `NotificationTemplate` (id, name, type, subjectTemplate, bodyTemplate, language, isActive).
- **Где в схеме:** таблиц нет. Также нет user-preferences (opt-in/out), хотя 13-notification:53 размещает их в Identity Domain (`users` или отдельная таблица) — в `users` таких колонок нет.

#### B8 — Сущность Ownership Transfer отсутствует
- **Спека:** `docs/specs/statemachines/ownership_transfer_state_machine.md` — состояния PENDING/IN_PROGRESS/COMPLETED/FAILED, поля transfer_id, обе стороны, confirmed-флаги, failure_reason, таймеры.
- **Где в схеме:** есть только `animal_ownership_history` (стр. 180-188) — это **журнал свершившихся** фактов (start_date/end_date/transfer_reason), а не **процессная** сущность перехода. Стейт-машина трансфера негде жить. При этом MVP-триггер (стр. 390-392) вообще блокирует смену `owner_id` — что согласуется с «MVP ownership lock», но делает `animal_ownership_history` и стейт-машину неактивируемыми в MVP (зафиксировать как осознанный пост-MVP скоуп).

---

### 3. Пропущенные сущности и атрибуты (Missing Elements)

**Отсутствующие таблицы** (есть в спеках, нет в схеме):

| Таблица | Источник | Назначение |
|---------|----------|-----------|
| `payment_transactions` | 14-payment:72 | Платёжные транзакции |
| `refunds` | 14-payment:73 | Возвраты |
| `moderation_decisions` | 12-moderation:62 | Решения модерации (append-only audit) |
| `notification_logs` | 13-notification:68 | Журнал доставки уведомлений |
| `notification_templates` | 13-notification:69 | Шаблоны уведомлений |
| `ownership_transfers` | statemachines/ownership_transfer | Процесс трансфера владения |
| `user_notification_preferences` | 13-notification:53 | Opt-in/out пользователя (или колонки в `users`) |
| `moderation_reasons` (lookup) | 12-moderation:48,66 | Предопределённый список причин (конфигурируется Admin) |

**Отсутствующие колонки в существующих таблицах:**

| Таблица | Колонка | Источник | Комментарий |
|---------|---------|----------|-------------|
| `listings` | `status` (ENUM 6 состояний) | listing_state_machine | Сейчас только `is_active` |
| `listings` | `published_at`, `sold_at`, `transaction_id` | listing_state_machine (Entry Actions ACTIVE/SOLD) | Нет timestamp-полей переходов |
| `listings` | `moderation_status` / FK на решение | 12-moderation:46 | Связь со статусом модерации |
| `users` | `status` (ENUM 6 состояний) | user_state_machine | Сейчас только `is_active` |
| `users` | `suspended_at`, `verification_attempts` | user_state_machine (SUSPENDED, MAX_ATTEMPTS) | Поля поддержки переходов |
| `animals` | `pedigree_id`, `health_test_results`, `show_titles`, `breeding_restrictions`, `is_visible_in_breeding_search` | 05-matching:108, UC-MT-02 | Breeding-атрибуты Matching-домена |
| `listings` | `lat` / `lng` (DOUBLE PRECISION) | 07-geo-search:41 | Fallback-хранение координат (Prior Decision) |

**Отсутствующие индексы:**

| Индекс | Зачем | Источник |
|--------|-------|----------|
| `idx_organization_users (organization_id, user_id) UNIQUE` | Предотвратить дубль-членство (M:N целостность) | 11-organization / data-model |
| `idx_listings_status` | Запросы по состоянию стейт-машины | listing_state_machine |
| Частичный UNIQUE по OAuth-провайдерам (`oauth_google_id` и т.д.) | Один аккаунт = один google_id | identity-domain |
| `UNIQUE (animal_id) WHERE is_active` на `listings` | Один активный листинг на животное (если требуется бизнесом — **не подтверждено**, отметить как вопрос) | — |
| `idx_messages_conversation (conversation_id, sent_at)` композитный | Пагинация ленты сообщений | (производительность) |

---

### 4. Избыточность и «мёртвый» код (Redundancy)

| Объект | Где | Замечание |
|--------|-----|-----------|
| Дублирующее ограничение `chk_animals_breed` (OR) vs `chk_animals_breed_dep` (XOR) | `:366-368` vs `:135-138` | Конфликт семантики; первое к тому же ломает DDL (см. B1). Удалить `chk_animals_breed`. |
| `metadata JSONB` в `listings` (стр. 201) | — | Не документирован в `data-model.md` детально как контракт; «experimental» — допустимо, но без схемы валидации = риск свалки данных. Низкий приоритет. |
| Колонка `quantity` в `listings` (стр. 207) | — | Не упомянута в стейт-машине/доменах pet/livestock явно; присутствует в API. Допустимо, но проверить владельца. |
| Комментарии-колонки на русском в EN-каноне (`COMMENT ON COLUMN ... IS 'Дата...'`) | `:159-162, 418-453, 561-569` | Не нарушает DDL, но смешивает языки в каноне. Стилистика, P2. |
| `name_ru`/`name_en` в комментариях organizations (`:419-420`) | — | **Мёртвая ссылка:** комментарии описывают колонки `name_ru`/`name_en`, которых в таблице `organizations` нет (там `name_localized JSONB`). Комментарий применяется через `COMMENT ON COLUMN organizations.name_ru` → **упадёт**, т.к. колонки нет. Это ещё один DDL-блокер (см. рекомендацию P0-3). |
| Триггер `update_supported_languages_updated_at` | блок `:307-325` НЕ включает `supported_languages` в список | Несогласованность: у таблицы нет `updated_at` — корректно, что исключена; но `branches`/`organization_users` имеют `updated_at` и включены — ОК. Зафиксировано как корректное. |

---

### 5. Проверка типов данных и ограничений (Data Types & Constraints)

**Конвенция ID (UUID/INT):**

| Сущность/поле | Схема | Конвенция | Вердикт |
|---|---|---|---|
| `users.id`, `animals.id`, `organizations.id`, `listings.id`, ... | UUID | UUID | ✅ |
| `species.id`, `breeds.id`, `cities.id` | SERIAL/INT | INT | ✅ |
| `animals.species_id`, `animals.breed_id` | INTEGER | INT | ✅ (совпадает с `animals-api.yaml:30,35`) |
| `users.city_id`, `branches.city_id` | INTEGER | INT | ✅ в схеме |
| `city_id` в API | **string/uuid** (`organization-api.yaml:619-620`, `branch-api.yaml:205-207`) | INT | ❌ **дефект документации (S2)** — контракт расходится со схемой и конвенцией |

**Денежные типы (особое внимание):**
- `listings.price_cents INTEGER` + `currency CHAR(3) DEFAULT 'RUB'` — ✅ корректно (minor units, не FLOAT). Совпадает с `listings-api.yaml:384` (integer, «in cents»).
- ⚠️ `INTEGER` для cents ограничивает сумму ~21,5 млн RUB (2^31 копеек). Для livestock (дорогой племенной скот) рекомендуется `BIGINT`. P1.
- Будущие Payment-таблицы: тип `amount` в 14-payment:72 не специфицирован → зафиксировать `BIGINT` minor units или `NUMERIC(18,2)`, **запретить** FLOAT/DOUBLE.

**JSONB-локализация:**
- `name_localized`, `description_localized`, `title_localized`, `nickname_localized`, `breed_text_localized` — ✅ согласованы с `data-model.md` и GIN-индексами (`:518-559`).
- ⚠️ `animals.nickname_localized JSONB NOT NULL` (стр. 132) — **без DEFAULT**, тогда как `data-model.md:98` указывает `NOT NULL DEFAULT '{"en":"","ru":""}'`. Несоответствие: вставка без nickname упадёт. Уточнить намеренность.
- ⚠️ `animals.breed_text_localized JSONB` (стр. 131) — **nullable, без DEFAULT** в схеме, тогда как `data-model.md:97` объявляет `NOT NULL DEFAULT`. Здесь схема (nullable) логичнее (XOR с breed_id), значит дефект в `data-model.md`. Зафиксировать расхождение.

**Timestamps:**
- Повсеместно `TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()` — ✅ согласовано, ERD `TIMESTAMPTZ`.

**NOT NULL / UNIQUE / DEFAULT / CHECK:**
- `species.code UNIQUE`, `breeds UNIQUE(species_id, code)` — ✅.
- `users.role CHECK IN (USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER)` (стр. 106) — ✅ включает VETERINARIAN/GROOMER. ❗ Но `data-model.md:179` объявляет `CHECK IN (USER, BREEDER, FARMER, MODERATOR, ADMIN)` — **без VETERINARIAN/GROOMER**. Дефект документации (`data-model.md` отстал от схемы). Промпт фиксирует целевой ENUM как `USER/MODERATOR/ADMIN/VETERINARIAN/GROOMER` — схема его покрывает (плюс BREEDER/FARMER).
- `organization_users.role_in_org CHECK IN (OWNER, ADMIN, STAFF, VET, MODERATOR)` (стр. 77) — ✅ совпадает с organization-domain:44,129.
- `feature_toggles.rollout_percentage CHECK BETWEEN 0 AND 100` — ✅.
- ⚠️ Нет UNIQUE на `organization_users(organization_id, user_id)` — пользователь может быть добавлен в одну орг дважды. M:N-целостность не защищена.

**ON DELETE / ON UPDATE (корректность):**

| FK | ON DELETE | Оценка |
|----|-----------|--------|
| `animals.owner_id → users` | RESTRICT | ✅ (нельзя удалить пользователя с животными) |
| `animals.organization_id → organizations` | RESTRICT | ✅ |
| `animals.breed_id → breeds` | SET NULL | ⚠️ конфликтует с `chk_animals_breed_dep` (XOR): при удалении породы `breed_id→NULL`, но `breed_text_localized` остаётся NULL → строка нарушит CHECK. **Логическая ошибка** — SET NULL небезопасен при таком CHECK. Заменить на RESTRICT. |
| `users.city_id → cities` | SET NULL | ✅ |
| `animal_ownership_history.animal_id → animals` | CASCADE | ⚠️ удаление животного стирает историю владения — противоречит цели «traceability, regulatory» (стр. 179). Должно быть RESTRICT или мягкое удаление. |
| `listings.animal_id → animals` | CASCADE | ✅ (листинг без животного бессмыслен) |
| `messages.conversation_id → conversations` | SET NULL | ⚠️ осиротевшие сообщения с `conversation_id=NULL`; для «no chat in MVP» (ADR-0005) допустимо, но семантически странно. Рассмотреть CASCADE. |
| `listings.organization_id/branch_id` | SET NULL | ✅ |
| Нет `ON UPDATE` нигде | — | ✅ приемлемо для UUID/SERIAL PK (не меняются). |

---

### 6. Целостность связей (ERD vs Требования)

**ERD (`ZooLink_ERD.mmd`) vs `database_schema.sql`:**

| Связь в ERD | Реальность в схеме | Вердикт |
|---|---|---|
| `organizations }o..o{ organization_users` и `users }o..o{ organization_users` (стр. 220-221) | `organization_users` — корректная junction-таблица для M:N users↔organizations с `role_in_org` | ✅ Но ERD рисует M:N от обеих сторон к junction (`}o..o{`) — нотационно неверно: должно быть `1..o{` (organization 1—N rows) и `1..o{` (user 1—N rows). Junction сама и есть разрешение M:N. P2. |
| `organizations }o..o{ branches` (стр. 222) | В схеме `branches.organization_id` — это **1:N** (одна орг → много филиалов), не M:N | ❌ ERD неверно: должно быть `organizations ||..o{ branches`. |
| `animals }o..|| branches : "kept at"` (стр. 227) | В схеме у `animals` **нет** колонки `branch_id` | ❌ ERD показывает связь, которой нет в схеме. Либо добавить `animals.branch_id`, либо убрать из ERD. |
| `animals }o..|| organizations` (стр. 226) | `animals.organization_id` есть | ✅ |
| `breeds ||..o{ animals` (стр. 202) | `animals.breed_id` nullable FK | ✅ (1:N, с учётом NULL) |
| `messages.conversation_id` | ERD рисует `conversations ||..o{ messages` (стр. 217) | ✅, но FK = SET NULL допускает «сироты» (см. раздел 5). |
| ERD `breed_text_localized` без NULL-маркера, `nickname_localized NOT NULL` (стр. 65-66) | Схема: `breed_text_localized` nullable, `nickname_localized NOT NULL` | ✅ соответствует схеме (но не `data-model.md`, см. раздел 5). |

**Кардинальности vs требования:**
- `animals` ↔ owner: спека `organization-domain:57,150` гласит **«at least one** of owner_id or organization_id» (т.е. допускает оба сразу), но схема `chk_animal_ownership` (стр. 154-157) требует **ровно один (XOR)**. **Противоречие требования и схемы.** Нужно решение владельца: организация-владелец + контактное лицо (оба) — реально ли? Если да, схема слишком строгая.
- `listings` ↔ animal: 1 листинг → 1 животное (NOT NULL FK), животное → N листингов. ✅ соответствует listing_state_machine.
- Junction `organization_users` без UNIQUE(org, user) — формально допускает дубли строк M:N (см. раздел 3).

**Сущности, отсутствующие в ERD И в схеме, но требуемые спеками:** payment_transactions, refunds, moderation_decisions, notification_logs, notification_templates, ownership_transfers (см. раздел 3). ERD их тоже не отражает — согласованный, но неполный.

---

### 7. Рекомендации по улучшению

#### P0 — Блокеры (без них схема не исполняется или требования нереализуемы)

**P0-1. Удалить битое ограничение `chk_animals_breed`** (исправляет B1):
```sql
-- УДАЛИТЬ строки 366-368 целиком. Ограничение уже покрыто chk_animals_breed_dep (XOR).
-- ALTER TABLE animals ADD CONSTRAINT chk_animals_breed CHECK (breed_id IS NOT NULL OR breed_text IS NOT NULL); -- DELETE
```

**P0-2. Переставить блок Organization Domain после Identity Domain** (исправляет B2): переместить `CREATE TABLE organizations/branches/organization_users` (стр. 40-90) на позицию после `CREATE TABLE users` (после стр. 112). Альтернатива — вынести FK `organization_users.user_id` в отдельный `ALTER TABLE ... ADD FOREIGN KEY` в конце скрипта.

**P0-3. Удалить `COMMENT ON COLUMN organizations.name_ru / name_en`** (стр. 419-420) — колонок нет, DDL упадёт:
```sql
-- УДАЛИТЬ:
-- COMMENT ON COLUMN organizations.name_ru IS 'Русское название организации';
-- COMMENT ON COLUMN organizations.name_en IS 'Английское название организации';
COMMENT ON COLUMN organizations.name_localized IS 'Локализованное название организации (JSONB en/ru)';
```

**P0-4. Сделать PostGIS опциональным + добавить lat/lng fallback** (исправляет B3, согласует с geo-spec):
```sql
ALTER TABLE listings ADD COLUMN lat DOUBLE PRECISION;
ALTER TABLE listings ADD COLUMN lng DOUBLE PRECISION;
ALTER TABLE listings ADD CONSTRAINT chk_listings_latlng
    CHECK ((lat IS NULL AND lng IS NULL) OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180));
CREATE INDEX idx_listings_latlng ON listings (lat, lng) WHERE lat IS NOT NULL;
-- location_point GEOGRAPHY оставить опционально под раскомментированный PostGIS;
-- при выключенном PostGIS колонку location_point создавать не следует (вынести в условный блок).
```
Также раскомментировать `CREATE EXTENSION postgis` (стр. 8) ИЛИ обернуть колонку `location_point` в условие наличия расширения.

**P0-5. Добавить статусные колонки стейт-машин** (исправляет B4):
```sql
ALTER TABLE listings ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PENDING_MODERATION','ACTIVE','EXPIRED','SOLD','DEACTIVATED'));
ALTER TABLE listings ADD COLUMN published_at TIMESTAMPTZ;
ALTER TABLE listings ADD COLUMN sold_at TIMESTAMPTZ;
CREATE INDEX idx_listings_status ON listings(status);

ALTER TABLE users ADD COLUMN status VARCHAR(25) NOT NULL DEFAULT 'UNVERIFIED'
    CHECK (status IN ('UNVERIFIED','PENDING_VERIFICATION','VERIFIED','ACTIVE','SUSPENDED','DEACTIVATED'));
ALTER TABLE users ADD COLUMN suspended_at TIMESTAMPTZ;
```

**P0-6. Создать домен Moderation с immutable audit trail** (исправляет B5):
```sql
ALTER TABLE listings ADD COLUMN moderation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED'));

CREATE TABLE moderation_decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    moderator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('LISTING','ANIMAL')),
    entity_id UUID NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APPROVED','REJECTED','CHANGES_REQUESTED')),
    reason VARCHAR(50) NOT NULL,           -- FK на moderation_reasons (lookup)
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- НЕТ updated_at: append-only. Запретить UPDATE/DELETE триггером (immutability).
);
CREATE INDEX idx_moddec_entity ON moderation_decisions(entity_type, entity_id);
CREATE INDEX idx_moddec_moderator ON moderation_decisions(moderator_id, created_at);
-- Триггер immutability:
CREATE OR REPLACE FUNCTION trg_block_modify() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'moderation_decisions is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_moddec_immutable BEFORE UPDATE OR DELETE ON moderation_decisions
    FOR EACH ROW EXECUTE FUNCTION trg_block_modify();
```
И **исключить `moderation_decisions` из общего триггера `updated_at`** (стр. 314-316), т.к. колонки нет.

**P0-7. Создать домен Payment** (исправляет B6; деньги — minor units BIGINT, не FLOAT):
```sql
CREATE TABLE payment_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    gateway_transaction_id VARCHAR(255),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),  -- копейки; НЕ FLOAT
    currency CHAR(3) NOT NULL DEFAULT 'RUB',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING','COMPLETED','FAILED','REFUNDED','DISPUTED')),
    purpose_type VARCHAR(40) NOT NULL,    -- ListingPromotion / PremiumSubscription / ...
    purpose_id UUID,
    idempotency_key VARCHAR(255) UNIQUE,  -- 14-payment:78
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_transaction_id UUID NOT NULL REFERENCES payment_transactions(id) ON DELETE RESTRICT,
    gateway_refund_id VARCHAR(255),
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    reason TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_paytx_user ON payment_transactions(user_id);
CREATE INDEX idx_paytx_purpose ON payment_transactions(purpose_type, purpose_id);
```

**P0-8. Создать домен Notification** (исправляет B7):
```sql
CREATE TABLE notification_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('EMAIL','SMS')),
    subject_template TEXT,
    body_template TEXT NOT NULL,
    language CHAR(2) NOT NULL REFERENCES supported_languages(code),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    UNIQUE (name, type, language)
);
CREATE TABLE notification_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(10) NOT NULL CHECK (type IN ('EMAIL','SMS')),
    template_id UUID REFERENCES notification_templates(id) ON DELETE SET NULL,
    recipient VARCHAR(255) NOT NULL,
    content TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'SENT'
        CHECK (status IN ('SENT','DELIVERED','FAILED','BOUNCED')),
    provider_response JSONB,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Преференции (13-notification:53): добавить в users либо отдельной таблицей.
ALTER TABLE users ADD COLUMN notification_prefs JSONB NOT NULL DEFAULT '{"email":true,"sms":true,"promo":false}'::jsonb;
```

#### P1 — Высокий приоритет (целостность данных, согласование контрактов)

**P1-1.** Исправить опасный `ON DELETE SET NULL` на `animals.breed_id` (конфликт с XOR-CHECK):
```sql
ALTER TABLE animals DROP CONSTRAINT animals_breed_id_fkey,
    ADD CONSTRAINT animals_breed_id_fkey FOREIGN KEY (breed_id) REFERENCES breeds(id) ON DELETE RESTRICT;
```

**P1-2.** Защитить историю владения от CASCADE-удаления:
```sql
ALTER TABLE animal_ownership_history DROP CONSTRAINT animal_ownership_history_animal_id_fkey,
    ADD CONSTRAINT animal_ownership_history_animal_id_fkey
    FOREIGN KEY (animal_id) REFERENCES animals(id) ON DELETE RESTRICT;
```

**P1-3.** Добавить UNIQUE на junction:
```sql
ALTER TABLE organization_users ADD CONSTRAINT uq_org_user UNIQUE (organization_id, user_id);
```

**P1-4.** `price_cents INTEGER → BIGINT` (диапазон для дорогого livestock):
```sql
ALTER TABLE listings ALTER COLUMN price_cents TYPE BIGINT;
```

**P1-5.** Создать `ownership_transfers` (процессная сущность стейт-машины) — отдельной таблицей со статусом PENDING/IN_PROGRESS/COMPLETED/FAILED, обеими сторонами, confirmed-флагами, failure_reason. (DDL по образцу P0-7; в MVP может быть выключена флагом, но схему завести.)

**P1-6.** Согласовать API-контракт `city_id` (исправляет S2/R5): в `organization-api.yaml:619-620` и `branch-api.yaml:205-207, 252-254, 287-289` заменить `type: string / format: uuid` → `type: integer`. **Правка документации, не схемы.**

**P1-7.** Привести `data-model.md` в соответствие со схемой по `users.role` (добавить VETERINARIAN, GROOMER в перечисление на `data-model.md:179`) и по `city_id UUID → INTEGER` (`data-model.md:174`). Правка документации.

**P1-8.** Устранить расхождение nullability `nickname_localized` / `breed_text_localized` между схемой и `data-model.md:97-98` — зафиксировать схему как источник истины, обновить `data-model.md`.

**P1-9.** Добавить breeding-атрибуты Matching-домена в `animals` (05-matching:108):
```sql
ALTER TABLE animals ADD COLUMN pedigree_id VARCHAR(100);
ALTER TABLE animals ADD COLUMN health_test_results JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE animals ADD COLUMN show_titles JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE animals ADD COLUMN is_visible_in_breeding_search BOOLEAN NOT NULL DEFAULT TRUE; -- UC-MT-02
CREATE INDEX idx_animals_breeding_visible ON animals(is_visible_in_breeding_search) WHERE is_visible_in_breeding_search;
```

#### P2 — Низкий приоритет (нотация, стиль, гигиена)

**P2-1.** Исправить ERD `ZooLink_ERD.mmd`:
- стр. 222: `organizations }o..o{ branches` → `organizations ||..o{ branches` (1:N).
- стр. 220-221: junction рисовать как `organizations ||..o{ organization_users` и `users ||..o{ organization_users`.
- стр. 227: удалить `animals }o..|| branches : "kept at"` (нет колонки) ИЛИ добавить `animals.branch_id` в схему.
- Добавить в ERD недостающие таблицы при их создании (payment_transactions, refunds, moderation_decisions, notification_logs, notification_templates, ownership_transfers).

**P2-2.** Решить с владельцем семантику «exactly one vs at least one» владельца животного (раздел 6): если допустимы оба (организация + контактное лицо), ослабить `chk_animal_ownership` до «at least one». Иначе — поправить `organization-domain.md:57,150` формулировку на «exactly one».

**P2-3.** Единый язык комментариев в EN-каноне (или перенести RU-комментарии в `docsRU`). Стилистика.

**P2-4.** Добавить композитный `idx_messages_conversation (conversation_id, sent_at)` для пагинации.

---

## Открытые вопросы владельцу — РЕШЕНЫ (2026-06-17)

1. **Владелец животного — XOR или AND?** → **XOR (ровно один).** Схема оставлена как есть (`chk_animal_ownership`); формулировка `organization-domain.md` (EN+RU) исправлена с «at least one» на «exactly one». Контактное лицо орг-животного — отдельная роль (`organization_users`).
2. **MVP-скоуп статус-доменов.** → **Все таблицы остаются в схеме, активация гейтится тогглами.** Moderation — ON (ADR-0003 пре-модерация); Notification — ON (транзакционные); Payment — таблицы определены, но выключены (`feature_toggles.payments = false`, пост-MVP).
3. **PostGIS vs lat/lng.** → **lat/lng — основной MVP-вариант** (Haversine + bounding box); PostGIS `location_point` опционален (создаётся только при наличии расширения). Реализовано.
4. **`nickname_localized` без DEFAULT?** → **Да, обязателен без дефолта** (имя должно задаваться при создании). Схема канон; `data-model.md` приведён в соответствие.
5. **Один активный листинг на животное?** → **UNIQUE `(animal_id, listing_type) WHERE status='ACTIVE'`** — один активный листинг каждого типа на животное (разрешает sale + stud_service одновременно). Добавлено в схему и миграцию, проверено на живом PG.

---

_Все наблюдения привязаны к конкретным строкам `database_schema.sql` / `ZooLink_ERD.mmd` и файлам спек. Источник истины по БД — `database_schema.sql`; расхождения ERD и API-контрактов с ним и с конвенцией ID трактованы как дефекты документации._
