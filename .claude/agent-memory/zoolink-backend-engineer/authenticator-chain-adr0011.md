---
name: authenticator-chain-adr0011
description: ADR-0011 §5 authenticator-chain shape + service_credentials form (A0b) — how auth is wired and where to add the agent link
metadata:
  type: project
---

ADR-0011 §5 / A0b (migration 0017) laid the agent-service-auth FORM (behaviour gated, no agent active in MVP).

**Authenticator chain** (in `backend/src/lib/auth/`):
- `request-authenticator.ts` — `RequestAuthenticator` interface (`tryAuthenticate(req): AuthPrincipal | null`) + `REQUEST_AUTHENTICATORS` Symbol DI token. Contract: return `null` if the credential isn't yours (next link tries); throw 401 only if a credential that IS yours is malformed.
- `bearer-jwt.authenticator.ts` — `BearerJwtAuthenticator`, the only live link; holds the exact verify logic previously inline in `JwtAuthGuard` (behaviour-preserving).
- `agent-service-token.authenticator.ts` — `AgentServiceTokenAuthenticator` STUB; NOT in the chain, always returns null. To activate agents later: implement verify against `service_credentials` + `AGENT_SERVICE_SIGNING_SECRET`, then add it to the `REQUEST_AUTHENTICATORS` factory array in `auth.module.ts`.
- `jwt-auth.guard.ts` — now iterates the injected chain (first non-null principal wins → `req.user`, else 401). `@Public`/`@CurrentUser`/RolesGuard/PoliciesGuard untouched.

Chain is bound in `modules/auth/auth.module.ts` via a `useFactory` for `REQUEST_AUTHENTICATORS` injecting `[BearerJwtAuthenticator]`. `OptionalJwtGuard` was NOT migrated (it still calls TokenService directly — soft auth on @Public routes; fine for MVP).

**Why this shape:** the authz subject is already agent-agnostic, so adding agents = one extra authenticator, not a guard/RBAC/CASL rewrite. Source-agnostic `AuthPrincipal {userId, role, principalType}`.

**service_credentials table** (migration 0017): hashed-secret store keyed to AGENT principal. `agent_user_id FK users(id) ON DELETE RESTRICT` (mirrors agent-lifecycle = deactivate-not-delete), `secret_hash` only (no plaintext), `is_active`/`revoked_at` (revoke), `rotated_from` self-FK (rotation chain). Partial index `idx_service_credentials_agent_active`. FORM ONLY — not populated in MVP.

**env:** `AGENT_SERVICE_SIGNING_SECRET` in `env.validation.ts` — optional+min32-when-present in dev/test; prod-required enforced by an explicit check inside `validateEnv()` (not a zod refine, to keep `envSchema` a plain ZodObject). `.env.example` is at REPO ROOT (`/home/asulimenko/Project/workspace/ZooLink/.env.example`), NOT under backend/.

Tests: `jwt-auth.guard.spec.ts` covers chain order/fallthrough/401 + Bearer extraction + stub-returns-null. 174 unit + 41 e2e green after refactor.

Related: [[adr-0011-actor-snapshot-invariants]].
