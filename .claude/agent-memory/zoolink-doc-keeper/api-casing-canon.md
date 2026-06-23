---
name: api-casing-canon
description: API request/response bodies use camelCase; DB stays snake_case; sort/filter query params stay snake_case
metadata:
  type: project
---

API JSON bodies (request + response) are **camelCase**. Owner-locked decision 2026-06-23 (ADMIN_PHASE_ACTION_PLAN.md Owner-decisions #1, phase B0.1). Database columns stay snake_case (ADR-0007 SQL canon). The mapping happens in the app layer.

**Why:** consistency for frontend/codegen consumers; previously contracts mixed snake_case (listings, organization, matching) and camelCase. Single canon kills churn at codegen time (C3 conformance gate).

**How to apply:**
- Convert all schema property names + requestBody/response fields to camelCase: `animal_id`→`animalId`, `is_active`→`isActive`, `created_at`→`createdAt`, `price_cents`→`priceCents`, etc.
- DO NOT camelCase: §12 sort/filter QUERY params (those stay snake_case by API_CONVENTIONS §12 — `sort=created_at:desc`, filter params `species_id`). Pagination params `page`/`limit` are already flat.
- DO NOT touch `$ref` targets, enum string VALUES, URL paths, x-required-roles values, securityScheme names.
- `price_cents` keeps its name semantically but becomes `priceCents` in body casing (money suffix rule §7 is about minor-units, not casing).

See [[api-conformance-b0]], [[camelcase-conversion-pitfalls]].
