# Конвенции API (нормативно для всех OpenAPI-контрактов)

> Этот документ **обязателен** для каждого `*-api.yaml` в этом каталоге. Закрывает сквозные пробелы из предпроектного
> аудита (нет стандарта ошибок, нет деклараций ролей, разнобой security/пагинации). Где контракт молчит — действуют эти правила.

## 0. Регистр JSON (тела запросов и ответов) — **camelCase** (зафиксировано владельцем 2026-06-23)
Имена полей **тел** API (тела запросов, тела ответов, ключи свойств схем) — **camelCase**
(`animalId`, `isActive`, `createdAt`, `priceCents`, `nameLocalized`). **БД остаётся `snake_case`**
(SQL-канон ADR-0007); прикладной слой мапит БД↔API. Исключения, остающиеся `snake_case`:
**query-параметры** sort/filter из §12 (напр. `sort=created_at:desc`, `species_id`) — они именуют колонки БД,
а не поля тела — и имена колонок БД в тексте `description:`.
- **ЧТО:** унифицировать все 12 контрактов на camelCase в телах; привести snake_case-контракты (listings,
  organization, matching и любые др.) и запретить смешанный регистр.
- **ПОЧЕМУ:** pre-codegen conformance gate (B0) нашёл смешанный регистр (snake_case в listings/organization/
  matching, camelCase в остальных) — единый клиент/codegen-таргет был невозможен.
- **ПОЧЕМУ ТАК ЛУЧШЕ для проекта в целом:** единый канон регистра убирает сюрпризы на контракт для фронтенда
  (Фаза 2) и любого OpenAPI-codegen, предотвращает тихий дрейф док↔код при генерации DTO и оставляет БД
  свободной быть `snake_case` (ADR-0007) без протечки регистра колонок в публичный контракт.

## 1. Базовый путь и версионирование
Все эндпоинты под `/api/v1`. Ломающие изменения → `/api/v2`. `servers: [{ url: /api/v1 }]`, `version: 1.0.0`.

## 2. Аутентификация
- Схема: `bearerAuth` (HTTP bearer, JWT). Глобально по умолчанию: **все эндпоинты требуют auth.**
  ```yaml
  components: { securitySchemes: { bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT } } }
  security: [ { bearerAuth: [] } ]
  ```
- Публичные эндпоинты **обязаны** явно отказаться `security: []`. Единственные публичные в MVP:
  `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /listings` (только активные),
  `GET /listings/{id}` (только активные), `GET /geo-search`, `GET /geo/geocode`, чтение справочников `GET`.
- **Транспорт refresh-токена:** refresh-токен — **HttpOnly, Secure, SameSite=Strict cookie** (`refresh_token`);
  access-токен в теле JSON. `POST /auth/refresh` ротирует оба; `POST /auth/logout` отзывает refresh на сервере
  (allowlist в Redis). Access TTL 15м, refresh TTL 7д.

## 3. Авторизация (роли)
Каждая непубличная операция декларирует допустимые роли через `x-required-roles`:
```yaml
paths:
  /admin/users/{id}/role:
    put:
      x-required-roles: [ADMIN]
```
Нормативное соответствие роль→ресурс→действие — **[security/rbac-matrix.md](../../specs/security/rbac-matrix.md)**.
Объектное владение (напр. редактировать своё животное может только владелец) применяется в сервис-слое по той матрице.
- **Enum ролей (канон, 7 ролей):** `USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER`. Любой
  `x-required-roles`, фильтр по роли или схема смены роли (напр. `admin-api.yaml`) использует именно этот набор.
  `principal_type (HUMAN|AGENT)` **ортогонален** роли (ADR-0006/ADR-0011) — роль может держать ИИ-агент; не
  смешивать. Роли в рамках организации (`role_in_org`) — **отдельный** enum в `organization-api.yaml`, не входят
  в платформенный набор ролей.

## 4. Стандартный конверт ошибок (RFC 7807)
Все non-2xx ответы используют `application/problem+json` с этой схемой (определить один раз, `$ref` везде):
```yaml
Problem:
  type: object
  required: [type, title, status, code]
  properties:
    type:    { type: string, format: uri, example: "about:blank" }
    title:   { type: string, example: "Validation failed" }
    status:  { type: integer, example: 400 }
    code:    { type: string, example: "VALIDATION_ERROR" }   # стабильный машинный код (enum, ниже)
    detail:  { type: string }
    instance:{ type: string }
    errors:  { type: array, items: { type: object } }          # ошибки уровня полей
```
Стандартные `code`: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500), `UPSTREAM_UNAVAILABLE` (503). Доменные коды расширяют набор
и перечислены в секции «Error Handling» каждой доменной спеки (см. `specs/error_handling/standard_error_format.md`).
Каждая операция документирует минимум `400, 401, 403, 404, 500` со ссылкой на `Problem` (публичные опускают 401/403).
- **Claim/lock модерации (B10, `specs/12-moderation-domain.md`):** `ALREADY_CLAIMED` (409, claim на элементе с
  живым lock другого принципала), `NOT_LOCK_HOLDER` (409, release/decide не-держателем), `ITEM_NOT_CLAIMED`
  (409, decide на элементе без живого lock).

