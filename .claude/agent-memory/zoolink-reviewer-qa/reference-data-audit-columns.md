---
name: reference-data-audit-columns
description: species/breeds/cities lookup tables lack created_by/updated_by/sort_order — reference-data CRUD audit (GAP-006/D4) needs schema form before Admin CRUD ships
metadata:
  type: project
---

INT lookup tables `species`/`breeds`/`cities` (schema:13-42) have **no** `created_by`, `updated_by`, `sort_order`, or `description` columns. Admin-BR (`admin-domain.md`) expects versioned/audited reference-data CRUD with sort_order.

The general `audit_log` table can record reference-data changes (action + before/after), so a separate per-row audit may not be needed — but `sort_order` (ordering of dropdown values) and operator attribution decisions affect the table FORM and should be decided when the reference-data model is canonised (Plan item A2), not deferred to D4.

**Why:** Admin Slice 2-4 is built on reference-data; adding columns to lookup tables after CRUD ships is a migration on live data.
**How to apply:** When reviewing A2/A3/D4, require an explicit decision on sort_order + created_by/updated_by (or "audit via audit_log only") as part of the reference-data model canonisation, with negative tests for the CRUD audit path.
