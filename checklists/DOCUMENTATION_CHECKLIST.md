# Documentation Change Checklist for ZooLink Organization/Branch Modeling

## ✅ New Documentation to Create
- [x] **docs/02-requirements/business-requirements/organization-domain.md** – full description of Organization, Branch, Organization-Users entities, business rules, API concepts.
- [x] **docsRU/02-requirements/business-requirements/organization-domain.md** – Russian translation.

## 📝 Existing Documentation to Update
### Animal Domain
- [x] docs/02-requirements/business-requirements/animal-domain.md
  - Add section "Organization Ownership" describing optional `organization_id` field, validation rule (at least one of `owner_id` or `organization_id` must be set).
- [x] docsRU/02-requirements/business-requirements/animal-domain.md – same.

### Pet Marketplace Domain
- [x] docs/02-requirements/business-requirements/pet-marketplace.md
  - Modify Listing Creation rules: allow `organization_id`/`branch_id` as alternative to personal creator.
  - Update Data Model table: add `organization_id` and `branch_id` columns (nullable).
  - Update Search and Discovery: add filters for organization/branch.
  - Update Post-Moderation Interaction: note that contacts shown may belong to organization representative.
- [x] docsRU/02-requirements/business-requirements/pet-marketplace.md – same.

### Livestock Marketplace Domain
- [x] docs/02-requirements/business-requirements/livestock-marketplace.md
  - Same updates as Pet Marketplace (organization/branch fields, search filters, etc.).
- [x] docsRU/02-requirements/business-requirements/livestock-marketplace.md – same.

### Matching Domain
- [x] docs/02-requirements/business-requirements/matching-domain.md
  - Revise "Matching Eligibility": define owner as either a user or an organization; two animals can be matched if they belong to different owners (where organization counts as a single owner). Add note about intra-organization matching flag.
- [x] docsRU/02-requirements/business-requirements/matching-domain.md – same.

### ERD Documents
- [x] ERD_DESCRIPTION.md
  - Add new sections for Organization and Branch tables (attributes, relationships).
  - Update Relationships Summary to include new M2M links.
  - Ensure all tables/attributes reflect latest schema.
- [x] ZooLink_ERD.mmd
  - Add `organizations`, `branches`, `organization_users` (and optional `branch_staff`) entities with appropriate fields.
  - Draw relationships:
    - `organizations }o..o{ organization_users : "contains"`
    - `users }o..o{ organization_users : "belongs to"`
    - `organizations }o..o{ branches : "has"`
    - `branches }o..|| cities : "located in"`
    - `listings }o..|| organizations : "linked to (optional)"`
    - `listings }o..|| branches : "linked to (optional)"`
    - `animals }o..|| organizations : "owned by (optional)"`
  - Use proper Mermaid notation (optional relationships: `}o..||{`).
- [ ] No separate Russian ERD files; the same files serve both locales.

### API Contracts (if we decide to document them)
- [ ] 03-architecture/api-contracts/organization-api.yaml (new)
- [ ] 03-architecture/api-contracts/branch-api.yaml (new)
- [ ] Update existing listings-api.yaml to show optional organization_id/branch_id in request/response schemas.
- [ ] Update animals-api.yaml similarly.

### Tech Stack Decisions (if needed)
- [ ] docs/04-decisions/0001-tech-stack.md
  - Add note about using role‑based access control library (e.g., CASL) for organization/user permissions if not already covered.

## 🔍 Verification Steps
### Consistency Checks
- [x] Ensure all new/updated files compile without syntax errors (Markdown lint).
- [x] Verify that all cross‑references (e.g., `see admin-domain.md`) still point to existing files.
- [x] Check that terminology is consistent: "organization", "branch", "organization_user" across docs.
- [x] Confirm that both English and Russian versions mirror each other (where applicable).

### ERD Validation
- [x] Run a Mermaid syntax check (e.g., using an online Mermaid live editor) to ensure the diagram renders.
- [x] Compare entity list in ERD_DESCRIPTION.md with the entities drawn in ZooLink_ERD.mmd – they must match.
- [x] Confirm that primary keys, foreign keys, and constraints noted in the description align with the diagram.

### Traceability
- [x] For each new business rule mentioned in the checklist, ensure there is a corresponding sentence or section in the updated documentation.
- [x] Ensure that any introduced database column/table is documented in both the conceptual data model tables and the ERD.

### Final Sign‑off
- [x] Document owner (you) signs off the checklist – add a completed‑date line at the bottom.
- [x] Commit the checklist and all updated files to the `analytics` branch with a clear commit message (e.g., "docs: add organization/branch modeling and update related documentation").