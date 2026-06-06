# Pending Documentation Checklist for ZooLink

*This checklist contains all remaining documentation‑only tasks that are not yet completed across the various checklists. Backend‑implementation items (DB schema changes, API DTO/guard updates, validation logic, etc.) have been removed. Use this list to track what still needs to be written or updated in specs, glossaries, traceability, API contracts (as documentation), ADRs, etc.*

---

## ✅ Completed (for reference)

The following items have been marked as completed in the source checklists and are therefore **not** shown here:
- All items in `DOCUMENTATION_CHECKLIST.md`
- All items in `FURTHER_IMPLEMENTATION_CHECKLIST.md`
- Completed documentation‑specific items from `ACCURACY_FIX_CHECKLIST.md` (spec updates, terminology changes, frontmatter, cross‑reference checks, etc.)

---

## 📋 Pending Documentation‑Only Tasks

### 1. Animal Domain – Health Records Note
- [ ] **Spec clarification**: In `docs/02-requirements/business-requirements/animal-domain.md` (and Russian version), consider whether to keep a single logical `healthStatus` field as a view, noting that the implementation splits into `health_records` and `reproductive_data` JSONB columns for indexing. Add a short note if this approach is chosen.

### 2. API Contracts Documentation (OpenAPI 3.0)
*(Treat these as documentation – write/update the YAML files even if implementation is pending.)*

- [ ] **Organization API** – create `03-architecture/api-contracts/organization-api.yaml`  
    - Define CRUD endpoints for organizations  
    - Define endpoints for managing organization users  
    - Include request/response schemas with proper validation  
    - Add security schemes (Bearer token)  
    - Document error responses and standard HTTP status codes  
    - Add examples for common operations  

- [ ] **Branch API** – create `03-architecture/api-contracts/branch-api.yaml`  
    - Define Branch‑specific CRUD endpoints  
    - Include branch‑animal relationships if applicable  
    - Document branch‑level permissions and access controls  

- [ ] **Update Listings API** (`03-architecture/api-contracts/listings-api.yaml`)  
    - Add optional `organization_id` and `branch_id` fields to the Listing schema  
    - Update create/listing endpoints to accept organization/branch context  
    - Add query parameters for filtering by organization/branch  
    - Document access control rules for organization‑owned listings  

- [ ] **Update Animals API** (`03-architecture/api-contracts/animals-api.yaml`)  
    - Add optional `organization_id` field to the Animal schema  
    - Update create/animal endpoints to accept organization context  
    - Add query parameters for filtering by organization  
    - Document inheritance of organization permissions to animal records  

- [ ] **Update Matching API** (`03-architecture/api-contracts/matching-api.yaml` – if exists)  
    - Document organization‑aware matching rules  
    - Specify how organization ownership affects matching eligibility  
    - Add intra‑organization matching flag handling  

### 3. Technical Stack Decisions Documentation
- [ ] **docs/04-decisions/0001-tech-stack.md** – expand or create sections for:  
    - **Role‑Based Access Control (RBAC) library selection**  
        - Evaluate CASL, AccessControl, Zod‑based, or custom solution  
        - Document chosen library and justification  
        - Include implementation pattern examples (NestJS Guards, React hooks/HOCs)  
    - **API Documentation approach**  
        - OpenAPI/Swagger version (3.0.3 recommended)  
        - Tooling for generation/validation (Swagger UI, Redoc, StopLight)  
        - Strategy for keeping docs in sync with implementation (e.g., CI validation, pre‑commit hooks)  
    - **API Gateway/Management considerations**  
        - Rate limiting strategy  
        - Authentication/authorization centralization  
        - Logging and monitoring requirements  
    - **Data validation approach**  
        - Library choice (Joi, Yup, Zod, class‑validator)  
        - Validation layer placement (controller, service, model)  
        - Error formatting strategy  
    - **API versioning strategy**  
        - URI versioning (`/api/v1/`) vs header vs query parameter  
        - Deprecation policy  
        - Backward compatibility guarantees  

### 4. Verification Steps for Documentation
- [ ] **API Contract Validation**  
    - Validate all YAML files against OpenAPI 3.0 schema  
    - Ensure all required fields are marked appropriately  
    - Verify that enum values are properly defined  
    - Check that examples match schema definitions  
    - Confirm security schemes are correctly referenced  

- [ ] **Tech Stack Decision Validation**  
    - Ensure decisions align with project NFRs (performance, security, scalability)  
    - Verify licensing compatibility of selected libraries  
    - Check that the team has expertise or a training plan for chosen technologies  
    - Document any known limitations or trade‑offs  

- [ ] **Cross‑Cutting Concerns**  
    - Ensure API contracts reflect security requirements (authentication, authorization, data protection)  
    - Verify that tech stack decisions support scalability and performance goals  
    - Confirm that decisions align with organizational standards and compliance requirements  
    - Check that auditability and logging requirements are addressed  

### 5. Review & Approval Process
- [ ] Review API contracts with the backend team for implementability  
- [ ] Review tech stack decisions with the architecture review board (or senior system analyst)  
- [ ] Obtain product‑owner approval for the API surface and functionality described in the docs  
- [ ] Obtain security‑team review for authentication/authorization approaches  
- [ ] Document final decisions with rationale and alternatives considered (e.g., in an ADR or the tech‑stack file)  

