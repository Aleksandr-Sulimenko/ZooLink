---
version: "2.0"
lastUpdated: "2026-06-17"
author: "Системный аналитик"
status: "Approved"
---

# Глоссарий терминов ZooLink

> Соглашения: идентификаторы кода/контрактов (имена таблиц/колонок, значения ENUM, ролевые константы) сохраняются дословно в EN и RU; переводится только проза. Источник истины по данным — `database_schema.sql`; по решениям — ADR в `04-decisions/`.

## Домены и архитектура

**ZooLink**  
Маркетплейс/платформа по животным. Два жёстко разделённых рынка (ADR-0002): **Pet Marketplace** (питомцы) и **Livestock Marketplace** (сельхоз/племенные).

**Bounded Context**  
Граница домена с собственной моделью и единым языком (DDD). Контексты ZooLink: Identity, Animal, Organization, Pet/Livestock Marketplace, Matching, Moderation, Payment, Notification, Geo-Search, Admin.

**Aggregate Root (агрегатный корень)**  
Входная сущность, охраняющая согласованность агрегата. **Animal** — агрегатный корень домена животных (ADR-0004); объявления — сущности, ссылающиеся на него.

**Identity Domain**  
Контекст пользователей, аутентификации (телефон/SMS, OAuth), ролей и жизненного цикла аккаунта.

**Animal Domain**  
Контекст агрегата `animals`, истории владения и передач владения.

**Pet Marketplace / Livestock Marketplace**  
Два рынка объявлений, жёстко разделённые по ADR-0002 (pet = питомцы; livestock = сельхоз/племенные).

**Organization Domain**  
Контекст юридических лиц (клиники, питомники, приюты, фермы), их филиалов и аффилиаций персонала (M:N).

**Moderation Domain**  
Контекст пре-модерации (ADR-0003): очередь, решения (append-only), коды причин и жалобы пользователей на контент.

**Payment Domain**  
Контекст платёжных транзакций и возвратов. Гейтится через `feature_toggles.payments` (выключен до пост-MVP).

**Notification Domain**  
Контекст транзакционных/промо-уведомлений: шаблоны, логи доставки и преференции пользователя.

**Matching Domain**  
Контекст, предлагающий пары/партнёров для разведения по атрибутам животных.

**Geo-Search Service**  
Сквозная возможность находить объявления в радиусе (1–100 км) от точки (см. **Geo-search**).

**Admin Domain**  
Контекст управления справочными данными, системными настройками и операционным инструментарием.

## Сущности (основные таблицы)

**User (Пользователь)**  
Принципал, взаимодействующий с ZooLink (покупатель, продавец, модератор, админ или ИИ-агент). Хранится в `users`; аутентифицируется через Identity Domain. См. **Principal**, **Role**.

**Animal (Животное)**  
Агрегатный корень; принадлежит ровно одной стороне (пользователю **или** организации — XOR, `chk_animal_ownership`). Хранится в `animals`.

**Listing (Объявление)** (синоним **Advertisement**)  
Запись на рынке, описывающая животное для продажи/разведения/показа/пристройства/услуги производителя. Хранится в `listings`. «Advertisement» — прозовый синоним; каноническая сущность/таблица — **listing**.

**Organization / Branch / Organization User**  
Юрлицо (`organizations`), его физическое расположение (`branches`) и M:N-аффилиация пользователей с ролью `role_in_org` (`organization_users`).

**Conversation / Message**  
Диалог покупатель↔продавец по объявлению (`conversations`, `messages`). Встроенный чат отложен (ADR-0005); таблицы есть на будущее.

**Favorite (Избранное)**  
Сохранённое пользователем объявление (`favorites`, UNIQUE на пользователь+объявление). MVP-фича.

**Saved Search (Сохранённый поиск)**  
Сохранённый набор фильтров + локация/радиус (`saved_searches`, UC-GS-03). Проактивные алерты — Phase 2.

**Content Report (Жалоба на контент)**  
Поданный пользователем флаг на контент (`content_reports`: reporter, entity, reason, status OPEN/REVIEWED/DISMISSED/ACTIONED). Питает очередь модерации.

