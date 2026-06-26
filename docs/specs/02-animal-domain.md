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
   - [ ] Create AnimalService (business logic: validation, ownership transfer [simplified direct flow per ADR-0013 — see round-6 section], archival)
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

**Color/coat is a discrete attribute** (round-5, normative): color/coat is stored in the structured column
`color_coat VARCHAR(100)` and exposed by the API as its own field **`colorCoat`** (camelCase ↔ DB `color_coat` snake_case,
API_CONVENTIONS §12). It is **not** folded into the free-text `description_localized` / `descriptionLocalized`. It is
**mutable** (patchable via `AnimalUpdate`, unlike the immutable species/sex/DoB) and optional/nullable.

**Other:** `microchip_id`/`tattoo_brand_id` are **unique** (migration 0004) — supersedes earlier "warned, not enforced"
wording; chip format SHOULD follow ISO-11784/85 (15 digits, service-validated). Correcting an immutable field
(species/sex/DoB) requires an audit-logged admin procedure (not self-service). `breed_id` may be normalized **once**
from custom (NULL) → directory id (migration 0008).

## Ownership transfer — MVP rules (round-6, normative)

Ownership transfer **is in MVP** as a **simplified direct transfer** — ratified by
[ADR-0013](../04-decisions/0013-mvp-ownership-transfer.md), resolving GAP-TRACE-007 toward the apex business
requirement (`../02-requirements/business-requirements/animal-domain.md:56-61`). This supersedes any earlier
"ownership change is locked during MVP" wording.

**Flow.** The animal's **current owner** initiates a transfer to a **recipient** (an existing **user OR organization**)
→ the recipient **accepts** or **declines** → on **accept**, in **one transaction**: the animal's
`owner_id`/`organization_id` is atomically re-attributed, the `ownership_transfers` row moves `PENDING → COMPLETED`
(`completed_at` set), and `animal_ownership_history` is appended (close the prior interval `end_date`, open the new
`start_date`); `animals.owned_since` is updated. The initiator may **cancel** a still-`PENDING` transfer; an unaccepted
transfer **expires** after **72h** (lazy-on-read in MVP, no worker). Decline / cancel / expire → terminal **`CANCELLED`**.

**Controlled owner-lock (GUC).** The owner-lock trigger `trg_animals_immutable_and_owner` no longer blocks every
`owner_id`/`organization_id` change — it permits the change **only** when the transfer service has set the
transaction-local GUC `app.ownership_transfer = 'on'` in the same transaction (ADR-0013 §2). Outside that path the lock
is fully in force. The immutable `species_id` / `sex` / `date_of_birth` / `breed_id` checks are **unchanged** (see the
round-4/round-5 sections above); only the owner/org branch becomes conditional.

**Invariants (MVP).**
1. Only the **current owner** (present `owner_id`, or an authorized org-admin of the present `organization_id`) may initiate.
2. **Recipient ≠ current owner** (no self-transfer).
3. **At most one active `PENDING` transfer per animal** (partial unique index `UNIQUE (animal_id) WHERE status='PENDING'`).
4. On accept: **atomic** re-attribution + `ownership_transfers.status=COMPLETED` + `animal_ownership_history` append +
   `animals.owned_since` update — all-or-nothing, under the GUC.
5. The acting principal of each act (initiate / accept / decline / cancel) is snapshotted as `{actor_id, principal_type}`
   (HUMAN or AGENT — ADR-0006/0011); a transfer may be brokered by an AI agent without a future rewrite.
6. `expires_at` is set at initiate (72h default).

**MVP states:** `PENDING`, `COMPLETED`, `CANCELLED`. The heavy verification superset (`IN_PROGRESS`, `FAILED`,
payment/vet/legal/CITES, two-sided confirmation, escrow) is **deferred behind `feature_toggles.ownership_transfer_verification`**
(default off) — form kept on the existing `ownership_transfers` columns, behaviour later. Full lifecycle: the
[Ownership Transfer State Machine](statemachines/ownership_transfer_state_machine.md). The schema deltas the MVP flow needs
(`CANCELLED` status, `from/to_organization_id`, `completed_at`, principal-type snapshots, `transfer_reason`, the partial
unique index) are defined in ADR-0013 §3 and owed via a backend migration.

