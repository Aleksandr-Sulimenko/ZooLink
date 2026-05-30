---
name: schema_alignment_analysis
description: Analysis of database schema alignment with domain models and MVP scope
metadata:
  type: project
---

Assessment of database schema alignment with documented domain models (animal-domain.md, identity-domain.md) and MVP scope.

**database_schema.sql (initial):**
- Identity Domain: Significant mismatches - uses email as primary identifier, missing OAuth fields, incorrect name structure, missing.profile fields
- Animal Domain: Major mismatches - wrong field names (name vs nickname), missing breed_text, incorrect health/reproductive fields, wrong soft delete mechanism
- Overall: Requires substantial rework to align with documented models

**database_schema_aligned.sql:**
- Identity Domain: Excellent alignment - all required fields present with correct types and constraints
- Animal Domain: Good alignment with minor issues:
  1. Redundant `name` and `nickname` fields (docs specify only nickname as display name)
  2. Sex CHECK uses lowercase values while docs show capitalized (logically equivalent)
  3. Missing application-level validation for breed_id/breed_text dependency
  4. Missing enforcement of immutable fields after creation (species, breed, sex, DOB)
  5. Missing prevention of ownership changes on MVP

**Recommendations for database_schema_aligned.sql:**
1. Remove `name` column from animals table, keep only `nickname` 
2. Consider updating sex CHECK to use ('Male','Female') for consistency with docs
3. Ensure application validates: if breed_id IS NULL THEN breed_text IS NOT NULL
4. Implement application-level validation to prevent changes to species_id, breed_id (if from directory), sex, date_of_birth after creation
5. Implement application-level block on ownership changes during MVP phase