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
- Reference data management: species, breeds, cities, listing types, health statuses
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
  - CRUD operations for species, breeds, cities, listing types, health statuses
  - Validation rules for reference data (e.g., breed must belong to species)
  - Bulk import/export of reference data (CSV/JSON)
  - Versioning and change history for reference data
  - Notification system for users when reference data changes affect their listings

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

## Related Documents

- [Glossary](glossary.md)
- [Admin API](../03-architecture/api-contracts/admin-api.yaml)
- [Moderation Domain](12-moderation-domain.md)
- [Identity Domain](01-identity-domain.md)
- [Business Requirements](../02-requirements/business-requirements/admin-domain.md)
- 🌐 RU mirror: [docsRU/specs/06-admin-domain.md](../../docsRU/specs/06-admin-domain.md)
