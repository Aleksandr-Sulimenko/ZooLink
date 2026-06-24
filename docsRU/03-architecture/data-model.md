# Логическая модель данных (ERD)

Этот документ описывает логическую модель данных системы ZooLink, соответствующую концептуальным моделям доменов и реализованную в PostgreSQL схеме.

## Обзор

Логическая модель данных представляет собой структурированное представление данных системы, включая:
- Сущности и их атрибуты
- Связи между сущностями
- Ограничения и бизнес-правила на уровне данных
- Индексы для производительности
- Расширяемость через JSONB и другие механизмы

Физическая реализация схемы данных находится в файле [`database_schema.sql`](../../database_schema.sql).

## Основные принципы моделирования

### 1. Соответствие доменной модели (DDD)
- Таблицы и отношения отражают агрегаты, сущности и объекты-значения из доменных моделей
- Каждый ограниченный контекст имеет четко выраженную структуру данных
- Агрегатные корни имеют глобальные идентификаторы (UUID)
- Внешние ключи устанавливают связи внутри и между агрегатами

### 2. Расширяемость
- Использование колонок JSONB для атрибутов, которые могут меняться или иметь переменную структуру
- Метаданные и расширяемые поля в ключевых таблицах
- Поддержка мультиязычности через локализованные JSONB поля

### 3. Целостность данных
- Ограничения CHECK для бизнес-правил на уровне БД
- Внешние ключи для ссылочной целостности
- Уникальные ограничения там, где необходимо
- Триггеры для автоматического поддержания производных данных

### 4. Производительность
- Стратегически подобранные индексы для частых шаблонов запросов
- Разделение нагрузки через соответствующие типы индексов (B-tree, GIN, GiST, GIST)
- Предварительно вычисленные или кэшируемые значения там, где уместно

### 5. Audit и traceability
- Временные метки создания и обновления на всех таблицах
- Специальные таблицы для истории изменений там, где требуется полная прослеживаемость
- Мягкое удаление вместо физического удаления для ключевых сущностей
- Таблица исходящих событий (Outbox) для надежной интеграции

## Основные сущности и их отношения

Данная модель поддерживает все ограниченные контексты системы ZooLink:

### Контекст идентичности
- `users` - основная сущность пользователя
- Связи с аутентификационными провайдерами через отдельные колонки
- Роли и права доступа

### Контекст организации
- `organizations` - организации и компании
- `branches` - филиалы организаций
- `organization_users` - связь пользователей с организациями и их роли

### Контекст животных (ядро системы)
- `animals` - агрегатный корень, центральная сущность системы
- `species` и `breeds` - справочные данные из контекста администрирования
- `animal_ownership_history` - история смены владельцев
- Связи с родителями для отслеживания pedigree (планируемое расширение)

### Контекст объявлений (маркетплейсы)
- `listings` - объявления, связанные с животными через внешний ключ
- `listing_photos` - фотографии объявлений
- `location_point` - геопространственная позиция для поиска по радиусу
- Различные типы объявлений: продажа, разведение, выставка, усыновление, услуги случки

### Контекст взаимодействий
- `conversations` и `messages` - система коммуникации между пользователями (после модерации)
- Связи с объявлениями для контекстуализации коммуникации

### Контекст администрирования
- `cities` - справочник городов для геопоиска
- `feature_toggles` - управление функциональностью через переключатели
- `outbox_events` - таблица исходящих событий для надежной интеграции
- `supported_languages` - управление поддерживаемыми языками

### Вспомогательные таблицы
- Таблицы для хранения локализованных данных (все *_localized JSONB колонки)
- Таблицы для временных данных и кеша (через приложение)
- Таблицы для медиа-файлов (через объектное хранилище, ссылки в БД)

## Детальное описание ключевых таблиц

