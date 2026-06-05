---
name: zoolink-consistency-analysis
description: Comprehensive consistency analysis of ZooLink project across API contracts, database schema, documentation, and business logic
metadata:
  type: project
---

# ZooLink Project Consistency Analysis Report

## Summary of Overall Consistency Status
The ZooLink project shows foundational Domain-Driven Design work with bounded contexts, but exhibits critical inconsistencies between API contracts, database schema, and documentation layers. The database schema appears most current, with API contracts showing enum mismatches and documentation missing implemented fields.

## Specific Inconsistencies Found

### 1. Listing Type Enum Mismatch (CRITICAL)
- **Files**: 
  - listings-api.yaml: enum [sale, breeding, show, adoption] (excluding stud_service)
  - matching-api.yaml: enum [sale, breeding, show, adoption, stud_service] 
  - database_schema.sql: CHECK constraint includes stud_service
- **Impact**: Integration failure between matching and listings services
- **Lines**: listings-api lines 369-372, 447-450, 491-494; matching-api line 645; database line 208

### 2. Animal Domain Documentation Gaps
- **Missing fields in docs/specs/02-animal-domain.md conceptual model**:
  - owned_since DATE
  - mother_id UUID (foreign key to animals)
  - father_id UUID (foreign key to animals)  
  - deactivated_at TIMESTAMP WITH TIME ZONE
- **Database implementation**: lines 138, 160-164 in database_schema.sql
- **Impact**: Traceability gap between requirements and implementation

### 3. Organization Domain Metadata Communication
- Documentation describes JSONB metadata fields for extensibility
- Implementation shows metadata JSONB DEFAULT '{}'::jsonb in organizations (line 50) and branches (line 63)
- Need to verify actual usage patterns and document intended extensibility points

## Recommended Fixes

### Immediate (P0-P1)
1. Add 'stud_service' to listing_type enum in listings-api.yaml to match matching-api and database
2. Update animal domain documentation conceptual model to include all four missing fields
3. Reference missing fields in relevant business rules sections (deactivation, pedigree)

### Extensibility Preparation (P2)
1. Validate JSONB metadata field usage across organizations, branches, listings tables
2. Document intended use cases for metadata extensibility (subscription tiers, branding, etc.)
3. Consider indexing strategies for JSONB query performance

### Future Growth Accommodations (P3)
1. Multi-tenancy preparation: tenant_id column strategy
2. Localization improvements: proper i18n table beyond name_ru/name_en
3. Advanced breeding: generational tracking, inbreeding calculations
4. Regulatory extensions: veterinary visits, movement permits, DNA tests
5. Service marketplace: service types, providers, bookings tables

## Impact Assessment
- **Critical**: Listing type mismatch blocks service integration (P0)
- **High**: Documentation gaps reduce maintainability (P1) 
- **Medium**: Extensibility validation ensures feature readiness (P2)
- **Low**: Advanced features for future phases (P3)

## Key Files Referenced
- API contracts: listings-api.yaml, matching-api.yaml, organization-api.yaml
- Database: database_schema.sql
- Documentation: specs/02-animal-domain.md, specs/03-organization-domain.md, ERD_DESCRIPTION.md
- Memory gaps: animal-domain-documentation-gap.md, organization-domain-metadata-gap.md, api-contract-listing-type-mismatch.md