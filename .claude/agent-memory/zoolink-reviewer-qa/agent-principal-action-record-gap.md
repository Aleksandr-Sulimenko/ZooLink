---
name: agent-principal-action-record-gap
description: audit_log + moderation_decisions record actor_id but NOT the actor's principal_type — agent-as-principal (ADR-0006) incomplete at the action-record level
metadata:
  type: project
---

`users.principal_type (HUMAN|AGENT)` exists (schema:112), but the rows that *record an action* do not capture which principal type acted:
- `audit_log` (schema:1081) has `actor_id` + `actor_role`, no `actor_principal_type`.
- `moderation_decisions` (schema:374) has `moderator_id`, no `principal_type` on the decision.

Both tables are **append-only** (immutability triggers), so you cannot backfill principal_type onto historical rows later — adding it after AGENT moderation ships means the audit trail can't distinguish human vs agent decisions retroactively. This is a textbook "test-na-perepisyvanie" (anti-rewrite) trigger.

**Why:** ADR-0006 says operator roles (moderator, later admin) will be executed by an AI agent; CLAUDE.md cross-cutting rule requires actor identity preserved wherever an actor is recorded.
**How to apply:** Whenever reviewing Admin/Moderation work (Phase A), require principal_type (+ optional on-behalf-of/human-override actor) on the action-record rows, decided NOW (form), not just on `users`. Flag any plan that treats agent-principal as solved just because `users.principal_type` exists.
