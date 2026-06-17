# ADR-0006: AI Agents as Platform Operators (Moderation, Admin, and Beyond)

**Status**: Accepted (directional / long-term)  
**Date**: 2026-06-17  

## Context and Problem Statement

ZooLink is not only a marketplace specification — its mission spans the full product **and business** lifecycle: creating and maintaining documentation, backend, and frontend; development, deployment/rollout; and operating the platform as a living business.

A core part of that operation — content moderation (ADR-0003 mandates pre-moderation of every listing) and, more broadly, platform administration — is labor-intensive, must run 24/7, and must stay consistent and fast as volume grows. The owner's directional vision is that **operator roles — first the Moderator, and in perspective the Admin — can be performed by specially-trained AI agents**, with the long-term goal of a mechanism that **runs and maintains the platform as a business largely via AI agents** (progressively autonomous operation), while preserving human accountability and override.

The question this ADR answers: do we bake **AI agents as first-class actors/principals** into the data model and capabilities now, or treat automation as a later bolt-on?

## Decision Drivers

1. **Mission scope**: the project covers operating the platform as a business, not just shipping an MVP — operations must be automatable by design.
2. **Moderation load (ADR-0003)**: pre-moderation of all content is the most repetitive, high-volume operational task — the natural first target for an agent.
3. **24/7 + consistency + cost**: agents give round-the-clock, uniform decisions and lower marginal cost as volume scales.
4. **Avoid painful retrofits**: actor identity ("who acted") is hard to retrofit; modeling principals (human vs agent) early is cheap, later is expensive.
5. **Accountability & compliance**: even with agents, a responsible human/legal entity remains accountable (152-ФЗ, prohibited-content laws). Full, immutable audit and human override are mandatory.
6. **Trust & safety**: autonomous action requires confidence thresholds, escalation to humans, and reversibility.

## Considered Options

### Option 1: Humans-only operators (status quo)
Moderators/admins are always human user accounts; automation, if any, is external scripting.

Pros:
- Simplest mental model; nothing to add now.
- Clear human accountability by default.

Cons:
- Does not scale; pre-moderation becomes a bottleneck.
- No data path for agent actors — every future automation step requires schema/role rework.
- Contradicts the stated mission (AI-operated business).

### Option 2: Bake in AI-agent principals as first-class actors (Chosen)
Model every actor as a **principal** that is either `HUMAN` or `AGENT`. Agents are accounts that can hold operator roles (MODERATOR now, ADMIN/ops later). Decisions/actions record the acting principal (and its type) in the existing append-only audit. Roll out with human-in-the-loop first, increasing autonomy over time.

Pros:
- Future-proofs the data model; agents and humans are interchangeable at the role level.
- Reuses existing structures: `users.role`, `role_in_org`, append-only `moderation_decisions`.
- Enables phased autonomy (assisted → supervised → autonomous) without re-modeling.
- Keeps human accountability and override explicit.

Cons:
- Adds governance surface (agent auth, scoped permissions, confidence/escalation policy).
- Requires safety/compliance framework before any autonomous action.

### Option 3: Bolt-on automation later (no data-model support now)
Ship humans-only; add agent support reactively when needed.

Pros:
- Defers all complexity.

