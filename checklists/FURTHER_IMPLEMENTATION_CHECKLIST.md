# Further Implementation Checklist for ZooLink Organization/Branch Modeling

## 📋 API Contracts to Document
- [x] **03-architecture/api-contracts/organization-api.yaml** (new)
  - Create OpenAPI 3.0 specification for organization API
  - Include CRUD operations for organizations
  - Include endpoints for managing organization users
- [x] **03-architecture/api-contracts/branch-api.yaml** (new)
  - Create OpenAPI 3.0 specification for branch API
  - Include CRUD operations for branches
- [x] **Update existing listings-api.yaml**
  - Add optional organization_id/branch_id in request/response schemas
  - Update Listing object schema to include these fields
- [x] **Update existing animals-api.yaml**
  - Add optional organization_id in request/response schemas
  - Update Animal object schema to include this field

## ⚙️ Tech Stack Decisions
- [x] **docs/04-decisions/0001-tech-stack.md**
  - Add note about using role‑based access control library (e.g., CASL) for organization/user permissions
  - Specify where this will be integrated (NestJS Guards, React hooks/HOCs)

## 🔍 Verification Steps for New Items
- [x] Ensure all new API contract files compile without syntax errors (YAML/OpenAPI lint)
- [x] Verify that API contracts accurately reflect the implemented database schema
- [x] Check that terminology is consistent across API contracts and documentation
- [x] Confirm that added tech stack decisions align with actual implementation plans

## 📝 Final Sign‑off
- [x] Document owner signs off the checklist – add a completed‑date line at the bottom.
- [x] Commit the checklist and all related files with a clear commit message.

Completed: 2026-06-15