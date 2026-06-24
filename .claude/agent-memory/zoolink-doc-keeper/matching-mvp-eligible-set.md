---
name: matching-mvp-eligible-set
description: B4 ruling — matching MVP = stateless eligible-set (no scoring/history/feedback tables); scoring is x-phase 2, ineligibilityReason is a 7-value enum
metadata:
  type: project
---

B4 (2026-06-24) locked the matching MVP shape across spec 05, matching-api.yaml (EN+RU), and
business-requirements/matching-domain.md (EN+RU).

**Why:** MVP matching is a stateless eligible-set search (spec 05 hard predicates); no
`matches`/`match_history`/`match_feedback` tables exist. Returning a real `compatibilityScore` would
be a doc↔code lie.

**How to apply (if matching docs are touched again):**
- Endpoints `GET /matching/{id}`, `GET /matching/history`, `POST /matching/{id}/feedback` are whole
  `x-phase: 2`. Scoring fields (`compatibilityScore`, `scoreBreakdown`, `ScoreBreakdown` schema,
  `minScore`) are `x-phase: 2` + nullable/optional; removed from `required`.
- `ineligibilityReason` is an enum: `[SPECIES_MISMATCH, BREED_RULE, NOT_BREEDING_VISIBLE,
  REPRODUCTIVE_STATUS, SELF, INACTIVE, GEO_OUT_OF_RANGE]` — maps 1:1 to spec 05 hard predicates.
- BR doc: sections 2 (Factors/Weighting), 5 (assisted-repro scoring), the Compatibility Score
  concept, and the conceptual `matches` Data Model are tagged "Фаза 2+ design, not MVP behaviour".
- Phase-2 is additive on top of the eligible-set (no rewrite) — IMPLEMENTATION_PLAYBOOK §5.

x-phase:2 count in matching-api.yaml = 10 (EN and RU must match).
