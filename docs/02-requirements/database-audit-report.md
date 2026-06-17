# ZooLink Database Schema Audit Report

## Executive Summary

This report compares the current ZooLink database schema (`database_schema.sql`) and ER diagram (`ZooLink_ERD.mmd`) against the documented business requirements (specifically `animal-domain.md` and `identity-domain.md`). The audit reveals several areas of non-compliance, primarily related to data type mismatches, localization approach differences, and redundant code. While the core entity relationships are largely correct, inconsistencies in foreign key types and attribute representations may impact application logic and data integrity.

**Overall Assessment**: The schema implements many features correctly but requires alignment with documented specifications to ensure consistency between requirements, design, and implementation.

## Critical Non-Compliances (Blockers)

These issues represent deviations from documented requirements that could prevent correct application behavior:

| Issue | Location | Requirement | Implementation | Impact |
|-------|----------|-------------|----------------|--------|
| Incorrect FK data types for reference data | `animals.species_id`, `animals.breed_id` | Should be `INT` (FK to reference tables) | Implemented as `UUID` | Application queries expecting integer IDs will fail; referential integrity compromised |
| Incorrect FK data type for city reference | `users.city_id` | Should be `INT` (FK to cities directory) | Implemented as `UUID` | Geo-search and localization features relying on city IDs will malfunction |
| Overly permissive role definitions | `users.role` | Should be limited to `ENUM('USER', 'MODERATOR', 'ADMIN')` | Includes `'BREEDER', 'FARMER'` in CHECK constraint | Security model deviates from documented access controls; unauthorized role assignments possible |
| Localization approach mismatch | `animals.breed_text`, `animals.nickname` | Should be simple `VARCHAR` fields per conceptual model | Implemented as `JSONB` for localization | Application code expecting simple strings will receive JSON objects, causing serialization errors |

## Missing Entities and Attributes

All core entities and attributes specified in the requirements are present in the schema, though some have type or representation differences:

| Missing/Incorrect Element | Location | Expected per Requirements | Actual in Schema | Notes |
|---------------------------|----------|---------------------------|------------------|-------|
| `species_id` data type | `animals` table | `INT` | `UUID` | Reference data IDs should be integers per requirements |
| `breed_id` data type | `animals` table | `INT` | `UUID` | Reference data IDs should be integers per requirements |
| `city_id` data type | `users` table | `INT` | `UUID` | City directory IDs should be integers per requirements |
| Simple breed text field | `animals` table | `breed_text VARCHAR(100)` | `breed_text_localized JSONB` | Localization enhancement differs from base requirements |
| Simple nickname field | `animals` table | `nickname VARCHAR(50)` | `nickname_localized JSONB` | Localization enhancement differs from base requirements |
| Role enum restriction | `users` table | `role ENUM('USER', 'MODERATOR', 'ADMIN')` | `role VARCHAR(20)` with BREEDER/FARMER allowed | Exceeds documented role set |

## Redundancy and "Dead" Code

The following redundant elements increase maintenance burden and risk of inconsistencies:

| Redundant Element | Location | Issue | Recommendation |
|-------------------|----------|-------|----------------|
| Duplicate `update_updated_at_column()` function | Lines 293-299 and 557-563 | Function defined twice with identical implementation | Remove one definition |
| Duplicate trigger creation blocks | Lines 301-319 and 565-584 | Two separate DO blocks creating identical triggers | Consolidate into single trigger creation block |
| Redundant comments on localization | Throughout schema | Comments indicating localization is an "added enhancement" but implemented in core tables | Either remove comments if localization is permanent, or revert to base requirements for MVP |

## Data Types and Constraints Checking

Systematic review of data types, lengths, and constraints against requirements:

| Field | Requirement | Implementation | Compliant? | Notes |
|-------|-------------|----------------|------------|-------|
| `animals.species_id` | `INT` (FK to species) | `UUID` (FK to species) | ❌ | Type mismatch; should be integer reference |
| `animals.breed_id` | `INT` (FK to breeds) | `UUID` (FK to breeds) | ❌ | Type mismatch; should be integer reference |
| `animals.breed_text` | `VARCHAR(100)` | `JSONB` (localized) | ❌ | Localization approach differs from requirements |
| `animals.nickname` | `VARCHAR(50)` | `JSONB` (localized) | ❌ | Localization approach differs from requirements |
| `animals.sex` | `ENUM('Male', 'Female')` | `VARCHAR(10) CHECK (sex IN ('Male', 'Female'))` | ✅ | Functionally equivalent |
| `animals.date_of_birth` | `DATE` | `DATE` | ✅ | Compliant |
| `animals.is_active` | `BOOLEAN` | `BOOLEAN` | ✅ | Compliant |
| `users.city_id` | `INT` (FK to cities) | `UUID` (FK to cities) | ❌ | Type mismatch; should be integer reference |
| `users.role` | `ENUM('USER', 'MODERATOR', 'ADMIN')` | `VARCHAR(20) CHECK (role IN ('USER', 'BREEDER', 'FARMER', 'MODERATOR', 'ADMIN'))` | ❌ | Includes undocumented roles |
| `users.phone_hash` | `VARCHAR(60)` | `VARCHAR(60)` | ✅ | Compliant (nullable if OAuth-only) |
| `users.oauth_*_id` fields | `VARCHAR(255)` | `VARCHAR(255)` | ✅ | Compliant |
| `organizations.inn` | `VARCHAR(20)` | `VARCHAR(20)` | ✅ | Compliant |
| `organizations.kpp` | `VARCHAR(20)` | `VARCHAR(20)` | ✅ | Compliant |
| `listings.price_cents` | `INTEGER` | `INTEGER` | ✅ | Compliant (nullable for non-price listings) |

