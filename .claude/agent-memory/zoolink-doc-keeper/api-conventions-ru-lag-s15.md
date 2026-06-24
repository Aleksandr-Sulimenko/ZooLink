---
name: api-conventions-ru-lag-s15
description: Pre-existing EN↔RU drift in API_CONVENTIONS.md — RU lacks §15 Actor and B0.6 status is stale
metadata:
  type: project
---

**Pre-existing drift (as of 2026-06-24, found during B9):** `API_CONVENTIONS.md` EN↔RU are out of sync on the Actor section.
- EN has **§15 Actor representation** ({actorId, principalType} agent-badge) + Conformance "B0.6 done (2026-06-23, ADR-0011 §6)".
- RU has **NO §15** and its status block still says "Отложено (B0.6, блокировано ADR-0011)... пока не применена".

This is a B0.6 deliverable (see [[actor-badge-canon]] / [[b0-incidental-fixes]]), not B9. When B0.6 / §15 is finally mirrored to RU, also reconcile: RU §16 (analytics) was inserted after §14 because §15 was absent — after §15 lands, §16 should follow §15 in RU to match EN ordering.

**RESOLVED 2026-06-24 (final-B RU consolidation):** RU §15 (Actor object) added mirroring EN; §16 (analytics) now
follows §15 as in EN; B0.6 status block rewritten from "Отложено" to "B0.6 выполнено (2026-06-23, ADR-0011 §6)";
conformance-checklist §15 bullet added; §4 claim/lock codes (ALREADY_CLAIMED/NOT_LOCK_HOLDER/ITEM_NOT_CLAIMED) added
to BOTH EN and RU. EN↔RU section sequence now identical (§0–§16 + 2 non-numbered).

**How to apply:** if asked to sweep API_CONVENTIONS consistency, this specific drift is now fixed. Note
`API_CONVENTIONS.md` DOES have a RU mirror (docsRU/03-architecture/api-contracts/API_CONVENTIONS.md) — the
[[actor-badge-canon]] note's "no RU mirror" claim refers only to the historical state and is superseded.
