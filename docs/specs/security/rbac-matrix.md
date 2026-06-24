---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Spec: RBAC Permission Matrix (roles × resources)

## Outcome
Make authorization implementable without guessing. Defines the concrete role→resource→action matrix and the
object-level (ownership) rules the backend must enforce via CASL + NestJS Guards ([ADR-0001](../../04-decisions/0001-tech-stack.md),
`security/security_specification.md`). This is the normative source for the `x-required-roles` declarations in the
OpenAPI contracts (`docs/03-architecture/api-contracts/`).

## Roles
`USER` (default), `BREEDER`, `FARMER`, `MODERATOR`, `ADMIN`, `VETERINARIAN`, `GROOMER` (DB `users.role` CHECK).
`principal_type` may be `HUMAN` or `AGENT` ([ADR-0006](../../04-decisions/0006-ai-agents-operate-platform.md)) — an AGENT
holds an operator role (e.g. MODERATOR) and is subject to the same matrix. **AGENT is Фаза 2+ and feature-gated**
(`DEFAULT 'HUMAN'`); agent **service-auth** (scoped service tokens, not phone/OAuth) and the human-only controls
(MFA, concurrent-session limit) being non-applicable to AGENT are deferred to that phase. MVP runs HUMAN only.

BREEDER/FARMER/VETERINARIAN/GROOMER are USER + extra capabilities (breeding visibility, livestock listings, etc.);
they inherit all USER permissions. MODERATOR and ADMIN are operator roles.

## Principles
- **Default deny.** No permission unless granted here (least privilege).
- **Two-layer enforcement.** Coarse role check at the gateway/guard layer; **object-level ownership** check at the
  service layer (defense in depth).
- **Ownership = the actor owns the aggregate** (e.g. `animal.owner_id == user.id`, or via `organization_users` for
  org-owned animals/listings); MODERATOR/ADMIN bypass ownership for their operator scope only.

## Matrix (action: C=create, R=read, U=update, D=delete/deactivate; `own`=only own objects; `—`=denied)

| Resource | USER (+breeder/farmer/vet/groomer) | MODERATOR | ADMIN |
|---|---|---|---|
| **Auth/session** (register, login, refresh, logout) | C/own | C/own | C/own |
| **Own user profile** | R/U/D own | R/U own | R/U/D any |
| **Other user profiles** | R (public fields) | R (full) | R/U/D |
| **User roles / status (suspend)** | — | suspend/unsuspend (per moderation) | C/R/U/D |
| **Animals** | C/R/U/D own | R any | R/U/D any |
| **Animal ownership transfer** | initiate/confirm own (locked in MVP) | R | R/U |
| **Listings** | C/R/U/D own (R any active) | R any (incl. pending) | R/U/D any |
| **Listing moderation decision** | — | C (approve/reject/changes) | C |
| **Moderation queue** | — | R | R |
| **Content reports** | C/own, R own | R/U (resolve) | R/U/D |
| **Conversations/messages** (Фаза 2+) | C/R own | R (for moderation) | R |
| **Organizations / branches** | R; C/U/D if org admin (`organization_users.role_in_org`) | R | C/R/U/D |
| **Organization membership** | manage if org admin | R | C/R/U/D |
| **Reference data** (species, breeds, cities) | R | R | C/R/U/D |
| **Feature toggles / system config** | — | — | C/R/U/D |
| **Notification templates** | — | — | C/R/U/D |
| **Notifications (own)** | R own, manage prefs | R own | R any |
| **Payments / refunds** (Фаза 2+, gated) | C/R own | R | R/U (refund) |
| **Digital assets / NFT** (Фаза 2+, gated) | R own | R | R/U |
| **Audit log** | — | R (own actions) | R all |
| **Favorites / saved searches** | C/R/U/D own | own | own |

## Object-level (ownership) rules — must be enforced at service layer
- **Animal:** mutable only by `owner_id == actor` OR actor is org-admin of `organization_id`. Immutable fields
  (species_id, sex, date_of_birth, breed_id) blocked by trigger regardless of role.
- **Listing:** mutable only by `seller_id == actor` OR org-admin of the listing's `organization_id`.
- **Conversation/message:** visible only to `participant_a_id`/`participant_b_id` (+ MODERATOR for review).
- **Content report:** reporter sees own; MODERATOR/ADMIN see all.
- **Payment:** user sees only own `payment_transactions.user_id == actor`.
- **MODERATOR/ADMIN bypass** ownership only within their operator scope above — never silently for unrelated writes.

## Implementation notes
- Encode as CASL `defineAbilitiesFor(user)`; one ability set per role, composed (BREEDER = USER + extras).
- A `RolesGuard` reads `x-required-roles` (OpenAPI `x-required-roles` / a `@Roles()` decorator); a `PoliciesGuard`
  enforces object-level checks using the loaded resource.
- Public (no-auth) endpoints: register/login/refresh, public listing read, geo-search/geocode, reference-data read.
  Everything else requires a valid JWT.

## Related
- [Security Specification](security_specification.md) · [ADR-0001](../../04-decisions/0001-tech-stack.md) ·
  [Identity Domain](../01-identity-domain.md) · [Admin Domain](../06-admin-domain.md)
- 🌐 RU mirror: [docsRU/specs/security/rbac-matrix.md](../../../docsRU/specs/security/rbac-matrix.md)
