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
