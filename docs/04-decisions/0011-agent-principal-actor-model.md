# ADR-0011: Agent-Principal Actor Model — snapshotting the acting principal, human-override, and forward-compatible service-auth

**Status**: Accepted
**Date**: 2026-06-23
**Amends**: [ADR-0006](0006-ai-agents-operate-platform.md) (does not rewrite or supersede it — adds the concrete actor-recording form ADR-0006 declared "directional").
**Related**: [ADR-0009](0009-mvp-vs-target-architecture.md) (modular monolith), [ADR-0003](0003-pre-moderation-workflow.md), [ADR-0001](0001-tech-stack.md).

## Context and Problem Statement

ADR-0006 made AI agents first-class principals (`users.principal_type HUMAN|AGENT`) a directional, baked-in decision, but left the *concrete actor-recording form* to be specified at implementation time. The cross-check that produced `ADMIN_PHASE_ACTION_PLAN.md` (v1.1) found this gap is now load-bearing and **irreversible if deferred**:

- **C1 🔴 (6 independent agents):** the two append-only actor ledgers — `audit_log` and `moderation_decisions` — do **not** record *what kind of principal* acted at the moment of the action. Because both are append-only (immutability triggers already enforce this), a row written today with no `principal_type` can **never** be backfilled truthfully later: we will not be able to distinguish a human decision from an agent decision made before the column existed. ADR-0006's own "avoid painful retrofits" driver applies most acutely here.
- **C2/C5 🔴:** `rbac-matrix.md` currently says agent service-auth is "deferred to Фаза 2", which contradicts the phasing rule (`IMPLEMENTATION_PLAYBOOK.md §5`): the *form* of an actor/authz model that any future phase would otherwise force a rewrite of must be laid now; only *behaviour* is gated.
- There is no defined form for **human-override** of an agent decision, even though ADR-0006 §71 declares "every agent action is reversible" a non-negotiable.

