# ADR-0037: Scoped-ability for AGENT principals — deny-by-default, no `manage:all`, effective = role-matrix ∩ scope

**Status**: Accepted (owner, 2026-07-09 — §2 storage decided as **Option B** by owner override: named capability-profiles from the start; see §2 Decision)
**Date**: 2026-07-08
**Amends / refines**: [ADR-0011](0011-agent-principal-actor-model.md) §7 (`principal_type ⟂ role`) — refines the orthogonality invariant for the *authorization layer*: the role→ability **matrix is the ceiling**; an AGENT's **effective** abilities are that ceiling **intersected with an explicit least-privilege scope**. Does **not** rewrite/supersede ADR-0011 and introduces **no** cross-column schema CHECK coupling role and principal_type (which ADR-0011 §7 forbids).
**Related**: [ADR-0006](0006-ai-agents-operate-platform.md) (non-negotiable #4 = scoped, least-privilege permissions; #3 = human override), [ADR-0036](0036-agent-credential-issuance.md) (the credential/JWT that carries the scope), [ADR-0022](0022-multi-role-user.md) (dormant-form-first precedent, migration 0034), the RBAC matrix `docs/specs/security/rbac-matrix.md`.
**Audit trigger**: AUDIT4 **P1-6** *"[NS] AGENT scoped by human role only — AGENT+ADMIN inherits `manage:all`; no scoped-ability seam → any agent operator-power unsafe"* (⇊converged security + architect); `AUDIT4/security.md` §STRATEGIC FC-2 (`ability.factory.ts:46-84`); `AUDIT4/architect.md` §4a scorecard (scoped-ability BLOCKED).

---

## Context and Problem Statement

`AbilityFactory.createForPrincipal` (`backend/src/lib/auth/ability.factory.ts:51`) scopes a principal **purely by its human `role`**:

```ts
case 'ADMIN':
  can('manage', 'all'); // full operator scope
```

Because ADR-0011 §7 makes `principal_type ⟂ role` (an AGENT may hold any role), an AGENT account issued `role='ADMIN'` inherits **platform-wide `manage:all`** — every action on every subject — with **no agent-specific bound**: no least-privilege scope, no blast-radius cap, no per-capability limit. AUDIT4 code-verified this and rated it P1-6 / `[NS]` BLOCKED: *"do not grant any AGENT operator-power on the current model"* — an autonomous operator-agent on this model is either powerless (no creds — fixed by [ADR-0036](0036-agent-credential-issuance.md)) or **over-powered** (inherits the human role's full authority).

This is not exploitable *today* (no AGENT is active; the [ADR-0036](0036-agent-credential-issuance.md) master gate is off). It is a **forward-compat / cost-of-change** defect: the moment agent auth activates before this seam exists, an agent operator has admin-wide power. AUDIT4 §4c #4 says fix the *form* now — cheapest before Admin Slice 2 hard-wires the human-only assumption, and it is the exact generalization AUDIT4/architect #2 asks for ("promote the moderation safety pattern to a cross-cutting agent-operable-action contract").

The ADR-0006 non-negotiable #4 ("agents have scoped, least-privilege permissions") and ADR-0011 §5/§C ("least-privilege scoped agent credentials") already **require** this; the gap is that the requirement was never localized in the ability layer. This ADR closes it: a **deny-by-default, explicitly-scoped** ability model for AGENT principals that never grants the `manage:all` wildcard, preserves human override, and is compatible with the existing RBAC matrix and `x-required-roles`.

**Reconciliation with ADR-0011 §7.** ADR-0011 §7 says "the matrix applies identically regardless of `principal_type`" and forbids coupling the two columns in schema. That orthogonality is about **role semantics** — an AGENT-MODERATOR and a HUMAN-MODERATOR are governed by the *same* role→ability matrix; it does **not** mean an AGENT gets the role's authority unconditionally. This ADR keeps role semantics identical (the matrix is unchanged and is the ceiling for both) and adds, purely in the **authorization layer** (not schema), that an AGENT's *effective* grant = `matrix(role) ∩ scope`, deny-by-default. No cross-column CHECK is introduced. Hence: a **refinement/amendment** of §7 for the authz layer, not a contradiction.

## Decision Drivers

1. **Least-privilege / blast-radius (ADR-0006 #4, ADR-0011 §5/§C)** — an autonomous operator-agent must have the narrowest authority for its job and a bounded, killable blast radius. Highest driver.
2. **No silent over-grant (AUDIT4 P1-6)** — `manage:all` must be **unreachable** for an AGENT, by construction, even at `role='ADMIN'`.
3. **Human override preserved (ADR-0006 #3, ADR-0011 §3)** — a human can always supersede an agent decision and always out-authorizes an agent; scope never blocks human control.
4. **One authz path (ADR-0011 §5)** — no parallel agent ability factory; the intersection lives in the single `AbilityFactory` consumed by the one `PoliciesGuard`.
5. **Compatibility with the RBAC matrix + `x-required-roles`** — the coarse role gate (`RolesGuard`) stays; scope is an *additional* fine-grained narrowing, never a widening.
6. **Dormant-form-first (ADR-0022 / migration 0034 precedent, `IMPLEMENTATION_PLAYBOOK.md §5`)** — HUMAN behaviour byte-identical; the AGENT branch is dormant until an agent is provisioned; ship the seam, not live behaviour.
7. **Generalize the proven pattern (AUDIT4/architect #2)** — moderation is the READY reference (`agent_moderation` toggle + snapshot + override); the scope model must map cleanly onto it and extend to admin/report next.

---

## §1 — The scope seam: deny-by-default AGENT branch, effective = matrix(role) ∩ scope

**Considered options**

### Option 1: Keep matrix-identical; rely only on the per-domain `agent_<domain>` toggles
Leave `AbilityFactory` as-is; bound agents solely by the existing per-capability autonomy toggles (moderation's `agent_moderation`).

Pros:
- Zero code change to the ability layer.

Cons:
- The toggle is **binary per capability** and orthogonal to *authorization scope*: an AGENT-ADMIN with `manage:all` and the admin autonomy toggle on could do **anything** admin — no least-privilege, no blast-radius cap. Fails ADR-0006 #4 and AUDIT4 P1-6 directly. Rejected.

### Option 2: A separate, parallel AGENT ability factory
A second factory computes agent abilities independently.

Cons:
- Two authz paths drift (the exact reason ADR-0011 §5 rejected a parallel agent guard); the RBAC matrix would be applied twice and diverge. Rejected.

### Option 3: AGENT-specific roles in the enum (e.g. `AGENT_MODERATOR`)
Add agent variants to `users.role`.

Cons:
- Violates ADR-0011 §7 orthogonality (`principal_type ⟂ role`) and forks the locked 7-role canon; scope is a *capability grant*, not a role. Rejected.

### Option 4: Deny-by-default AGENT branch in the one `AbilityFactory`; effective = matrix(role) ∩ scope (Chosen)
`AbilityFactory.createForPrincipal` gains a single explicit branch: **if `principalType === 'AGENT'`**, start from **deny-all**, then grant **only** the abilities named in the principal's `scope`, each **further intersected with what `matrix(role)` would allow** (the role remains a ceiling — an agent can never exceed its role, and never reaches `manage:all` because the AGENT branch never emits the wildcard). An AGENT with empty/absent scope gets **nothing** (deny-by-default). The HUMAN path is untouched (byte-identical). Scope data is carried on the principal as a JWT claim, populated by the [ADR-0036](0036-agent-credential-issuance.md) exchange from the credential — so `AbilityFactory` reads it with **no extra DB hit**.

Pros:
- `manage:all` is **structurally unreachable** for an AGENT (the wildcard lives only in the HUMAN `ADMIN` branch).
- One authz path, one matrix (driver 4); the RBAC matrix stays the single ceiling.
- Deny-by-default is the correct security default (fail-safe): a mis-provisioned agent gets nothing, never everything.
- Scope travels in the JWT (from the credential) → no per-request scope lookup; revoking/rotating the credential (ADR-0036 §4) changes future scope immediately.
- Maps directly onto moderation (§3) and generalizes to admin/report (the AUDIT4 #2 ask).

Cons:
- One more concept (scope) to define and validate; requires a scope vocabulary. Acceptable — it is the least-privilege primitive ADR-0006 already mandated.

**Decision:** **Option 4.** For an AGENT principal: **deny-by-default**, effective ability = **`matrix(role) ∩ scope`**, and the `manage:all` wildcard is **never** emitted for an AGENT. HUMAN behaviour unchanged.

**ЧТО:** Add a deny-by-default AGENT branch to the single `AbilityFactory`: an AGENT's effective abilities = the role-matrix ceiling intersected with an explicit scope; empty scope = no abilities; `manage:all` unreachable for AGENT.
**ПОЧЕМУ:** An AGENT must not inherit a human role's blanket authority; least-privilege + a killable blast radius require an explicit, intersected, deny-by-default grant, not role-only inheritance.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** Directly closes AUDIT4 P1-6 and satisfies ADR-0006 #4 with **one** authz path (no drift, ADR-0011 §5); deny-by-default is fail-safe (a mis-config yields powerlessness, never omnipotence); the role stays a ceiling so ADR-0011 §7 orthogonality holds (role semantics identical for both principal types) with **no** cross-column schema CHECK; scope-in-JWT keeps it off the hot path. Alternatives rejected: toggle-only (no scope granularity — the P1-6 defect); parallel factory (drift, ADR-0011 §5); agent-roles-in-enum (forks the 7-role canon, breaks §7 orthogonality).

---

## §2 — Where scope lives: a named capability-profile referenced by the credential, embedded in the JWT at exchange (owner decision 2026-07-09 — Option B from the start)

**Considered options**

### Option A: Per-credential scope column (`service_credentials.scope JSONB`) (architect's recommendation — overridden by the owner)
Each credential carries its scope; the [ADR-0036](0036-agent-credential-issuance.md) exchange reads it and embeds it in the issued AGENT JWT as a claim; `AbilityFactory` reads the claim.

Pros:
- Scope is **co-located with the credential** (ADR-0036) — issuance, rotation, revocation and scoping are one administered object, changed/killed in one place by one human act.
- No extra table now; additive nullable column (N-1 safe); deny-by-default = NULL scope.

Cons:
- If many agents share a scope, it is duplicated per credential (acceptable at MVP-era fleet size; promote to Option B if it grows).

### Option B: Named capability-profile table (`agent_capability_profiles` + assignment) (Chosen — owner, 2026-07-09)
A profile = a named, reusable ability set (e.g. `moderation-agent`); an agent references a profile.

Pros:
- DRY for a large agent fleet; human-readable ("this agent is a moderation-agent").

Cons:
- New table(s) + assignment plumbing before there is any fleet to justify it — premature. Reserve as the later evolution *behind* the credential-scope seam (a profile is sugar that resolves to the same JWT scope claim).

**Decision (owner, 2026-07-09, section-by-section review — overrides the A-now/B-later recommendation):** **Option B from the start.** Scope lives in a new named-profile table `agent_capability_profiles` (a named, human-readable, reusable ability set — e.g. `moderation-agent`); `service_credentials` references it via a nullable `capability_profile_id` FK; **no per-credential `scope` column is built**. The [ADR-0036](0036-agent-credential-issuance.md) exchange resolves the profile at token issue and embeds the **resolved** `{action, subject}` list in the AGENT JWT `scope` claim — so the ability layer (§1) is identical under A or B (it only ever reads the claim), and deny-by-default holds end-to-end: `capability_profile_id IS NULL`, an inactive profile, or an empty grant list all issue a JWT with no scope → no abilities. Owner's rationale: a named profile is auditable, human-readable authority ("this agent is a moderation-agent") with no per-credential scope drift from day one — the North-Star assumes a fleet; the cost is one small lookup table in the agent-scope slice. A per-credential override column remains a possible later **additive** extension, not built. This resolves the storage question [ADR-0036](0036-agent-credential-issuance.md) §7 deliberately left to this ADR.

**Scope vocabulary (normative):** a scope is a list of `{ action, subject }` grants drawn from the **same** `Action × Subject` vocabulary the RBAC matrix / `AbilityFactory` already defines (`Action ∈ {read, create, update, delete}` — **never `manage`**; `Subject ∈` the existing subject enum — **never `all`**). Forbidding `manage`/`all` in a scope is what makes wildcard authority structurally impossible for an AGENT. A scope validator (service-layer) rejects any grant containing `manage` or `all`.

**ЧТО:** Scope lives in the named `agent_capability_profiles` table (owner decision 2026-07-09); a credential references one profile via nullable `capability_profile_id` (NULL / inactive / empty = deny-by-default); the exchange embeds the resolved scope in the AGENT JWT; the scope vocabulary is the existing `{action, subject}` set minus `manage`/`all`.
**ПОЧЕМУ:** Agent authority must be a named, auditable, reusable object administered by a human, available at request time without a DB hit (resolved into the JWT at exchange), while wildcard authority stays impossible to express.
**ПОЧЕМУ ТАК ЛУЧШЕ:** A named profile makes every grant readable and DRY from day one (no per-credential scope drift as the fleet grows); the profile resolves at exchange, so the ability layer is byte-identical to Option A (no hot-path cost, no second authz language) and re-scoping is one profile edit applying to every agent holding it; excluding `manage`/`all` from the vocabulary still enforces P1-6 by construction; credential rotate/revoke (ADR-0036 §4) unchanged.

---

## §3 — Reference mapping: the moderation-agent (the READY case)

Moderation is AUDIT4's **READY** reference (agent-toggle + actor-snapshot + human-override all built, migrations 0011/0016). Its scope maps cleanly and demonstrates the two independent bounds:

- **`moderation-agent` scope** = `[{read, ModerationQueue}, {create, ModerationDecision}, {read, Listing}, {read, ContentReport}]`.
- An AGENT holding `role='MODERATOR'` **with this scope** may moderate — and **nothing else**. Note the matrix grants a HUMAN-MODERATOR *more* (`update User` to suspend, `update Listing`, `read AuditLog`); the scope **narrows the agent below its role ceiling** — exactly least-privilege. It also never touches `manage:all` (that is only the HUMAN-ADMIN branch).
- **Two independent bounds must both pass** for the agent to actually decide: (1) the per-domain **autonomy toggle** `agent_moderation` (`moderation.service.ts:289` — *is autonomous moderation enabled at all?*) **and** (2) the **scope** (*does this specific agent hold the `create ModerationDecision` ability?*). Plus the [ADR-0036](0036-agent-credential-issuance.md) master auth gate upstream. Three gates: master-auth → scope → per-domain autonomy.
- **Human override unchanged:** ADR-0011 §3 (new append-only row, `actor_principal_type='HUMAN'`, `supersedes_decision_id`) is untouched; a human always out-authorizes and can reverse any agent decision.

This is the concrete instance of AUDIT4/architect #2's "cross-cutting agent-operable-action contract": **every agent operator write = actor-snapshot (ADR-0011 §1) + scoped ability (this ADR) + per-domain autonomy toggle + a human override/supersede path.** Admin and content-report (both SEAM-NEEDED in the scorecard) adopt the identical shape when their slices land.

**ЧТО:** Define `moderation-agent` scope; an AGENT-MODERATOR with it can only moderate (narrower than its role); actual action requires master-gate ∩ scope ∩ `agent_moderation` toggle; human override untouched.
**ПОЧЕМУ:** The READY domain must demonstrate the seam end-to-end and set the template admin/report reuse.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Turns the moderation-only safety pattern into a reusable four-part contract (snapshot + scope + autonomy-toggle + override) exactly as AUDIT4/architect #2 asked; the three-gate stack gives graduated, independently-killable autonomy matching ADR-0006 P-A…P-D; least-privilege is *demonstrated* (scope < role), not just asserted.

---

## §4 — Compatibility with `x-required-roles` / the RBAC matrix

The `x-required-roles` convention (`API_CONVENTIONS.md`, enforced by `RolesGuard` per `rbac-matrix.md`) is a **coarse role gate** that runs **before** the fine-grained CASL check (`PoliciesGuard` → `AbilityFactory`). This ADR changes **neither** the matrix nor `x-required-roles`:

- The role gate still applies to an AGENT (an AGENT-MODERATOR passes a `x-required-roles: MODERATOR` route — role ⟂ principal_type, ADR-0011 §7).
- The CASL layer **additionally** intersects scope. So for an AGENT, `x-required-roles` is **necessary but not sufficient**: it must hold the role **and** the scoped ability. Scope can only **narrow**, never widen — an agent can never do something its role-gate forbids.
- For a HUMAN, both layers behave exactly as today (scope absent ⇒ full role matrix). Zero behaviour change.

**ЧТО:** `x-required-roles`/`RolesGuard` (coarse) unchanged; the CASL/`AbilityFactory` layer additionally intersects AGENT scope; scope only narrows.
**ПОЧЕМУ:** The two-layer guard must keep working; scope is defense-in-depth *inside* the existing model, not a replacement.
**ПОЧЕМУ ТАК ЛУЧШЕ:** No contract/convention churn (the matrix stays authoritative and single-source); scope-narrows-only guarantees an agent can never exceed the documented role gate; HUMAN paths are provably unchanged (the parity test, §5).

---

## §5 — Rollout: dormant-form-first (the migration 0034 precedent)

Per ADR-0022 / migration 0034 (dormant `user_roles` junction) and the cost-of-change rule, this ships as a **dormant seam**, HUMAN behaviour byte-identical.

- **Now (this ADR + a gated slice):**
  1. Extend the principal type (`AuthPrincipal`/`AccessTokenClaims`) with an **optional** `scope` (only ever populated for AGENT; HUMAN = undefined = full role matrix). Form only.
  2. Add the **deny-by-default AGENT branch** to `AbilityFactory` (§1). It is **dormant** — no AGENT principal exists in MVP ([ADR-0036](0036-agent-credential-issuance.md) master gate off), so the branch is never hit; the HUMAN path is byte-identical.
  3. Add the scope validator (rejects `manage`/`all`).
  4. Add the dormant `agent_capability_profiles` table + `service_credentials.capability_profile_id` FK (PROPOSED migration sketch below; §2 owner decision) — additive, nullable, deny-by-default, N-1 safe.
- **Later (agent activation, P-A):** the [ADR-0036](0036-agent-credential-issuance.md) exchange resolves the credential's profile and populates the JWT scope claim; flip `agent_moderation`. **No authz rewrite** — the seam is already there.
- **Parity test (DoD):** a HUMAN principal's abilities are unchanged across every role (byte-identical to pre-ADR); an AGENT with **null** scope resolves to **no** abilities (deny-by-default); an AGENT with `moderation-agent` scope resolves to **exactly** `matrix(MODERATOR) ∩ scope`; an AGENT at `role='ADMIN'` **never** resolves `manage:all`.

**Schema — REALISED in migration 0038** (was: «PROPOSED schema sketch; this ADR writes no migration»).
**STATUS CORRECTED 2026-08-09:** `agent_capability_profiles` and the `service_credentials.capability_profile_id`
FK exist in the canon, with the seeded `moderation-agent` profile. Left as a «sketch» the heading invited a
DUPLICATE migration for objects that already exist. Objects are named below by NAME, not by line number.
```sql
-- Named, reusable least-privilege ability set (owner decision 2026-07-09: profiles from the start).
-- scope vocabulary: [{ "action": "read|create|update|delete", "subject": "<Subject>" }] — never "manage"/"all"
-- (the service-layer validator rejects them). INT-lookup + provenance/lifecycle in the A2 form.
CREATE TABLE IF NOT EXISTS agent_capability_profiles (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(50) NOT NULL UNIQUE,           -- e.g. 'moderation-agent'
  scope       JSONB NOT NULL,                        -- the {action, subject} grant list
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at  TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
-- The credential references its profile; NULL = deny-by-default (no abilities). Additive → N-1 safe.
ALTER TABLE service_credentials
  ADD COLUMN IF NOT EXISTS capability_profile_id INT
    REFERENCES agent_capability_profiles(id) ON DELETE RESTRICT;
```
Table count **+1** (`agent_capability_profiles`) when the agent-scope slice lands — backend follows the full DB workflow (schema / ERD / data-model / ledger counts); the sketch above is PROPOSED, the slice finalizes the DDL.

**ЧТО:** Ship the scope seam dormant (principal type + deny-by-default AGENT branch + validator + dormant `agent_capability_profiles` table with credential FK); HUMAN byte-identical; parity test pins it; activation later populates the JWT scope with no rewrite.
**ПОЧЕМУ:** The seam is cheapest before Admin Slice 2 hard-wires human-only authz, but must not change MVP behaviour or expose live agent authorization.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Reuses the proven dormant-form-first pattern (migration 0034); the parity test makes "zero HUMAN behaviour change" and "deny-by-default for AGENT" *verified*, not asserted; additive/nullable column is N-1 safe (heeds AUDIT4 P1-5); activation is one populate-the-claim step, honouring the phasing rule.

---

## Consequences

### Positive
- AUDIT4 P1-6 closed at the form level: an AGENT can **never** inherit `manage:all`; effective authority is an explicit, least-privilege, deny-by-default intersection — a bounded, killable blast radius (ADR-0006 #4).
- One authz path preserved (ADR-0011 §5); the RBAC matrix stays the single authoritative ceiling; ADR-0011 §7 orthogonality intact (no cross-column CHECK; role semantics identical).
- The moderation safety pattern is generalized into a reusable four-part agent-operable-action contract (snapshot + scope + autonomy-toggle + override) ready for admin/report (AUDIT4/architect #2).
- Human override and human out-authorization preserved unconditionally.

### Negative
- A scope vocabulary + validator + the `agent_capability_profiles` lookup table to maintain (one more administered object).
- One additive table + FK column beyond the [ADR-0036](0036-agent-credential-issuance.md) form (+1 table when the slice lands).

### Neutral
- MVP behaviour byte-identical (HUMAN path untouched; AGENT branch dormant, no agent provisioned).
- Scope storage resolved by the owner (2026-07-09): named profiles from the start (§2); a per-credential override column stays a possible additive extension (both resolve to the same JWT claim).

## Open questions — owner review 2026-07-09
1. **[owner/North-Star] A future "trusted agent" tier with broad scope?** The P-D vision is increasingly autonomous agents. Recommendation: even the **broadest** agent scope stays an **explicitly enumerated** `{action, subject}` grant — the `manage`/`all` wildcard remains **HUMAN-only forever**. An agent may be granted *wide* authority but never *wildcard* authority (so the grant is always auditable and boundable). **Owner decision 2026-07-09: deliberately left OPEN until P-D; the stated default applies meanwhile — no wildcard for AGENT.**
2. **[design, minor] Scope storage evolution** — promote per-credential scope to a named `agent_capability_profiles` table when the fleet grows? Recommendation: per-credential now (Option A); promote when >~a handful of agents share a scope. **Owner decision 2026-07-09: recommendation OVERRIDDEN — named profiles from the start (see §2 Decision); question closed.**

## Related Decisions
- [ADR-0011](0011-agent-principal-actor-model.md) — refines §7 for the authz layer (matrix = ceiling, AGENT effective = ceiling ∩ scope); no cross-column CHECK; §3 human-override untouched.
- [ADR-0006](0006-ai-agents-operate-platform.md) — realises non-negotiable #4 (scoped least-privilege) and preserves #3 (override).
- [ADR-0036](0036-agent-credential-issuance.md) — companion; the credential/JWT carries the scope defined here. Neither ADR alone unblocks the North-Star (powerless vs over-powered).
- [ADR-0022](0022-multi-role-user.md) — dormant-form-first precedent (migration 0034); note role⟂principal_type interplay if an AGENT ever holds multiple roles (effective = ⋃matrix(roles) ∩ scope).

## References
- `AUDIT4_HARDENING.md` §2 P1-6, §4a (scoped-ability BLOCKED), §4c #4, §6 (ADR track).
- `AUDIT4/security.md` §STRATEGIC FC-2 (`ability.factory.ts:46-84`, BLOCKED list #1); `AUDIT4/architect.md` §4a scorecard + anti-North-Star debt #2 (generalize the pattern).
- `backend/src/lib/auth/ability.factory.ts:51` (`case 'ADMIN': can('manage','all')`), `principal.ts` (`AuthPrincipal`, `AccessTokenClaims`), `policies.guard.ts`, `roles.guard.ts`.
- `backend/src/modules/moderation/moderation.service.ts:289` (`agent_moderation` per-domain autonomy toggle — the reference bound).
- `docs/specs/security/rbac-matrix.md` (the coarse matrix / `x-required-roles` ceiling).
- `database_schema.sql:1194` (`service_credentials`), `feature_toggles` (:651).
- `IMPLEMENTATION_PLAYBOOK.md §5` (phase-boundary / dormant-form-first / rewrite test).
