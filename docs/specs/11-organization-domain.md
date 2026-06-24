---
version: "1.0"
lastUpdated: "2026-06-15"
author: "Alpha-Analytic"
status: "Draft"
---

# Spec: Organization Domain

## 1. Business Objective & Context
[BUSINESS CONTEXT] Enable organizations (veterinary clinics, kennels, shelters, breeding farms) to effectively manage their presence on ZooLink platform, supporting multi-location operations and staff collaboration. This improves business metrics by:
- Increasing platform adoption among business users (target: 10k organizations in first year)
- Enabling higher-value transactions through organization-linked listings
- Improving data accuracy for animal ownership and listing attribution
- Supporting compliance with Russian legislation regarding legal entity identification

## 2. Glossary
- **Organization**: A legal entity that can own animals, create listings, and have affiliated users
- **Branch**: A physical location belonging to an organization
- **Organization User**: A platform user affiliated with one or more organizations
- **Headquarters**: Primary branch of an organization
- **INN**: Taxpayer Identification Number (Russian)
- **KPP**: Tax Registration Reason Code (Russian)
- **Role in Org**: ENUM of {OWNER, ADMIN, STAFF, VET, MODERATOR} defining user permissions within organization

## 3. Data Contract (Input/Output)

### Organization Entity
| Field Name | Data Type | Constraints | Description | Example |
|------------|-----------|-------------|-------------|---------|
| id | UUID | Primary key, not null | Unique identifier | "550e8400-e29b-41d4-a716-446655440000" |
| name_localized | JSONB | Not null, valid JSON | Localized names | {"en": "Vet Clinic", "ru": "Ветеринарная клиника"} |
| description_localized | JSONB | Nullable, valid JSON | Localized description | {"en": "Animal care", "ru": "Уход за животными"} |
| inn | VARCHAR(20) | Nullable, unique when not null, pattern: ^\d{10}$|\d{12}$ | Taxpayer ID | "7707083893" |
| kpp | VARCHAR(20) | Nullable, pattern: ^\d{9}$ | Tax registration reason | "773601001" |
| address | TEXT | Not null, min 10 chars | Headquarters address | "123 Veterinary St, Moscow" |
| phone | VARCHAR(30) | Nullable, pattern: ^\+?[1-9]\d{1,14}$ | Contact phone | "+74951234567" |
| email | VARCHAR(255) | Nullable, email format | Contact email | "info@vetclinic.ru" |
| logo_url | TEXT | Nullable, URL format | Logo image URL | "https://storage.example.com/logo.png" |
| metadata | JSONB | Nullable, valid JSON | Extensible attributes | {"subscription_tier": "premium"} |
| is_active | BOOLEAN | Not null, default true | Active status | true |
| created_at | TIMESTAMP | Not null, default now() | Creation timestamp | "2026-06-15T10:30:00Z" |
| updated_at | TIMESTAMP | Not null, default now() | Last update timestamp | "2026-06-15T10:30:00Z" |

### Branch Entity
| Field Name | Data Type | Constraints | Description | Example |
|------------|-----------|-------------|-------------|---------|
| id | UUID | Primary key, not null | Unique identifier | "660e8400-e29b-41d4-a716-446655440001" |
| organization_id | UUID | Foreign key to organizations.id, not null | Parent organization | "550e8400-e29b-41d4-a716-446655440000" |
| city_id | UUID | Foreign key to cities.id, not null | City where branch located | "770e8400-e29b-41d4-a716-446655440002" |
| address | TEXT | Not null, min 10 chars | Detailed branch address | "456 Animal Ave, Moscow" |
| phone | VARCHAR(30) | Nullable, pattern: ^\+?[1-9]\d{1,14}$ | Branch contact phone | "+74959876543" |
| email | VARCHAR(255) | Nullable, email format | Branch contact email | "branch@vetclinic.ru" |
| is_headquarters | BOOLEAN | Nullable, default false | Headquarters flag | true |
| is_active | BOOLEAN | Not null, default true | Active status | true |
| created_at | TIMESTAMP | Not null, default now() | Creation timestamp | "2026-06-15T10:30:00Z" |
| updated_at | TIMESTAMP | Not null, default now() | Last update timestamp | "2026-06-15T10:30:00Z" |