### Таблица animals (Агрегатный корень животного)
```sql
CREATE TABLE animals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID REFERENCES users(id) ON DELETE RESTRICT,
    organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
    species_id INT NOT NULL REFERENCES species(id) ON DELETE RESTRICT,
    breed_id INT REFERENCES breeds(id) ON DELETE RESTRICT,
    breed_text_localized JSONB, -- nullable: XOR with breed_id (exactly one is set)
    nickname_localized JSONB NOT NULL, -- display name; required on insert (no default)
    sex VARCHAR(10) NOT NULL CHECK (sex IN ('Male', 'Female')),
    date_of_birth DATE NOT NULL,
    color_coat VARCHAR(100),
    microchip_id VARCHAR(50),
    tattoo_brand_id VARCHAR(50),
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    health_records JSONB NOT NULL DEFAULT '[]'::jsonb,
    reproductive_data JSONB NOT NULL DEFAULT '[]'::jsonb,
    owned_since DATE,
    mother_id UUID REFERENCES animals(id) ON DELETE SET NULL,
    father_id UUID REFERENCES animals(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    deactivated_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT chk_animal_ownership CHECK (
        (owner_id IS NOT NULL AND organization_id IS NULL) OR
        (owner_id IS NULL AND organization_id IS NOT NULL)
    )
);
```

**Ключевые моменты:**
- Именно один владелец (либо пользователь, либо организация) через ограничение CHECK
- Неизменяемые поля после создания: species_id, sex, date_of_birth, breed_id (через триггер приложения)
- JSONB колонки для расширяемых и локализованных данных
- Связи с родителями для будущего отслеживания родословной
- Мягкое удаление через поле deactivated_at

### Таблица listings (Сущность внутри агрегата животного)
```sql
CREATE TABLE listings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    branch_id UUID REFERENCES branches(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    listing_type VARCHAR(20) NOT NULL CHECK (listing_type IN ('sale', 'breeding', 'show', 'adoption', 'stud_service', 'leasing')), -- 'leasing' = ФОРМА сейчас (значение enum, миграция 0021); правила/поведение лизинга — Фаза 2
    title_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    description_localized JSONB NOT NULL DEFAULT '{"en": "", "ru": ""}'::jsonb,
    price_cents BIGINT, -- деньги в минорных единицах (копейках) как BIGINT, никогда FLOAT/INTEGER: INTEGER переполняется на сделках масштаба livestock
    currency CHAR(3) DEFAULT 'RUB',
    quantity INTEGER DEFAULT 1,
    location_point GEOGRAPHY(POINT, 4326),
    search_radius_m INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_listing_ownership CHECK (
        (organization_id IS NULL AND branch_id IS NULL) OR  -- Personal listing
        (organization_id IS NOT NULL)                       -- Organizational listing
    )
);
```

**Ключевые моменты:**
- Обязательная связь с животным (каждое объявление относится к конкретному животному)
- Продавец всегда пользователь (даже для организационных объявлений)
- Опциональная привязка к организации/филиалу
- Геопространственная позиция для поиска по радиусу
- Различные типы объявлений через ограничение CHECK. Набор — `sale, breeding, show, adoption,
  stud_service, leasing` (миграция 0021). `leasing` — **форма сейчас / поведение Фаза 2** (B3):
  значение enum существует, чтобы тип был выбираем и не требовал последующего переписывания схемы,
  но правила/флоу лизинга (условия, возврат, модель ценообразования) отложены на Фазу 2 — см.
  `business-requirements/livestock-marketplace.md`. Триггеры объявлений не хардкодят набор типов.
- Ограничение собственности: либо личное объявление, либо организационное