**Contract.** The build-ready API contract is [transfers-api.yaml](../03-architecture/api-contracts/transfers-api.yaml)
(initiate `POST /animals/{id}/transfers`; accept/decline/cancel `POST /transfers/{transferId}/{action}`; read
`GET /transfers/{transferId}`; list `GET /transfers?role=initiated|incoming&status=…`). The settled trail is read via
the existing `GET /animals/{id}/ownership-history` (its `AnimalOwnershipHistory` schema was widened to carry org owners —
`ownerId` nullable + `organizationId`, OQ-1 **resolved = option (a)**, landed in migration 0023).

### States & transitions (MVP) — testable transition table

States used in MVP: **PENDING**, **COMPLETED** (terminal), **CANCELLED** (terminal). `IN_PROGRESS` / `FAILED` are
reserved for the Phase-2 verified flow.

| # | From | Event (trigger) | Guard | To | Effect |
|---|---|---|---|---|---|
| T1 | `[*]` | initiate (`POST /animals/{id}/transfers`) | actor = current owner (or org-admin of owning org); recipient ≠ current owner; recipient is exactly one of user/org; no other active PENDING for this animal | `PENDING` | create row; `expiresAt = now()+72h`; snapshot `initiatedBy` |
| T2 | `PENDING` | accept (`POST /transfers/{id}/accept`) | actor = named recipient (or org-admin of to-org); `now() ≤ expiresAt` | `COMPLETED` | **atomic txn**: re-attribute animal (GUC) + close prior history interval + open new interval + set `ownedSince` + set `completedAt` + snapshot `respondedBy` |
| T3 | `PENDING` | decline (`POST /transfers/{id}/decline`) | actor = named recipient (or org-admin of to-org) | `CANCELLED` | `terminalReason='declined'`; snapshot `respondedBy`; animal unchanged |
| T4 | `PENDING` | cancel (`POST /transfers/{id}/cancel`) | actor = initiator (or org-admin of from-org) | `CANCELLED` | `terminalReason='cancelled_by_initiator'`; animal unchanged |
| T5 | `PENDING` | expiry (lazy, on next read/action) | `now() > expiresAt` | `CANCELLED` | `terminalReason='expired'`; animal unchanged; no worker (OQ-2) |
| — | `COMPLETED` | terminal | — | — | the new owner may initiate a fresh transfer |
| — | `CANCELLED` | terminal | — | — | the partial-unique PENDING slot is free; a fresh transfer may be initiated |

### Decision rules (Gherkin)

```gherkin
Feature: MVP ownership transfer

  Scenario: Current owner initiates a transfer to a user
    Given an animal owned by the authenticated principal
    And no active PENDING transfer exists for that animal
    When the principal POSTs /animals/{id}/transfers with toUserId = R (R is not the owner)
    Then a PENDING transfer is created with expiresAt = createdAt + 72h
    And initiatedBy is the snapshot {actorId, principalType} of the principal
    And the response is 201 with an ETag

  Scenario: Second initiate while one is PENDING is rejected
    Given an animal with an active PENDING transfer
    When any principal POSTs /animals/{id}/transfers for that animal
    Then the response is 409 with code TRANSFER_ALREADY_PENDING

  Scenario: Self-transfer is rejected
    Given an animal owned by the authenticated principal
    When the principal initiates a transfer whose recipient is itself
    Then the response is 422 with code SELF_TRANSFER

  Scenario: Ambiguous or missing recipient is rejected
    When initiate is called with both toUserId and toOrganizationId set
    Then the response is 422 with code RECIPIENT_AMBIGUOUS
    When initiate is called with neither toUserId nor toOrganizationId
    Then the response is 422 with code RECIPIENT_REQUIRED

  Scenario: Recipient accepts — atomic re-attribution
    Given a PENDING transfer addressed to the authenticated principal
    And now() is on or before expiresAt
    When the principal POSTs /transfers/{id}/accept with a matching If-Match
    Then in one transaction the animal owner is set to the recipient
    And the prior ownership-history interval endDate is closed
    And a new ownership-history interval is opened with startDate = today
    And the transfer becomes COMPLETED with completedAt set
    And the response is 200 with the new ETag

  Scenario: Non-recipient cannot accept
    Given a PENDING transfer addressed to principal R
    When a principal other than R (and not an admin of the to-org) POSTs /accept
    Then the response is 403 with code FORBIDDEN
    And the animal is not re-attributed

  Scenario: Accept after expiry is rejected and the transfer is expired lazily
    Given a PENDING transfer whose expiresAt is in the past
    When the recipient POSTs /accept
    Then the transfer is transitioned to CANCELLED with terminalReason = expired
    And the response is 409 with code TRANSFER_EXPIRED

  Scenario: Initiator cancels a pending transfer
    Given a PENDING transfer the authenticated principal initiated
    When the principal POSTs /transfers/{id}/cancel with a matching If-Match
    Then the transfer becomes CANCELLED with terminalReason = cancelled_by_initiator
    And the animal is not re-attributed

  Scenario: Acting on a terminal transfer is rejected
    Given a transfer in COMPLETED or CANCELLED
    When any party POSTs /accept, /decline, or /cancel for it
    Then the response is 409 with code TRANSFER_NOT_PENDING

  Scenario: Stale view on a state-transition POST
    Given a PENDING transfer
    When a party POSTs /accept|/decline|/cancel with an If-Match that no longer matches
    Then the response is 412 with code STALE_RESOURCE
    When the If-Match header is absent
    Then the response is 428
```

