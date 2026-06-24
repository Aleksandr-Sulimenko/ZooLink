# ZooLink — Capability Digest (code ↔ contract ↔ spec ↔ schema)

> **Generated:** 2026-06-22 · **Branch:** `backend` (uncommitted work) · **Method:** native sweep of
> `backend/src/**`, `migrations/`, `database_schema.sql`, `docs/03-architecture/api-contracts/`, `docs/specs/`,
> `docs/04-decisions/`. This is a **point-in-time traceability artifact** — re-run the sweep after each domain lands.

## Purpose
For every **implemented** backend capability (endpoint / guard / invariant / worker), record which artifact
**governs** it along the truth hierarchy (**ADR → `database_schema.sql` → contract → spec**, per the project truth
hierarchy in `CLAUDE.md`), then collect **every place where code, contract, spec and schema diverge**, grouped by
domain.

## Scope
Implemented domains: **Auth**, **Identity**, **Admin/Reference**, plus the **cross-cutting platform**
(`backend/src/lib`, `worker.ts`). All other domains (Animal, Listings, Pet/Livestock, Matching, Moderation, Payment,
Notification, Geo-search, Organization) are **specified and contracted but have no code yet** — tracked as
*contract-ahead-of-code* (see DIV-4 / DIV-6), not enumerated as capabilities here.

Governing-artifact notation: **ADR → schema → contract → spec** — listing the artifact(s) that actually dictate the
capability.

---

## 1. Cross-cutting / Platform (`backend/src/lib`, `worker.ts`)

| Capability | Kind | Governed by |
|---|---|---|
| `JwtAuthGuard` — global, Bearer on every route except `@Public` | guard | spec `security/rbac-matrix.md` ("everything else requires JWT") · `API_CONVENTIONS.md` |
| `OptionalJwtGuard` — soft auth (public read + ADMIN widening) | guard | rbac-matrix (public reads) |
| `RolesGuard` + `roleSatisfies` (USER-tier inherits USER) | guard | **rbac-matrix.md** (roles/inheritance) · `x-required-roles` in contracts |
| `PoliciesGuard` + `AbilityFactory` (CASL, default-deny) | guard | **rbac-matrix.md** (matrix + object-level) · ADR-0006 (AGENT under same matrix) |
| `assertCan` — object-level check at service layer | invariant | rbac-matrix "two-layer enforcement" |
| `IdempotencyInterceptor` (`Idempotency-Key`, 24h) | interceptor | `API_CONVENTIONS.md` |
| `ETag` / `If-Match` / `If-None-Match` (412 / 428 / 304) | util | `API_CONVENTIONS.md` §10 |
| RFC7807 `problem.filter` (`application/problem+json`) | filter | `API_CONVENTIONS.md` |
| `OutboxRelay` — claim-lease-dispatch, exp. backoff, dead-letter | **worker** | schema `outbox_events` (+migration 0012 delivery-state) · spec `event-catalog.md` |
| `audit_log` append-only recording of actions | invariant | **schema** trigger `audit_log_append_only` · ADR-0006 (actor identity) |
| Providers (SMS smsru, email unisender, maps yandex, storage S3/sigv4, payment stub) | adapters | **ADR-0008** (RF provider matrix) · ADR-0001 |
| `feature-toggle` + rollout | gate | ADR-0009 (MVP vs target) · schema `feature_toggles` |

---

## 2. Auth / Session (`modules/auth`)

| Endpoint | Auth | Governed by |
|---|---|---|
| `POST /v1/auth/refresh` | public | spec 01 (family rotation + reuse-detection) · `auth-api.yaml` |
| `POST /v1/auth/logout` | jwt | spec 01 · auth-api.yaml |
| `GET /v1/auth/whoami` | jwt | auth-api.yaml *(diagnostic)* |
| `GET /v1/auth/operator-check` | `@Roles(MODERATOR)` + policy | rbac-matrix · auth-api.yaml *(marked `[test]`)* |
| `POST /v1/auth/dev-token` | public, prod-disabled | **code-only** → **DIV-1** |

**Invariants (code, spec 01 round-4):** access TTL **15m** / refresh **7d** (`env.validation.ts` defaults) · max **5**
active refresh families/user (oldest evicted) · presenting an already-rotated token → revoke the whole `family_id`.

---

## 3. Identity (`modules/identity`)