**Ownership Transfer (Передача владения)**  
Процессная сущность (`ownership_transfers`), управляющая передачей животного между сторонами (стейт-машина). Отличается от `animal_ownership_history` (журнал свершившихся фактов). Смена владения заблокирована в MVP.

**Moderation Decision**  
Append-only запись аудита (`moderation_decisions`) решения модератора/агента (APPROVED/REJECTED/CHANGES_REQUESTED). Неизменяема (UPDATE/DELETE блокируется триггером).

**Moderation Reason**  
Настраиваемый код причины (`moderation_reasons`), выбираемый при решении/жалобе.

**Payment Transaction / Refund**  
Платёж (`payment_transactions`) и его возврат (`refunds`). Суммы — **минорные единицы** (BIGINT), никогда не float.

**Notification Template / Notification Log**  
Шаблон сообщения по языкам (`notification_templates`) и запись доставки (`notification_logs`).

**Species / Breed / City**  
Справочные (lookup) данные с INTEGER-ключами (`species`, `breeds`, `cities`). См. **ID convention**.

**Feature Toggle**  
Флаг (`feature_toggles`), гейтящий поэтапные/платные/экспериментальные возможности (напр. `payments`).

**Outbox Event**  
Строка в `outbox_events`, реализующая **Outbox pattern** для надёжной публикации событий во внешние системы.

## Роли и принципалы

**Principal (Принципал)**  
Любой актёр, способный аутентифицироваться и действовать. Типизируется `users.principal_type` как **HUMAN** или **AGENT** (ADR-0006).

**AI Agent (ИИ-агент)**  
Специально обученный автоматический принципал (`principal_type=AGENT`), который может занимать операторские роли (Moderator сейчас, Admin позже) на пути к AI-эксплуатации площадки (ADR-0006). Неактивен до feature-флага; человеческая подотчётность и переопределение обязательны.

**Role (платформенная роль)**  
`users.role` ∈ {USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER}. Роли аддитивны.

**Role in Org**  
`organization_users.role_in_org` ∈ {OWNER, ADMIN, STAFF, VET, MODERATOR} — права внутри организации.

**VET ≡ VETERINARIAN**  
Профессия «ветеринар» представлена двумя токенами в **разных** ролевых системах: организационная роль — `VET` (`role_in_org`), платформенная — `VETERINARIAN` (`users.role`). Один и тот же смысл в разных областях (орг vs платформа).

**Moderator / Admin**  
Операторские роли: проверка контента / администрирование площадки. Может занимать HUMAN или AGENT (ADR-0006).

**agent-service-auth**  
*Форма* (закладывается сейчас, поведение gated), которой AGENT-принципал аутентифицируется как сервис: scoped-credential внутри монолита (ADR-0009 — без отдельного auth-сервиса), резолвится через ту же цепочку authenticator'ов, что и люди, с env signing-секретом (≥32) и хранилищем хешированного секрета с ротацией/отзывом, привязанным к `users.id` агента (ADR-0011 §5). Ни один токен агента не выдаётся, пока гейт AGENT выключен (DEFAULT HUMAN).

**principal-source-agnostic**  
Свойство, при котором авторизация (RBAC-матрица, CASL-abilities, объектное владение, снапшот актёра) потребляет единую абстракцию принципала `{ actor_id, principal_type, role }` **независимо от того, как аутентифицировался запрос** (ADR-0011 §5). Добавление агентов позже = один дополнительный authenticator (`AgentServiceToken`) в цепочке, а не переписывание authz/guard — субъект авторизации уже agent-агностичен.

## Статусы и стейт-машины

**State Machine (конечный автомат)**  
Формальная модель жизненного цикла сущности (состояния + охраняемые переходы). Стейт-машины ZooLink: listing, user, ownership transfer, payment, notification (`specs/statemachines/`).

**Listing status**  
`listings.status` ∈ {DRAFT, PENDING_MODERATION, ACTIVE, EXPIRED, SOLD, DEACTIVATED}. Только **ACTIVE** объявления видны в публичном поиске. (Прежде в доках был «PUBLISHED» → теперь `ACTIVE`.)

**Moderation status**  
`listings.moderation_status` ∈ {PENDING, APPROVED, REJECTED, CHANGES_REQUESTED} — исход проверки, поле **отдельное** от жизненного `status`.