### Invariants and negative cases (shared source of truth for backend-engineer + reviewer-qa)

This table expands the numbered invariants above into explicit negative cases, enforcement point, and the
HTTP/error-code each rejection MUST produce — so backend tests and QA coverage key off one list.

| # | Invariant (MUST hold) | Negative case (MUST be rejected) | Enforced by | Error → HTTP / code |
|---|---|---|---|---|
| INV-1 | Only the animal's **current owner** (present `owner_id`, or org-admin of present `organization_id`) may initiate. | A non-owner initiates. | service (object-level authz) | 403 `FORBIDDEN` |
| INV-2 | **Recipient ≠ current owner** (no self-transfer). | recipient resolves to the current owner. | service | 422 `SELF_TRANSFER` |
| INV-3 | Recipient is **exactly one of** user/org; from-side likewise. | both set, or neither set. | service + DB exactly-one-of CHECK | 422 `RECIPIENT_AMBIGUOUS` / `RECIPIENT_REQUIRED` |
| INV-4 | **At most one active PENDING per animal.** | a second initiate while one is PENDING. | DB `UNIQUE (animal_id) WHERE status='PENDING'` + service | 409 `TRANSFER_ALREADY_PENDING` |
| INV-5 | On accept, re-attribution + both history writes + `ownedSince` + status→COMPLETED + `completedAt` are **all-or-nothing in one txn** under `app.ownership_transfer`. | a partial write (owner changed but no history append). | single DB transaction + the trigger GUC guard (ADR-0013 §2) | 500 `INTERNAL` (txn rolls back; no state change) |
| INV-6 | `owner_id`/`organization_id` change **only** through the transfer path (GUC set). | a direct `UPDATE animals SET owner_id=…` outside the txn. | DB trigger raises | (not an API path) DB exception |
| INV-7 | Immutable `species_id`/`sex`/`date_of_birth`/`breed_id` stay immutable through transfer. | a transfer also mutates an immutable field. | DB trigger (unchanged branch) | DB exception → surfaced |
| INV-8 | Only the **named recipient** (or to-org admin) may accept/decline. | another principal accepts/declines. | service | 403 `FORBIDDEN` |
| INV-9 | Only the **initiator** (or from-org admin) may cancel. | a non-initiator cancels. | service | 403 `FORBIDDEN` |
| INV-10 | A transfer is actionable only while **PENDING**. | accept/decline/cancel on a terminal transfer. | service (state precondition) | 409 `TRANSFER_NOT_PENDING` |
| INV-11 | A PENDING transfer past `expiresAt` is **not acceptable**; expired lazily on read/action. | accept after `expiresAt`. | service (lazy check) | 409 `TRANSFER_EXPIRED` (+ transition to CANCELLED/`expired`) |
| INV-12 | State-transition POSTs require a **fresh `If-Match`**. | concurrent accept vs cancel; stale/missing ETag. | service ETag compare | 412 `STALE_RESOURCE` / 428 (missing) |
| INV-13 | Each act snapshots the **acting principal** `{actorId, principalType}` (HUMAN/AGENT). | a transfer act stored without a principal snapshot. | service + schema (`*_principal_type` columns) | n/a (write-time invariant) |
| INV-14 | History trail is **append-only and gap-free**: a COMPLETED transfer closes exactly one open interval and opens exactly one new one. | accept that skips the append or leaves two open intervals. | service within the INV-5 txn | 500 `INTERNAL` (txn rolls back) |

