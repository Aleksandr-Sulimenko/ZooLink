# API Conventions (normative for all OpenAPI contracts)

> This document is **binding** for every `*-api.yaml` in this directory. It removes the cross-cutting gaps found
> in the pre-dev audit (no standard error body, no role declarations, inconsistent security/pagination).
> Where a contract file is silent, these rules apply.

## 0. JSON casing (request & response bodies) — **camelCase** (owner-locked 2026-06-23)
All API **body** field names (request bodies, response bodies, schema property keys) are **camelCase**
(`animalId`, `isActive`, `createdAt`, `priceCents`, `nameLocalized`). The **database stays `snake_case`**
(ADR-0007 SQL canon); the application layer maps DB↔API. Exceptions that remain `snake_case`:
the §12 `sort`/filter **query parameters** (e.g. `sort=created_at:desc`, `species_id`) — they name DB
columns, not body fields — and DB column names quoted inside prose `description:` text.
- **WHAT:** unify all 12 contracts on camelCase bodies; convert the snake_case contracts (listings,
  organization, matching, and any other) and forbid mixed casing.
- **WHY:** the pre-codegen conformance gate (B0) found mixed casing (snake_case in listings/organization/
  matching, camelCase elsewhere); a single client/codegen target was impossible.
- **WHY-BETTER-for-the-whole-project:** one casing canon removes per-contract surprises for the frontend
  (Phase 2) and any OpenAPI codegen, prevents silent doc↔code drift when DTOs are generated, and keeps the
  DB free to stay `snake_case` (ADR-0007) without leaking column casing into the public contract.

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
- **Role enum (canon, 7 roles):** `USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER`. Any
  `x-required-roles`, role filter, or role-change request schema (e.g. `admin-api.yaml`) uses this exact set.
  `principal_type (HUMAN|AGENT)` is **orthogonal** to role (ADR-0006/ADR-0011) — a role may be held by an AI
  agent; do not conflate the two. Organization-scoped roles (`role_in_org`) are a **separate** enum and live
  in `organization-api.yaml`, not in the platform role set.

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
PageMeta:
  type: object
  properties:
    page:       { type: integer }
    limit:      { type: integer }
    total:      { type: integer }
    totalPages: { type: integer }
    nextCursor: { type: string, nullable: true }   # optional, cursor-ready (additive); absent in page-mode
# list responses: { items: [...], meta: PageMeta }
```
`offset`-style pagination is **not** used — `matching-api` is normalized off `offset`/`hasMore` to `page`/`limit`.
- **WHAT:** every list endpoint returns `{ items, meta: PageMeta }`; offset/hasMore removed.
- **WHY:** the audit found `matching-api` used `offset`/`hasMore`, diverging from the rest; high-frequency
  operator queues (moderation) will later need cursor paging without a contract break.
- **WHY-BETTER-for-the-whole-project:** the single `{items, meta}` envelope is **cursor-ready** — `meta.nextCursor`
  is additive (clients ignoring it keep working), so we never reshape list responses when an operator queue
  switches from page-mode to keyset paging. One shape for every consumer and codegen target.

## 6. Localization
- Localized fields use the shared `LocalizedString` schema: `{ type: object, properties: { en: {type: string}, ru: {type: string} } }`.
  Flat per-language fields (`name_ru`/`name_en`) and freeform `additionalProperties`-string JSONB maps are **not**
  used in contracts — they collapse to one `LocalizedString` field (e.g. `nameLocalized`, `titleLocalized`).
- **Admin / reference-data editor** endpoints return the **full `LocalizedString`** object (both locales — the
  operator edits all languages). **Public** read endpoints return the **resolved string** for the requested
  `Accept-Language` (with **en fallback**). Document the header on read endpoints.
- **WHAT:** every localized field is a single `LocalizedString {en, ru}`; admin returns both locales, public
  returns the resolved string.
- **WHY:** the audit found three coexisting shapes (flat `name_ru/name_en`, freeform JSONB maps, and
  `LocalizedString`) — clients could not tell which to expect.
- **WHY-BETTER-for-the-whole-project:** one localized shape backs both the operator editor and public reads,
  matches the `name_localized` JSONB DB migration (owner-decision #3), and lets us add a language without a
  contract change (the resolver simply gains a key).

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
- [ ] all body field names are **camelCase** (§0); only §12 sort/filter query params stay snake_case
- [ ] localized fields use `LocalizedString {en, ru}` (§6); no flat `name_ru/name_en` or freeform JSONB maps
- [ ] global `security` + explicit `security: []` on public ops
- [ ] `x-required-roles` on every non-public op (matches rbac-matrix.md)
- [ ] all error responses `$ref` `Problem`
- [ ] list ops use `page`/`limit` + `PageMeta`
- [ ] money fields in minor units int64 (`price_cents`/`amount_minor`); `currency` ISO-4217 pattern
- [ ] `429` + headers on sensitive ops
- [ ] mutating PATCH supports `If-Match` (§10); unsafe POST accepts `Idempotency-Key` (§11)
- [ ] list ops use the §12 `sort`/filter convention; public reads send `ETag`/`Cache-Control` (§13)
- [ ] actor-bearing responses/events use `Actor {actorId, principalType}` (§15); no flat actor uuids

## 10. Optimistic concurrency (mutating PATCH)
Every resource exposes an **`ETag`** (weak, derived from `updated_at`) on GET. A `PATCH`/`PUT` that mutates an
existing resource **must** send **`If-Match: <etag>`**. The server compares against the current row:
- match → apply, return new `ETag`;
- mismatch → **`412 Precondition Failed`** (`code: STALE_RESOURCE`) — the client must re-GET and retry;
- missing `If-Match` on a mutating PATCH → **`428 Precondition Required`**.
This prevents silent last-write-wins when two owners/moderators edit the same listing/animal/org concurrently.
(State-transition endpoints — moderation decide, payment confirm — keep their guard-based `409` instead.)

## 11. Idempotency (unsafe POST)
All non-idempotent `POST`s (create listing, add photo, favorite, contact-reveal, content-report, payment) accept an
**`Idempotency-Key`** request header (client-generated UUID). The server stores `key → (request-hash, response)` for
24 h: a replay with the same key returns the stored response; the same key with a **different** body → `422`. This is
the HTTP-layer complement to the DB unique constraints (`favorites`, `content_reports` OPEN-dedup, `payment_transactions.idempotency_key`).

## 12. Filtering & sorting (list endpoints)
- **Sort:** `sort=<field>:<asc|desc>` (repeatable), fields in **snake_case** matching the resource (e.g.
  `sort=created_at:desc`). No camelCase params (admin's legacy `sortBy/sortOrder`/camelCase is superseded).
- **Filter:** explicit query params per documented field (e.g. `species_id`, `listing_type`, `price_min`, `price_max`);
  no generic filter DSL in MVP.
- Public list/search endpoints (`GET /listings`, `GET /geo-search`) MUST offer a default deterministic sort.

## 13. Caching & conditional reads
Public read endpoints (active listings, listing detail, geo-search, reference data) send `ETag` + `Cache-Control`
and honor `If-None-Match` → **`304 Not Modified`**. Responses are gzip/brotli-compressed at the proxy. This is what
makes the CDN/perf targets in `performance_specification.md` realizable.

## 14. Deprecation
Deprecated operations/schemas carry `deprecated: true` and the server sends `Deprecation` + `Sunset` headers. The
chat schemas (`Conversation`/message endpoints) are deprecated in MVP (Фаза 2+, ADR-0005) and must be marked so.

## 15. Actor representation (`{ actorId, principalType }` — agent-badge)
Any response or domain event that **names an actor** (moderation decisions, audit entries, admin actions, and any
future actor-stamped payload) MUST carry the actor as the shared **`Actor`** object — `{ actorId, principalType }`
(+ optional `actorDisplayName`) — never a bare `actorId` uuid. `principalType ∈ {HUMAN, AGENT}` is the **write-time
snapshot** of `users.principal_type` (the contract mirror of the §1 schema snapshot in
[ADR-0011](../../04-decisions/0011-agent-principal-actor-model.md)), so a consumer can tell a human-decided from an
agent-decided action without a second lookup.
```yaml
Actor:
  type: object
  required: [actorId, principalType]
  properties:
    actorId:          { type: string, format: uuid }
    principalType:    { type: string, enum: [HUMAN, AGENT] }   # snapshot at action time (ADR-0011 §1)
    actorDisplayName: { type: string, nullable: true }         # optional operator-UI label
