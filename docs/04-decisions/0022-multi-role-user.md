# ADR-0022: Multi-role user — `user_roles` junction + JIT self-claim seam (form-now)

**Status**: Accepted — 2026-07-05 (owner ratified «по рекомендациям»; OD-A and OD-B resolved — see §Owner decisions). Low-risk additive seam; keeps `users.role` authoritative in MVP. Supersedes its earlier "Proposed — 2026-07-04 (awaiting owner nod)".
**Date**: 2026-07-04
**Relates to**: [ADR-0016](0016-provider-model.md) (a self-claimed provider role's verification tier T0–T3 gates what it may publish), [ADR-0006](0006-ai-agents-operate-platform.md)/[ADR-0011](0011-agent-principal-actor-model.md) (a role is orthogonal to `principal_type`), [ADR-0014](0014-offering-supertype-polymorphic-seam.md) (role-gated offering features multiply on this seam), the RBAC matrix `docs/specs/security/rbac-matrix.md`.
**Source vision**: `docsRU/01-discovery/future-features.md` §B (comfort BR — one account = owner + groomer + seller + buyer).

> **WHAT** — Reserve a `user_roles(user_id, role)` **junction** as the form-now seam for a user holding **multiple roles at once**, keeping the single `users.role CHECK IN (…7…)` column as the **primary/default-active** role for MVP authz. Reserve a **JIT self-claim** seam: a user can activate an additional role (e.g. GROOMER, FARMER, seller) without re-registration.
>
> **WHY** — The ecosystem comfort BR requires one account to be a pet owner **and** a groomer **and** a goods seller **and** a buyer. `users.role` is single-valued today (`database_schema.sql:115`); once role-gated offering features (ADR-0014/0016) multiply, retrofitting multi-role means back-filling a junction from a single column and rewiring every authz read at once — cheaper to reserve the junction now while it is dormant.
>
> **WHY-BETTER for the whole project** — Additive and reversible: MVP authz keeps reading `users.role` unchanged (zero behaviour change); the junction is dormant until role-gated features land. Role stays **orthogonal to `principal_type`** (an AGENT can hold operator roles — ADR-0011). Self-claim couples cleanly to ADR-0016 verification tiers (a claimed regulated role is publish-gated until its tier is met), so multi-role never becomes a trust bypass.

## Decision Drivers
1. Comfort BR — one account, many roles, no re-registration.
2. Anti-rewrite (§5) — reserve the junction before role-gated features multiply.
3. Orthogonality — role ⟂ `principal_type` (ADR-0011); ⟂ `role_in_org` (org membership).
4. Verification coupling — a self-claimed regulated role is gated by ADR-0016 tier, not client-asserted.
5. MVP simplicity — no authz rewrite now; single primary role still governs.

## Considered Options
- **(1) Migrate `users.role` → `roles TEXT[]` array.** Pros: one column. Cons: rewrites every authz read at once; loses a clean "primary/default-active" concept; array CHECKs are awkward; bigger blast radius now.
- **(2) `user_roles(user_id, role)` junction, `users.role` stays primary (Chosen).** Pros: additive, dormant, MVP authz untouched; primary role well-defined; self-claim and verification attach to junction rows. Cons: two places record role until authz reads the junction (documented; junction dormant until then).
- **(3) Do nothing now.** Cons: silent-drop of a comfort BR; forced simultaneous retrofit later.

## Decision
Adopt **Option 2**. Normative rules:
1. Reserve `user_roles(user_id, role)` (role vocabulary = the 7-role canon), `UNIQUE(user_id, role)`; **dormant** in MVP.
2. `users.role` stays the **primary/default-active** role and the sole authz source **until** role-gated features read the junction. No MVP behaviour change.
3. A user may **self-claim** an additional role (JIT); a claimed **regulated** role is **publish-gated** by its ADR-0016 verification tier — the claim alone grants nothing regulated.
4. Role is **orthogonal** to `principal_type` (ADR-0011) and to `role_in_org`. An AGENT principal may hold roles.
5. This is a **reservation**: the junction + self-claim behaviour build in the slice that first ships a role-gated offering feature — not in MVP.

## Consequences
- **Positive:** comfort BR reserved; no authz rewrite now; self-claim + verification unified with ADR-0016.
- **Negative:** two role stores coexist until authz reads the junction (documented; dormant meanwhile).
- **Neutral:** MVP unchanged; junction empty/dormant.

## Owner decisions (resolved 2026-07-05)
- **OD-A — resolved 2026-07-05 (confirmed):** junction-with-primary (Option 2), **not** the `roles TEXT[]` array (Option 1).
- **OD-B — resolved 2026-07-05 (confirmed):** a user may self-activate a **non-regulated** role (buyer/seller/owner) freely; **regulated** roles are publish-gated by their ADR-0016 verification tier (the claim alone grants nothing regulated).

## Related Decisions
- **ADR-0016** — provider verification tiers gate a self-claimed regulated role.
- **ADR-0006 / ADR-0011** — role ⟂ `principal_type`.
- **ADR-0014** — role-gated offering features consume this seam.

## References
- `database_schema.sql:115` (`users.role` single-valued).
- `AUDIT3/architect.md` (multi-role RESERVE-NOW; junction unreserved).
- `docsRU/01-discovery/future-features.md` §B (comfort BR).
