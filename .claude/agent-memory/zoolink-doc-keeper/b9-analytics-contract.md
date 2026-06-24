---
name: b9-analytics-contract
description: B9 analytics contract form (GAP-011, decision #6) — counts + series-ready; schema columns NOT yet present; API_CONVENTIONS §16
metadata:
  type: project
---

B9 (ADMIN_PHASE_ACTION_PLAN) added analytics contract form, owner-decision #6 = **counts + series-ready**.

**What was added (EN+RU mirrored):**
- listings-api.yaml: `GET /listings/{id}/analytics` + `ListingAnalytics` {listingId, views, contactReveals, lastActivityAt, series?} + `AnalyticsSeriesPoint`. Owner-scope = seller OR org-admin (service layer).
- organization-api.yaml: `GET /organizations/{id}/analytics` + `OrganizationAnalytics` {organizationId, totalListings, countsByStatus, countsByMarket(pet/livestock ADR-0002), totalViews, totalContactReveals, lastActivityAt, series?} + `AnalyticsSeriesPoint`.
- `series` is `nullable: true` + `x-phase: 2` in BOTH — **never remove it** (removing breaks the additive contract). MVP = absent/empty.
- API_CONVENTIONS §16 (EN+RU) = analytics envelope rule; B9 status line appended.
- BR notes: pet-marketplace.md §5, organization-domain.md §9 (EN+RU) — "form now, impl deferred to frontend phase".

**Why:** GAP-011 — BR promised "Views:15, Contacts shown:3" + org aggregate, no contract existed.

**How to apply:** any future analytics endpoint follows §16 (flat counts + optional x-phase:2 `series`). Implementation is frontend-phase, not done now.

**RESIDUAL RISKS flagged at delivery (need a decision, NOT mechanical):**
1. **Schema gap:** `listings` table has NO `view_count`/`contact_shown_count` columns (verified database_schema.sql L234-276). BR pet-marketplace data-model table (L176-177) lists them, but they're not in live schema. `contactReveals` can source from `contact_reveals` table; `views` has NO source yet. Backend impl will need a schema migration (architect/backend, not doc-keeper). Contract intentionally describes target form.
2. See [[api-conventions-ru-lag-s15]] — RU API_CONVENTIONS lacks §15 (Actor) and its B0.6 status is stale (says deferred; EN says done). Pre-existing, out of B9 scope.