### OrganizationUsers Entity (Many-to-Many)
| Field Name | Data Type | Constraints | Description | Example |
|------------|-----------|-------------|-------------|---------|
| id | UUID | Primary key, not null | Unique identifier | "880e8400-e29b-41d4-a716-446655440003" |
| organization_id | UUID | Foreign key to organizations.id, not null | Organization reference | "550e8400-e29b-41d4-a716-446655440000" |
| user_id | UUID | Foreign key to users.id (identity domain), not null | User reference | "990e8400-e29b-41d4-a716-446655440004" |
| role_in_org | VARCHAR(20) | Not null, enum: OWNER, ADMIN, STAFF, VET, MODERATOR | Role in organization | "OWNER" |
| is_primary | BOOLEAN | Nullable, default false | Primary organization flag | true |
| joined_at | DATE | Not null | Date user joined organization | "2026-06-15" |
| created_at | TIMESTAMP | Not null, default now() | Creation timestamp | "2026-06-15T10:30:00Z" |

### API Endpoints Contracts

#### Organization Management
**POST /organizations**
- Request: OrganizationCreateDTO
- Response: OrganizationResponseDTO

**GET /organizations/{id}**
- Request: Path parameter: id (UUID)
- Response: OrganizationResponseDTO

**PATCH /organizations/{id}**
- Request: Path parameter: id (UUID), OrganizationUpdateDTO
- Response: OrganizationResponseDTO

**GET /organizations**
- Request: Query parameters: name (string), is_active (boolean), page (int), limit (int)
- Response: PaginatedOrganizationResponseDTO

#### Branch Management
**POST /branches**
- Request: BranchCreateDTO
- Response: BranchResponseDTO

**GET /branches/{id}**
- Request: Path parameter: id (UUID)
- Response: BranchResponseDTO

**PATCH /branches/{id}**
- Request: Path parameter: id (UUID), BranchUpdateDTO
- Response: BranchResponseDTO

**GET /branches**
- Request: Query parameters: organization_id (UUID), city_id (UUID), is_headquarters (boolean), page (int), limit (int)
- Response: PaginatedBranchResponseDTO

#### Organization-Users Management
**POST /organization-users**
- Request: OrganizationUserCreateDTO
- Response: OrganizationUserResponseDTO

**GET /organization-users**
- Request: Query parameters: organization_id (UUID), user_id (UUID), role_in_org (string), page (int), limit (int)
- Response: PaginatedOrganizationUserResponseDTO

**PATCH /organization-users/{id}**
- Request: Path parameter: id (UUID), OrganizationUserUpdateDTO
- Response: OrganizationUserResponseDTO

**DELETE /organization-users/{id}**
- Request: Path parameter: id (UUID)
- Response: SuccessResponseDTO

### DTO Definitions

#### OrganizationCreateDTO
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| name_localized | JSONB | Yes | Valid JSON object with at least one language |
| description_localized | JSONB | No | Valid JSON object |
| inn | STRING | No | Pattern: ^\d{10}$|\d{12}$, unique when provided |
| kpp | STRING | No | Pattern: ^\d{9}$ |
| address | STRING | Yes | Min 10 characters |
| phone | STRING | No | Pattern: ^\+?[1-9]\d{1,14}$ |
| email | STRING | No | Valid email format |
| logo_url | STRING | No | Valid URL format |
| metadata | JSONB | No | Valid JSON object |
| is_active | BOOLEAN | No | Default true |

#### OrganizationUpdateDTO
All fields from OrganizationCreateDTO are optional for PATCH operations.

