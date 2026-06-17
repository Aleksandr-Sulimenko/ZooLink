# Business Analysis & Documentation Checklist for ZooLink

*Use this checklist when capturing new business ideas, refining specifications, or updating documentation during the analysis/design phase (no implementation).*

---

---

## ✅ New Documentation to Create

- [ ] **Feature Idea Document** – e.g., `docs/02-requirements/business-requirements/<new-feature>-domain.md` or under `docs/02-requirements/` with appropriate name.
- [ ] **Russian translation** – mirror the above in `docsRU/02-requirements/business-requirements/`.
- [x] **Glossary entries** – add definitions for any new terms/concepts in `docs/specs/glossary.md` and `docsRU/specs/glossary.md`.
- [x] **Traceability Matrix updates** – add new rows linking Business Requirement ID → Specification → Verification Criteria → ADR → DB schema → API contracts (both language versions).
- [x] **Domain Model updates** – if new entities/attributes are suggested, update relevant conceptual model tables in the domain specification files (both EN and RU).
- [x] **ERD description updates** – describe new tables/relationships in `ERD_DESCRIPTION.md` (shared for both locales).
- [x] **Mermaid ERD sketch** – optionally update `ZooLink_ERD.mmd` to visualize new entities (still documentation‑only).

---

---

## 📝 Existing Documentation to Review & Possibly Update

### General

- [ ] **README files** – ensure top‑level `README.md`, `docs/README.md`, `docsRU/README.md` mention any new major capability areas.
- [x] **Project Structure Map** – after adding new docs, update `docs/project-structure-map.md` (see its maintenance section).

### Domain‑Specific (example sections – adjust per feature)

- [ ] **Animal Domain** – consider if new fields (e.g., health sub‑types, behavioral traits) or new rules are needed.
- [x] **Organization / Branch** – think about hierarchical organization, multi‑branch reporting, verification levels.
- [ ] **Pet & Livestock Marketplace** – new listing types, additional metadata fields, promotion/commission workflows.
- [ ] **Matching** – new matching criteria (e.g., genetic compatibility, geographic proximity), scoring models.
- [ ] **Admin / Moderation** – new moderation actions, automated fraud detection, reporting dashboards.
- [ ] **Geo‑search** – new search facets (e.g., by services offered, by facility type).
- [ ] **Frontend** – new UI concepts/pages (e.g., organization profile, analytics dashboard) – capture as wireframe sketches or description in `docs/specs/08-frontend-architecture.md`.
- [ ] **Non‑Functional Requirements** – if the idea impacts performance, scalability, security, extensibility, update the relevant NFR files under `docs/02-requirements/nfr/` and `docsRU/02-requirements/nfr/`.
- [ ] **Localization/Internationalization (i18n)** – consider how to support multiple languages in UI, database schema, API responses, and documentation. This includes language selection mechanisms, translation storage, localized content management, and fallback strategies.

### API Contracts (documentation‑only)

- [x] If the idea introduces a new endpoint or modifies an existing one, update the corresponding OpenAPI YAML in `03-architecture/api-contracts/` **as documentation** (even if not yet implemented). Keep the file in the repo so the contract is visible.
- [x] Add request/response examples, describe new query parameters, headers, error codes.

### Architectural Decisions (ADR)

- [x] If the idea leads to a new significant design choice (e.g., adopting event‑sourcing for a sub‑domain, introducing CQRS, choosing a specific third‑party service), create a new ADR in `docs/04-decisions/` following the existing template (e.g., `0002-<short-name>.md`).

---

---

## 🔍 Verification Steps (Documentation‑Only)

### Consistency & Completeness

- [ ] All newly created files are valid Markdown (no syntax errors). Run `markdownlint` or similar if available.
- [ ] All cross‑references (e.g., `see animal-domain.md`) point to existing files; if referencing a planned file, note it as “(planned)” and create a placeholder.
- [ ] Terminology is consistent: use the same Russian and English terms across docs (check glossary).
- [ ] Both English and Russian versions mirror each other where translation is expected (except for intentional locale‑specific notes).
- [ ] No duplicate or conflicting business rules appear in different specifications.

### Traceability

- [ ] For each new business rule or feature idea captured, there is a line in the Traceability Matrix (both EN and RU) linking it to at least one specification, one verification criterion, one ADR (if applicable), and notes on DB/API impact.
- [ ] Any new entity/attribute mentioned in a spec is reflected in the conceptual model table of that spec and, if appropriate, in the ERD description.

### Artifact Hygiene

- [ ] No stray files left in the repo root; everything resides under appropriate directories (`docs/`, `docsRU/`, `03-architecture/`, `checklists/`, etc.).
- [ ] File names follow kebab‑case and the established numbering convention (where applicable).
- [ ] Diagrams (if added) are in `.svg` or `.mmd` format and are referenced from the relevant spec.

### Review & Sign‑off

- [ ] Peer review: at least one other team member (or the system analyst) has reviewed the new/updated documentation and left comments or approval.
- [x] Document owner (you) signs off the checklist – add a completed‑date line at the bottom.

---

---

## 📅 Completed

**Completed by:** AlexSulima  
**Date:** 2026-06-15

*After completing the checklist, commit all changes to the analytics branch with a clear commit message, e.g.:*  
`docs: add business analysis checklist and capture initial feature ideas for <topic>`.

--- 

---

*Tip:* Keep this checklist lightweight – only tick items that are genuinely relevant to the current analysis effort. If a section does not apply, you may skip it but leave a brief comment why.