## 5. Пагинация (list-эндпоинты)
Query-параметры `page` (с 1, по умолчанию 1) и `limit` (по умолчанию 20, макс 100). Конверт ответа:
```yaml
PageMeta:
  type: object
  properties:
    page:       { type: integer }
    limit:      { type: integer }
    total:      { type: integer }
    totalPages: { type: integer }
    nextCursor: { type: string, nullable: true }   # опционально, cursor-ready (аддитивно); в page-режиме отсутствует
# list-ответы: { items: [...], meta: PageMeta }
```
`offset`-пагинация **не** используется — `matching-api` приведён с `offset`/`hasMore` к `page`/`limit`.
- **ЧТО:** каждый list-эндпоинт возвращает `{ items, meta: PageMeta }`; offset/hasMore убраны.
- **ПОЧЕМУ:** аудит нашёл `offset`/`hasMore` в `matching-api`, расходящийся с остальными; высокочастотным
  операторским очередям (модерация) позже понадобится cursor-пагинация без слома контракта.
- **ПОЧЕМУ ТАК ЛУЧШЕ для проекта в целом:** единый конверт `{items, meta}` **cursor-ready** — `meta.nextCursor`
  аддитивен (клиенты, его игнорирующие, продолжают работать), поэтому мы не переформируем list-ответы, когда
  операторская очередь переключится с page-режима на keyset-пагинацию. Одна форма для всех потребителей и codegen.

## 6. Локализация
- Локализованные поля используют общую схему `LocalizedString`: `{ type: object, properties: { en: {type: string}, ru: {type: string} } }`.
  Плоские поля по языкам (`name_ru`/`name_en`) и freeform-`additionalProperties`-string JSONB-карты в контрактах
  **не** используются — они сворачиваются в одно поле `LocalizedString` (напр. `nameLocalized`, `titleLocalized`).
- **Admin / редактор справочников** возвращают **полный объект `LocalizedString`** (обе локали — оператор правит
  все языки). **Публичные** read-эндпоинты возвращают **резолвленную строку** на запрошенный `Accept-Language`
  (с **фолбэком на en**). Документировать заголовок на read-эндпоинтах.
- **ЧТО:** каждое локализованное поле — единый `LocalizedString {en, ru}`; admin отдаёт обе локали, публичные —
  резолвленную строку.
- **ПОЧЕМУ:** аудит нашёл три сосуществующие формы (плоские `name_ru/name_en`, freeform-JSONB-карты и
  `LocalizedString`) — клиент не мог понять, какую ждать.