```
For the **moderation decision ledger** the actor form additionally carries the human-override chain (ADR-0011 §2/§3):
`actorRole` (snapshot of the role held when deciding), `supersedesDecisionId` and `isHumanOverride` (non-null
together — a HUMAN reversal references the superseded decision; the original agent row is never mutated).
- **WHAT:** every actor-bearing response/event uses `Actor {actorId, principalType}` (+ override fields on the
  moderation ledger); the legacy flat `moderatorId`/`performedBy`/`resolvedBy`/`updatedBy` uuids are superseded.
- **WHY:** an operator UI / regulator export / downstream service must distinguish human from agent without a
  second lookup, and the response form must match the truthful append-only schema snapshot (ADR-0011 §1/§6).
- **WHY-BETTER-for-the-whole-project:** closes the schema↔contract loop (the snapshot is useless if the API hides
  it); forward-compatible at zero cost (`principalType` is `HUMAN` for every MVP response, so adopting it now
  avoids a breaking contract change when agents activate — ADR-0006); one `Actor` shape for every consumer and
  codegen target; supports the still-open product question of whether end-users see "decided by AI" (the data is
  present regardless of the display choice).
> Query filters that select by actor take the scalar `actorId` (you filter by id, not by the object).

## Conformance status (B0 — contract conformance gate, 2026-06-23)
B0 brought all 12 contracts onto this document: camelCase bodies (§0), `{items, meta: PageMeta}` (§5, offset
removed from `matching-api`), RFC7807 `Problem` on every non-2xx (§4), `LocalizedString {en, ru}` (§6, flat
`name_ru/name_en` and freeform JSONB maps removed), `If-Match`/`ETag` (§10) on mutating admin/moderation PATCH,
and the 7-role enum (§3) in `admin-api`. `favorites-api.yaml` gained its RU mirror.
**B0.6 done (2026-06-23, ADR-0011 §6):** the actor response form `Actor {actorId, principalType}` (agent-badge, §15)
is applied to moderation/audit/admin actor-bearing responses — `moderation-api` (`ModerationDecision.actor` +
`actorRole`/`supersedesDecisionId`/`isHumanOverride`, `ContentReport.resolvedBy`) and `admin-api`
(`AuditLogEntry.actor`, `ModerationLogEntry.actor`, `ModerationActionResponse.actor`, `SystemSetting.updatedBy`).
`API_CONVENTIONS.md` is the single normative source.
