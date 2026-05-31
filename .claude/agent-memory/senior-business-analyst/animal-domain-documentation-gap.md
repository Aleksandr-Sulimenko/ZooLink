---
name: animal-domain-documentation-gap
description: Animal domain documentation missing fields owned_since, mother_id, father_id, deactivated_at in conceptual model
metadata:
  type: project
---

The animal domain documentation (both English and Russian versions) includes a conceptual data model table that is missing several fields present in the database schema (database_schema.sql) and ERD_DESCRIPTION.md. Specifically, the following fields are absent from the documentation's conceptual model but present in the database:
- `owned_since` DATE
- `mother_id` UUID (foreign key to animals.id, for future pedigree)
- `father_id` UUID (foreign key to animals.id, for future pedigree)
- `deactivated_at` TIMESTAMP WITH TIME ZONE (for soft deletion of animals)

Additionally:
- The business rules section 3. Animal Deactivation/Archival discusses deactivation but does not reference the `deactivated_at` field.
- The `mother_id` and `father_id` fields are mentioned in the Open Questions & Assumptions and Related Domains as future work, but are not included in the conceptual model.
- The `owned_since` field is not mentioned anywhere in the documentation.

This inconsistency creates a traceability gap where business rules and documentation do not reflect the actual data model implemented in the database.

**How to apply:** Update the conceptual model table in both docs/02-requirements/business-requirements/animal-domain.md and docsRU/02-requirements/business-requirements/animal-domain.md to include the missing fields with appropriate descriptions. Also consider adding references to these fields in the relevant business rules sections (e.g., deactivation rules should mention `deactivated_at`). Ensure the English and Russian versions remain consistent after updates.