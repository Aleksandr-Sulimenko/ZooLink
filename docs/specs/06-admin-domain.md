---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# Spec: Admin Domain

## Outcome
Provide administrative functions for platform management, including user moderation, listing moderation, reference data management, and system configuration. Ensure compliance with Russian regulations regarding content moderation and data handling.

## Scope & Boundaries
**In Scope:**
- User management: view users, change roles, ban/unban, verify identity
- Listing moderation: review queue, approve/reject listings, add rejection reasons
- Reference data management: species, breeds, cities, health_certifications, genetic_markers (the five managed lookup datasets; see the round-9 → A3 implementation-scope note below — listing types and animal/health statuses are fixed DB CHECK enums, not row-CRUD)
- System configuration: moderation rules, rate limits, feature toggles
- Audit logs: track moderation actions, user actions, system changes
- Integration with all other domains (Identity, Animal, Marketplaces, Matching)
- Compliance with Russian legislation on information moderation and 152-ФЗ

**Out of Scope:**
- Financial/admin billing systems - deferred to phase 2
- Advanced analytics/dashboard - deferred
- System performance tuning tools - deferred
- Legal/compliance automation tools - deferred

## Constraints
- **Legal:** Must comply with Russian Federal Law "On Information, Information Technologies and Protection of Information" (149-ФЗ) regarding content moderation, and 152-ФЗ for personal data handling in admin actions.
- **Security:** Admin actions must be audited and restricted to authorized roles only. Protect against privilege escalation.
- **Performance:** Moderation queue should load quickly (<2s) even with large volumes.
- **Scalability:** Support moderation workflow for 1000+ daily actions.
- **Technology:** Align with NestJS, TypeScript, PostgreSQL.
- **Usability:** Interface must be clear for moderators (may not be technical experts).

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Moderation queue loads in <2s with 10k pending items (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Admin actions are fully auditable; personal data handling follows 152-ФЗ; content moderation follows 149-ФЗ (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Interface must be clear for moderators; follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)

## User Stories

### Admin & Moderation Management
**UC-AD-01:** As a moderator, I want to easily manage users so that I can maintain a safe and compliant platform.
- Acceptance Criteria:
  - User management loads in <2s
  - Search and filter users by role, status, registration date
  - One-click role changes (user to moderator, moderator to admin, etc.)
  - Ban/unban users with optional reason and duration
  - Verify identity with document upload (future enhancement)
  - Notification system for users when actions are taken against them
  - Audit trail of all moderation actions for accountability

**UC-AD-02:** As a moderator, I want to efficiently moderate listings so that I can ensure quality, compliance, and safety in the marketplace.
- Acceptance Criteria:
  - Moderation queue loads in <2s with clear status indicators (pending, approved, rejected)
  - Bulk moderation options for similar listings
  - Clear compliance checklist for listing requirements (species-specific, livestock-specific, pet-specific)
  - Ability to request additional information from seller before decision
  - Template comments for common rejection reasons
  - Escalation path for complex cases to admin review
  - Statistics on moderation throughput and accuracy

**UC-AD-03:** As an administrator, I want to manage reference data so that I can ensure accuracy and consistency across the platform.
- Acceptance Criteria:
  - Reference data management loads in <2s
  - CRUD operations for species, breeds, cities, health_certifications, genetic_markers (listing types and animal/health statuses are fixed CHECK enums, not row-CRUD — see the round-9 → A3 note below)
  - Validation rules for reference data (e.g., breed must belong to species)
  - Bulk import/export of reference data (CSV/JSON)
  - Versioning and change history for reference data
  - Notification system for users when reference data changes affect their listings

> **Implementation scope (round-9 → A3, normative).** The **managed lookup tables that exist in
> `database_schema.sql` are CRUD-able reference data: `species`, `breeds`, `cities`,
> `health_certifications`, `genetic_markers`** (= code `DATASETS`; matches rbac-matrix.md "Reference
> data = ADMIN C/R/U/D"). `health_certifications`/`genetic_markers` were added in **A3**
> (ADMIN_PHASE_ACTION_PLAN) as **form-now / behaviour-later** livestock breeding dictionaries: the
> managed lookup + CRUD exists now, while their marketplace **filtering** is deferred to Фаза 2
> (anti-rewrite, IMPLEMENTATION_PLAYBOOK §5). "Listing types" and "animal/health statuses" are **fixed DB
> CHECK enums** (`listings.listing_type`, `listings.status`, animal lifecycle), not row-CRUD — changing
> them is a schema/ADR change. `traits`/`temperament_tags`/`health_flags` are **free text/JSONB soft
> tags** (no managed table; a lookup can be added additively in Фаза 2 without a rewrite). Lookup ids are
> **INT** (id-type convention); localized names are **`name_localized` JSONB** (A2). Bulk import/export
> and change-history/versioning are deferred (soft-delete = `is_active`); the audit_log records every
> mutation (via `entity_id_int` for INT lookups). WHY: contract must match the source of truth
> (schema + RBAC + code); WHY BETTER: prevents endpoints that cannot exist, keeps MVP scope honest
> (form vs behaviour), and the dataset registry absorbs new lookups without shape change. See
> `api-contracts/admin-api.yaml` (reconciled).

**UC-AD-04:** As an administrator, I want to monitor system activity and security so that I can detect and respond to potential issues.
- Acceptance Criteria:
  - Audit log viewer loads in <2s
  - Filter and search audit logs by action type, user, date range
  - Real-time alerts for suspicious activities (multiple failed logins, rapid listing creation)
  - Export audit logs for external analysis (CSV/JSON)
  - Dashboard view of key moderation and user metrics
  - Ability to suspend specific API endpoints or features during maintenance

**UC-AD-05:** As a user concerned about platform safety, I want to understand moderation policies and report issues so that I can contribute to a safe community.
- Acceptance Criteria:
  - Access to platform guidelines and community standards
  - Clear process for reporting inappropriate content or users
  - Status updates on reported items (under review, action taken, no action)
  - Protection against retaliation for good-faith reports
  - Educational resources on recognizing scams and fraudulent listings
  - Feedback mechanism for users to suggest improvements to moderation

## Prior Decisions
- Admin functionality will be accessed via a separate admin panel (initially same WebApp but with role-based access).
- Moderators are a special role in Identity Domain with permissions to moderate listings and users.
- Admin role has full system access including reference data management.
- All moderation actions require a reason and are logged for audit trail.
- Reference data (species, breeds, etc.) is managed via CRUD interfaces in admin panel.
- We implement role-based access control (RBAC) with fine-grained permissions.
- Admin actions that modify data (banning users, rejecting listings) require explicit confirmation.

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `admin` module
   - [ ] Create AdminController for user moderation endpoints
   - [ ] Create AdminService for business logic (user banning, role changes, etc.)
   - [ ] Create ModerationController for listing moderation endpoints
   - [ ] Create ModerationService for moderation workflow logic
   - [ ] Create ReferenceDataController for managing species, breeds, etc.
   - [ ] Create AuditService for logging admin actions
   - [ ] Implement role-based guards and permissions system
   - [ ] Set up database indexes for moderation queues
   - [ ] Write unit and integration tests for admin/moderation flows
   - [ ] Create OpenAPI docs for admin endpoints

2. **Frontend (React)**
   - [ ] Create admin panel routes: /admin/users, /admin/moderation, /admin/reference-data
   - [ ] Implement user management table with search, filtering, role change, ban/unban actions
   - [ ] Implement moderation queue with listing cards, approve/reject actions, reason input
   - [ ] Create reference data management interfaces (CRUD for species, breeds, etc.)
   - [ ] Implement audit log viewer
   - [ ] Create admin layout with navigation and role-based menu visibility
   - [ ] Write unit and e2e tests for admin flows

3. **Infrastructure**
   - [ ] Ensure database schema supports admin/moderation entities and audit logs
   - [ ] Configure Prisma schema for Admin, ModerationAction, AuditLog entities
   - [ ] Set up efficient indexing for moderation queues (by status, created_at)
   - [ ] Implement rate limiting for admin endpoints to prevent abuse
   - [ ] Add security headers and strict CSP for admin panel

## Verification Criteria
- [ ] Unit tests >90% coverage for admin module (backend)
- [ ] Integration tests cover: user moderation (ban, role change), listing moderation (approve/reject), reference data CRUD, audit logging
- [ ] E2E tests cover: moderator logs in, views queue, approves/rejects listing, views audit log
- [ ] Manual testing: verify moderation workflow, audit trail completeness, role-based access
- [ ] Performance: moderation queue loads in <2s with 10k pending items
- [ ] Compliance: admin actions are fully auditable; personal data handling follows 152-ФЗ; content moderation follows 149-ФЗ
- [ ] Documentation: OpenAPI spec generated and available
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented

---

## Reference-data audit & operator security (D4, normative)

### Reference-data CRUD is audited and audit-readable (closes GAP-006-sub "versioning/audit reference-data")
- **Every reference-data mutation** (create/update/soft-deactivate of `species`, `breeds`, `cities`,
  `health_certifications`, `genetic_markers`) writes an `audit_log` row (actor + before/after JSONB), per
  [data-governance.md](data-governance.md) §3. Because reference lookups are **INT** (id-type convention) while
  `audit_log.entity_id` is UUID, the INT lookup id is recorded in **`audit_log.entity_id_int`** (A2 / migration
  0018) with `entity_type = 'reference-data'`.
- **These entries are readable** through admin **`GET /audit/log`** (`getAuditLog`, ADMIN-only — `admin-api.yaml`),
  filterable by `actorId`, `entityType=reference-data`, `actionType`, and — for the INT-keyed lookup subject —
  **`entityIdInt`** (integer). This is the **change history** for reference data in the MVP — it replaces the
  deferred dedicated "versioning" feature (UC-AD-03 lists versioning as an aspiration; the audit trail is the
  implemented MVP equivalent).
- **Filtering reference-data audit by subject id (INT) — resolved (Slice-2 contract-owner, normative).** Because
  reference lookups are **INT** while UUID entities use `audit_log.entity_id`, the audit-viewer filters INT
  subjects with a dedicated **`entityIdInt`** query param (→ `audit_log.entity_id_int`), parallel to the UUID
  **`entityId`** (→ `audit_log.entity_id`). Both `getAuditLog` filters and the `AuditLogEntry` response carry the
  two id fields; **exactly one is populated per row** (mirrors `database_schema.sql`, migration 0018). The two
  filters are **mutually exclusive** (supplying both → `400 VALIDATION_ERROR`).
  - **ЧТО:** add an `entityIdInt` (integer) filter + response field to `GET /audit/log` / `AuditLogEntry`,
    parallel to the UUID `entityId`. **ПОЧЕМУ:** the D4 reference-data history is *written* via `entity_id_int`
    but the contract exposed only a `format:uuid` `entityId`, so reference-data entries were **not filterable**
    by their subject id (the audit-viewer could not reach them). **ПОЧЕМУ ТАК ЛУЧШЕ:** the contract now mirrors
    the schema's two-column key space (`entity_id` UUID + `entity_id_int` INT, "exactly one populated") with zero
    new infrastructure and **no break** to existing UUID consumers (`entityIdInt` is purely additive); any new INT
    lookup added to the dataset registry is auditable & filterable with no further contract change. Alternative (a
    single polymorphic `entityRef {type,id}`) was rejected as a breaking reshape and a needless abstraction over a
    schema that already separates the two id spaces.
- **ЧТО:** make explicit that reference-data edits are both *written* to `audit_log` (via `entity_id_int`) and
  *read back* via `GET /audit/log`. **ПОЧЕМУ:** GAP-006-sub flagged that reference-data had no stated audit/versioning
  contract; the round-9→A3 note covered the write side only. **ПОЧЕМУ ТАК ЛУЧШЕ:** the read path closes the loop with
  zero new infrastructure (the audit table, the INT key column and the endpoint already exist) — admins get a complete
  who/when/before-after history of reference changes, which satisfies the UC-AD-03 "change history" acceptance criterion
  in the MVP without building a separate versioning store. agent-as-principal (ADR-0006): the `audit_log.actor` badge
  carries `principalType`, so an AI-agent admin's reference edits are attributed identically.

### Audit vocabulary is namespaced and free-text (Slice-2 contract↔code reconciliation, normative)
- **`action` is a namespaced dotted verb `{domain}.{verb}`.** Every domain writes information-rich,
  namespaced verbs to `audit_log.action` (`VARCHAR(100)`, free text, **no CHECK enum**) — e.g.
  `identity.role_changed`, `identity.identifier_rebound`, `identity.recovery_succeeded`, `user.erased`,
  `reference_data.created`, `reference_data.updated`, `listing.auto_expired`, `feature_toggle.flip`,
  `identity.oauth_login`. The admin **`GET /audit/log`** `actionType` filter and the `AuditLogEntry.actionType`
  response field are therefore a **`{domain}.{verb}` string** (`pattern ^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$`)
  with an **open, documented known-values list** (`x-known-values` in `admin-api.yaml`) — **not** a closed enum.
  The verb is returned **verbatim**, never collapsed to a coarse category.
- **`entityType` is a bare closed enum; the reference dataset is a separate field.** `entityType` ∈
  `{listing, user, organization, reference-data, moderation-action, feature-toggle}`. Reference-data writes
  store the suffixed `audit_log.entity_type = 'reference-data:{dataset}'`; on the wire `entityType` is always the
  bare `reference-data` and the concrete dataset is exposed in a parallel, nullable **`referenceDataset`** field
  (∈ the 5 managed datasets) — and is filterable via a `referenceDataset` query param. `entityType` never carries
  the colon form on the wire.
- **ЧТО:** widen the audit contract (`admin-api.yaml` `getAuditLog` + `AuditLogEntry`) to the vocabulary the
  code actually emits: `actionType` → namespaced `{domain}.{verb}` string + pattern + `x-known-values`;
  `entityType` enum extended with `feature-toggle`; the `reference-data:{dataset}` dataset split into a separate
  additive `referenceDataset` field/filter. **ПОЧЕМУ:** the audit-viewer (Slice 2) surfaced that the write-side
  stores values **outside** the previous closed enums (`reference_data.created`, `identity.*`,
  `reference-data:species`, …); the doc↔code protocol forbids silent code↔doc divergence, and the source-of-truth
  `database_schema.sql` keeps `action`/`entity_type` as **free text** precisely so each domain's vocabulary grows
  without a migration. **ПОЧЕМУ ТАК ЛУЧШЕ:** the namespaced verb is high-fidelity audit data (an admin sees
  `identity.recovery_succeeded`, not a lossy `login`), the read layer no longer needs a lossy verb→category remap,
  and the change is **purely additive & forward-compatible** — a new domain's verbs need zero contract change
  (they match the pattern; their values are appended to `x-known-values`). The `referenceDataset` split keeps
  `entityType` a stable filterable enum while exposing the dataset losslessly, consistent with the `entityIdInt`
  split above. *Alternative rejected:* tightening the write-side to the old 9-value enum — it would discard audit
  information, churn 8+ modules (identity/admin/scheduler/feature-toggle), and fight the schema's free-text design.

### System-settings update is read-for-concurrency (per-setting GET surfaces the ETag) — SF-2, normative
- **`PATCH /system/settings/{key}` is an optimistic-concurrency mutation** (API_CONVENTIONS §10): it requires
  `If-Match` carrying the weak ETag `weakEtag('system-setting:{key}', updatedAt)`. The client obtains that
  validator from a **per-setting read** — **`GET /system/settings/{key}`** (ADMIN-only) returns a single
  `SystemSetting` and **sets the `ETag` response header**, exactly as `GET /reference-data/{dataset}/{id}` does
  for its matching PATCH. An unknown key → **`404 NOT_FOUND`** (RFC7807); the admin read is **not publicly
  cacheable** (`Cache-Control: private, no-store`, §13). The collection `GET /system/settings` (object map) is a
  convenience listing and is **not** the concurrency-read — it surfaces no per-entry ETag.
- **ЧТО:** add `GET /system/settings/{key}` (single setting + `ETag` header) and bind the PATCH `If-Match` to it.
  **ПОЧЕМУ:** the PATCH precondition required a weak ETag, but the only read was the collection map, which exposes
  no ETag — so a real client could not obtain the validator and the read→If-Match→PATCH loop was **unusable
  end-to-end** (only the e2e passed, by reaching into the DB to recompute the ETag). **ПОЧЕМУ ТАК ЛУЧШЕ:** the
  cleanest REST shape — it reuses the validator the service already computes (`SystemSettingService.etag()`) and
  the established GET-sets-ETag precedent, with **no transport concern leaking into the response body** and **no
  change** to the collection endpoint or the `SystemSetting` schema (purely additive). *Alternative rejected:*
  adding a derived `etag`/`version` field to each `SystemSetting` in the collection map — it avoids a new path but
  puts a transport-layer concern in the resource body and diverges from the reference-data precedent, so the loop
  would be inconsistent with the rest of the admin API.

### Operator authentication uses the password policy in security_specification.md
- Operator roles (**ADMIN/MODERATOR**) are the **only** password-bearing accounts (`users.password_hash`;
  end users are passwordless — [01-identity-domain.md](01-identity-domain.md) "Auth model"). Their credential rules are
  **not redefined here** — they are governed by [security/security_specification.md](security/security_specification.md):
  **min 12 chars + complexity**, **bcrypt cost factor ≥12**, **account lockout after 5 failed attempts for 15 min**,
  and the session-timeout / token-TTL rules (canonical access TTL **15 min**, refresh **7 d** — 01-identity-domain.md).
- **ЧТО:** bind the admin/moderation domain's operator-login requirement to the existing `security_specification.md`
  canon rather than restating numbers. **ПОЧЕМУ:** the spec asserts "admin actions restricted to authorized roles" and
  "protect against privilege escalation" but never named the operator credential policy, risking drift if a number is
  re-stated. **ПОЧЕМУ ТАК ЛУЧШЕ:** single source of truth (security-spec) for the password/lockout numbers — no
  duplication, no new infrastructure; this is a requirement-linkage, not a new rule.

---

## Related Documents

- [Glossary](glossary.md)
- [Admin API](../03-architecture/api-contracts/admin-api.yaml)
- [Security Specification](security/security_specification.md)
- [Data Governance](data-governance.md)
- [Moderation Domain](12-moderation-domain.md)
- [Identity Domain](01-identity-domain.md)
- [Business Requirements](../02-requirements/business-requirements/admin-domain.md)
- 🌐 RU mirror: [docsRU/specs/06-admin-domain.md](../../docsRU/specs/06-admin-domain.md)
