---
name: schema-analysis-2026-05-30
description: Analysis of three database schema files against domain documentation to determine correct implementation schema
metadata:
  type: project
---

Analysis performed on 2026-05-30 comparing database_schema.sql, database_schema_aligned.sql, and database_schema_final.sql against animal-domain.md and identity-domain.md documentation.

**Findings:**
1. database_schema.sql - Outdated, misaligned with domain models:
   - Uses separate first/last name instead of full_name
   - Missing OAuth fields, phone_hash, city_id
   - Incorrect health_status structure (object vs array)
   - Missing breed_text, reproductive_data, parent fields
   - Incorrect sex field allowances

2. database_schema_aligned.sql - Well aligned with domain documentation:
   - Proper identity model (phone_hash, OAuth, full_name, city_id)
   - Correct animal model with nickname, breed_text, JSONB arrays
   - Includes cities table for geo-search
   - Appropriate indexes and constraints

3. database_schema_final.sql - Best version, improvements over aligned:
   - Sex CHECK constraint uses exact casing from docs: ('Male', 'Female')
   - Includes helpful comments about required application-level validations
   - Represents fully agreed-upon schema after alignment checks

**Recommendation:** 
database_schema_final.sql should be used as the single source of truth for implementation. The other two files should be archived as they represent outdated or superseded versions.

**Action Items:**
1. Rename database_schema_final.sql to database_schema.sql (overwrite old version after backup)
2. Archive database_schema.sql and database_schema_aligned.sql with version timestamps
3. Ensure team knows single schema file is authoritative