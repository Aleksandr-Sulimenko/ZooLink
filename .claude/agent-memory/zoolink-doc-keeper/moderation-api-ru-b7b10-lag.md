---
name: moderation-api-ru-b7b10-lag
description: RU moderation-api.yaml lagged EN by all of B7/B10 (claim/lock, SLA, decision-templates, owner-result) — full remirror done in final-B consolidation
metadata:
  type: project
---

**Found during final Phase-B RU consolidation (2026-06-24):** `docsRU/03-architecture/api-contracts/moderation-api.yaml`
was at the **B0.6 stage only** (459 lines) while EN had advanced to B7+B10 (801 lines). The RU mirror was missing,
in full:
- path `POST/DELETE /moderation/queue/{listingId}/claim` (claim/lock)
- path `GET /moderation/decision-templates`
- path `GET /listings/{id}/moderation-result` (owner agent-transparency)
- schemas `ModerationLock`, `QueueGroupCounts`, `OwnerModerationResult`, `DecisionTemplate`
- claim/lock + SLA fields on `ModerationQueueItem` (lockState/assignedTo/lockedAt/lockExpiresAt/slaState/waitingSeconds)
- `PageMeta.counts`, `ModerationActionRequest.templateCode`+`supersedesDecisionId`
- queue filters market/slaState/escalated/lockState

**Fix:** full RU rewrite from EN, prose-only translation. Verified: paths/schema-names/structural-token multisets
IDENTICAL EN↔RU; both `python3 yaml.safe_load` OK. Final EN 801 / RU 800 lines (prose wrap).

**Lesson / how to apply:** the moderation-api RU mirror is the single easiest contract to fall behind — it absorbed
B0.6, B7, B10 in sequence and RU only caught B0.6. When a B-phase touches moderation, ALWAYS re-diff
`moderation-api.yaml` EN↔RU with the structural-token harness (operationId/enum/required/$ref/format multiset +
path list + schema-name list), not just line count. The `series`/`time-series` prose word inflates naive token
grep on listings/organization analytics yaml — count the STRUCTURAL `series:` key + `x-phase`, not the word.
See [[skeleton-compare-harness]] [[contract-files-mirror]] [[b9-analytics-contract]] [[api-conventions-ru-lag-s15]].