### Таблица users (Контекст идентичности)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_hash VARCHAR(60), -- детерминированный HMAC-SHA256(phone, server_pepper), уникальный; НЕ bcrypt (spec 01 round-4)
    oauth_google_id VARCHAR(255),
    oauth_apple_id VARCHAR(255),
    oauth_telegram_id VARCHAR(255),
    oauth_vk_id VARCHAR(255),
    full_name VARCHAR(100) NOT NULL,
    city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
    avatar_url TEXT,
    email VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(60), -- bcrypt; ТОЛЬКО операторы (конечные пользователи passwordless: phone OTP + OAuth)
    role VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'BREEDER', 'FARMER', 'MODERATOR', 'ADMIN', 'VETERINARIAN', 'GROOMER')) DEFAULT 'USER',
    principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (principal_type IN ('HUMAN', 'AGENT')), -- ADR-0006: операторские роли может занимать ИИ-агент
    status VARCHAR(25) NOT NULL DEFAULT 'UNVERIFIED'
        CHECK (status IN ('UNVERIFIED','PENDING_VERIFICATION','VERIFIED','ACTIVE','SUSPENDED','DEACTIVATED')), -- источник истины жизненного цикла (user_state_machine.md)
    suspended_at TIMESTAMP WITH TIME ZONE,
    verification_attempts INTEGER NOT NULL DEFAULT 0, -- попытки OTP; MAX 5, затем lockout
    notification_prefs JSONB NOT NULL DEFAULT '{"email": true, "sms": true, "promo": false}'::jsonb,
    preferred_language CHAR(2) NOT NULL DEFAULT 'ru' REFERENCES supported_languages(code),
    is_active BOOLEAN NOT NULL DEFAULT TRUE, -- ПРОИЗВОДНОЕ от status (синхронизируется; не авторитетно)
    last_login_at TIMESTAMP WITH TIME ZONE,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    erased_at TIMESTAMP WITH TIME ZONE, -- ставится erase_user() (ФЗ-152 анонимизация на месте); NULL = не стёрт
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Ключевые моменты:**
- Множественные способы аутентификации (телефон/SMS OTP + OAuth провайдеры); конечные пользователи passwordless
- `status` — источник истины жизненного цикла; `is_active`/`deactivated_at` — производные от него
- Роль пользователя определяет доступ к функциям системы
- Связь с городом для геопоиска по местоположению
- Мягкое удаление через поле deactivated_at (status=DEACTIVATED)
- Право на забвение (ФЗ-152): `erase_user()` анонимизирует PII на месте, освобождает идентификаторы
  (phone_hash/oauth_*/email), отзывает сессии и ставит `erased_at`; UUID сохраняется, чтобы строки
  FK RESTRICT остались валидными (data-governance.md §2)

### Таблица refresh_tokens (трекинг сессий/устройств)

`refresh_tokens` — хранилище ротируемых refresh-токенов, обеспечивающее модель сессии
15-мин access / 7-дн refresh (`nfr/security.md` §Session Management, spec 01). Помимо уже имевшихся
колонок ротации/семейства (`device_label`, `family_id`), миграция 0020 (B2) добавила колонки
**контекста сессии**, чтобы пользователь видел и отзывал отдельные сессии, а security-ревью имело
провенанс:

| Колонка | Тип | Примечания |
|---|---|---|
| `ip_address` | `INET` | IP клиента на момент выпуска (безопасность/аудит; редактируется в логах по `nfr/observability.md`) |
| `user_agent` | `TEXT` | Строка UA клиента на момент выпуска (UX списка устройств) |
| `last_used_at` | `TIMESTAMPTZ` | Обновляется при каждой ротации; питает "активные сессии" / детекцию простоя |
| `revoked_reason` | `VARCHAR` | Почему токен инвалидирован (logout / ротация / смена роли / erase / админ) |

**Колонка-плейсхолдер MFA не добавляется**: MFA отложена на Фазу 2 (GAP-013), а спекулятивная пустая
колонка была бы мёртвой схемой (IMPLEMENTATION_PLAYBOOK §5 — добавляем форму только когда она и есть
необратимый артефакт). См. исправление по MFA в `nfr/security.md`.

## Связи и ограничения

