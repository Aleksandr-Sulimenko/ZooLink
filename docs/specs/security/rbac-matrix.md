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
`principal_type` may be `HUMAN` or `AGENT` ([ADR-0006](../../04-decisions/0006-ai-agents-operate-platform.md),
[ADR-0011](../../04-decisions/0011-agent-principal-actor-model.md)) — an AGENT holds an operator role (e.g. MODERATOR)
and is subject to the **same** matrix (`principal_type ⟂ role`, orthogonal). The **FORM** of agent-principal and agent
**service-auth** is laid in now and is forward-compatible (ADR-0011): a source-agnostic principal resolved through a
chain of authenticators inside the monolith (`BearerJwt` now, `AgentServiceToken` added additively later, ADR-0009),
the acting principal snapshotted onto every append-only actor ledger (`audit_log.actor_principal_type`,
`moderation_decisions.actor_principal_type` + `actor_role`), and an env signing-secret (≥32) + in-monolith
rotatable/revocable service-credential form. **Activation of AGENT behaviour is feature-gated and DEFAULT `'HUMAN'`** —
no agent is active, no service token is issued, until the gate is on (mirroring how Payment is gated). The human-only
controls (MFA, concurrent-session limit) being non-applicable to AGENT remain gated with that activation. MVP runs
HUMAN only, but the schema/contract/authz shape is already agent-ready (no future rewrite).

BREEDER/FARMER/VETERINARIAN/GROOMER are USER + extra capabilities (breeding visibility, livestock listings, etc.);
they inherit all USER permissions (additive model). MODERATOR and ADMIN are operator roles. The 7-role set above is
the canon; **SUPER_ADMIN is NOT a `users.role` value** (break-glass/super-admin is modelled outside the enum — ADR-0011 §7).
Org-scoped membership is a separate axis: `organization_users.role_in_org = {OWNER, ADMIN, STAFF, VET}` (MODERATOR is
**not** a valid `role_in_org` — moderation is a platform-operator role, not an org-membership role).

> **(round-7, normative) — agent-principal & service-auth form is laid now (forward-compatible), behaviour gated.**
> **ЧТО:** заменено «agent-service-auth deferred to Фаза 2» на «ФОРМА agent-principal/service-auth закладывается
> сейчас (forward-compatible), АКТИВАЦИЯ поведения AGENT — за feature-gate, DEFAULT HUMAN»; зафиксирован 7-ролевой
> канон, additive-модель, SUPER_ADMIN вне `users.role`, `principal_type ⟂ role`, `role_in_org`={OWNER,ADMIN,STAFF,VET}.
> **ПОЧЕМУ:** append-only ledger'ы (`audit_log`/`moderation_decisions`) необратимы — отсрочка формы актёра =
> переписывание истории (rewrite-test = да); прежняя формулировка «deferred» противоречила правилу фаз
> (`IMPLEMENTATION_PLAYBOOK §5`).
> **ПОЧЕМУ ТАК ЛУЧШЕ:** один authz-путь и одна матрица остаются авторитетными; активация агентов позже = один
> дополнительный authenticator + флаг гейта, без переписывания схемы/контракта/authz; согласовано с ADR-0006
> (immutable audit, scoped credentials) и ADR-0009 (всё внутри монолита); MVP-поведение не меняется (DEFAULT HUMAN).

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
| **Animal ownership transfer** ([ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md)) | current owner initiates/cancels own; named recipient accepts/declines incoming | R | R/U |
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

> **(round-8, normative) — ownership-transfer permissions are the real MVP rules (ADR-0013).**
> **ЧТО:** Заменено «initiate/confirm own (locked in MVP)» на фактические MVP-права: текущий владелец инициирует/отменяет
> свой трансфер; названный получатель принимает/отклоняет входящий; MODERATOR = R, ADMIN = R/U (override). Строка
> одинакова при любом `principal_type` (ADR-0011 §7).
> **ПОЧЕМУ:** «locked in MVP» противоречил апекс-требованию (BR animal-domain:56-61, GAP-TRACE-007), которое
> ратифицировано [ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md): трансфер — в MVP (упрощённый прямой флоу).
> **ПОЧЕМУ ТАК ЛУЧШЕ:** RBAC-матрица перестаёт врать о «заблокированности»; гварды получают однозначные права
> (initiate/cancel = инициатор-владелец, accept/decline = получатель, R/U = ADMIN); owner-lock остаётся защитой
> в глубину (только контролируемый путь через GUC). Согласовано с [ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md) §1/§5.

## Object-level (ownership) rules — must be enforced at service layer
- **Animal:** mutable only by `owner_id == actor` OR actor is org-admin of `organization_id`. Immutable fields
  (species_id, sex, date_of_birth, breed_id) blocked by trigger regardless of role.
- **Ownership transfer** ([ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md)): only the animal's **current
  owner** (the present `owner_id`, or an org-admin of the present `organization_id`) may **initiate** a transfer; only
  the **named recipient** (`to_user_id`/`to_organization_id`) may **accept** or **decline**; only the **initiator** may
  **cancel** a still-`PENDING` transfer. MODERATOR = R, ADMIN = R/U (override). The same matrix row applies regardless of
  `principal_type` (a HUMAN or AGENT principal may initiate/accept; ADR-0011 §7). The DB owner-lock trigger blocks any
  `owner_id`/`organization_id` change **except** through the controlled transfer path (GUC `app.ownership_transfer`).
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
  [ADR-0006](../../04-decisions/0006-ai-agents-operate-platform.md) ·
  [ADR-0011](../../04-decisions/0011-agent-principal-actor-model.md) (agent-principal actor model, role canon) ·
  [ADR-0013](../../04-decisions/0013-mvp-ownership-transfer.md) (MVP ownership transfer authz) ·
  [Identity Domain](../01-identity-domain.md) · [Admin Domain](../06-admin-domain.md)
- 🌐 RU mirror: [docsRU/specs/security/rbac-matrix.md](../../../docsRU/specs/security/rbac-matrix.md)
