# Accuracy Fix Checklist for ZooLink Specs vs Implementation

## 🎯 Goal
Address discrepancies identified between specifications (`docs/specs/*.md`) and current implementation (database_schema.sql, API contracts, requirements).

## 📋 Issues & Fixes

### 1. Role Model Mismatch
- [x] **Update database role constraint** to include BREEDER and FARMER values.
- [x] **Update specs** (`01-identity-domain.md`) if needed to reflect actual stored role values (uppercase with underscores).
- [x] **Update API DTOs / guards** (if any) to handle new roles.

### 2. Animal Identification Fields
- [x] **Option A**: Clarify in specs (`02-animal-domain.md`) that `tattoo_brand_id` serves both ear tag and passport depending on species.
- [ ] **Option B**: Extend DB schema with separate `ear_tag_id` and `passport_number` columns (if required for regulatory reporting).
- [ ] **Update validation/comments** accordingly.

### 3. Health & Reproductive Data Structure
- [x] **Update specs** (`02-animal-domain.md`) to reflect two JSONB fields: `health_records` and `reproductive_data`.
- [x] **Optionally**, keep single `healthStatus` field as logical view and note that implementation splits for indexing.

### 4. Archival/Deactivation Terminology
- [x] **Choose one term**: `deactivated_at` (current DB) vs `archivedAt` (specs).
- [x] **Update specs** (`02-animal-domain.md`, any other specs) to use selected term.
- [ ] **Update DB comment** if changing column name (prefer to keep `deactivated_at` and adjust specs).
- [ ] **Update API contracts** if they expose this field.

### 5. Organizational Ownership Missing in Specs
- [x] **Add description** of `organization_id` field to `02-animal.domain.md` (Animal spec) and `03-pet-marketplace-domain.md` / `04-livestock-marketplace-domain.md` (Listing spec).
- [x] **Include business rules** (exactly one of owner_id/organization_id) as noted in requirements.
- [x] **Update API contracts** if needed (already include).

### 6. General Specs Versioning & Traceability
- [x] **Ensure each spec file** has a YAML frontmatter with `version:` and `lastUpdated:`.
- [x] **Add a changelog section** or note to track modifications.
- [x] **Verify cross-references** (e.g., see admin-domain.md) still point to existing files.

### 7. Organization Domain Modeling Completeness
- [x] **Create organization domain specification** (`11-organization-domain.md`) with full description of Organization, Branch, Organization-Users entities, business rules, API concepts.
- [x] **Create Russian translation** of organization domain specification (`docsRU/specs/11-organization-domain.md`).
- [x] **Update ERD documents** to include organizations, branches, and organization_users tables with proper relationships.
- [x] **Create API contract documentation** for organization and branch APIs (`03-architecture/api-contracts/organization-api.yaml`, `branch-api.yaml`).
- [x] **Update existing API contracts** (listings-api.yaml, animals-api.yaml) to include optional organization_id/branch_id fields.
- [x] **Update technical stack decisions** to document RBAC library selection for organization/user permissions.

### 8. Missing Documentation Artifacts
- [x] **Verify all domain specifications** (01-15) exist in both English and Russian versions.
- [x] **Verify supporting documentation** exists: business_logic, deployment, error_handling, glossary, localization, performance_specification, README, security, statemachines, traceability Matrix.
- [x] **Update project structure map** to accurately reflect current repository structure.

## ✅ Definition of Done
- All checklist items marked `[x]`.
- Corresponding files updated and committed.
- No lint/OpenAPI validation errors introduced.
- Documentation builds without warnings.

## 📝 Final Sign‑off
- [x] Document owner signs off the checklist – add a completed‑date line at the bottom.
- [x] Commit the checklist and all related files with a clear commit message.

Completed: 2026-06-15