### Основные связи
1. `animals.species_id → species.id` (тип животного)
2. `animals.breed_id → breeds.id` (порода животного)  
3. `animals.owner_id → users.id` (личный владелец)
4. `animals.organization_id → organizations.id` (организационный владелец)
5. `listings.animal_id → animals.id` (объявление относится к животному)
6. `listings.seller_id → users.id` (кто разместил объявление)
7. `listings.organization_id → organizations.id` (организация, разместившая объявление)
8. `listings.branch_id → branches.id` (филиал организации)
9. `users.city_id → cities.id` (город пользователя для геопоиска)
10. `organization_users.organization_id → organizations.id`
11. `organization_users.user_id → users.id`

### Ограничения целостности
- **CHK_CONSTRAINT_ON_ANIMAL_OWNERSHIP:** Животное должно иметь либо личного владельца, либо принадлежать организации (не оба и не ни одного)
- **CHK_CONSTRAINT_ON_LISTING_OWNERSHIP:** Объявление либо личное (без организации/филиала), либо организационное (с организацией)
- **ROLE_CONSTRAINTS:** Ограничения ролей пользователей и их ролей в организациях
- **IMMUTABLE_FIELDS_TRIGGER:** Триггер предотвращающий изменение неизменяемых полей животного после создания
- **OWNERSHIP_CHANGE_LOCK_MVP:** Триггер блокирующий изменение собственности на фазе MVP

## Индексы для производительности

### Таблица animals
- `idx_animals_owner` - поиск по владельцу (личный или организационный)
- `idx_animals_species_breed` - поиск по виду и породе (частый фильтр)
- `idx_animals_microchip` / `idx_animals_tattoo` - поиск по идентификаторам
- GIN индексы на JSONB колонках (`health_records`, `reproductive_data`) - поиск по содержимому
- `idx_animals_active` - частичный индекс только для активных животных
- `idx_animals_owned_since` - поиск по дате приобретения

### Таблица listings
- `idx_listings_animal` - поиск объявлений конкретного животного
- `idx_listings_seller` - поиск объявлений конкретного продавца
- `idx_listings_type_active` - комбинированный индекс для поиска активных объявлений по типу
- `idx_listings_price` - поиск по цене (только для объявлений с ценой)
- GIST индекс на `location_point` (если PostGIS доступен) - эффективный геопоиск
- `idx_listings_expires` - поиск ещё не истекших объявлений
- `idx_listing_photos_listing` - связь фотографий с объявлениями

### Другие важные индексы
- Индексы на таблицах пользователей для быстрого поиска по разным способам аутентификации
- Индексы на справочных таблицах (species, breeds, cities)
- Индексы на таблицах истории владения и организационных связях

## Модель справочных данных (species / breeds / cities)

Три управляемые админом lookup-таблицы разделяют одну расширяемую форму (миграция 0018):

- **Локализованное имя** — отображаемое имя представлено единой колонкой `name_localized JSONB {ru,en}`
  (НЕ плоскими `name_ru`/`name_en`). Это соответствует канону `*_localized` JSONB, применяемому в
  `organizations`/`branches`/`animals`, SQL-хелперам `get_localized()`/`has_translation()`,
  `localization_specification.md` и `API_CONVENTIONS.md §6`. Новый язык добавляется записью ещё одного
  JSON-ключа — **без изменения схемы**. Чтения для админа/редактора возвращают полный `LocalizedString`
  (`nameLocalized`); публичные чтения возвращают разрешённую строку `name` для `Accept-Language` (фолбэк на
  en). Локализованный поиск обеспечивают per-locale индексы `GIN ((name_localized -> 'xx'))`.
- **Provenance и порядок** — `created_by`/`updated_by` (nullable `FK → users(id) ON DELETE SET NULL`,
  готовность к agent-as-principal по ADR-0006: строку-изменение может владеть AGENT) и `sort_order INTEGER`
  (порядок отображения; списки `ORDER BY sort_order, id`). Мягкое удаление через `is_active` (без удаления
  строк → безопасность FK).