This ADR fixes the *form* (schema shape, normative API rule, authenticator-chain shape, agent lifecycle) so that activating AGENT behaviour later (per ADR-0006's phased autonomy P-A…P-D) requires **no schema, contract, actor, or authz rewrite**. Behaviour stays gated; the form ships now.

The phasing rule was applied as the decision gate throughout: *irreversible-or-rewrite-forcing → now; behaviour → behind a forward-compatible gate, default HUMAN.*

## Decision Drivers

1. **Irreversibility of append-only ledgers** — `audit_log`/`moderation_decisions` immutability triggers mean a missing actor attribute is permanent data loss; this is the single strongest driver (the "rewrite test" returns *yes, rewrites history*).
2. **ADR-0006 non-negotiables** — accountable human/legal entity, reversible agent actions, immutable audit, least-privilege scoped agent credentials. The form must make all four expressible.
3. **Phasing rule (`§5`)** — form now if deferral forces a future schema/contract/actor/authz rewrite; behaviour behind a real gate (`DEFAULT 'HUMAN'`, mirroring how Payment is gated by `feature_toggles.payments`).
4. **ADR-0009 (modular monolith)** — agent service-auth is a principal/guard concern **inside** the monolith, not a separate service; no microservice boundary is introduced now.
5. **Compliance (ФЗ-152, prohibited-content)** — audit must let a regulator/operator reconstruct *who or what* decided, and trace any human reversal of an agent.
6. **MVP non-disruption** — MVP runs HUMAN-only; the snapshot defaults to `HUMAN`, no agent is active, no flow changes shape.

---

## §1 — Actor `principal_type` snapshot on append-only ledgers

**Considered options**

### Option 1: Join to `users.principal_type` at read time (no snapshot column)
Read the actor's current `principal_type` from `users` when displaying an audit/moderation row.

Pros:
- No schema change; one source of truth.

Cons:
- **Wrong by construction.** `users.principal_type` is mutable account state *as of now*; the ledger must record state *as of the action*. An account that was HUMAN when it decided and is later converted to AGENT (or vice-versa) would rewrite history on every read. Defeats the entire append-only guarantee.
- Breaks if the actor account is later erased (`erased_at`, ФЗ-152) or the FK is `SET NULL`.

### Option 2: Snapshot `actor_principal_type` onto each ledger row at write time (Chosen)
Add `actor_principal_type` to `audit_log` and `moderation_decisions`, written at insert from the acting principal, never updated (append-only trigger already blocks UPDATE/DELETE).

Pros:
- Truthful, permanent, regulator-reconstructable record of who/what acted at the moment.
- Zero behaviour change in MVP (defaults to `HUMAN`).
- Cheap now, impossible-to-backfill-truthfully later — exactly the case the phasing rule says "do now".

Cons:
- Minor denormalisation (one VARCHAR per row); acceptable for an audit ledger where denormalised snapshots are the correct pattern.

### Option 3: Defer to Phase 2 with the agent rollout
Add the column only when agents go live.

Cons:
- Every HUMAN row written between now and then is permanently un-attributable as "this was definitely a human" vs "unknown" — poisons the historical record the moment a single agent acts. Fails the rewrite test.

**Decision:** Option 2.

**ЧТО:** Add an append-only, write-time snapshot column `actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (... IN ('HUMAN','AGENT'))` to `audit_log` and `moderation_decisions`.
**ПОЧЕМУ:** An append-only ledger must record actor state *as of the action*, not as joined-now; a missing attribute on an immutable row is unrecoverable.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** Directly satisfies ADR-0006's "immutable audit" + "avoid painful retrofits" drivers and ФЗ-152 reconstructability; costs one nullable-defaulted column now versus a permanent hole in history later; no MVP behaviour change (`DEFAULT 'HUMAN'`); neighbouring Moderation/Admin domains read a single truthful field instead of an unsafe join. Alternative (read-time join) was rejected as wrong-by-construction.

---

## §2 — Actor `actor_role` snapshot

`audit_log` already has `actor_role VARCHAR(20)`. `moderation_decisions` does **not** — it has only `moderator_id`. The same snapshot logic applies: the role the actor held *when they decided* must be frozen, because `users.role` is mutable (role-elevation exists — Identity Slice 4).

**Decision:** Add `actor_role VARCHAR(20)` (nullable, snapshot at write) to `moderation_decisions`, mirroring `audit_log`. Not constrained by CHECK to the role enum at the column level (it is a historical snapshot, and the role enum may evolve across ADRs; a too-tight CHECK would itself become a rewrite point). It records whatever role string the actor held.

**ЧТО:** `moderation_decisions.actor_role VARCHAR(20)` snapshot column.
**ПОЧЕМУ:** `users.role` is mutable; a moderation decision must permanently show the role under which it was made.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Parity with `audit_log` (consistent actor-snapshot shape across both ledgers), supports accountability/audit reconstruction, no CHECK coupling to a still-evolving role enum (forward-compatible). Alternative (rely on join to `users.role`) rejected for the same reason as §1 Option 1.

---

## §3 — Human-override of an agent decision = new append-only row (not a mutation)

Locked owner decision (`ADMIN_PHASE_ACTION_PLAN.md` Owner-decisions #4, 2026-06-23): **human-override is a new append-only row referencing the superseded one — never a mutation, never a flag-on-the-old-row.**

**Considered options**

### Option 1: Mutate the original decision (add `overridden` flag / change `decision`)
Cons: violates the append-only trigger; destroys the original agent decision; un-auditable. Rejected outright (contradicts ADR-0006 immutable-audit non-negotiable).

### Option 2: New append-only row + `supersedes_decision_id` + `is_human_override` (Chosen, locked)
The human inserts a fresh `moderation_decisions` row carrying their own `moderator_id` (a HUMAN principal), `actor_principal_type='HUMAN'`, `is_human_override=TRUE`, and `supersedes_decision_id` → the agent's row. Both rows remain forever. The chain agent→human is fully reconstructable.

Pros:
- Preserves the full decision chain; both the agent's and the human's act are immutable record.
- Satisfies "reversible + immutable audit" together.
- The override is itself a first-class, audited principal action (carries its own actor snapshot).

Cons:
- Read side must resolve "latest effective decision" by following `supersedes_decision_id` (a self-referential lookup); acceptable and a standard event-sourcing-style read.

**Decision:** Option 2.

**ЧТО:** Add to `moderation_decisions`: `supersedes_decision_id UUID NULL REFERENCES moderation_decisions(id) ON DELETE RESTRICT` and `is_human_override BOOLEAN NOT NULL DEFAULT FALSE`.
**ПОЧЕМУ:** A human reversing an agent must not erase the agent's record; the reversal is a new accountable act linked to the original.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Makes ADR-0006's "every agent action is reversible AND recorded in immutable audit" simultaneously true; gives regulators/operators the full agent→human chain; reuses the existing append-only trigger instead of weakening it; the `supersedes` link is the minimal forward-compatible form for P-A…P-D autonomy rollout. Owner-locked — not reopened here.

**Normative override rules:**
- An override row's `actor_principal_type` MUST be `HUMAN` and `is_human_override` MUST be `TRUE` (enforced in service layer; see Migration spec for the partial invariant tested).
- `supersedes_decision_id` MUST point to an existing decision on the **same** `(entity_type, entity_id)`.
- A row with `is_human_override=TRUE` MUST have a non-NULL `supersedes_decision_id` (and vice-versa: a non-NULL `supersedes_decision_id` marks an override). This biconditional is the negative-test invariant.

---

## §4 — Agent lifecycle = deactivation, not deletion

**Decision:** An agent principal is an account (`users` row with `principal_type='AGENT'`). It is retired by **deactivation** (`status='DEACTIVATED'` / `is_active=FALSE` / `deactivated_at`), never by row deletion.

**ЧТО:** Normative rule: agent accounts follow the existing user lifecycle state machine; retirement = DEACTIVATED, never DELETE.
**ПОЧЕМУ:** Agent decisions are referenced by `moderation_decisions.moderator_id` (FK `ON DELETE RESTRICT`) and `audit_log.actor_id`; deleting the account would orphan or `SET NULL` the immutable trail and destroy accountability.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Preserves audit integrity and the accountable-entity chain (ADR-0006 non-negotiable) with **zero new schema** — reuses the existing user state machine and FK semantics. Forward-compatible: a future per-agent `agents` metadata table (ADR-0006 §93, deferred to P-A) can attach to the same UUID without changing this rule.

---

## §5 — Agent service-auth FORM (source-agnostic principal via authenticator chain) — inside the monolith

Locked canon: agent-service-auth is a **principal/guard concern inside the monolith** (ADR-0009). Form now; behaviour gated.

**Considered options**

### Option 1: A second, parallel guard for agents
Cons: duplicates authz logic; two code paths drift; the matrix would have to be applied twice. Rejected.

### Option 2: Source-agnostic principal resolved by a chain of authenticators behind one guard (Chosen)
The guard resolves a **single principal abstraction** (`{ actor_id, principal_type, role, ... }`) regardless of *how* the request authenticated. Authentication is factored out of `JwtAuthGuard` into an ordered chain of `RequestAuthenticator`s:
- `BearerJwtAuthenticator` — **present now** (human end-users + operators via phone-OTP/OAuth JWT).
- `AgentServiceTokenAuthenticator` — **added additively later** (scoped service token for an AGENT principal); slots into the same chain, returns the same principal shape, behaviour behind the AGENT gate.

Everything downstream (RBAC matrix, CASL abilities, object-level ownership, actor snapshotting in §1–§3) consumes the principal abstraction and is **already source-agnostic** (cross-check C4 confirmed the authz subject is agent-agnostic today). So adding agents later is **one additional authenticator**, not a guard/authz rewrite.

Pros:
- No future rewrite of guards, RBAC, or actor-recording; agents plug in additively.
- One authz path, one matrix, defense-in-depth unchanged.
- Honours ADR-0009: all inside the monolith, no service boundary.

Cons:
- Small upfront refactor to extract the authenticator chain (form work, A0b).

**Decision:** Option 2.

**Form to lay now (this ADR is the architectural decision; backend implements in A0b):**
1. **Authenticator chain shape** — extract authentication from `JwtAuthGuard` into an ordered `RequestAuthenticator` chain producing a source-agnostic principal `{ actor_id, principal_type, role }`. `BearerJwt` now; `AgentServiceToken` is an additive future link. No behaviour change for HUMAN.
2. **Env signing-secret form** — a service-credential signing secret env var, **minimum length ≥ 32** (validated at boot, same discipline as existing secrets); declared in `.env.example`. Present as form; no agent token is issued until the AGENT gate is on.
3. **Service-credential storage / rotation / revoke form** — service credentials for an AGENT principal are stored, rotatable, and revocable **inside the monolith** (e.g. a hashed-secret column/table keyed to the agent's `users.id`, with rotation = issue-new + revoke-old, revoke = mark inactive). This ADR fixes that the form lives in-monolith and is rotatable/revocable; the exact table/columns are specified in the Migration spec as a *forward-compatible stub*, gated, not populated in MVP. (Detailed credential-store schema may be finalised with backend at P-A; this ADR forbids a separate auth service and forbids an un-rotatable/un-revocable design.)

**ЧТО:** Source-agnostic principal via authenticator chain inside the monolith; env signing-secret (≥32) form; rotatable/revocable in-monolith service-credential form. Behaviour gated.
**ПОЧЕМУ:** The authz subject is already agent-agnostic; the only real gap is *how the principal is authenticated* and *where agent credentials live* — laying these as form now avoids a guard/authz/secret rewrite when P-A activates.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Maximally cheap forward-compat (one authenticator added, not a subsystem rewritten); keeps a single authz path and the one RBAC matrix authoritative; honours ADR-0009 (no premature service split); rotation/revoke baked into the form satisfies least-privilege + ADR-0006 "scoped credentials" non-negotiable. Alternative (parallel agent guard) rejected as drift-prone duplication.

---

## §6 — Normative rule: every actor-bearing response/event carries `{actor_id, principal_type}`

**Decision (normative, platform-wide):** Any API response or domain event that names an actor (moderation decisions, audit entries, admin actions, and any future actor-stamped payload) MUST carry the actor as `{ actor_id, principal_type }` (the "agent-badge" shape), not bare `actor_id`. This is the contract-level mirror of the §1 schema snapshot.

This rule is **owned here** and **applied** by the contract owners: `API_CONVENTIONS.md` records it as a convention (plan B0.6), and the affected `*.yaml` contracts (moderation, audit, admin) adopt the shape. This ADR does not edit contracts (other agents own those files); it establishes the binding rule they must implement.

**ЧТО:** Normative API/event rule — actor is always `{actor_id, principal_type}`.
**ПОЧЕМУ:** A consumer (operator UI, downstream service, regulator export) must be able to tell human-decided from agent-decided without a second lookup; the response form must match the truthful schema snapshot.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Closes the loop schema↔contract (the snapshot is useless if the API hides it); forward-compatible (the `principal_type` field is `HUMAN` for all MVP responses, so adopting it now costs nothing and avoids a breaking contract change when agents appear); supports the deferred product question of whether end-users see "decided by AI" (Owner-decision #5, open) — the data is present regardless of the display choice.

---

## §7 — Role canon (A1): 7 roles, additive model, `principal_type ⟂ role`, SUPER_ADMIN out of `users.role`

This consolidates the role canon here so it is not duplicated across docs (plan A1 asks architect to anchor it in ADR-0011).

**Locked canon (not reopened):**
- **`users.role` = exactly 7 roles:** `USER, MODERATOR, ADMIN, BREEDER, FARMER, VETERINARIAN, GROOMER` (matches `database_schema.sql` line 109 CHECK).
- **Additive model:** `BREEDER/FARMER/VETERINARIAN/GROOMER = USER + extra capabilities` (inherit all USER permissions). `MODERATOR`/`ADMIN` are operator roles. CASL composes ability sets additively (per rbac-matrix implementation notes).
- **SUPER_ADMIN is NOT a `users.role` value.** Any super-admin / break-glass capability is modelled outside the `users.role` enum (e.g. a separate operator-elevation mechanism). Adding `SUPER_ADMIN` to the enum is rejected — it would conflate a privilege-escalation control with the role taxonomy.
- **`principal_type ⟂ role` (orthogonal invariant).** `principal_type` (HUMAN|AGENT) is independent of `role`. Any of the 7 roles may, in principle, be held by either principal type; the operator roles (MODERATOR, later ADMIN) are the ones ADR-0006 targets for AGENT. The matrix applies identically regardless of `principal_type`. This invariant is anchored **here** and MUST NOT be duplicated as schema CHECKs coupling the two columns (that coupling would itself be a rewrite point).
- **Org-scoped roles are a separate axis:** `organization_users.role_in_org = {OWNER, ADMIN, STAFF, VET}` — **not** the same enum as `users.role`, and **MODERATOR is NOT a valid `role_in_org`** (moderation is a platform-operator role, not an org-membership role).

**`role_in_org` duplicate-definition hygiene (schema gap → backend migration-spec):**
`database_schema.sql` defines `role_in_org` inconsistently:
- Line **79** (inline CREATE TABLE CHECK): includes `'MODERATOR'` — `CHECK (role_in_org IN ('OWNER','ADMIN','STAFF','VET','MODERATOR'))`.
- Line **986** (ALTER, named `chk_org_user_role`): **drops MODERATOR** — `CHECK (role_in_org IN ('OWNER','ADMIN','STAFF','VET'))`.
- Comment line **722**: still says "OWNER, ADMIN, STAFF, VET, MODERATOR".

The named constraint at :986 is the *effective* runtime state (it runs after the inline one) and is the correct canon (no MODERATOR). The inline CHECK and the comment are stale and contradictory. The canonical 4-value set must be made the single source of truth and the stale text removed. This is a backend migration-spec item (see Migration spec §D).

**ЧТО:** Anchor the 7-role canon, additive model, SUPER_ADMIN-out-of-enum, `principal_type ⟂ role`, and the 4-value `role_in_org` canon; flag the schema:79/:722 vs :986 contradiction for backend remediation.
**ПОЧЕМУ:** The role canon was drifting across identity-BR/admin-BR/org-BR and the schema has a live self-contradiction in `role_in_org`; a single normative anchor prevents re-litigation and a wrong CHECK shipping.
**ПОЧЕМУ ТАК ЛУЧШЕ:** One source of truth (this ADR + schema CHECK) instead of N drifting copies; keeps `principal_type` orthogonal (no brittle cross-column CHECK that future agent roll-out would have to unwind); fixes a real correctness bug (two contradictory CHECKs + a misleading comment) before Admin Slice 2-4 builds authz on top of it. The 4-value `role_in_org` is the safe canon (operator-moderation must not be grantable as an org membership).

---

## Migration spec (for `zoolink-backend-engineer` — this ADR does NOT write the migration or edit `database_schema.sql`)

Follow `IMPLEMENTATION_PLAYBOOK.md §3` DB-workflow: edit `database_schema.sql` + new idempotent migration `migrations/YYYYMMDD_NNNN_*.sql` + `ZooLink_ERD.mmd` + `docs/03-architecture/data-model.md` + table/migration counters in both `CLAUDE.md` files; run twice on live PG; add negative tests; then `npm run db:sync`. EN↔RU not applicable to SQL but data-model.md prose must mirror.

### §A — `audit_log`
- `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (actor_principal_type IN ('HUMAN','AGENT'));`
- Idempotent (`ADD COLUMN IF NOT EXISTS`; the CHECK rides with the column add — if re-run on an existing column it is a no-op).
- No backfill needed: existing rows correctly default to `HUMAN` (the MVP truth).
- `actor_role` already exists — no change.

### §B — `moderation_decisions`
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK (actor_principal_type IN ('HUMAN','AGENT'));`
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS actor_role VARCHAR(20);` (nullable snapshot; no enum CHECK — see §2).
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS supersedes_decision_id UUID REFERENCES moderation_decisions(id) ON DELETE RESTRICT;`
- `ALTER TABLE moderation_decisions ADD COLUMN IF NOT EXISTS is_human_override BOOLEAN NOT NULL DEFAULT FALSE;`
- **Biconditional invariant (§3)** — enforce that `is_human_override` and `supersedes_decision_id` are non-NULL together, via a table CHECK:
  `ADD CONSTRAINT chk_moddec_override CHECK ( (is_human_override = TRUE AND supersedes_decision_id IS NOT NULL) OR (is_human_override = FALSE AND supersedes_decision_id IS NULL) )` — add with `DROP CONSTRAINT IF EXISTS chk_moddec_override` first for idempotency.
- Optional index for override-chain reads: `CREATE INDEX IF NOT EXISTS idx_moddec_supersedes ON moderation_decisions(supersedes_decision_id) WHERE supersedes_decision_id IS NOT NULL;`
- The existing append-only immutability trigger is unchanged and now also protects the new columns.
- **Service-layer rule** (not a DB CHECK, since it spans rows): an override row's `actor_principal_type` MUST be `HUMAN`, and its `supersedes_decision_id` MUST reference a decision with the same `(entity_type, entity_id)`.

### §C — Agent service-credential form (§5.3) — forward-compatible stub, gated, NOT populated in MVP
Backend + architect to finalise exact shape at A0b/P-A. Minimum forward-compatible form:
- A hashed-secret store keyed to the agent `users.id`, supporting **rotation** (issue-new + revoke-old) and **revoke** (mark inactive). Either a `service_credentials` table (`id`, `agent_user_id FK users(id) ON DELETE RESTRICT`, `secret_hash`, `is_active`, `created_at`, `revoked_at`) or an equivalent in-monolith form. No plaintext secrets at rest.
- **Do not** create this as part of A0a if it risks scope-creep; A0a's hard requirement is §A + §B. The credential-store is A0b. This ADR only forbids: (a) a separate auth service, (b) an un-rotatable/un-revocable design, (c) plaintext secret storage.
- Env: `AGENT_SERVICE_SIGNING_SECRET` (or equivalent) length-validated ≥32 at boot; add to `.env.example`. Form only; unused while AGENT gate is off.

### §D — `role_in_org` canon hygiene (§7)
- Make the **4-value** set canonical and remove the contradiction:
  - Update inline CREATE TABLE CHECK at line ~79 to drop `'MODERATOR'` (so the source-of-truth file matches the effective named constraint).
  - Keep/confirm named `chk_org_user_role` at ~986 as the 4-value set (already correct).
  - Fix the stale COMMENT at line ~722 to read `'OWNER, ADMIN, STAFF, VET'`.
- Idempotent: `DROP CONSTRAINT IF EXISTS chk_org_user_role; ADD CONSTRAINT chk_org_user_role CHECK (role_in_org IN ('OWNER','ADMIN','STAFF','VET'));` (already the migration form) — the inline edit is a source-file consistency fix, not a runtime change.

### §E — Negative tests (DoD)
1. **append-only:** `UPDATE`/`DELETE` on `audit_log` and `moderation_decisions` (including the new columns) is rejected by the immutability trigger.
2. **principal snapshot:** an AGENT principal can write a `moderation_decisions` row with `actor_principal_type='AGENT'` (passes the guard once gate on — test the schema accepts it); a row defaults to `HUMAN` when not specified.
3. **override invariant:** inserting `is_human_override=TRUE` with NULL `supersedes_decision_id` is rejected by `chk_moddec_override`; and `is_human_override=FALSE` with a non-NULL `supersedes_decision_id` is rejected.
4. **override actor is human:** service-layer test that an override row is rejected if `actor_principal_type != 'HUMAN'`.
5. **role canon:** `users.role='SUPER_ADMIN'` is rejected (CHECK); `organization_users.role_in_org='MODERATOR'` is rejected by `chk_org_user_role`.
6. **idempotency:** run the migration twice on live PG — second run is a clean no-op (all `IF NOT EXISTS` / `DROP…IF EXISTS` guarded).

### ERD / data-model
- `ZooLink_ERD.mmd`: add the new `moderation_decisions` columns (incl. the self-referential `supersedes_decision_id` → `moderation_decisions`) and `audit_log.actor_principal_type`.
- `docs/03-architecture/data-model.md`: document the actor-snapshot pattern, the override-chain, and the agent service-credential stub (gated).
- Table count: +0 if credential-store is deferred to A0b (only columns added in A0a); +1 if `service_credentials` is created at A0b. Update counters accordingly when the table actually lands.

---

## Consequences

### Positive
- Append-only ledgers become truthful about human-vs-agent for all time; ADR-0006's immutable-audit/avoid-retrofit drivers satisfied at the latest cheap moment.
- Human-override is a first-class, fully-audited, reversible act (owner-locked form).
- Activating agents later (P-A…P-D) is additive: one authenticator + flipping a gate, with no schema/contract/authz rewrite.
- Role canon has a single normative anchor; a live schema contradiction (`role_in_org`) is scheduled for fix before Admin authz is built on it.

### Negative
- Minor denormalisation (snapshot columns) and a small authenticator-chain refactor (A0b).
- Read side must resolve the override chain via `supersedes_decision_id`.

### Neutral
- MVP behaviour unchanged: everything defaults to `HUMAN`; no agent active; no agent token issued.
- The detailed `service_credentials` schema is intentionally finalised with backend at A0b/P-A; this ADR fixes only its non-negotiable properties (in-monolith, rotatable, revocable, hashed).

## Related Decisions
- [ADR-0006](0006-ai-agents-operate-platform.md) — amended (concrete actor form for the directional decision).
- [ADR-0009](0009-mvp-vs-target-architecture.md) — agent service-auth stays inside the monolith.
- [ADR-0003](0003-pre-moderation-workflow.md) — moderation is the first agent target; this ADR shapes its decision ledger.
- [ADR-0001](0001-tech-stack.md) — NestJS guards/authenticator chain, CASL abilities.

## References
- `ADMIN_PHASE_ACTION_PLAN.md` v1.1 — phases A0a/A0b/A1, Owner-decisions #4 (human-override form locked 2026-06-23), cross-check findings C1/C2/C4/C5.
- `IMPLEMENTATION_PLAYBOOK.md` §3 (DB-workflow), §5 (phase-boundary / rewrite test).
- `database_schema.sql` — `users` (line 109 role enum, 112 principal_type), `moderation_decisions` (~374, append-only trigger ~396), `audit_log` (~1081, append-only trigger ~1099), `organization_users.role_in_org` (79 / 722 / 986).
- `docs/specs/security/rbac-matrix.md` — agent-principal/service-auth form (this ADR rewrites §Roles narrative there).
