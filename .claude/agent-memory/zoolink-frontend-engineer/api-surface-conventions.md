---
name: api-surface-conventions
description: Locked API conventions the SPA client must honor — and where the contracts violate their own normative doc
metadata:
  type: reference
---

API_CONVENTIONS.md is the single normative source for all `*-api.yaml`. Key consumer-facing rules:
- Base path `/api/v1`; breaking → `/api/v2`.
- Bearer JWT global default; public ops opt out with `security: []`. Refresh token = HttpOnly Secure SameSite=Strict cookie `refresh_token`; access token in JSON body. Access TTL 15m, refresh 7d.
- Errors: RFC7807 `application/problem+json` with `{type,title,status,code,detail,instance,errors}`. Stable machine `code` enum: VALIDATION_ERROR/UNAUTHENTICATED/FORBIDDEN/NOT_FOUND/CONFLICT/RATE_LIMITED/INTERNAL/UPSTREAM_UNAVAILABLE + domain codes. Concurrency uses `STALE_RESOURCE`.
- Pagination: `page`(1-based)/`limit`(20,max100) + envelope `{ items, meta: PageMeta{page,limit,total,totalPages} }`. `offset` is explicitly NOT used.
- Localization: `LocalizedString {en,ru}`; `Accept-Language: ru|en` with EN fallback.
- Money: integer minor units int64; suffixes `price_cents` (listings, kept) and `amount_minor` (new). `currency` ISO-4217 `^[A-Z]{3}$`.
- Concurrency: weak ETag on GET; mutating PATCH requires `If-Match` → 412 STALE_RESOURCE / 428 if missing. State-transition endpoints keep guard-based 409.
- Idempotency: unsafe POST accepts `Idempotency-Key` (24h; same key+diff body → 422).
- Sort: `sort=field:asc|desc`, snake_case fields. camelCase sortBy/sortOrder is superseded.
- Caching: public reads send ETag + Cache-Control, honor If-None-Match → 304.

**Compliance reality (round-5 note in API_CONVENTIONS.md):** only `favorites-api.yaml` actually applies these inline. The other 11 contracts are NON-conformant on the wire shape (no Problem $ref, wrong page envelope, no x-required-roles, camelCase sort, snake/camel field-naming split). This is the #1 SPA-rewrite risk: a generated client off today's yaml would be wrong.