**Domain error codes (extend API_CONVENTIONS §4):** `TRANSFER_ALREADY_PENDING` (409), `TRANSFER_NOT_PENDING` (409),
`TRANSFER_EXPIRED` (409), `SELF_TRANSFER` (422), `RECIPIENT_AMBIGUOUS` (422), `RECIPIENT_REQUIRED` (422); plus the
standard `STALE_RESOURCE` (412), `FORBIDDEN` (403), `NOT_FOUND` (404), `VALIDATION_ERROR` (400).

**RBAC (rbac-matrix.md "Animal ownership transfer" row, MVP normative):** USER (and breeder/farmer/vet/groomer) =
initiate own (as current owner) / accept-or-decline incoming / cancel own-initiated; MODERATOR = R;
ADMIN = R/U (override). The row applies identically regardless of `principal_type` (ADR-0011 §7).

> **OQ-1 RESOLVED (option (a)) — landed in migration 0023.** `animal_ownership_history.owner_id` is now **nullable**
> with a nullable `organization_id` and a `chk_aoh_owner_party` exactly-one-of CHECK (mirroring `animals.chk_animal_ownership`),
> so org-owned intervals are recordable. The contract's org-capable `AnimalOwnershipHistory` shape is therefore backed by the
> schema and the org-transfer path is unblocked.
> **(round-7, normative) ЧТО:** OQ-1 закрыт = вариант (a); `animal_ownership_history.owner_id` → nullable + `organization_id` +
> exactly-one-of CHECK (миграция 0023). **ПОЧЕМУ:** схема (тир выше спеки) уже содержит дельту — спека отставала, помечая OQ-1
> «owed/open»; апекс-BR требует org-transfer в MVP, а контракт уже несёт org-capable форму. **ПОЧЕМУ ТАК ЛУЧШЕ:** одна правда
> по OQ-1 во всех артефактах (schema↔data-model↔спека↔контракт); org-owned интервалы истории фиксируются без переписывания;
> согласовано с ADR-0013 §3 (рекомендованный вариант (a)) и зеркалит `animals.chk_animal_ownership`.

> **(round-6, normative) ЧТО:** Добавлена нормативная секция MVP-правил передачи владения (упрощённый прямой флоу;
> recipient = user OR organization; контролируемый owner-lock через GUC `app.ownership_transfer`; 72h lazy-expiry;
> история дополняется при completion; principal snapshot HUMAN/AGENT).
> **ПОЧЕМУ:** До сих пор спека описывала transfer лишь ссылкой на стейт-машину, которая помечала флоу как post-MVP; апекс-BR
> (animal-domain:56-61, GAP-TRACE-007) и [ADR-0013](../04-decisions/0013-mvp-ownership-transfer.md) требуют transfer в MVP.
> **ПОЧЕМУ ТАК ЛУЧШЕ:** Одна нормативная точка правды по transfer внутри домена; backend получает явные инварианты
> (single-active-PENDING, atomic completion, recipient≠owner) и фазовую границу (verification за toggle); сохраняется
> история/родословная (re-attribute, не re-register) — ради чего запрет и вводился.

## Related Documents

- [Glossary](glossary.md)
- [ADR-0013: MVP Ownership Transfer](../04-decisions/0013-mvp-ownership-transfer.md)
- [Ownership Transfer State Machine](statemachines/ownership_transfer_state_machine.md)
- [Species Validation Decision Table](business_logic/species_validation_decision_table.md)
- [Animals API](../03-architecture/api-contracts/animals-api.yaml)
- [Pet Marketplace](03-pet-marketplace-domain.md)
- [Livestock Marketplace](04-livestock-marketplace-domain.md)
- [Organization Domain](11-organization-domain.md)
- [Business Requirements](../02-requirements/business-requirements/animal-domain.md)
- 🌐 RU mirror: [docsRU/specs/02-animal-domain.md](../../docsRU/specs/02-animal-domain.md)