#### OrganizationResponseDTO
Same as Organization entity fields.

#### BranchCreateDTO
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| organization_id | UUID | Yes | Must reference existing organization |
| city_id | UUID | Yes | Must reference existing city |
| address | STRING | Yes | Min 10 characters |
| phone | STRING | No | Pattern: ^\+?[1-9]\d{1,14}$ |
| email | STRING | No | Valid email format |
| is_headquarters | BOOLEAN | No | Default false |
| is_active | BOOLEAN | No | Default true |

#### BranchUpdateDTO
All fields from BranchCreateDTO are optional except organization_id and city_id for PATCH operations.

#### BranchResponseDTO
Same as Branch entity fields.

#### OrganizationUserCreateDTO
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| organization_id | UUID | Yes | Must reference existing organization |
| user_id | UUID | Yes | Must reference existing user from identity domain |
| role_in_org | ENUM | Yes | Must be one of: OWNER, ADMIN, STAFF, VET, MODERATOR |
| is_primary | BOOLEAN | No | Default false |
| joined_at | DATE | Yes | Must not be future date |

#### OrganizationUserUpdateDTO
| Field | Type | Required | Constraints |
|-------|------|----------|-------------|
| role_in_org | ENUM | No | Must be one of: OWNER, ADMIN, STAFF, VET, MODERATOR |
| is_primary | BOOLEAN | No |  |
| joined_at | DATE | No | Must not be future date |

#### OrganizationUserResponseDTO
Same as OrganizationUsers entity fields.

## 4. State Machine / Process Flow

### Organization Lifecycle State Machine
| State | Description | Entry Actions | Exit Actions |
|-------|-------------|---------------|--------------|
| **PENDING_VERIFICATION** | Initial state after creation; limited functionality | - Record creation timestamp<br>- Send verification email to owner<br>- Set verification token | None |
| **ACTIVE** | Full functionality available | - Clear verification token<br>- Enable all organization features<br>- Notify owner of activation | None |
| **SUSPENDED** | Temporarily restricted due to policy violations | - Log suspension reason<br>- Disable listing creation<br>- Restrict admin actions<br>- Notify owner | None |
| **ARCHIVED** | Permanently deactivated; read-only access | - Set deactivation timestamp<br>- Anonymize sensitive data per 152-ФЗ<br>- Disable all modification capabilities | None |

#### Organization State Transitions
| From State | To State | Trigger | Guard Condition | Action |
|------------|----------|---------|-----------------|--------|
| PENDING_VERIFICATION | ACTIVE | Owner verification completed | Verification token valid && organization data validated | Enable full features; notify owner |
| PENDING_VERIFICATION | ARCHIVED | Verification failed | Max verification attempts exceeded || invalid data detected | Log failure reason; notify owner |
| ACTIVE | SUSPENDED | Policy violation detected | Moderation action = SUSPEND || automated fraud detection | Log violation; notify owner |
| ACTIVE | ARCHIVED | Owner request | Owner explicitly requests deletion && no active listings | Anonymize data; log archival |
| SUSPENDED | ACTIVE | Suspension lifted | Review completed && corrective actions taken | Restore features; notify owner |
| SUSPENDED | ARCHIVED | Persistent violations | Multiple suspensions within 30 days || severe policy breach | Anonymize data; log archival |
| * | ARCHIVED | Legal requirement | Court order or regulatory mandate | Anonymize PII; log compliance action |

### Branch Lifecycle State Machine
| State | Description | Entry Actions | Exit Actions |
|-------|-------------|---------------|--------------|
| **ACTIVE** | Branch is operational and can be used for listings | - Validate address geocoding<br>- Enable branch for listing creation<br>- Notify organization admins | None |
| **INACTIVE** | Branch temporarily unavailable | - Set inactivation timestamp<br>- Disable branch for new listings<br>- Notify organization admins | None |
| **CLOSED** | Branch permanently closed | - Set closure timestamp<br>- Prevent new listings<br>- Mark existing listings as inactive after grace period | None |

