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
    listing_type VARCHAR(20) NOT NULL CHECK (listing_type IN ('sale', 'breeding', 'show', 'adoption', 'stud_service')),
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
- Различные типы объявлений через ограничение CHECK
- Ограничение собственности: либо личное объявление, либо организационное

### Таблица users (Контекст идентичности)
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    phone_hash VARCHAR(60),
    oauth_google_id VARCHAR(255),
    oauth_apple_id VARCHAR(255),
    oauth_telegram_id VARCHAR(255),
    oauth_vk_id VARCHAR(255),
    full_name VARCHAR(100) NOT NULL,
    city_id INTEGER REFERENCES cities(id) ON DELETE SET NULL,
    avatar_url TEXT,
    email VARCHAR(255),
    email_verified BOOLEAN DEFAULT FALSE,
    password_hash VARCHAR(60),
    role VARCHAR(20) NOT NULL CHECK (role IN ('USER', 'BREEDER', 'FARMER', 'MODERATOR', 'ADMIN', 'VETERINARIAN', 'GROOMER')) DEFAULT 'USER',
    principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (principal_type IN ('HUMAN', 'AGENT')), -- ADR-0006: операторские роли может занимать ИИ-агент
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at TIMESTAMP WITH TIME ZONE,
    deactivated_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
```

**Ключевые моменты:**
- Множественные способы аутентификации (телефон/SMS + OAuth провайдеры)
- Роль пользователя определяет доступ к функциям системы
- Связь с городом для геопоиска по местоположению
- Мягкое удаление через поле deactivated_at

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

## Операционные домены (Moderation / Payment / Notification / Ownership Transfer)

Полный DDL перечисленных таблиц находится в `database_schema.sql` (источник истины); контракты доменов
заданы в связанных спеках. Они добавлены по итогам аудита схемы (`DATABASE_SCHEMA_AUDIT.md`), чтобы
сделать документированные требования реализуемыми.

| Таблица | Спека домена | Примечания |
|---|---|---|
| `moderation_reasons` | `specs/12-moderation-domain.md` | Настраиваемые админом коды причин (справочник) |
| `moderation_decisions` | `specs/12-moderation-domain.md` | Append-only журнал аудита (UPDATE/DELETE блокируется триггером) |
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

## Связанные решения

- [ADR-0001: Выбор технологического стека](../04-decisions/0001-tech-stack.md)
- [ADR-0002: Жёсткое разделение рынков](../04-decisions/0002-hard-split-markets.md)
- [ADR-0003: Премодерация рабочего процесса](../04-decisions/0003-pre-moderation-workflow.md)
- [ADR-0004: Животное как агрегатный корень](../04-decisions/0004-animal-as-aggregate.md)
- [ADR-0005: Нет встроенного чата в MVP](../04-decisions/0005-no-chat-mvp.md)

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