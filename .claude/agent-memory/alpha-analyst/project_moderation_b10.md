---
name: moderation-b10-contract-shape
description: B10 moderation contract-shape decisions — claim/lock state machine, SLA, decision-templates=TABLE, owner-facing AI transparency
metadata:
  type: project
---

B10 (ADMIN_PHASE_ACTION_PLAN) brought `moderation-api.yaml` to spec 12 round-5 — FORM now, behavior with the Moderation domain. Executed 2026-06-24.

**decision-templates = TABLE, not enum (locked, with §5 rationale).**
**Why:** canned REJECT/CHANGES notes are business-editable content an AGENT selects by stable `code`; enum → contract+schema rewrite on every new template (rewrite-test=yes); table → new template is one data row. Mirrors `moderation_reasons` reference-data shape + A2 convention (code PK, body_localized JSONB, market ADR-0002, sort_order, is_active, provenance).
**How to apply:** new `decision_templates` table is a SCHEMA MIGRATION FLAGGED FOR backend — NOT implemented in the contract. Distinct from `moderation_reasons` (taxonomy/why-rejected, mandatory FK) — templates are the note prose.

**Owner-decision #5 (locked 2026-06-24): "decided by AI" shown to EVERYONE incl. seller.**
**How to apply:** `OwnerModerationResult` (narrower than `ModerationDecision`) carries `decidedBy.principalType` + `decidedByAgent`; surfaced by `GET /listings/{id}/moderation-result`. listings-api owner read SHOULD embed it as additive `lastModerationResult` (flagged backend+doc-keeper). Resolves human-override chain (effective decision).

**claim/lock contract:** columns already exist on `listings` (migration 0009: assigned_to/locked_at/lock_expires_at/moderation_enqueued_at). Contract added: POST/DELETE `/moderation/queue/{listingId}/claim`, `lockState` enum {FREE,CLAIMED_BY_ME,CLAIMED_BY_OTHER,LOCK_EXPIRED} relative-to-caller, MOD_LOCK_TTL default 15min (expiry computed, no job needed). New error codes: `ALREADY_CLAIMED`/`NOT_LOCK_HOLDER`/`ITEM_NOT_CLAIMED` (all 409). SLA: `slaState`{ON_TRACK,BREACHED,ESCALATED}; ESCALATED→ADMIN, never auto-decides. `PageMeta.counts` (QueueGroupCounts) is additive, queue-only, null elsewhere.

See [[identity-slice4-patterns]] for prior round-5 normative-block convention. ADR-0011 = actor-snapshot/human-override canon.
