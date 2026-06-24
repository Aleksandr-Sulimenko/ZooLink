---
name: adr0011-actor-snapshot-invariants
description: ADR-0011 actor-snapshot DB invariants + the negative-test trap that hides them behind FK/NOT-NULL errors
metadata:
  type: project
---

ADR-0011 (migration 0016) added actor-snapshot + human-override invariants to the append-only ledgers.
Verified GREEN on live PG 2026-06-23 (commit 0aea7e2).

DB-enforced invariants (have working negative tests; re-run on schema change):
- `audit_log.actor_principal_type` + `moderation_decisions.actor_principal_type`: CHECK IN ('HUMAN','AGENT'), DEFAULT 'HUMAN'.
- `chk_moddec_override` biconditional: is_human_override=TRUE <=> supersedes_decision_id NOT NULL (both directions reject).
- `chk_org_user_role`: role_in_org canon = {OWNER,ADMIN,STAFF,VET}; MODERATOR rejected (inline CHECK :79 + named :999 now agree).
- `users.role` CHECK has no SUPER_ADMIN (7-role canon, ADR-0011 §7).
- append-only trigger blocks UPDATE/DELETE on both ledgers (covers the new columns automatically).

**Why (test trap):** moderation_decisions has FK moderator_id -> users and users.full_name is NOT NULL.
A naive negative test that inserts with random/absent moderator_id or no full_name fails on the FK/NOT-NULL
BEFORE reaching the CHECK under test -> false "NOT REJECTED" or false "REJECTED". 
**How to apply:** when testing moderation_decisions/users CHECK constraints, FIRST seed a valid users row and
pass that id as moderator_id; only then does the row reach the constraint you actually want to exercise.

Service-layer rule NOT enforced by DB (spans rows) — needs a service test when override flow is built:
override row's actor_principal_type MUST be HUMAN, and supersedes must point to a decision on the SAME
(entity_type, entity_id). DB only enforces the biconditional, not these two. See [[agent-principal-action-record-gap]].
