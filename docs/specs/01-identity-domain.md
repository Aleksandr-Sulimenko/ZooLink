---
version: "1.2"
lastUpdated: "2026-05-28"
author: "Системный аналитик"
status: "Approved"
---

# Spec: Identity Domain

## Outcome
Provide secure authentication and authorization for users of ZooLink, including pet owners, breeders, farmers, moderators, and admins. Enable user registration, login, profile management, and role-based access control.

## Scope & Boundaries
**In Scope:**
- User registration via phone (SMS) and OAuth (Google, Apple, Telegram, VK)
- Email verification (optional)
- Phone verification via SMS code
- JWT-based authentication with refresh tokens
- User profile management (view, update)
- Role and permission management (pet owner, breeder, farmer, moderator, admin)
- Passwordless login (SMS code)
- Session management

**Out of Scope:**
- Social features (chat, forums, etc.) - deferred to phase 2
- Advanced security features (biometrics, hardware keys) - deferred
- Account deletion/gdpr right to be forgotten - deferred to phase 2
- Admin impersonation/support tools - deferred

## Constraints
- **Legal:** Must comply with Russian Federal Law 152-ФЗ (Personal Data) for storing and processing user data.
- **Security:** Passwords not used; authentication via phone/OAuth only. Protect against brute force, SIM swapping (rate limiting on SMS).
- **Usability:** Registration flow must be simple for non-technical users (mass market pet owners).
- **Performance:** Authentication latency < 1s under normal load.
- **Scalability:** System must support 100k+ active users.
- **Technology:** Must align with selected stack (NestJS, TypeScript, PostgreSQL, Redis).
- **Data:** Personal data (phone number, name) must be stored securely and minimally.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Authentication latency < 1s under normal load; auth API latency < 800ms for 95% of requests under load test (100 RPS) (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Passwords not used; authentication via phone/OAuth only; protect against brute force, SIM swapping; data storage adheres to 152-ФЗ (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Registration flow must be simple for non-technical users (mass market pet owners); follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)

## Prior Decisions
- Technology Stack (ADR 0001): NestJS backend, React frontend, PostgreSQL, Redis.
- Authentication method: Phone (SMS) + OAuth providers; email optional.
- No username/password authentication.
- JWTs stored in frontend (httpOnly cookies or local storage with safeguards).
- Role-based access control (RBAC) with roles: USER, BREEDER, FARMER, MODERATOR, ADMIN.
- User entity includes: id, phoneNumber (verified), firstName, lastName, role, createdAt, updatedAt, isActive.

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `identity` module with NestJS CLI
   - [ ] Define User model (Prisma, per [ADR-0007](../04-decisions/0007-orm-strategy.md)) with fields: id, phoneNumber, firstName, lastName, role, isActive, createdAt, updatedAt
   - [ ] Implement phone verification service (SMS via `SmsProvider` port — SMS.RU default, [ADR-0008](../04-decisions/0008-rf-provider-matrix.md))
   - [ ] Implement OAuth verification strategies (Google, Apple, Telegram, VK)
   - [ ] Create AuthController (register, login, refresh, profile)
   - [ ] Create AuthService (validate credentials, generate JWT/refresh tokens)
   - [ ] Create JwtStrategy and RefreshTokenGuard
   - [ ] Implement role-based guards (RolesGuard)
   - [ ] Set up rate limiting for SMS endpoints
   - [ ] Write unit and integration tests for auth flows
   - [ ] Create OpenAPI (Swagger) docs for auth endpoints

2. **Frontend (React)**
   - [ ] Create auth pages: Register, Login, Profile
   - [ ] Implement phone input with country code selection
   - [ ] Implement SMS code verification form
   - [ ] Implement OAuth login buttons
   - [ ] Create auth context/hooks (useAuth, useUser) for state management
   - [ ] Protect routes based on authentication and role
   - [ ] Implement token refresh mechanism
   - [ ] Create user profile view/edit page
   - [ ] Write unit and e2e tests for auth flows

3. **Infrastructure**
   - [ ] Configure Redis for refresh token storage (or use JWT with database refresh tokens)
   - [ ] Set up SMS provider credentials (SMS.RU api_id) in environment
   - [ ] Configure OAuth provider credentials (Google, Apple, etc.)
   - [ ] Add security headers (helmet) and CORS configuration
   - [ ] Implement logging for auth events (success/failure)

## Verification Criteria
- [ ] Unit tests achieve >90% coverage for identity module (backend)
- [ ] Integration tests cover: registration via phone, registration via OAuth, login, token refresh, profile update, role-based access
- [ ] E2E tests (Cypress/Playwright) cover full user flow: registration -> login -> access protected route -> logout
- [ ] Manual testing: verify SMS delivery timing (<10s), OAuth redirect flows work
- [ ] Security review: no sensitive data leaked in responses, tokens are HTTP-only or properly protected
- [ ] Performance: auth API latency < 800ms for 95% of requests under load test (100 RPS)
- [ ] Compliance: data storage adheres to 152-ФЗ (minimal personal data, consent for processing)
- [ ] Documentation: OpenAPI spec generated and available at /api/docs
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented

---

## Account lifecycle, sessions & recovery (round-4, normative)

- **Identifier uniqueness:** `phone_hash` and each `oauth_*` id are **unique** (migration 0008). `phone_hash` is a
  **deterministic HMAC-SHA256(phone, server_pepper)** — NOT bcrypt — so duplicates are detectable. The last-4-digits
  display is stored/derived separately.
- **Auth model:** passwordless for end users (phone OTP + OAuth). `password_hash` is reserved for **operator roles**
  (ADMIN/MODERATOR) only; the password policy/lockout in `security_specification.md` applies **only** to them. The
  canonical access TTL is **15 min** (refresh 7 d) — the "24h" wording elsewhere is superseded.
- **SMS OTP:** 6 digits, TTL 5 min, resend cooldown 60 s, max 5 verify attempts then lockout 15 min;
  `verification_attempts` counts verify attempts and resets on success/TTL.
- **Sessions / refresh:** stored in `refresh_tokens` (family-based rotation). On `/auth/refresh` the presented token is
  rotated (new row, `rotated_from`); **reuse of an already-rotated token revokes the whole `family_id`** (theft
  detection). Max 5 active families/user (oldest evicted). Password/role/status change → revoke all families.
- **Account recovery:** lost phone/OAuth → recovery via a **verified secondary channel** (verified email) with a
  fresh OTP, or an ADMIN-assisted, audit-logged re-binding of the phone/OAuth identifier. (No silent takeover.)
- **Role elevation:** USER → BREEDER/FARMER/VETERINARIAN/GROOMER is **admin-granted/verified**, not self-claimed,
  and audit-logged. Canonical role set = the 7 in the DB CHECK; `auth-api` enum must list all 7.
- **Deactivation vs erasure (ФЗ-152):** `status='DEACTIVATED'` (30-day grace, recoverable) is MVP; the anonymise
  procedure `erase_user` is defined in [data-governance.md](data-governance.md). `status` is the single source of
  truth; `is_active`/`deactivated_at` are derived.

### Recovery, role-elevation & erasure endpoints (Slice-4, normative)
Concrete endpoints implementing the recovery/role/erasure bullets above (contract: `auth-api.yaml`):

| Endpoint | Auth | Behaviour |
|---|---|---|
| `POST /auth/recover/email/request` | public | Sends a 6-digit OTP to the user's **VERIFIED** email. Always 202 (no account enumeration). Same OTP lifecycle as SMS (TTL 5 min, cooldown 60 s, 5 attempts → 15-min lockout), keyed in a separate `recover:email:*` Redis namespace. |
| `POST /auth/recover/email/verify` | public | Validates the OTP → issues a fresh session. SUSPENDED ⇒ 403 (operator-only). DEACTIVATED within grace ⇒ reactivated to ACTIVE; past grace ⇒ 403. Erased account ⇒ not recoverable (email is NULL, so no match). This closes the Slice-3 tracked item "auth path for a logged-out DEACTIVATED account". |
| `PATCH /admin/users/{userId}/role` | ADMIN | Sets `users.role` to any of the 7 canonical roles. Audit-logged (`identity.role_changed`, before/after). **Revokes ALL refresh families** of the target (round-4). Self-demotion of the last ADMIN is allowed in MVP (see Open Questions). |
| `POST /admin/users/{userId}/rebind` | ADMIN | Re-binds exactly one identifier: `newPhone` (re-hashed), or an `oauthProvider`+`oauthId`, or clears an OAuth id. 409 if the new identifier is already taken. Audit-logged (`identity.identifier_rebound`, reason recorded). Revokes all target sessions. No silent takeover — actor is the ADMIN. |
| `POST /admin/users/{userId}/erase` | ADMIN | Runs `erase_user` (data-governance.md §2): anonymise PII, release `phone_hash`/`oauth_*`/`email`, NULL `avatar_url`, redact `notification_logs.recipient/content`, revoke sessions, stamp `erased_at`, status→DEACTIVATED. Idempotent (already-erased ⇒ 200 no-op). Audit `user.erased` retained under legal hold. |
| `POST /me/erase` | user | Self right-to-erasure: deactivates immediately (if ACTIVE) and records the request; the anonymisation runs after the 30-day grace (retention job / ADMIN). MVP has no scheduler — see Open Questions. |

**`erase_user(user_id)` field actions (authoritative — mirrors data-governance.md §1 PII inventory):**
`phone_hash`→NULL, `oauth_google_id`/`oauth_apple_id`/`oauth_telegram_id`/`oauth_vk_id`→NULL, `email`→NULL,
`email_verified`→false, `full_name`→`'[deleted]'` (column is NOT NULL → tombstone, not NULL), `avatar_url`→NULL,
`contact_phone`→NULL, `contact_telegram`→NULL, `contact_prefs`→default (`{"show_phone": true, "show_telegram": false}`),
`last_login_at`→NULL, `notification_prefs`→default, `status`→DEACTIVATED, `is_active`→false,
`deactivated_at`→now() (if unset), `erased_at`→now(). `notification_logs` rows for the user: `recipient`→`'[erased]'`
(column is NOT NULL → tombstone), `content`→NULL. **Retained:** `audit_log`, `moderation_decisions`,
`animal_ownership_history`, `payment_transactions`/`refunds`.

> **ЧТО/ПОЧЕМУ/ПОЧЕМУ ТАК ЛУЧШЕ:** data-governance.md §1 says NULL `phone_hash`/`recipient`, but `users.full_name`
> and `notification_logs.recipient` are `NOT NULL` in `database_schema.sql` (truth hierarchy: schema > spec prose).
> Tombstoning (`'[deleted]'`/`'[erased]'`) satisfies the anonymisation intent without a schema change or a NOT NULL
> violation — the PII is destroyed either way. This is the minimal, schema-honest reconciliation.

> **ЧТО/ПОЧЕМУ/ПОЧЕМУ ТАК ЛУЧШЕ (round-8, normative — contact-PII closure):** added `contact_phone`→NULL,
> `contact_telegram`→NULL and `contact_prefs`→default to the authoritative list. **ЧТО:** the contact-exchange
> columns (ADR-0005, `database_schema.sql` §"Contact exchange") were missing from this list while data-governance.md §1
> already flagged `contact_phone`/`contact_telegram` as "NULL on erasure" — the contract contradicted itself and the
> code under-erased. **ПОЧЕМУ:** these hold the seller's directly-reachable phone/Telegram handle — the most sensitive
> contact PII under ФЗ-152 — and `contact_prefs` is the visibility setting for them; leaving them after erasure is a
> ФЗ-152 right-to-erasure violation the moment contact-exchange ships. **ПОЧЕМУ ТАК ЛУЧШЕ:** it makes the authoritative
> list fully cover data-governance.md §1 (no silent doc↔doc drift), resets `contact_prefs` to its column default by the
> same rule already applied to `notification_prefs` (consistency, no NOT-NULL violation — the column is `NOT NULL`), and
> needs **no schema change** (columns already exist). Latent today (contact-exchange not yet built, columns always NULL)
> but closes the gap before it can leak.

### Phone-OTP activation flow (round-7/Phase-2, normative)
- Registration that sends the OTP in the same request creates the account **directly in
  `PENDING_VERIFICATION`** (the `UNVERIFIED` entry state is transient/internal — the instant before the
  code is sent — and is not persisted by the phone flow).
- On a valid OTP the account goes **`PENDING_VERIFICATION → ACTIVE`** in one step: there is **no
  mandatory profile-completion gate in the MVP**, so the `VERIFIED` state collapses into `ACTIVE`
  ("automatic activation (no profile req)" in [user_state_machine.md](statemachines/user_state_machine.md)).
  `VERIFIED` remains a logical pass-through; if a future profile-completion requirement is added, the
  flow rests at `VERIFIED` until profile is complete.
- `verify-phone` only activates an account in `{UNVERIFIED, PENDING_VERIFICATION}`; a stale OTP can
  never re-activate an `ACTIVE/SUSPENDED/DEACTIVATED` account (race-safety).
- **ЧТО/ПОЧЕМУ/ПОЧЕМУ ТАК ЛУЧШЕ:** collapsing `VERIFIED→ACTIVE` matches the MVP (no profile gate),
  avoids a redundant intermediate write, and keeps the state machine honest about what is actually
  persisted — without removing the `VERIFIED` state needed when a profile gate arrives.

## Related Documents

- [Glossary](glossary.md)
- [User State Machine](statemachines/user_state_machine.md)
- [Auth API](../03-architecture/api-contracts/auth-api.yaml)
- [Organization Domain](11-organization-domain.md)
- [Admin Domain](06-admin-domain.md)
- [Business Requirements](../02-requirements/business-requirements/identity-domain.md)
- 🌐 RU mirror: [docsRU/specs/01-identity-domain.md](../../docsRU/specs/01-identity-domain.md)