| Endpoint | Auth | Governed by |
|---|---|---|
| `POST /v1/auth/register/phone` (202, OTP) | public | spec 01 · auth-api.yaml · schema `users.phone_hash` UNIQUE (HMAC) |
| `POST /v1/auth/verify-phone` (200, session) | public | spec 01 · auth-api.yaml |
| `POST /v1/auth/register/oauth/{provider}` (200/201) | public | spec 01 · auth-api.yaml · ADR-0008 |
| `POST /v1/auth/recover/email/request` (202) | public | **spec 01 Slice-4** · auth-api.yaml |
| `POST /v1/auth/recover/email/verify` (200) | public | spec 01 Slice-4 · auth-api.yaml |
| `GET /v1/me` (+ETag/304) | jwt | API_CONVENTIONS · auth-api.yaml |
| `PATCH /v1/me` (If-Match) | jwt | API_CONVENTIONS · auth-api.yaml |
| `POST /v1/me` (deactivate, 30-day grace) | jwt | spec 01 · schema `users.status/deactivated_at` |
| `POST /v1/me/reactivate` | jwt | spec 01 |
| `POST /v1/me/erase` (202, ФЗ-152) | jwt | spec 01 · **data-governance.md** `erase_user` · schema `users.erased_at` (migration 0015) |
| `PATCH /v1/admin/users/{userId}/role` | ADMIN | spec 01 Slice-4 · rbac-matrix · **auth-api.yaml** (not admin-api) → DIV-3 |
| `POST /v1/admin/users/{userId}/rebind` | ADMIN | spec 01 Slice-4 · auth-api.yaml |
| `POST /v1/admin/users/{userId}/erase` (200, idempotent) | ADMIN | spec 01 · data-governance.md · auth-api.yaml |

**Invariants (code, spec 01):** OTP 6 digits, TTL **300s**, cooldown **60s**, **5** attempts → lockout **900s**
(`otp.service.ts`, exactly matches spec) · per-IP throttle register 5/15m, verify 15/15m, oauth 20/15m, recover 5 and
15/15m · role set = 7 canonical roles (code `ROLES` = DB CHECK = auth-api.yaml enum — **consistent**) ·
role-change / erase / rebind → revoke all sessions + audit-log.

---

## 4. Admin / Reference Data (`modules/admin`)

| Endpoint | Auth | Governed by |
|---|---|---|
| `GET /v1/reference-data/{dataset}` (public, Cache-Control) | optional-jwt | rbac-matrix (ref-data R=public) · **admin-api.yaml** |
| `GET /v1/reference-data/{dataset}/new` (form template) | ADMIN | admin-api.yaml |
| `GET /v1/reference-data/{dataset}/{id}` (+ETag) | public | admin-api.yaml |
| `POST /v1/reference-data/{dataset}` (Idempotency-Key) | ADMIN | admin-api.yaml · API_CONVENTIONS |
| `PATCH /v1/reference-data/{dataset}/{id}` (If-Match) | ADMIN | admin-api.yaml |
| `PATCH /v1/reference-data/{dataset}/{id}/toggle-active` (soft-delete) | ADMIN | admin-api.yaml · schema `is_active` |

**Datasets:** code = `species/breeds/cities` (round-9) = admin-api.yaml enum (3) — **consistent**, but ≠ spec 06 →
**DIV-9**.

---

## 5. Schema-enforced invariants (governed by `database_schema.sql` + ADR; consistent with specs)

| Invariant | Mechanism | Governed by |
|---|---|---|
| Animal immutable fields (species_id, sex, date_of_birth, breed_id) + MVP ownership lock | trigger `trg_animals_immutable_and_owner` | ADR-0004 · rbac-matrix object-level |
| Listing ACTIVE requires `moderation_status = APPROVED` | trigger `enforce_listing_active_requires_approval` | **ADR-0003** (pre-moderation) |
| `moderation_decisions` / `audit_log` append-only | triggers `trg_block_modify_append_only` / `audit_log_append_only` | ADR-0003 · ADR-0006 |
| Animal microchip / tattoo uniqueness (anti-fraud) | unique partial indexes | spec 02 |
| breed must belong to animal's species | composite FK `fk_animals_breed_species` | spec 02 |
| one OPEN content report per (reporter, entity) | unique partial index | spec 12 |
| deactivation cascades to live listings (animal & user) | triggers `cascade_*_deactivation` | spec 01 / spec 03 |
| species belongs to exactly one market (pet/livestock) | `species.market` CHECK | **ADR-0002** (hard split) |
| money = integer minor units (non-negative), ISO currency | CHECK constraints | API_CONVENTIONS |

---

# 📋 Divergence ledger (by domain)