Cons:
- Retrofitting "who/what acted" across users, roles, audit trails, and APIs is costly and error-prone.
- Risks inconsistent history (can't reliably distinguish human vs agent decisions made before the change).

## Decision

We adopt **Option 2**: treat **AI agents as first-class principals/actors** in the platform's data model and capabilities, baked in from the spec phase.

1. **Principal typing**: every account is a principal of type `HUMAN` or `AGENT` (`users.principal_type`, default `HUMAN`). An agent is an account, so it can authenticate, hold roles, and act.
2. **Roles are actor-agnostic**: operator roles (`MODERATOR`, later `ADMIN`; also `role_in_org`) may be held by either a human or an agent. `moderation_decisions.moderator_id` may therefore point to an agent-type account; the audit trail already records who acted (and now, of what type).
3. **Phased autonomy** (each phase gated, with human override and full audit):
   - **P-A — AI-assisted moderation (human-in-the-loop)**: agent proposes APPROVE/REJECT/CHANGES_REQUESTED with a confidence score; a human confirms. Inserts naturally at spec-12's "automated moderation triggers (Phase 2)".
   - **P-B — Supervised autonomy**: agent acts autonomously above a confidence threshold; low-confidence/edge cases escalate to humans; humans audit samples.
   - **P-C — Operational agents (admin/ops)**: agents handle reference-data upkeep, routine admin, monitoring response — still under policy and human escalation.
   - **P-D — AI-run business operations**: progressively autonomous running/maintenance of the platform as a business, with humans in governance/accountability roles.
4. **Non-negotiables**: a responsible human/legal entity is always accountable; every agent action is reversible and recorded in immutable audit; agents have scoped, least-privilege permissions and their own credentials; autonomy is opt-in per capability via configuration/feature flags.

## Consequences

### Positive
- Operations are automatable by design; moderation can scale 24/7.
- Data model and roles future-proofed; no actor-identity retrofit.
- Directly serves the mission (operate the platform as a business via agents).
- Reuses existing immutable audit (`moderation_decisions`) and role machinery.

### Negative
- New governance/safety/compliance obligations before autonomous action (confidence policy, escalation, override, legal accountability).
- Agent authentication, permission scoping, and abuse/rate controls must be designed.

### Neutral
- MVP behavior is unchanged: `principal_type` defaults to `HUMAN`; no agents are active until explicitly enabled (feature-flagged), mirroring how Payment is gated.
- Agents are modeled as accounts, so most existing flows need no structural change.

## Implementation Notes

1. **Data model** (`database_schema.sql`, `data-model.md`):
   - `users.principal_type VARCHAR CHECK (principal_type IN ('HUMAN','AGENT')) DEFAULT 'HUMAN'`.
   - Optional later: an `agents` table (or `metadata` on the agent account) for model/version, owner, capability scope, confidence config — deferred until P-A.
   - `moderation_decisions.moderator_id` stays a FK to `users`; the actor's `principal_type` distinguishes human vs agent. Keep the append-only immutability trigger.
2. **Roles & permissions**: `MODERATOR`/`ADMIN` and `role_in_org` are assignable to agent accounts; enforce least-privilege and per-capability autonomy flags.
3. **Audit & override**: every agent decision is an immutable `moderation_decisions` row; provide human override paths and escalation for low-confidence cases.
4. **Security/compliance**: agent credentials (service auth), scoped tokens, rate limits; a human/legal entity remains the accountable party for 152-ФЗ and prohibited-content compliance.
5. **Knowledge**: agents may use RAG/RLM over `docs/` (see `RLM_RAG_HANDOFF.md`) for policy-grounded decisions.
6. **Rollout gating**: introduce via feature flags (cf. `feature_toggles`), starting with P-A human-in-the-loop.

## Related Decisions

- **ADR-0003**: Pre-Moderation Workflow — the highest-volume operational task and the first agent target.
- **ADR-0001**: Tech stack (NestJS) — supports service principals, scoped auth, background workers for agents.
- **ADR-0005**: No chat in MVP — keeps the MVP operational surface small while this direction matures.
- Moderation Domain spec (`docs/specs/12-moderation-domain.md`) — "automated moderation (Phase 2)" is the insertion point.
- Admin Domain spec (`docs/specs/06-admin-domain.md`) — future operational agents.

## References

- Owner directive (2026-06-17): operator roles (moderator, later admin) may be specially-trained AI agents; long-term goal — running/maintaining the platform as a business via AI agents.
- `database_schema.sql` (`users`, `moderation_decisions`, `feature_toggles`).
- `docs/03-architecture/data-model.md`; `docs/01-discovery/future-features.md`.
- `RLM_RAG_HANDOFF.md` (RAG/RLM over documentation for agent knowledge).