- **ПОЧЕМУ ТАК ЛУЧШЕ для проекта в целом:** одна форма локализации обслуживает и операторский редактор, и
  публичные чтения, совпадает с миграцией БД `name_localized` JSONB (owner-decision #3) и позволяет добавить язык
  без изменения контракта (резолвер просто получает новый ключ).

## 7. Деньги и валюта
Денежные поля — целые **минорные единицы** (копейки), `format: int64` (BIGINT). Используются два синонимичных
суффикса, оба означают минорные единицы: существующее поле listings — **`price_cents`** (оставлено, без переименования
ради избежания churn), поля платежей — **`amount_minor`**. Новые денежные поля — с суффиксом `*_minor`. `currency` —
ISO 4217: `{ type: string, minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' }` (enforced DB CHECK `chk_listings_currency_iso`).

## 8. Ограничение скорости
Чувствительные эндпоинты (auth: login/register/refresh; платежи; жалобы; раскрытие контактов) возвращают `429` с
`Retry-After` и `X-RateLimit-Limit` / `X-RateLimit-Remaining`. Конкретные лимиты: `nfr/security.md`.

## 9. Замечание об объёме MVP
`POST/GET /listings/{id}/conversations` и схемы `Conversation`/сообщений — **Фаза 2+** (чат вне MVP по
[ADR-0005](../../04-decisions/0005-no-chat-mvp.md)); пометить `deprecated: true` или убрать из MVP-контракта.
`payment-api.yaml` гейтится `feature_toggles.payments` (Фаза 2+).

## Чек-лист соответствия (на файл контракта)
- [ ] все имена полей тел — **camelCase** (§0); только sort/filter query-параметры §12 остаются snake_case
- [ ] локализованные поля — `LocalizedString {en, ru}` (§6); без плоских `name_ru/name_en` и freeform-JSONB-карт
- [ ] глобальный `security` + явный `security: []` на публичных
- [ ] `x-required-roles` на каждой непубличной (соответствует rbac-matrix.md)
- [ ] все ошибки `$ref` `Problem`
- [ ] list-операции используют `page`/`limit` + `PageMeta`
- [ ] денежные поля в минорных единицах int64 (`price_cents`/`amount_minor`); `currency` ISO-4217 pattern
- [ ] `429` + заголовки на чувствительных
- [ ] mutating PATCH поддерживает `If-Match` (§10); небезопасный POST принимает `Idempotency-Key` (§11)
- [ ] list-операции используют §12 sort/filter; публичные read шлют `ETag`/`Cache-Control` (§13)
- [ ] ответы/события с актёром используют `Actor {actorId, principalType}` (§15); без плоских actor-uuid

## 10. Оптимистичная конкуренция (mutating PATCH)
Каждый ресурс отдаёт **`ETag`** (weak, из `updated_at`) на GET. `PATCH`/`PUT`, изменяющий существующий ресурс,
**обязан** слать **`If-Match: <etag>`**:
- совпало → применить, вернуть новый `ETag`;
- не совпало → **`412 Precondition Failed`** (`code: STALE_RESOURCE`) — клиент перечитывает и повторяет;
- нет `If-Match` на mutating PATCH → **`428 Precondition Required`**.
Предотвращает тихий last-write-wins при параллельном редактировании listing/animal/org. (Эндпоинты переходов —
moderation decide, payment confirm — сохраняют guard-based `409`.)

## 11. Идемпотентность (небезопасный POST)
Все неидемпотентные `POST` (создание объявления, фото, favorite, contact-reveal, content-report, payment) принимают
заголовок **`Idempotency-Key`** (UUID клиента). Сервер хранит `key → (хэш запроса, ответ)` 24 ч: повтор с тем же
ключом → сохранённый ответ; тот же ключ с другим телом → `422`. Это HTTP-дополнение к UNIQUE-ограничениям БД
(`favorites`, OPEN-дедуп `content_reports`, `payment_transactions.idempotency_key`).

## 12. Фильтрация и сортировка (списки)
- **Sort:** `sort=<field>:<asc|desc>` (повторяемый), поля в **snake_case** как у ресурса (`sort=created_at:desc`).
  camelCase-параметры запрещены (legacy `sortBy/sortOrder` admin заменён).
- **Filter:** явные query-параметры на документированное поле (`species_id`, `listing_type`, `price_min`, `price_max`);
  без общего filter-DSL в MVP.
- Публичные списки/поиск (`GET /listings`, `GET /geo-search`) обязаны иметь дефолтную детерминированную сортировку.

## 13. Кэширование и conditional-read
Публичные read-эндпоинты (активные объявления, деталь, geo-search, справочники) шлют `ETag` + `Cache-Control` и
обрабатывают `If-None-Match` → **`304 Not Modified`**. Сжатие gzip/brotli на прокси. Это делает CDN/perf-цели из
`performance_specification.md` реализуемыми.

## 14. Депрекация
Устаревшие операции/схемы помечаются `deprecated: true`, сервер шлёт `Deprecation` + `Sunset`. Схемы чата
(`Conversation`/сообщения) депрекированы в MVP (Фаза 2+, ADR-0005) и должны быть помечены.

## 15. Представление актёра (`{ actorId, principalType }` — agent-badge)
Любой ответ или доменное событие, **называющее актёра** (решения модерации, записи аудита, админ-действия и любой
будущий payload со штампом актёра), ОБЯЗАН нести актёра как общий объект **`Actor`** — `{ actorId, principalType }`
(+ опционально `actorDisplayName`) — никогда как голый uuid `actorId`. `principalType ∈ {HUMAN, AGENT}` — это
**снимок на момент записи** `users.principal_type` (контракт-зеркало снимка схемы §1 в
[ADR-0011](../../04-decisions/0011-agent-principal-actor-model.md)), чтобы потребитель отличал решённое человеком от
решённого агентом без второго запроса.
```yaml
Actor:
  type: object
  required: [actorId, principalType]
  properties:
    actorId:          { type: string, format: uuid }
    principalType:    { type: string, enum: [HUMAN, AGENT] }   # снимок на момент действия (ADR-0011 §1)
    actorDisplayName: { type: string, nullable: true }         # опциональная метка для операторского UI
```
Для **журнала решений модерации** форма актёра дополнительно несёт цепочку human-override (ADR-0011 §2/§3):
`actorRole` (снимок роли при принятии решения), `supersedesDecisionId` и `isHumanOverride` (ненулевые вместе —
HUMAN-отмена ссылается на отменяемое решение; исходная строка агента никогда не мутируется).
- **ЧТО:** каждый ответ/событие с актёром использует `Actor {actorId, principalType}` (+ override-поля в журнале
  модерации); legacy-плоские uuid `moderatorId`/`performedBy`/`resolvedBy`/`updatedBy` заменены.
- **ПОЧЕМУ:** операторский UI / регуляторный экспорт / нижестоящий сервис должны отличать человека от агента без
  второго запроса, а форма ответа должна совпадать с правдивым append-only снимком схемы (ADR-0011 §1/§6).
- **ПОЧЕМУ ТАК ЛУЧШЕ для проекта в целом:** замыкает петлю схема↔контракт (снимок бесполезен, если API его прячет);
  форвард-совместимо с нулевой стоимостью (`principalType` = `HUMAN` для каждого MVP-ответа, поэтому принятие сейчас
  избегает ломающего изменения контракта при активации агентов — ADR-0006); одна форма `Actor` для всех потребителей
  и codegen-таргетов; поддерживает ещё открытый продуктовый вопрос, видят ли конечные пользователи «решено ИИ»
  (данные присутствуют независимо от выбора отображения).
> Query-фильтры, выбирающие по актёру, принимают скалярный `actorId` (фильтруем по id, не по объекту).

## 16. Конверт аналитики (счётчики сейчас, series-ready) — зафиксировано владельцем (решение #6, 2026-06-24)
Ответы аналитики — это **снимки-счётчики сейчас** с формой **series-ready**: каждая схема аналитики — плоский
объект счётчиков (напр. `views`, `contactReveals`, `totalListings`, `countsByStatus`, `countsByMarket`) **плюс
опциональный массив `series`** (`nullable: true`, `x-phase: 2`) точек по дням. В MVP `series` **отсутствует или
пуст**; временной ряд добавляется **аддитивно в Фазе 2 без смены контракта**.
- **ЧТО:** аналитика продавца (`GET /listings/{id}/analytics`) и организации (`GET /organizations/{id}/analytics`)
  возвращают счётчики сейчас; поле временного ряда `series` присутствует в контракте, но помечено `x-phase:2`/nullable.
  **Не удалять поле `series`** ради «чистоты» MVP — именно оно делает форму аддитивной.
- **ПОЧЕМУ:** GAP-011 — BR/UC обещают «Просмотры: 15, Показано контактов: 3» и org-агрегат, но контракта не было;
  владелец зафиксировал форму как счётчики + series-ready (решение #6), чтобы контракт можно было выпустить до
  фронтенда без пересмотра формы при появлении временного ряда.
- **ПОЧЕМУ ТАК ЛУЧШЕ для проекта в целом:** единый конверт аналитики обслуживает и MVP-дашборд счётчиков, и более
  поздний вид с временным рядом без слома контракта (потребитель, игнорирующий `series`, продолжает работать);
  рынки разделены по ADR-0002 (`countsByMarket`), форма owner-scoped (продавец / org-admin), поэтому авторизация
  согласуется с rbac-matrix.md. Реализация отложена до фронтенд-фазы — это **форма сейчас, поведение потом**.

## Статус соответствия (B0 — contract conformance gate, 2026-06-23)
B0 привёл все 12 контрактов к этому документу: camelCase-тела (§0), `{items, meta: PageMeta}` (§5, offset убран из
`matching-api`), RFC7807 `Problem` на каждом non-2xx (§4), `LocalizedString {en, ru}` (§6, плоские `name_ru/name_en`
и freeform-JSONB-карты убраны), `If-Match`/`ETag` (§10) на мутирующих admin/moderation PATCH, и 7-ролевой enum (§3)
в `admin-api`. `favorites-api.yaml` получил RU-зеркало.
**B0.6 выполнено (2026-06-23, ADR-0011 §6):** форма актёра в ответе `Actor {actorId, principalType}` (agent-badge,
§15) применена к ответам moderation/audit/admin со штампом актёра — `moderation-api` (`ModerationDecision.actor` +
`actorRole`/`supersedesDecisionId`/`isHumanOverride`, `ContentReport.resolvedBy`) и `admin-api`
(`AuditLogEntry.actor`, `ModerationLogEntry.actor`, `ModerationActionResponse.actor`, `SystemSetting.updatedBy`).
`API_CONVENTIONS.md` — единый нормативный источник.
**B9 выполнено (2026-06-24, решение #6):** конверт аналитики (§16, счётчики + series-ready) применён —
`listings-api` (`GET /listings/{id}/analytics`, `ListingAnalytics`) и `organization-api`
(`GET /organizations/{id}/analytics`, `OrganizationAnalytics`). `series` помечен `x-phase:2`/nullable (форма сейчас,
реализация отложена до фронтенд-фазы). GAP-011 закрыт на уровне контракта.

🌐 EN: [docs/03-architecture/api-contracts/API_CONVENTIONS.md](../../../docs/03-architecture/api-contracts/API_CONVENTIONS.md)