#### Branch State Transitions
| From State | To State | Trigger | Guard Condition | Action |
|------------|----------|---------|-----------------|--------|
| ACTIVE | INACTIVE | Manual deactivation | User is org owner/admin && branch has no active listings | Set inactivation timestamp; notify staff |
| INACTIVE | ACTIVE | Reactivation | User is org owner/admin || address re-validated | Clear inactivation timestamp; notify staff |
| ACTIVE | CLOSED | Permanent closure | User is org owner/admin || 6+ months inactive | Set closure timestamp; start grace period |
| INACTIVE | CLOSED | Permanent closure from inactive | User is org owner/admin || 6+ months inactive | Set closure timestamp |
| CLOSED | * | No transitions allowed | Forbidden | Error: Closed branch cannot be modified |

### Organization-Users Affiliation State Machine
| State | Description | Entry Actions | Exit Actions |
|-------|-------------|---------------|--------------|
| **PENDING_INVITE** | User invited but not yet accepted | - Send invitation email<br>- Generate invitation token<br>- Set expiration (7 days) | None |
| **ACTIVE** | User affiliated with organization | - Clear invitation token<br>- Assign role permissions<br>- Notify organization admins | None |
| **REVOKED** | Affiliation terminated | - Record revocation timestamp<br>- Remove role permissions<br>- Notify user and organization | None |
| **EXPIRED** | Invitation not accepted | - Clear invitation token<br>- Log expiry event | None |

#### Organization-Users State Transitions
| From State | To State | Trigger | Guard Condition | Action |
|------------|----------|---------|-----------------|--------|
| PENDING_INVITE | ACTIVE | Invitation accepted | Invitation token valid && not expired | Activate affiliation; notify org admins |
| PENDING_INVITE | EXPIRED | Invitation not accepted | Invitation token expired | Log expiry; notify sender |
| PENDING_INVITE | REVOKED | Invitation withdrawn | Sender is org owner/admin || system admin | Log withdrawal; notify invitee |
| ACTIVE | REVOKED | Affiliation terminated | Requester is org owner/admin || user requests removal | Record termination; notify both parties |
| * | REVOKED | System mandate | Legal requirement || security violation | Log reason; notify affected parties |

## 5. Business Logic & Rules (Decision Table / Gherkin)

### Organization Validation Rules - Decision Table
| Conditions | C1: INN Provided | C2: KPP Provided | C3: Has Branches | C4: User Role | Actions | A1: Required Fields | A2: Unique Constraints | A3: Role Permissions | A4: Additional Validation |
|------------|------------------|------------------|------------------|---------------|---------|---------------------|------------------------|----------------------|---------------------------|
| R1 | Yes | Yes | Any | Any | name, address, inn, kpp | inn unique, kpp format | Based on role_in_org | inn/kpp combination unique per org |
| R2 | Yes | No | Any | Any | name, address, inn | inn unique | Based on role_in_org | inn format validation |
| R3 | No | Yes | Any | Any | name, address, kpp | kpp unique | Based on role_in_org | kpp format validation |
| R4 | No | No | Yes | OWNER/ADMIN | name, address | None | FULL_ACCESS | At least one active branch required |
| R5 | No | No | No | OWNER/ADMIN | name, address | None | LIMITED_ACCESS | Solo operator validation |
| R6 | Any | Any | Any | STAFF/VET/MODERATOR | name, address | None | BASED_ON_ROLE | Cannot create org without OWNER/ADMIN |

### Business Logic - Gherkin Scenarios

