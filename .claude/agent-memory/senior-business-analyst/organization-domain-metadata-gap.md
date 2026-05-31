---
name: organization-domain-metadata-gap
description: Organization domain documentation mentions JSONB metadata fields that are not present in database schema
metadata:
  type: project
---

The organization domain documentation (both English and Russian versions) states under Non-Functional Requirements -> Extensibility: "JSONB `metadata` fields can be used for experimental attributes (e.g., subscription tier, branding preferences)." However, examination of the database schema (`database_schema.sql`) reveals that neither the `organizations` table nor the `branches` table includes a JSONB `metadata` column.

The schema does contain JSONB columns in other tables (e.g., `animals.health_records`, `animals.reproductive_data`, `outbox_events.payload`), but the extensibility mechanism described for the organization domain is missing from the implementation.

This creates a traceability gap where documented extensibility features are not implemented, potentially leading to confusion during development or where future features relying on this metadata field would require schema changes.

**How to apply:** Either:
1. Add a JSONB `metadata` column to both `organizations` and `branches` tables in `database_schema.sql` to match the documentation, OR
2. Update the documentation to remove references to JSONB metadata fields for organization/branch extensibility if the feature is not planned.

Ensure that any changes are reflected consistently in both English and Russian documentation versions, and update the ERD_DESCRIPTION.md if needed.