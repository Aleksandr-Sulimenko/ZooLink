---
name: adr-0011-actor-snapshot-invariants
description: ADR-0011 agent-principal actor-snapshot invariants on audit_log/moderation_decisions + role_in_org canon, with their negative tests
metadata:
  type: project
---

ADR-0011 (A0a) landed as migration `0016` (`20260623_0016_actor_principal_snapshot_and_role_hygiene.sql`), columns-only, table count stays 31.

**Schema invariants now enforced (verify via `pg_constraint` before relying):**
- `audit_log.actor_principal_type` + `moderation_decisions.actor_principal_type` — `VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK IN ('HUMAN','AGENT')`. Write-time snapshot, never join `users.principal_type`.
- `moderation_decisions.actor_role VARCHAR(20)` nullable, **no enum CHECK** (role enum may evolve — ADR §2).
- `moderation_decisions.supersedes_decision_id` self-ref FK `ON DELETE RESTRICT` + `is_human_override BOOLEAN`.
- `chk_moddec_override` biconditional: `is_human_override=TRUE ⇔ supersedes_decision_id IS NOT NULL`.
- `idx_moddec_supersedes` partial index for override-chain reads.
- Append-only triggers (`trg_moderation_decisions_immutable`, `trg_audit_log_append_only`) are UNCHANGED and automatically cover the new columns (they block ALL update/delete).
- `chk_org_user_role` = 4-value `{OWNER,ADMIN,STAFF,VET}` (MODERATOR rejected). Inline CHECK (schema:79) + COMMENT (:722) were the stale/contradictory copies — fixed to match.
- `users.role` CHECK already rejects SUPER_ADMIN (7-role enum, line 109) — confirmed, no change.

**Service-layer rules NOT in DB (deferred to Moderation domain, no code yet):**
- override row's `actor_principal_type` MUST be HUMAN (ADR §E4).
- supersedes target must share `(entity_type, entity_id)`.
Agent service-credential store (ADR §5/§C) = deferred to A0b; +1 table when it lands.

**Negative-test recipe (live PG, all PASS 2026-06-23):** need a real `users.id` + `moderation_reasons.code`; generate UUIDs with `gen_random_uuid()` (no `uuidgen` on this host). Test append-only UPDATE/DELETE inside a `DO $$ ... $$` block on a freshly-inserted row (BEFORE-ROW trigger doesn't fire on 0-row updates). For role-CHECK-vs-FK ambiguity (org_users MODERATOR), grep the error for `chk_org_user_role` to confirm the CHECK fired before the FK.

See [[adr-0011]] contract at `docs/04-decisions/0011-agent-principal-actor-model.md` (Migration spec §A–§E).
