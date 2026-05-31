---
name: pet-marketplace-metadata-gap
description: Pet marketplace documentation mentions JSONB metadata field not present in database schema for listings table
metadata:
  type: project
---

The pet marketplace documentation (both English and Russian versions) states under Non-Functional Requirements -> Extensibility: "JSONB `metadata` field for experimental attributes (e.g., social media links, video URL placeholder)." Additionally, the conceptual data model table for listings includes a `metadata` attribute of type JSONB.

However, the database schema (`database_schema.sql`) for the `listings` table does not include a `metadata` column.

This creates a traceability gap where documented extensibility features are not implemented.

**How to apply:** Either add a JSONB `metadata` column to the `listings` table in `database_schema.sql` to match the documentation, or update the documentation to remove references to the JSONB metadata field if the feature is not planned.

Ensure that any changes are reflected consistently in both English and Russian documentation versions, and update the ERD_DESCRIPTION.md if needed.