## Relationship Integrity (ER Diagram vs Requirements)

The ER diagram accurately reflects the current schema implementation, but both diverge from requirements in key areas:

| Relationship | ER Diagram Shows | Requirements Specify | Compliant? | Notes |
|--------------|------------------|----------------------|------------|-------|
| `species` → `breeds` | `species.id UUID` → `breeds.species_id UUID` | `species.id INT` → `breeds.species_id INT` | ❌ | Both sides should be integer IDs |
| `species` → `animals` | `species.id UUID` → `animals.species_id UUID` | `species.id INT` → `animals.species_id INT` | ❌ | Both sides should be integer IDs |
| `breeds` → `animals` | `breeds.id UUID` → `animals.breed_id UUID` | `breeds.id INT` → `animals.breed_id INT` | ❌ | Both sides should be integer IDs |
| `cities` → `users` | `cities.id UUID` → `users.city_id UUID` | `cities.id INT` → `users.city_id INT` | ❌ | Both sides should be integer IDs |
| `cities` → `branches` | `cities.id UUID` → `branches.city_id UUID` | `cities.id INT` → `branches.city_id INT` | ❌ | Both sides should be integer IDs |
| `organizations` → `branches` | `organizations.id UUID` → `branches.organization_id UUID` | Matches (both UUID) | ✅ | Correct as per requirements |
| `users` → `animals` (ownership) | `users.id UUID` → `animals.owner_id UUID` | Matches (both UUID) | ✅ | Correct as per requirements |
| `organizations` → `animals` (ownership) | `organizations.id UUID` → `animals.organization_id UUID` | Matches (both UUID) | ✅ | Correct as per requirements |

Note: The requirements consistently use integer IDs for reference data (species, breeds, cities), while the implementation uses UUIDs for all entities. This represents a fundamental divergence in identification strategy.

## Recommendations for Improvement

### Priority 1 (Blockers - Must Fix)
1. **Correct reference data foreign key types**: Change `species_id`, `breed_id` in `animals` table and `city_id` in `users`/`branches` tables from `UUID` to `INT` to match requirements and reference table definitions.
2. **Align role definitions**: Restrict `users.role` CHECK constraint to only `('USER', 'MODERATOR', 'ADMIN')` per identity-domain.md requirements.
3. **Remove duplicate code**: Consolidate the two `update_updated_at_column()` function definitions and trigger creation blocks into single implementations.

### Priority 2 (Important - Should Fix)
4. **Evaluate localization approach**: Determine whether JSONB localization for breed_text and nickname is necessary for MVP. If not required, revert to simple VARCHAR fields as specified in requirements. If required, update requirements documentation to reflect this enhancement.
5. **Add missing constraints**: Implement application-level validations noted in schema comments (lines 449-455) as actual database triggers or check constraints where appropriate:
   - Validate breed_id/breed_text dependency
   - Validate animal ownership (exactly one of owner_id/organization_id set)
   - Prevent changes to immutable fields after creation
   - Block ownership changes during MVP phase

### Priority 3 (Optional - Could Fix)
6. **Standardize timestamp types**: Consider using `TIMESTAMPTZ` consistently (already done well) or document rationale for any variations.
7. **Add missing indexes**: Review query patterns from requirements to ensure adequate indexing for search fields mentioned in animal-domain.md (species, breed, sex, age, color/coat, microchip presence).
8. **Document enhancements**: Clearly mark which schema elements represent enhancements over base requirements (like localization JSONB fields, description_localized, metadata JSONB columns) to maintain traceability.

## Conclusion

The ZooLink database schema demonstrates good implementation of core concepts and relationships but contains several critical mismatches with documented requirements, primarily around data types for reference keys and an overly permissive role system. Addressing the Priority 1 items is essential for ensuring the application behaves as specified. The localization approach represents a deliberate enhancement that should either be incorporated into requirements or reverted for MVP alignment.

Once these discrepancies are resolved, the schema will provide a solid foundation that accurately reflects the documented business specifications while maintaining extensibility for future phases.