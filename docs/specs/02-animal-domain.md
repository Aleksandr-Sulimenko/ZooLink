---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# Spec: Animal Domain

## Outcome
Manage the core animal entity as an aggregate root, representing pets and livestock. Enable creation, updating, and retrieval of animal records, including breed, species, age, health status, and ownership. Ensure data integrity and compliance with Russian animal identification and tracking regulations.

## Scope & Boundaries
**In Scope:**
- Animal as aggregate root with global unique identifier (UUID)
- Attributes: species (dog, cat, cattle, etc.), breed, nickname, date of birth, sex, color/coat, markings, health records (JSONB: vaccinations, treatments), reproductive data (JSONB: heat cycles, mating), ownership history
- Lifecycle: creation (by owner/breeder), update, deactivation (not deletion for compliance)
- Relationships: one animal can have multiple listings (sale, breeding, show)
- Integration with Identity Domain (owner reference)
- Validation rules per species/breed (e.g., cattle require ear tag)
- Compliance with Russian animal identification (microchip ID for pets, tattoo/brand ID for livestock) and 152-ФЗ for personal data of owners

**Out of Scope:**
- Genetic lineage tracking (pedigree) - deferred to phase 2
- Veterinary medical records (detailed health history) - deferred
- Animal movement tracking (for livestock) - deferred
- Auction/bidding systems - deferred

## Constraints
- **Legal:** Must comply with Russian veterinary legislation, animal identification laws (e.g., Federal Law "On Veterinary Medicine"), and 152-ФЗ for owner data.
- **Data Integrity:** Prevent duplicate animal records (microchip/ear tag uniqueness where applicable).
- **Extensibility:** Support future attributes via JSONB or extension entities without schema changes.
- **Performance:** Animal lookup by microchip/ID < 500ms.
- **Scalability:** Support 1M+ animal records.
- **Technology:** Align with NestJS, TypeScript, PostgreSQL.
- **Usability:** UI must guide users through complex attribute entry (species-dependent fields).