### 6. Timeline & Milestones (optional, for tracking)
- [ ] API contracts draft completion: [DATE]  
- [ ] API contracts review completion: [DATE]  
- [ ] Tech‑stack decisions finalization: [DATE]  
- [ ] Implementation kickoff: [DATE]  

---

## 📝 General Analysis & Documentation Tasks (Re‑usable)

*Use the following generic items when working on any new feature idea, specification update, or analysis effort.*

### ✅ New Documentation to Create
- [ ] **Feature Idea Document** – e.g., `docs/02-requirements/business-requirements/<new-feature>-domain.md` or under `docs/02-requirements/` with an appropriate name.  
- [ ] **Russian translation** – mirror the above in `docsRU/02-requirements/business-requirements/`.  
- [ ] **Glossary entries** – add definitions for any new terms/concepts in `docs/specs/glossary.md` and `docsRU/specs/glossary.md`.  
- [ ] **Traceability Matrix updates** – add new rows linking Business Requirement ID → Specification → Verification Criteria → ADR → DB schema → API contracts (both language versions).  
- [ ] **Domain Model updates** – if new entities/attributes are suggested, update the conceptual model tables in the relevant domain specification files (both EN and RU).  
- [ ] **ERD description updates** – describe new tables/relationships in `ERD_DESCRIPTION.md` (shared for both locales).  
- [ ] **Mermaid ERD sketch** – optionally update `ZooLink_ERD.mmd` to visualize new entities (still documentation‑only).  

### 📝 Existing Documentation to Review & Possibly Update
- [ ] **README files** – ensure top‑level `README.md`, `docs/README.md`, `docsRU/README.md` mention any new major capability areas.  
- [ ] **Project Structure Map** – after adding new docs, update `docs/project-structure-map.md` (see its maintenance section).  
- [ ] **Domain‑Specific** (adjust per feature):  
    - Animal Domain – new fields (health sub‑types, behavioral traits) or rules.  
    - Organization / Branch – hierarchical organization, multi‑branch reporting, verification levels.  
    - Pet & Livestock Marketplace – new listing types, additional metadata fields, promotion/commission workflows.  
    - Matching – new matching criteria (genetic compatibility, geographic proximity), scoring models.  
    - Admin / Moderation – new moderation actions, automated fraud detection, reporting dashboards.  
    - Geo‑search – new search facets (services offered, facility type).  
    - Frontend – new UI concepts/pages (organization profile, analytics dashboard) – capture as wireframe sketches or description in `docs/specs/08-frontend-architecture.md`.  
    - Non‑Functional Requirements – update the relevant NFR files under `docs/02-requirements/nfr/` and `docsRU/02-requirements/nfr/` if the idea impacts performance, scalability, security, extensibility.  

- [ ] **API Contracts (documentation‑only)**  
    - If the idea introduces a new endpoint or modifies an existing one, update the corresponding OpenAPI YAML in `03-architecture/api-contracts/` **as documentation** (even if not yet implemented).  
    - Add request/response examples, describe new query parameters, headers, error codes.  

- [ ] **Architectural Decisions (ADR)**  
    - If the idea leads to a new significant design choice (e.g., event‑sourcing for a sub‑domain, introducing CQRS, choosing a specific third‑party service), create a new ADR in `docs/04-decisions/` following the existing template (e.g., `0002-<short-name>.md`).  

### 🔍 Verification Steps (Documentation‑Only)
- [ ] **Consistency & Completeness**  
    - All newly created files are valid Markdown (no syntax errors). Run `markdownlint` or similar if available.  
    - All cross‑references (e.g., `see animal-domain.md`) point to existing files; if referencing a planned file, note it as “(planned)” and create a placeholder.  
    - Terminology is consistent: use the same Russian and English terms across docs (check glossary).  
    - Both English and Russian versions mirror each other where translation is expected (except for intentional locale‑specific notes).  
    - No duplicate or conflicting business rules appear in different specifications.  

- [ ] **Traceability**  
    - For each new business rule or feature idea captured, there is a line in the Traceability Matrix (both EN and RU) linking it to at least one specification, one verification criterion, one ADR (if applicable), and notes on DB/API impact.  
    - Any new entity/attribute mentioned in a spec is reflected in the conceptual model table of that spec and, if appropriate, in the ERD description.  

- [ ] **Artifact Hygiene**  
    - No stray files left in the repo root; everything resides under appropriate directories (`docs/`, `docsRU/`, `03-architecture/`, `checklists/`, etc.).  
    - File names follow kebab‑case and the established numbering convention (where applicable).  
    - Diagrams (if added) are in `.svg` or `.mmd` format and are referenced from the relevant spec.  

### 📅 Review & Sign‑off
- [ ] Peer review: at least one other team member (or the system analyst) has reviewed the new/updated documentation and left comments or approval.  
- [ ] Document owner (you) signs off the checklist – add a completed‑date line at the bottom.  

---

## 📅 Completed
**Completed by:** _______________________  
**Date:** _______________________

*After completing the checklist, commit all changes to the `analytics` branch with a clear commit message, e.g.:*  
`docs: update pending documentation checklist and capture new feature ideas for <topic>`.

--- 

*Tip:* Keep this checklist lightweight – only tick items that are genuinely relevant to the current analysis effort. If a section does not apply, you may skip it but leave a brief comment why.