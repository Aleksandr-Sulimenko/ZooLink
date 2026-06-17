# API Conventions (normative for all OpenAPI contracts)

> This document is **binding** for every `*-api.yaml` in this directory. It removes the cross-cutting gaps found
> in the pre-dev audit (no standard error body, no role declarations, inconsistent security/pagination).
> Where a contract file is silent, these rules apply.

## 1. Base path & versioning
All endpoints under `/api/v1`. Breaking changes → `/api/v2`. `servers: [{ url: /api/v1 }]`, `version: 1.0.0`.

## 2. Authentication
- Scheme: `bearerAuth` (HTTP bearer, JWT). Global default: **all endpoints require auth.**
  ```yaml
  components: { securitySchemes: { bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT } } }
  security: [ { bearerAuth: [] } ]
  ```
- Public endpoints **must** opt out explicitly with `security: []`. The only public endpoints in MVP:
  `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `GET /listings` (active only),
  `GET /listings/{id}` (active only), `GET /geo-search`, `GET /geo/geocode`, reference-data `GET`.
- **Refresh token transport:** refresh token is set/read as an **HttpOnly, Secure, SameSite=Strict cookie**
  (`refresh_token`); access token returned in the JSON body. `POST /auth/refresh` rotates both; `POST /auth/logout`
  revokes the refresh token server-side (Redis allowlist). Access TTL 15m, refresh TTL 7d.

## 3. Authorization (roles)
Every non-public operation declares the allowed roles via `x-required-roles`:
```yaml
paths:
  /admin/users/{id}/role:
    put:
      x-required-roles: [ADMIN]
```
The authoritative role→resource→action mapping is **[security/rbac-matrix.md](../../specs/security/rbac-matrix.md)**.
Object-level ownership (e.g. only the owner may edit their animal) is enforced at the service layer per that matrix.

## 4. Standard error envelope (RFC 7807)
All non-2xx responses use `application/problem+json` with this schema (define once, `$ref` everywhere):
```yaml
Problem:
  type: object
  required: [type, title, status, code]
  properties:
    type:    { type: string, format: uri, example: "about:blank" }
    title:   { type: string, example: "Validation failed" }
    status:  { type: integer, example: 400 }
    code:    { type: string, example: "VALIDATION_ERROR" }   # stable machine code (enum, see below)
    detail:  { type: string }
    instance:{ type: string }
    errors:  { type: array, items: { type: object } }          # field-level validation issues
```
Standard `code` values: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404),
`CONFLICT` (409), `RATE_LIMITED` (429), `INTERNAL` (500), `UPSTREAM_UNAVAILABLE` (503). Domain-specific codes extend
this set and are listed in each domain spec's "Error Handling" section (see `specs/error_handling/standard_error_format.md`).
Every operation must document at least `400, 401, 403, 404, 500` referencing `Problem` (public ones omit 401/403).

## 5. Pagination (list endpoints)
Query params `page` (1-based, default 1) and `limit` (default 20, max 100). Response envelope:
```yaml
PageMeta: { type: object, properties: { page: {type: integer}, limit: {type: integer}, total: {type: integer}, totalPages: {type: integer} } }
# list responses: { items: [...], meta: PageMeta }
```
`offset`-style pagination is **not** used — normalize matching-api to `page`/`limit`.

## 6. Localization
- Localized fields use the shared `LocalizedString` schema: `{ type: object, properties: { en: {type: string}, ru: {type: string} } }`.
- Clients may send `Accept-Language: ru|en`; the API returns localized prose in that language with **en fallback**,
  or the full `LocalizedString` object for editable resources. Document the header on read endpoints.

## 7. Money & currency
Monetary fields are integer **minor units** (kopecks), `format: int64` (BIGINT). Two synonymous suffixes are in
use and both mean minor units: the existing listings field is **`price_cents`** (kept — no rename, to avoid churn),
payment fields use **`amount_minor`**. New money fields should use the `*_minor` suffix. `currency` is ISO 4217:
`{ type: string, minLength: 3, maxLength: 3, pattern: '^[A-Z]{3}$' }` (enforced by DB CHECK `chk_listings_currency_iso`).

## 8. Rate limiting
Sensitive endpoints (auth: login/register/refresh; payments; content-reports; contact reveal) return `429` with
`Retry-After` and `X-RateLimit-Limit` / `X-RateLimit-Remaining` headers. Concrete limits: `nfr/security.md`.

## 9. MVP scope note
`POST/GET /listings/{id}/conversations` and the `Conversation`/message schemas are **Фаза 2+** (chat is out of MVP
per [ADR-0005](../../04-decisions/0005-no-chat-mvp.md)); mark them `deprecated: true` or remove from the MVP contract.
`payment-api.yaml` is gated by `feature_toggles.payments` (Фаза 2+).

## Conformance checklist (per contract file)
- [ ] global `security` + explicit `security: []` on public ops
- [ ] `x-required-roles` on every non-public op (matches rbac-matrix.md)
- [ ] all error responses `$ref` `Problem`
- [ ] list ops use `page`/`limit` + `PageMeta`
- [ ] money fields in minor units int64 (`price_cents`/`amount_minor`); `currency` ISO-4217 pattern
- [ ] `429` + headers on sensitive ops