**CHANGES_REQUESTED**  
**Исправимый** исход модерации: модератор/агент просит продавца доработать объявление (оно возвращается в `DRAFT` для повторной подачи), в отличие от `REJECTED` (терминальный отказ). Это канонический токен — он заменяет неформальное «FLAG»/«flagged» в admin-BR, где смешивались «нужны изменения» и «жалоба/флаг». Фиксируется как значение `moderation_decisions.decision` и enum `listings.moderation_status` (ADR-0003).

**User status**  
`users.status` ∈ {UNVERIFIED, PENDING_VERIFICATION, VERIFIED, ACTIVE, SUSPENDED, DEACTIVATED}.

**Payment status**  
`payment_transactions.status` ∈ {PENDING, COMPLETED, FAILED, REFUNDED, DISPUTED}. (Объявление продаётся, когда платёж **COMPLETED**.)

**Notification status**  
`notification_logs.status` ∈ {SENT, DELIVERED, FAILED, BOUNCED}.

**Ownership transfer status**  
`ownership_transfers.status` ∈ {PENDING, IN_PROGRESS, COMPLETED, FAILED}.

**Pre-moderation (Пре-модерация)**  
Рабочий процесс (ADR-0003), при котором объявление не видно публично до одобрения модератором/агентом (`PENDING_MODERATION` → `ACTIVE`).

## Концепции данных и архитектуры

**ID convention (конвенция ID)**  
Бизнес-сущности используют **UUID** первичные ключи; lookup/справочные таблицы (`species`, `breeds`, `cities`, `supported_languages`) — **INTEGER**. Поэтому `species_id`/`breed_id`/`city_id` — INTEGER.

**dataset (датасет, reference-data)**  
Именованный набор справочных/lookup-строк под одним admin-CRUD (напр. `species`, `breeds`, `cities`). Реестр reference-data в Admin — extensibility-first: новый датасет добавляется без смены формы контракта/реестра. **State-enum НЕ является датасетом** — напр. `animal-statuses` — это состояния жизненного цикла (стейт-машина), а не редактируемые оператором справочные данные, поэтому они исключены из реестра (ADR/план A2/A3).

**Passwordless auth (беспарольная аутентификация)**  
Аутентификация конечных пользователей — **phone OTP + OAuth**, без пароля. `password_hash` зарезервирован только для операторских ролей (ADMIN/MODERATOR) (спека 01 round-4).

**OTP (одноразовый код)**  
6-значный SMS-код подтверждения: TTL 5 мин, cooldown повторной отправки 60 с, 5 попыток затем lockout 15 мин. Хранится только как SHA-256-дайджест в Redis (не в PG); ключ — `phone_hash`.

**phone_hash (HMAC + pepper)**  
Детерминированный `HMAC-SHA256(phone, server_pepper)` (base64url) от телефона в E.164, хранится уникально в `users`. Детерминированный (в отличие от bcrypt), чтобы телефоны были уникальны/искомы без хранения самого номера; секрет `PHONE_HASH_PEPPER` — серверный env.

**Восстановление доступа (email-OTP)**  
Самостоятельный путь для пользователя, потерявшего телефон/OAuth, но имеющего **подтверждённый email**: на него отправляется новый OTP (`/auth/recover/email/*`), и после подтверждения выдаётся новая сессия (аккаунт DEACTIVATED в пределах grace реактивируется). Без тихого захвата (spec 01 Slice-4).

**Перепривязка идентификатора (admin-ассистированная)**  
Замена `phone_hash` или `oauth_*` идентификатора пользователя только ADMIN, с аудитом (`/admin/users/{id}/rebind`), для восстановления, когда подтверждённого email нет. Отзывает сессии цели; никогда не тихий захват.

**Повышение роли**  
Изменение `users.role`, назначаемое ADMIN (`/admin/users/{id}/role`) — USER → BREEDER/FARMER/VETERINARIAN/GROOMER (или операторские роли) никогда не заявляется самим пользователем; записывается в аудит и отзывает все refresh-семейства цели (round-4).

