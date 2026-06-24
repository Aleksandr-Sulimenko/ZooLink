# Конвенции API (нормативно для всех OpenAPI-контрактов)

> Этот документ **обязателен** для каждого `*-api.yaml` в этом каталоге. Закрывает сквозные пробелы из предпроектного
> аудита (нет стандарта ошибок, нет деклараций ролей, разнобой security/пагинации). Где контракт молчит — действуют эти правила.

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

## 5. Пагинация (list-эндпоинты)
Query-параметры `page` (с 1, по умолчанию 1) и `limit` (по умолчанию 20, макс 100). Конверт ответа:
```yaml
PageMeta: { type: object, properties: { page: {type: integer}, limit: {type: integer}, total: {type: integer}, totalPages: {type: integer} } }
# list-ответы: { items: [...], meta: PageMeta }
```
`offset`-пагинация **не** используется — привести matching-api к `page`/`limit`.

## 6. Локализация
- Локализованные поля используют общую схему `LocalizedString`: `{ type: object, properties: { en: {type: string}, ru: {type: string} } }`.
- Клиент может слать `Accept-Language: ru|en`; API возвращает локализованную прозу на этом языке с **фолбэком на en**,
  либо полный объект `LocalizedString` для редактируемых ресурсов. Документировать заголовок на read-эндпоинтах.

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
- [ ] глобальный `security` + явный `security: []` на публичных
- [ ] `x-required-roles` на каждой непубличной (соответствует rbac-matrix.md)
- [ ] все ошибки `$ref` `Problem`
- [ ] list-операции используют `page`/`limit` + `PageMeta`
- [ ] денежные поля в минорных единицах int64 (`price_cents`/`amount_minor`); `currency` ISO-4217 pattern
- [ ] `429` + заголовки на чувствительных
- [ ] mutating PATCH поддерживает `If-Match` (§10); небезопасный POST принимает `Idempotency-Key` (§11)
- [ ] list-операции используют §12 sort/filter; публичные read шлют `ETag`/`Cache-Control` (§13)

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

## Статус соответствия (раунд 5)
Сейчас §2–§7 inline применяет только `favorites-api.yaml`; остальные 11 контрактов нужно привести к этому документу
(глобальный `security` + public opt-out, `x-required-roles`, `Problem`, `PageMeta`, `*_minor`, §10–§14). Это
механический проход, трекается как pre-implementation задача — `API_CONVENTIONS.md` — единый нормативный источник.

🌐 EN: [docs/03-architecture/api-contracts/API_CONVENTIONS.md](../../../docs/03-architecture/api-contracts/API_CONVENTIONS.md)