#### Organization Creation
```gherkin
Feature: Organization Management
  Background:
    Given the system is operational
    And valid admin credentials are available

  Scenario: Create organization with Russian tax IDs
    Given I provide organization data with:
      | name_localized | {"en": "Vet Clinic", "ru": "Ветеринарная клиника"} |
      | description_localized | {"en": "Animal care", "ru": "Уход за животными"} |
      | inn | "7707083893" |
      | kpp | "773601001" |
      | address | "123 Veterinary St, Moscow" |
      | phone | "+74951234567" |
      | email | "info@vetclinic.ru" |
    When I submit the organization creation request
    Then the organization should be created with status PENDING_VERIFICATION
    And a verification email should be sent to the owner
    And the INN and KPP should be validated for uniqueness

  Scenario: Create organization without tax IDs (individual entrepreneur)
    Given I provide organization data with:
      | name_localized | {"en": "Pet Shelter", "ru": "Приют для животных"} |
      | address | "456 Shelter Ave, Moscow" |
    When I submit the organization creation request
    Then the organization should be created with status PENDING_VERIFICATION
    And INN and KPP fields should remain null
    And verification process should proceed normally

  Scenario: Reject duplicate INN
    Given an organization exists with INN "7707083893"
    When I attempt to create another organization with INN "7707083893"
    Then the request should fail with error code ORG-001
    And the error message should indicate INN already exists
```

#### Branch Management
```gherkin
Feature: Branch Management
  Background:
    Given an active organization exists with id "org-123"
    And the user has OWNER role in the organization

  Scenario: Create branch under organization
    Given I provide branch data with:
      | organization_id | "org-123" |
      | city_id | "city-456" |
      | address | "789 Branch Rd, Moscow" |
      | phone | "+74959876543" |
      | email | "branch@vetclinic.ru" |
    When I submit the branch creation request
    Then the branch should be created with status ACTIVE
    And it should be linked to the specified organization
    And geocoding validation should be performed on the address

  Scenario: Set branch as headquarters
    Given a branch exists under organization "org-123"
    When I update the branch to set is_headquarters to true
    Then the branch should be marked as headquarters
    And any previous headquarters branch should have is_headquarters set to false
    And only one branch per organization can be headquarters

  Scenario: Reject branch creation for non-existent city
    Given I provide branch data with:
      | organization_id | "org-123" |
      | city_id | "non-existent-city" |
      | address | "789 Branch Rd, Moscow" |
    When I submit the branch creation request
    Then the request should fail with error code BRN-001
    And the error message should indicate invalid city reference
```

#### Organization-Users Affiliation
```gherkin
Feature: Organization-Users Management
  Background:
    Given an active organization exists with id "org-123"
    And a user exists with id "user-456"

  Scenario: Invite user to organization
    Given I provide affiliation data with:
      | organization_id | "org-123" |
      | user_id | "user-456" |
      | role_in_org | "STAFF" |
      | joined_at | "2026-06-15" |
    When I submit the organization-user creation request
    Then an invitation should be sent to the user
    And the affiliation status should be PENDING_INVITE
    And the invitation token should be valid for 7 days

  Scenario: Accept organization invitation
    Given a pending invitation exists for user "user-456" to organization "org-123"
    When the user accepts the invitation with valid token
    Then the affiliation status should become ACTIVE
    And the user should gain STAFF role permissions in the organization
    And organization admins should be notified

  Scenario: Reject invitation for non-existent user
    Given I provide affiliation data with:
      | organization_id | "org-123" |
      | user_id | "non-existent-user" |
      | role_in_org | "STAFF" |
    When I submit the organization-user creation request
    Then the request should fail with error code ORGU-001
    And the error message should indicate user not found

  Scenario: Prevent duplicate active affiliation
    Given an active affiliation exists for user "user-456" in organization "org-123"
    When I attempt to create another affiliation for the same user-organization pair
    Then the request should fail with error code ORGU-002
    And the error message should indicate user already affiliated
```