## Prior Decisions
- Animal is an aggregate root with UUID as primary key.
- Species and breed are reference data (managed via Admin Domain).
- Ownership is linked to Identity Domain (User) via many-to-one (one animal has one current owner, but we track ownership history).
- Animal attributes vary by species; we use a combination of fixed columns and JSONB for extensible attributes.
- Russian regulations require tracking of microchip ID (for pets) and ear tag/passport (for livestock).
- We store minimal owner personal data in Animal (just userId reference) to comply with 152-ФЗ; full owner details are in Identity Domain.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Animal search by microchip returns in <500ms with 100k records (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Owner PII not duplicated in animal table to comply with 152-ФЗ (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Animal management UI follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `animal` module
   - [ ] Define Animal entity with fields: id (UUID), speciesId, breedId, nickname, dateOfBirth, sex, colorCoat, markings, microchipId, tattooBrandId, healthRecords (JSONB), reproductiveData (JSONB), ownerId (FK to User), organizationId (FK to Organization, nullable), ownedSince, motherId, fatherId, deactivatedAt, createdAt, updatedAt
   - [ ] Create reference tables for Species and Breed (managed via Admin Domain)
   - [ ] Implement validation rules per species (e.g., if species=cattle, earTagId required)
   - [ ] Create AnimalController (CRUD operations, search by microchip/ear tag)
   - [ ] Create AnimalService (business logic: validation, ownership transfer, archival)
   - [ ] Create AnimalRepository (using Prisma)
   - [ ] Set up database indexes: microchipId, earTagId, speciesId+breedId
   - [ ] Write unit and integration tests for animal lifecycle
   - [ ] Create OpenAPI docs for animal endpoints

2. **Frontend (React)**
   - [ ] Create animal management pages: Add Animal, Edit Animal, View Animal
   - [ ] Implement dynamic form that adjusts fields based on selected species/breed
   - [ ] Implement microchip/ear tag input with validation
   - [ ] Create animal card component for listings
   - [ ] Integrate with Identity Domain to show owner info (without exposing PII unnecessarily)
   - [ ] Write unit and e2e tests for animal flows

3. **Infrastructure**
   - [ ] Ensure PostgreSQL extension for UUID and JSONB
   - [ ] Configure Prisma schema for Animal, Species, Breed
   - [ ] Add database triggers for ownership history logging (optional, could be handled in service layer)
   - [ ] Set up audit trail for animal changes (for compliance)
   - [ ] Implement GDPR/152-ФZ data retention policies (archival vs deletion)

## Verification Criteria
- [ ] Unit tests >90% coverage for animal module (backend)
- [ ] Integration tests cover: animal creation (valid/invalid per species), update, ownership transfer, search by microchip/ear tag, deactivation
- [ ] E2E tests cover: user adds animal with species-specific fields, views animal, edits animal
- [ ] Manual testing: verify microchip uniqueness constraint, species-dependent validation
- [ ] Performance: animal search by microchip returns in <500ms with 100k records
- [ ] Compliance: data model supports Russian animal identification requirements; owner PII not duplicated in animal table
- [ ] Documentation: OpenAPI spec generated and available
- [ ] Additional fields: Verify owned_since, mother_id, father_id, deactivated_at fields are properly implemented and tested
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented

---

## Pedigree integrity & JSONB contracts (round-4, normative)

**Pedigree integrity** (enforced by trigger `trg_enforce_pedigree_integrity`, migration 0008):
- An animal cannot be its own parent; **no cycles** (an animal may not be its own ancestor; checked to depth 64).
- `mother_id` must reference a **Female** of the **same species**, born **before** the offspring; `father_id` a **Male**, same rules.
- `mother_id`/`father_id` NULL = "unknown/external ancestor" (external pedigree numbers live in `pedigree_id`; a richer
  external-ancestor model is Фаза 2+).
- Deactivated animals remain in their offspring's pedigree (lineage integrity) but are excluded from breeding search (`is_active`).

**JSONB field contracts** (each is a JSON **array**; validate `jsonb_typeof = 'array'` + per-item shape at the service layer):
- `health_records`: `[{ "type": "vaccination|treatment|checkup", "date": "YYYY-MM-DD", "note": str, "vet": str? }]`
- `reproductive_data` (females): `[{ "event": "heat|mating|pregnancy|birth", "date": "YYYY-MM-DD", "details": obj? }]`
- `health_test_results`: `[{ "test": str (HD|ED|PRA|DNA…), "result": "clear|carrier|affected|<value>", "date": "YYYY-MM-DD", "lab": str? }]`
- `show_titles`: `[{ "title": str, "show": str?, "date": "YYYY-MM-DD"?, "country": str?, "rank": str? }]`

**Other:** `microchip_id`/`tattoo_brand_id` are **unique** (migration 0004) — supersedes earlier "warned, not enforced"
wording; chip format SHOULD follow ISO-11784/85 (15 digits, service-validated). Correcting an immutable field
(species/sex/DoB) requires an audit-logged admin procedure (not self-service). `breed_id` may be normalized **once**
from custom (NULL) → directory id (migration 0008).

## Related Documents

- [Glossary](glossary.md)
- [Ownership Transfer State Machine](statemachines/ownership_transfer_state_machine.md)
- [Species Validation Decision Table](business_logic/species_validation_decision_table.md)
- [Animals API](../03-architecture/api-contracts/animals-api.yaml)
- [Pet Marketplace](03-pet-marketplace-domain.md)
- [Livestock Marketplace](04-livestock-marketplace-domain.md)
- [Organization Domain](11-organization-domain.md)
- [Business Requirements](../02-requirements/business-requirements/animal-domain.md)
- 🌐 RU mirror: [docsRU/specs/02-animal-domain.md](../../docsRU/specs/02-animal-domain.md)
