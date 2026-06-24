---
name: flag-to-changes-requested
description: FLAG/"FLAG FOR REVIEW" is dead wording — canon moderation decision is CHANGES_REQUESTED (fixable path)
metadata:
  type: project
---

The moderator decision set is `{APPROVED, REJECTED, CHANGES_REQUESTED}` — `moderation_decisions.decision` enum + `listings.moderation_status` (ADR-0003 / spec 12 / glossary).

`FLAG` / "FLAG FOR REVIEW" / RU «ПОМЕТИТЬ НА ПЕРЕПРОВЕРКУ» was an informal early wording that conflated "needs changes" with "report/flag". It is **rejected** — replaced by `CHANGES_REQUESTED` (the fixable path: listing → DRAFT for re-submit, vs terminal REJECT).

**Fixed in admin-BR (C1, 2026-06-23, GAP-TRACE-006):** `business-requirements/admin-domain.md` (+RU) — 3 spots per file:
1. §2 moderator-action block ("FLAG FOR REVIEW" → "CHANGES_REQUESTED").
2. data-model Moderation Log table: `action ENUM('APPROVE','REJECT','FLAG')` → `ENUM('APPROVED','REJECTED','CHANGES_REQUESTED')`.
3. API Contract References: "approve/reject/flag listing" → "approve/reject/request-changes".

**Do NOT touch:** the word "flagging" in GAP-ADM-003 ("manual flagging" / "ручное flagging") — that is user **content-reporting**, a different concept, not the moderation decision. Also "Feature Flags" is unrelated.

The admin-domain sequence diagram already used REQUEST_CHANGES/CHANGES_REQUESTED correctly — no FLAG there.