**erase_user / право на забвение (152-ФЗ)**  
Процедура анонимизации на месте (`/admin/users/{id}/erase`, data-governance.md §2): PII → NULL/tombstone, идентификаторы (`phone_hash`/`oauth_*`/`email`) освобождаются, сессии отзываются, `notification_logs` редактируется, ставится `users.erased_at`; UUID сохраняется, чтобы строки FK RESTRICT остались валидными. Append-only аудит/модерация/финансовые записи сохраняются под юр.удержанием.

**creator_id ≡ seller_id**  
`creator_id` — бизнес-термин «пользователь, разместивший объявление (для аудита)»; соответствует канонической колонке схемы `listings.seller_id`. Одно поле; для орг-объявлений это аффилированный пользователь, создавший объявление.

**Localized (JSONB-локализация)**  
Колонки `*_localized` хранят переводы как JSONB-объект по коду языка, напр. `{"en":"Name","ru":"Название"}`. DB-функции: `get_localized`, `has_translation`. Поддерживаемые языки — в `supported_languages`.

**Minor units (минорные единицы)**  
Денежные суммы как целые в наименьшей единице валюты (напр. копейки), тип BIGINT — никогда не float. Поля: `listings.price_cents`, `payment_transactions.amount_minor`, `refunds.amount_minor`.

**Idempotency key (ключ идемпотентности)**  
Уникальный ключ на вызовах создания/подтверждения/вебхука платежа, чтобы повторы/реплеи не вызывали двойного списания/перехода (`payment_transactions.idempotency_key`).

**Append-only audit**  
Таблица, куда строки можно только вставлять, не обновлять/удалять (триггер). Используется для `moderation_decisions` ради защищённого от подделки следа.

**Outbox pattern**  
Паттерн надёжности: доменные события пишутся в `outbox_events` в одной транзакции с изменением состояния, затем асинхронно публикуются во внешние системы.

**Haversine / Bounding box**  
Математика гео-поиска: формула Haversine вычисляет расстояние по большому кругу между двумя точками lat/lng; предварительный фильтр bounding box сужает кандидатов до точной проверки расстояния (основной гео-путь MVP; PostGIS опционален).

**RAG / RLM**  
Retrieval-Augmented Generation / слой поиска поверх документации. Может использоваться ИИ-агентами для знаний, обоснованных политикой (см. `RLM_RAG_HANDOFF.md`).

## Конкретные JSONB-схемы

**Health Records**  
JSONB-массив в `animals`, хранящий ветеринарные события здоровья. Каждый объект: `type` (string), `detail` (string), `date` (ISO 8601), `provider` (string).  
Пример: `[{"type":"vaccination","detail":"Rabies","date":"2024-05-10","provider":"Green Vet Clinic"}]`

**Reproductive Data**  
JSONB-массив в `animals` для репродуктивных событий (в основном самки). Каждый объект: `event` (heat_start/mating/pregnancy_confirmation/birth), `date` (ISO 8601), `partner_id` (UUID, nullable).  
Пример: `[{"event":"heat_start","date":"2024-06-01","partner_id":"550e8400-e29b-41d4-a716-446655440000"}]`

**Metadata**  
JSONB-колонка расширяемости на `organizations`, `branches`, `listings`. Хранит произвольные key-value атрибуты; по умолчанию `'{}'::jsonb`.  
Пример: `{"subscription_tier":"premium","branding":{"primary_color":"#FF5733"}}`

## Внешнее и юридическое

**152-ФЗ**  
Федеральный закон РФ «О персональных данных» № 152-ФЗ (27.07.2006), регулирующий обработку персональных данных. Ответственным остаётся человек/юрлицо даже когда площадку эксплуатируют ИИ-агенты.

**INN / KPP**  
Российские налоговые идентификаторы юрлиц: ИНН (идентификатор налогоплательщика) и КПП (код причины постановки на учёт); хранятся на `organizations`.

**SMS provider**  
Внешний сервис отправки SMS (напр. кодов верификации).

**Yandex.Maps API**  
Картографический/геокодинговый сервис Яндекса для карт и геокодинга адрес→координаты.

**Payment gateway**  
Внешний PCI-совместимый сервис обработки платежей; ZooLink хранит только метаданные, никогда сырые карточные данные (spec 14).

**Cloud / Object storage**  
S3-совместимое хранилище медиафайлов (фото объявлений и т.п.).
