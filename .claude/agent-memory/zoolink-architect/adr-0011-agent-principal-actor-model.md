---
name: adr-0011-agent-principal-actor-model
description: ADR-0011 (Accepted 2026-06-23) amends ADR-0006 — concrete actor-recording form; key rationale & rejected options
metadata:
  type: project
---

ADR-0011 `docs/04-decisions/0011-agent-principal-actor-model.md` (Accepted 2026-06-23) **amends, does not supersede** ADR-0006. Output of ADMIN_PHASE_ACTION_PLAN A0a/A1.

**Why:** ADR-0006 left the actor-recording form "directional"; cross-check C1 (6 agents) found `audit_log`/`moderation_decisions` are append-only and DON'T record principal_type at write time → irreversible data loss if deferred (rewrite-test = yes, rewrites history). This is the strongest driver.

**How to apply / locked canon (do not reopen):**
- Actor snapshot `actor_principal_type` (DEFAULT 'HUMAN') added to BOTH `audit_log` and `moderation_decisions`; `actor_role` snapshot added to `moderation_decisions` (audit_log already had it). Snapshot-at-write, NOT read-time join — join is wrong-by-construction (users.principal_type/role are mutable).
- Human-override (Owner-decision #4) = NEW append-only row + `supersedes_decision_id` + `is_human_override` biconditional CHECK; NEVER a mutation/flag-on-old-row. Override actor MUST be HUMAN (service-layer rule).
- Agent lifecycle = deactivation (status DEACTIVATED), never DELETE — FK ON DELETE RESTRICT protects the immutable trail.
- Agent service-auth FORM (§5): source-agnostic principal via `RequestAuthenticator` chain INSIDE the monolith (ADR-0009) — BearerJwt now, AgentServiceToken additive later. Env signing-secret ≥32. service-credential store: hashed, rotatable, revocable, in-monolith. ADR forbids: separate auth service / un-rotatable / un-revocable / plaintext.
- §6 normative rule: every actor-bearing response/event carries `{actor_id, principal_type}` (agent-badge) — mirrors schema snapshot at contract level (plan B0.6).

**Rejected:** read-time join (wrong-by-construction); defer-to-Phase-2 (poisons history); parallel agent guard (drift-prone duplication); SUPER_ADMIN in users.role enum (conflates escalation control with role taxonomy).

Related: [[role-canon-7-and-role-in-org-dup]], [[agent-as-principal-touchpoints]].
