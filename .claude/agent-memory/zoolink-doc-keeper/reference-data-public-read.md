---
name: reference-data-public-read
description: reference-data GET list/byId are PUBLIC reads (security:[], no x-required-roles); only /new form + CUD are ADMIN
metadata:
  type: project
---

admin-api.yaml reference-data authorization (fixed B0-followup, 2026-06-23, EN canon + RU mirror):

- `GET /reference-data/{dataset}` (list) and `GET /reference-data/{dataset}/{id}` (byId) are **PUBLIC reads**:
  `security: []` opt-out, **NO `x-required-roles`**, and drop `401`/`403` from responses (byId keeps 404).
  Was wrongly `x-required-roles: [ADMIN]` — a real doc bug (DIV candidate for orchestrator).
- **Stays ADMIN:** `GET /reference-data/{dataset}/new` (editor form template — NOT in §3 public list), `POST`,
  `PATCH /{id}`, `PATCH /{id}/toggle-active`.

Source of truth that drove the fix:
- rbac-matrix.md row "Reference data = R / R / C-R-U-D" (USER reads, ADMIN does CUD) + §3 public-endpoint list
  explicitly names "reference-data `GET`".
- API_CONVENTIONS.md §3: public ops opt out with `security: []` and **omit** `x-required-roles`; §6 line 71
  public ops omit 401/403.
- code `reference-data.controller.ts`: `@Get()` + `@Get(':id')` are `@Public()` + `OptionalJwtGuard`;
  `@Get('new')`/POST/PATCH/toggle = `@Roles('ADMIN')`.

Read shape by context (§6): PUBLIC read returns resolved `name` (Accept-Language); ADMIN/editor read returns
`nameLocalized`. `includeInactive=true` honoured for ADMIN only. See [[api-conformance-b0]] [[api-casing-canon]].