#### Listing Attribution Rules
```gherkin
Feature: Listing Attribution to Organizations
  Background:
    Given an active organization exists with id "org-123"
    And a branch exists under the organization with id "branch-456"
    And a user exists with id "user-789" who has STAFF role in organization "org-123"

  Scenario: Create listing attributed to organization
    Given I provide listing data with:
      | organization_id | "org-123" |
      | branch_id | "branch-456" |
      | creator_id | "user-789" |
      | title | "Purebred Puppies for Sale" |
    When I submit the listing creation request
    Then the listing should be created successfully
    And it should display the organization name in public view
    And it should display the branch location if applicable
    And the creator_id should be recorded for audit purposes

  Scenario: Create listing with organization but wrong branch
    Given I provide listing data with:
      | organization_id | "org-123" |
      | branch_id | "branch-999" | // belongs to different organization
      | creator_id | "user-789" |
    When I submit the listing creation request
    Then the request should fail with error code LIST-ORG-001
    And the error message should indicate branch does not belong to organization

  Scenario: Create listing as individual (no organization)
    Given I provide listing data with:
      | creator_id | "user-789" |
      | title | "Personal Pet for Sale" |
    When I submit the listing creation request
    Then the listing should be created successfully
    And organization_id and branch_id should be null
    And the listing should be attributed to the individual user

  Scenario: Require either organization or personal attribution
    Given I provide listing data with:
      | title | "Unattributed Listing" |
    When I submit the listing creation request
    Then the request should fail with error code LIST-ORG-002
    And the error message should indicate either organization or personal attribution required
```