- **Расширяемость реестра (паттерн кода)** — backend-модуль reference-data управляется датасетами:
  управляемый набор — это один кортеж `DATASETS` и таблица `CAPS` (per-dataset флаги `{code, speciesId, market}`)
  в `modules/admin/dto/reference-data.dto.ts` + `reference-data.service.ts`. `ParseDatasetPipe` валидирует
  сегмент пути `{dataset}` против `DATASETS`. Добавить новую lookup-таблицу = добавить её в `DATASETS` + запись
  `CAPS` + Prisma-делегат — **без изменения формы CRUD/audit/локализации**. (Является ли кандидат управляемым
  датасетом или фиксированным CHECK-enum — решается по `specs/06-admin-domain.md`.)

**Словари разведения (A3, миграция 0019).** `health_certifications` и `genetic_markers` — ещё две
управляемые админом lookup-таблицы в **той же форме** (`id` INT PK, `code`, `name_localized` JSONB {ru,en},
`market`, `sort_order`, `is_active`, `created_by`/`updated_by`, per-locale GIN, триггер
`update_<tbl>_updated_at`), добавленные потому, что фильтры поиска по livestock в
`business-requirements/livestock-marketplace.md` (`health_certifications`, `genetic_flags`) ссылались на
контролируемые словари, у которых не было таблицы (GAP-TRACE-002). Они были поглощены реестром **без
изменения формы** — это доказательство расширяемости A2 — поэтому управляемый набор `dataset` вырос `3 → 5`
(`species, breeds, cities, health_certifications, genetic_markers`). Уникальность — `(market, code)`
(симметрично breeds' `(species_id, code)`): код может повторяться между рынками, но уникален внутри одного.
**Форма сейчас, поведение потом:** **фильтрация** маркетплейса, потребляющая эти словари, остаётся отложенной
(Фаза 2, сторона генетики гейтится `feature_toggles.genetics_portal`); в MVP существуют только форма таблиц +
admin CRUD. Pet-side soft-tags `temperament_tags`/`health_flags` сознательно сделаны **свободным текстом/JSONB,
не таблицами** (lookup можно добавить аддитивно в Фазе 2 без переписывания); `animal-statuses` — это
**state CHECK enum, не датасет**; `decision-templates` (модерация) **отложены к контракту модерации** (связаны с
формой модерации, а не с обобщённым reference-data).

Аудит CRUD справочных данных: id у lookup'ов — `INT`, а `audit_log.entity_id` — `UUID`. Миграция 0018 добавляет
`audit_log.entity_id_int INTEGER` (частичный индекс `idx_audit_log_entity_int`), чтобы INT-ключевая сущность
аудировалась по своему реальному id; UUID-сущности продолжают использовать `entity_id`. Ровно одна из двух
колонок заполняется на строку.

## Операционные домены (Moderation / Payment / Notification / Ownership Transfer)

Полный DDL перечисленных таблиц находится в `database_schema.sql` (источник истины); контракты доменов
заданы в связанных спеках. Они добавлены по итогам аудита схемы (`DATABASE_SCHEMA_AUDIT.md`), чтобы
сделать документированные требования реализуемыми.

| Таблица | Спека домена | Примечания |
|---|---|---|
| `moderation_reasons` | `specs/12-moderation-domain.md` | Настраиваемые админом коды причин (справочник) |
| `moderation_decisions` | `specs/12-moderation-domain.md` · `../04-decisions/0011-agent-principal-actor-model.md` | Append-only журнал аудита (UPDATE/DELETE блокируется триггером). ADR-0011 actor-snapshot (`actor_principal_type` HUMAN/AGENT, `actor_role`) + цепочка human-override (`supersedes_decision_id` self-ref FK ON DELETE RESTRICT, `is_human_override`, биусловный `chk_moddec_override`) |
| `decision_templates` | `specs/12-moderation-domain.md` | B10 Расширяемый админом словарь заготовленных формулировок REJECT/CHANGES_REQUESTED (ТАБЛИЦА, не enum). INT id; `body_localized` JSONB {ru,en}; `applies_to_decision` ∈ {REJECTED, CHANGES_REQUESTED}; `market` (ADR-0002); опц. `related_reason_code` FK → `moderation_reasons.code` (ON DELETE SET NULL); `sort_order`/`is_active`/provenance; UNIQUE (market, code); per-locale GIN; updated_at-триггер. Форма reference-data A2/A3. ФОРМА сейчас; выбор шаблона при решении приходит с доменом Moderation. |
| `payment_transactions` | `specs/14-payment-domain.md` | `amount_minor BIGINT` (минорные единицы, никогда FLOAT); `idempotency_key` UNIQUE |
| `refunds` | `specs/14-payment-domain.md` | Связаны с `payment_transactions` |
| `notification_templates` | `specs/13-notification-domain.md` | По языкам; FK на `supported_languages` |
| `notification_logs` | `specs/13-notification-domain.md` | Журнал доставки (SENT/DELIVERED/FAILED/BOUNCED) |
| `ownership_transfers` | `specs/statemachines/ownership_transfer_state_machine.md` | Процессная сущность стейт-машины передачи (в отличие от `animal_ownership_history` — журнала свершившихся фактов). Смена владения заблокирована в MVP. |
| `digital_assets` | `../04-decisions/0010-nft-digital-assets-hooks.md` | Хук готовности к NFT/токенизации (ADR-0010). Пустая в MVP; гейтится `feature_toggles('digital_assets')`. On-chain mint/indexer — Фаза 2+. |

Колонки жизненного цикла/состояния, добавленные в существующие таблицы: `listings.status` +
`listings.moderation_status` (см. `specs/statemachines/listing_state_machine.md`), `users.status`
(см. `specs/statemachines/user_state_machine.md`). Гео: `listings.lat`/`listings.lng` — основное
хранилище для MVP (Haversine + bounding box), с опциональным PostGIS `location_point`.

## Механизмы расширяемости

### JSONB колонки
Используются для:
- Локализованных строк (все *_localized колонки)
- Расширяемых атрибутов со сложной структурой (medical records, reproductive data)
- Метаданных и экспериментальных полей
- Хранения данных с переменной схемой без необходимости миграций

### Метаданные таблицы
- `metadata` колонка в ключевых таблицах (organizations, listings, feature_toggles)
- Для хранения экспериментальных или временных атрибутов
- Позволяет добавлять новые функции без изменения схемы БД

### Таблица feature_toggles
- Управление функциональностью через переключатели
- Прогрессивный розлив функций (rollout_percentage)
- Легкое включение/выключение функций без деплоя

## Паттерны обработки специальных данных

### Геопространственные данные
> Примечание: SQL-сниппеты в этом документе иллюстративны; источник истины — `database_schema.sql`, где уже есть
> `lat`/`lng`, `status`/`moderation_status` и прочие колонки из аудита.
- **MVP, основное:** колонки `lat`/`lng` DOUBLE + Haversine + предфильтр bounding box (в схеме; ADR-0009).
- **Фаза 2+, опционально:** колонка `location_point` типа GEOGRAPHY(POINT, 4326) (требует PostGIS; уже зарезервирована в схеме).
- Радиус поиска: колонка `search_radius_m` в метрах
- Индексы: B-tree по lat/lng (MVP); GiST по `location_point` при включении PostGIS
- Единицы: Метры для расстояний, SRID 4326 (WGS84) для координат

### Мультиязычность
- Все текстовые поля, требующие локализации, представлены как JSONB колонки
- Структура: {"en": "English text", "ru": "Russian text"}
- Функции БД: `get_localized()` и `has_translation()` для работы с локализованными данными
- Индексы: GIN индексы на конкретных языковых компонентах для поиска по локализованному тексту

### История изменений и аудит
- Мягкое удаление: поля `deactivated_at` в ключевых таблицах
- История владения животными: отдельная таблица `animal_ownership_history`
- Исходящие события: таблица `outbox_events` для надёжной интеграции, со статусом доставки relay (`attempts`, `last_error`, `next_attempt_at`, `dead_lettered_at`) — доставка at-least-once с экспоненциальным backoff и dead-lettering (миграция 0012)
- Временные метки: `created_at` везде; `updated_at` поддерживается триггером, который вешается ровно на те таблицы, где есть эта колонка (выводится из схемы, миграция 0013). У append/log-таблиц (`outbox_events`, `audit_log`, `animal_ownership_history`, `messages`) колонки `updated_at` и такого триггера нет
- Аудит: append-only таблица `audit_log` (неизменяемость на уровне БД) для привилегированных операций

### Модель Actor-Principal на append-only журналах (ADR-0011)

Оба append-only журнала актёров — `audit_log` и `moderation_decisions` — записывают действующего принципала
**как снимок на момент записи**, никогда не как join во время чтения к `users` (где хранится *текущий*,
изменяемый `principal_type`/`role`). Неизменяемая строка обязана отражать кто/что действовал *в момент
действия*.

- **`actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN'`** (CHECK `HUMAN|AGENT`) на обеих таблицах.
  `DEFAULT 'HUMAN'` — истина MVP (ни один агент не активен); колонка присутствует уже сейчас, потому что
  отсутствующий атрибут на append-only строке уже нельзя достоверно восстановить после того, как любой AGENT
  начнёт действовать. `principal_type` **ортогонален `role`** — никакой кросс-колоночный CHECK их не связывает
  (ADR-0011 §7).
- **`moderation_decisions.actor_role VARCHAR(20)`** — свободный снимок роли, которую актёр держал при принятии
  решения (nullable; намеренно **без** enum CHECK, так как enum ролей может эволюционировать). Зеркалит
  `audit_log.actor_role`, который уже существовал.
- **Цепочка human-override** — человек, отменяющий решение агента, вставляет **новую append-only строку**
  (никогда не мутацию): `is_human_override = TRUE`, `supersedes_decision_id` → отменяемое решение
  (само-ссылающийся FK, `ON DELETE RESTRICT`). Обе строки остаются навсегда; цепочка агент→человек полностью
  реконструируема. Биусловный `chk_moddec_override` обеспечивает `is_human_override = TRUE ⇔
  supersedes_decision_id IS NOT NULL`. Правило сервис-слоя (не DB CHECK, так как охватывает несколько строк)
  требует, чтобы у override-строки `actor_principal_type = 'HUMAN'`, а её `supersedes_decision_id` ссылался на
  решение по **тому же** `(entity_type, entity_id)`. Сторона чтения вычисляет «последнее действующее решение»,
  следуя по `supersedes_decision_id` (индекс `idx_moddec_supersedes`).
- **Хранилище сервис-учёток агента** — `service_credentials` (ADR-0011 §5.3/§C, A0b, миграция 0017),
  **форвард-совместимая ФОРМА**: внутримонолитное хранилище хешированного секрета, привязанное к агенту
  (`agent_user_id` FK `users.id`, `ON DELETE RESTRICT`), **ротируемое** (`rotated_from` self-FK = новые выпуски
  связываются со старыми) и **отзываемое** (`is_active` / `revoked_at`), c **только `secret_hash`** в покое
  (никогда не plaintext) и без отдельного auth-сервиса. В MVP это **ТОЛЬКО ФОРМА**: гейт AGENT выключен, поэтому
  строка не создаётся и секрет не проверяется; заглушка `AgentServiceTokenAuthenticator` не в цепочке
  аутентификаторов и всегда возвращает `null`. Активация сервис-auth агента позже (ADR-0006 P-A…P-D) не требует
  переписывания схемы.
- **Цепочка аутентификаторов** (ADR-0011 §5) — аутентификация вынесена из `JwtAuthGuard` в упорядоченную
  цепочку `RequestAuthenticator`, порождающую источник-агностичный `AuthPrincipal {userId, role, principalType}`.
  `BearerJwtAuthenticator` — единственное звено сегодня (люди-конечные-пользователи + операторы);
  `AgentServiceTokenAuthenticator` — аддитивное будущее звено (gated). RBAC/CASL/actor-snapshotting потребляют
  абстракцию принципала, поэтому добавление агентов — это один лишний аутентификатор, а не переписывание
  guard/authz. Env `AGENT_SERVICE_SIGNING_SECRET` (≥32; опционален в dev/test, обязателен в production) — это
  форма подписывающего секрета, не используется пока gated.
- **Жизненный цикл агента** = деактивация, никогда не удаление (`users.status='DEACTIVATED'`), поэтому
  FK `ON DELETE RESTRICT` из журналов никогда не осиротеют.

Канон `organization_users.role_in_org` — это набор из **4 значений** `{OWNER, ADMIN, STAFF, VET}`
(`chk_org_user_role`). `MODERATOR` — это роль платформенного оператора, **а не** роль членства в организации
(ADR-0011 §7); ранее противоречивые inline CHECK и комментарий колонки были исправлены под действующее
именованное ограничение.

## Связанные решения

- [ADR-0001: Выбор технологического стека](../04-decisions/0001-tech-stack.md)
- [ADR-0002: Жёсткое разделение рынков](../04-decisions/0002-hard-split-markets.md)
- [ADR-0003: Премодерация рабочего процесса](../04-decisions/0003-pre-moderation-workflow.md)
- [ADR-0004: Животное как агрегатный корень](../04-decisions/0004-animal-as-aggregate.md)
- [ADR-0005: Нет встроенного чата в MVP](../04-decisions/0005-no-chat-mvp.md)
- [ADR-0011: Модель Agent-Principal Actor (снимок актёра, human-override, канон ролей)](../04-decisions/0011-agent-principal-actor-model.md)

## Диаграмма ERD

**Каноническая, машинно-рендерящаяся ERD** поддерживается единым mermaid-источником истины:
[`ZooLink_ERD.mmd`](../../ZooLink_ERD.mmd) (в корне репозитория).

Она покрывает все актуальные сущности — включая операционные домены (Moderation, Payment,
Notification, Ownership Transfer) и MVP-добавления (Favorites, Saved Searches, Content Reports) —
с атрибутами, типами, внешними ключами и кардинальностями связей, синхронно с `database_schema.sql`.

> Прежняя ASCII-диаграмма удалена: она покрывала только MVP-ядро и разошлась с реальностью.
> Отрендерьте `ZooLink_ERD.mmd` (напр. через `mmdc` или любой mermaid-просмотрщик) для полной актуальной ERD.

## Инструкции по поддержке

### При изменении схемы
1. Всегда обновляйте `database_schema.sql` как источник истины
2. Обновляйте этот документ, чтобы отражать изменения в логической модели
3. Учитывайте обратную совместимость при добавлении/изменении полей
4. Добавляйте миграционные скрипты для существующих данных
5. Обновляйте связанные документы (доменные спецификации, API контракты)

### При добавлении новых функций
1. Рассмотрите возможность использования JSONB колонок перед изменением схемы
2. Используйте таблицу `feature_toggles` для постепенного включения функций
3. Добавляйте необходимые индексы для новых шаблонов запросов
4. Убедитесь, что ограничения и бизнес-правила правильно представлены на уровне БД
5. Добавьте комментарии и документацию для новых таблиц и колонок

### Производительность и мониторинг
1. Периодически пересматривайте и обновляйте индексы на основе реальных шаблонов запросов
2. Мониторьте медленные запросы и корректируйте индексы соответственно
3. Рассмотрите партиционирование больших таблиц (listings, messages) по времени
4. Настройте оповещения на использование ресурсов БД и время выполнения запросов