### Auth
- **DIV-1 — `/auth/dev-token` exists in code, in no contract.** `auth.controller.ts:62`. Dev-only (404 in prod) but
  undocumented. *Fix:* add to `auth-api.yaml` marked dev-only, or move out of the contracted surface.
- **DIV-5 — test/diagnostic endpoints as first-class contract.** `whoami` and `operator-check` (latter marked
  `[test]` in code) are normal operations in `auth-api.yaml`. *Fix:* mark `x-internal` / drop from public contract.

### Identity
- **DIV-3 — admin identity ops live in `auth-api.yaml`, not `admin-api.yaml`.** `/admin/users/{userId}/role|rebind|erase`
  are contracted in the auth contract. Organizational "contract vs its purpose" mismatch (overlaps DIV-2).
  *Fix (architect):* decide contract ownership; do not duplicate the path.
- **DIV-7 — OAuth provider matrix partially implemented.** Contract enum `[google, apple, telegram, vk]`; code:
  **telegram is real**, google/apple/vk fall back to stub, real adapters deferred to Slice 2b (prod returns 503 on an
  unconfigured provider). Code↔contract partial, tracked in code.

### Admin / Reference
- **DIV-2 — duplicate & contradictory role-change contract.** Role change is defined **twice**:
  `auth-api.yaml /admin/users/{userId}/role` (implemented) **and** `admin-api.yaml /users/{id}/role`
  (`changeUserRole`, **not implemented**). Plus `admin-api.yaml /users/roles` (`getUsersWithRoles`) — not implemented.
  Two contracts disagree on the canonical path/shape. *Fix:* mark `admin-api.yaml /users*` superseded or remove.
- **DIV-4 — `admin-api.yaml` is well ahead of code.** Not implemented: `moderation/queue|listing/{id}|action|log/{listing_id}|ban-user`,
  `system/settings` (get/update), `audit/log`. Expected phasing, but a contract↔code gap — keep in the
  "contract ahead of code" register.
- **DIV-9 — spec 06 ↔ contract/code on datasets.** Spec 06 (lines 17, 69) still lists **5** datasets
  ("species, breeds, cities, **listing types, health statuses**"); contract and code are narrowed to **3** (round-9).
  Spec 06 is stale vs the narrowing. UC-AD-03 features (bulk CSV/JSON import-export, versioning, change-notifications)
  also unimplemented. *Fix (doc-keeper):* sync spec 06 with round-9 (+EN/RU).

### Cross-cutting / AuthZ
- **DIV-6 — `AbilityFactory` is ahead of the implemented surface.** Rules for `Animal, Listing, ModerationDecision,
  ContentReport, Organization, Branch, Notification, Payment, DigitalAsset, Favorite, SavedSearch` are declared, but no
  endpoints/services exist → those rules are **not covered by integration tests**. Intentional (matrix encoded ahead),
  but carries an "untested authz" risk. *Fix:* attach domain tests to each rule as the domain ships.
- **DIV-8 (informational, not a bug) — schema ahead of MVP, but commented.** `conversations`/`messages` (ADR-0005
  no-chat — marked "Фаза 2+ unused"), `digital_assets` (ADR-0010 NFT hooks), `payment_*` (gated by
  `feature_toggles.payments`). Consistent via comments/gates.

---

## Summary
- **Real code↔contract divergences needing a fix:** DIV-1, DIV-2, DIV-9 (+organizational DIV-3).
- **Contract/schema ahead of code (expected phasing, registered):** DIV-4, DIV-6, DIV-8.
- **Partial implementation (tracked):** DIV-7.
- **Contract hygiene:** DIV-5.
- **Fully consistent (strengths):** OTP parameters, refresh-family/TTL, 7-role enum (code = DB = contract),
  reference-dataset enum (code = contract), and all schema invariants (immutable animals, listing-approval gate,
  append-only audit/moderation, content-report dedup, deactivation cascades) — enforced by schema triggers and matching
  the specs.

---

## Related
- Truth hierarchy & doc↔code protocol: `CLAUDE.md`, `IMPLEMENTATION_PLAYBOOK.md`
- Prior audits: `DATABASE_SCHEMA_AUDIT.md` · `EN_RU_CONSISTENCY_AUDIT.md` · `BACKEND_TECH_AUDIT.md` ·
  `BUSINESS_LOGIC_CONSISTENCY_AUDIT.md`
- RBAC source: `docs/specs/security/rbac-matrix.md` · ФЗ-152 erasure: `docs/specs/data-governance.md`
