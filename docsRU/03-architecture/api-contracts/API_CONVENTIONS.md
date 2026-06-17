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
Денежные поля — целые **минорные единицы** с именем `*_minor`, `format: int64` (BIGINT). `currency` — ISO 4217:
`{ type: string, minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' }`. (Переименовать legacy `price_cents` → `price_minor`.)

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
- [ ] денежные поля `*_minor` int64; `currency` ISO-4217 pattern
- [ ] `429` + заголовки на чувствительных

🌐 EN: [docs/03-architecture/api-contracts/API_CONVENTIONS.md](../../../docs/03-architecture/api-contracts/API_CONVENTIONS.md)