### Reference Data Validation - Decision Table (Cities)
| Conditions | C1: Country Code | C2: Region Code | C3: City Name | Actions | A1: Required Fields | A2: Validation Rules | A3: Geo-coordinates | A4: Uniqueness |
|------------|------------------|-----------------|---------------|---------|---------------------|----------------------|---------------------|----------------|
| R1 | RU | Any | Any | name_localized, country_code, region_code | Validate against FIAS database | Required for Russian cities | Unique within region |
| R2 | Foreign | Any | Any | name_localized, country_code | Validate against GeoNames | Optional for foreign cities | Unique within country |
| R3 | Any | Any | Empty/Blank | - | - | Reject with error CITY-001 | - | - |
```

## 6. Error Handling & Edge Cases

| Error Scenario | Expected System Response | Error Code | User Message |
|----------------|--------------------------|------------|--------------|
| Attempt to create organization with duplicate INN | HTTP 409 Conflict | ORG-001 | Organization with this Tax ID (INN) already exists |
| Attempt to create organization with invalid INN format | HTTP 400 Bad Request | ORG-002 | Invalid Tax ID (INN) format. Must be 10 or 12 digits |
| Attempt to create organization with invalid KPP format | HTTP 400 Bad Request | ORG-003 | Invalid Tax Registration Reason Code (KPP) format. Must be 9 digits |
| Organization creation with missing required fields | HTTP 400 Bad Request | ORG-004 | Missing required fields: {field_list} |
| Attempt to access non-existent organization | HTTP 404 Not Found | ORG-005 | Organization not found |
| Attempt to update organization without proper permissions | HTTP 403 Forbidden | ORG-006 | Insufficient permissions to modify organization |
| Attempt to create branch with non-existent organization reference | HTTP 400 Bad Request | BRN-001 | Referenced organization does not exist |
| Attempt to create branch with non-existent city reference | HTTP 400 Bad Request | BRN-002 | Referenced city does not exist |
| Attempt to set multiple headquarters for same organization | HTTP 400 Bad Request | BRN-003 | Only one branch can be designated as headquarters per organization |
| Attempt to create branch with missing required fields | HTTP 400 Bad Request | BRN-004 | Missing required fields: {field_list} |
| Attempt to access non-existent branch | HTTP 404 Not Found | BRN-005 | Branch not found |
| Attempt to invite non-existent user to organization | HTTP 400 Bad Request | ORGU-001 | User not found |
| Attempt to create duplicate active affiliation | HTTP 409 Conflict | ORGU-002 | User is already affiliated with this organization |
| Attempt to modify affiliation without proper permissions | HTTP 403 Forbidden | ORGU-003 | Insufficient permissions to modify organization affiliation |
| Attempt to access expired invitation token | HTTP 410 Gone | ORGU-004 | Invitation has expired. Please request a new invitation |
| Attempt to use invalid invitation token | HTTP 400 Bad Request | ORGU-005 | Invalid invitation token |
| Attempt to create listing without organization or personal attribution | HTTP 400 Bad Request | LIST-ORG-001 | Listing must be attributed either to an organization or to an individual user |
| Attempt to create listing with branch not belonging to organization | HTTP 400 Bad Request | LIST-ORG-002 | Specified branch does not belong to the specified organization |
| Attempt to perform organization action on suspended organization | HTTP 403 Forbidden | ORG-007 | Organization is currently suspended. Please contact support. |
| Attempt to perform organization action on archived organization | HTTP 410 Gone | ORG-008 | Organization has been archived and is no longer accessible. |
| Attempt to create branch under suspended organization | HTTP 403 Forbidden | BRN-005 | Cannot create branch under suspended organization |
| Attempt to perform branch action on closed branch | HTTP 410 Gone | BRN-006 | Branch has been closed and is no longer available for use. |
| System inability to process verification email | HTTP 500 Internal Server Error | ORG-009 | Unable to send verification email. Please try again later. |
| Database constraint violation during organization creation | HTTP 500 Internal Server Error | ORG-010 | Unable to create organization due to system error. Please try again. |

## 7. Non-Functional Requirements

### Performance Requirements
- Organization creation API latency < 800ms for 95% of requests under normal load
- Organization retrieval API latency < 300ms for 95% of requests under normal load
- Branch creation API latency < 500ms for 95% of requests under normal load
- Organization-users affiliation API latency < 400ms for 95% of requests under normal load
- Search organizations by name: < 1s for 95% of requests with 100k+ organizations
- List branches for organization: < 500ms for 95% of requests

### Security Requirements
- All organization-sensitive operations requires authentication
- Organization creation requires email verification
- Only users with OWNER or ADMIN role can modify organization/branch details
- Users can only create listings for organizations they have active affiliation with (validated via organization_users)
- Organization contact details (phone, email) are shown only if organization has opted to share them
- Personal user data is protected; organization listings do not expose individual creator's contact info unless organization chooses to reveal it
- All organization modifications are logged for audit trail
- Rate limiting: max 10 organization creation requests per hour per IP address
- Rate limiting: max 100 affiliation requests per hour per IP address

### Reliability Requirements
- Organization data persistence: 99.9% monthly uptime
- Automated backups of organization data daily
- Organization deletion follows archival pattern (soft delete) for compliance
- Audit trail retention: minimum 5 years for legal compliance

### Scalability Requirements
- Support up to 100,000 organizations without degradation
- Support up to 1,000,000 branches without degradation
- Support up to 10,000,000 organization-user affiliations without degradation
- Database indexing strategy optimized for:
  - Organization lookup by INN
  - Branch lookup by organization_id + city_id
  - Affiliation lookup by organization_id + user_id
  - Organization search by name_localized

### Observability Requirements
- All organization state transitions logged with: timestamp, organization_id, user_id (if applicable), previous_state, new_state
- Organization creation/update/deletion events sent to audit log service
- Failed verification attempts logged for security monitoring
- Organization metrics: active organizations, new registrations monthly, suspension rate
- Alert thresholds: suspension rate > 5% hourly, failed verification attempts > 100/hour

## 8. Open Questions / Assumptions

### Assumptions
1. The system uses UUID v4 for all entity identifiers
2. The city reference data comes from Admin Domain (cities table)
3. Email verification for organization creation uses the same mechanism as Identity Domain
4. The system follows the same authentication and authorization patterns as other domains (JWT-based)
5. Localization structure follows key-value pairs in JSONB with language codes as keys (ISO 639-1)
6. Organization verification process follows similar patterns to user verification in Identity Domain
7. Geocoding validation for addresses uses external service (Yandex.Maps API as specified in tech stack)
8. The metadata JSONB field follows a predefined schema for known extensions (subscription tiers, etc.)
9. Organization archival process anonymizes personal data in compliance with 152-ФЗ but maintains audit trail
10. The system will use the same error handling format as defined in error_handling/standard_error_format.md

### Open Questions
1. What is the exact format and validation rules for the metadata JSONB field? Should we define a JSON schema for extensibility?
2. Should organization verification include document upload (OGRN, registration certificate) or rely solely on INN/KPP validation?
3. What are the specific business rules for organization type classification (veterinary clinic, kennel, shelter, etc.)? Should this be a separate reference table?
4. Should we implement organization verification badges (verified/checkmark) as mentioned in the GAP registry?
5. What is the grace period for closing branches before existing listings are automatically deactivated?
6. Should we implement organization-level moderation policies (e.g., prohibited breeds) as feature flags?
7. What are the specific rate limits for different organization operations (creation, modification, affiliation)?
8. Should we support hierarchical organization structures (parent/sub-organization) for franchises or large networks?
9. What fields should be included in the search index for organization name lookup (full text search vs exact match)?
10. Should we implement organization analytics API endpoint as mentioned in the business requirements document?

---

## Org-internal roles, lifecycle & invariants (round-4, normative)

**Organization lifecycle** (`organizations.status`, migration 0008): `PENDING_VERIFICATION → ACTIVE → SUSPENDED →
ARCHIVED`. An org may **create listings only when `status='ACTIVE'`**. On `ARCHIVED`: its branches → closed, its
active listings → DEACTIVATED; org-owned animals stay (ownership transfer is MVP-locked) and become read-only.
INN is **unique** (migration 0008); INN/KPP are format-validated in MVP (registry check is Фаза 2+).

**Branches:** **at most one** `is_headquarters` per org (unique index, migration 0008); a listing's `branch_id` must
belong to the listing's `organization_id` (service-layer + composite check).

**Org-internal roles** (`organization_users.role_in_org` ∈ OWNER/ADMIN/STAFF/VET; distinct from platform roles):

| Action | OWNER | ADMIN | STAFF | VET |
|---|---|---|---|---|
| Manage org profile / branches | ✓ | ✓ | — | — |
| Invite / remove members, change roles | ✓ | ✓ (not OWNER) | — | — |
| Create/edit org animals & listings | ✓ | ✓ | ✓ | ✓ (health data) |
| Transfer ownership / archive org | ✓ | — | — | — |

- **Invariant:** every org has **≥1 OWNER**; the last OWNER cannot leave/be removed (must transfer ownership first).
- **Membership lifecycle** (`organization_users.status`): `PENDING_INVITE → ACTIVE → REVOKED/EXPIRED`; invites carry
  `invitation_token` + `invitation_expires_at` (7 days) + `invited_by_user_id` (migration 0008). Creating an org
  atomically creates an `OWNER` ACTIVE membership for the creator.
- **Affiliation enforcement:** an org listing's `seller_id` must be an ACTIVE member of the listing's org (service-layer guard).
- **`is_primary`:** at most one primary org per user (unique index, migration 0008).
- All membership/role/lifecycle changes are written to `audit_log` (see [data-governance.md](data-governance.md)).

## Related Documents

- [Glossary](glossary.md)
- [Organization API](../03-architecture/api-contracts/organization-api.yaml)
- [Branch API](../03-architecture/api-contracts/branch-api.yaml)
- [Identity Domain](01-identity-domain.md)
- [Animal Domain](02-animal-domain.md)
- [Business Requirements](../02-requirements/business-requirements/organization-domain.md)
- 🌐 RU mirror: [docsRU/specs/11-organization-domain.md](../../docsRU/specs/11-organization-domain.md)
