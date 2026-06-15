---
version: "1.0"
lastUpdated: "2026-06-15"
author: "System Analyst"
status: "Draft"
---

# Spec: Moderation Domain

## Outcome
Provide a reliable moderation workflow for user-generated content (listings, animal profiles, etc.) to ensure compliance with platform policies, legal requirements, and community standards. Enable moderators to review submissions, make decisions (approve, reject, request changes), and maintain an audit trail of all moderation actions.

## Scope & Boundaries
**In Scope:**
- Moderation queue for listings awaiting review
- Moderation queue for animal profiles awaiting review (if applicable)
- Moderator interface for viewing queue items, accessing item details, and making decisions
- Decision types: Approve, Reject, Request Changes (with specific reasons)
- Automated moderation triggers (e.g., profanity detection, duplicate detection) - deferring to phase 2
- Appeal process for rejected items - deferring to phase 2
- Audit trail recording: moderator ID, timestamp, decision, reason, and any notes
- Notifications to users upon moderation decision (via Notification Domain)
- Role-based access control: only users with MODERATOR or ADMIN role can access moderation features
- Integration with Listing Domain (for listing moderation) and Animal Domain (for animal profile moderation)
- Bulk moderation actions (approve/reject multiple items) - deferring to phase 2

**Out of Scope:**
- Automated content moderation (AI-based image/text analysis) - deferred to phase 2
- User reputation system based on moderation history - deferred to phase 2
- Legal review workflow for high-risk items - deferred to phase 2
- Public moderation logs (transparency reports) - deferred to phase 2
- Integration with external moderation services (e.g., third-party content filters) - deferred to phase 2

## Constraints
- **Legal:** Must comply with Russian Federal Law 152-ФЗ (Personal Data) when handling user-generated content that may contain personal data. Must adhere to Russian laws regarding prohibited content (extremism, etc.).
- **Performance:** Moderation queue retrieval < 2s under normal load; individual moderation decision processing < 1s.
- **Usability:** Moderator interface must be simple and efficient for high-volume moderation (target: <30 seconds per item review).
- **Scalability:** System must support 10k+ moderation decisions per day.
- **Technology:** Must align with selected stack (NestJS, TypeScript, PostgreSQL, Redis).
- **Data:** Moderation decisions and audit logs must be stored immutably (append-only) to prevent tampering.
- **Reliability:** Moderation decisions must be persisted reliably; no loss of decisions or audit trail.

## Prior Decisions
- Moderation is implemented as a dedicated NestJS module with its own service and controller.
- Moderation queue is stored in PostgreSQL with a status field (PENDING, APPROVED, REJECTED, CHANGES_REQUESTED).
- Each moderatable entity (listing, animal profile) has a moderation status and a reference to the moderation decision record.
- Moderators access the queue via a paginated API endpoint with filtering options (by entity type, date submitted, etc.).
- Decision reasons are selected from a predefined list (configurable via Admin Domain) with optional free-text notes.
- Notifications are sent asynchronously via the Notification Domain after a moderation decision is made.
- Audit trail is stored in a separate table to ensure immutability and enable forensic analysis.
- Moderation interface is part of the admin panel (Admin Domain) but accessible to users with MODERATOR role.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Moderation API latency < 800ms for 95% of requests under load test (50 RPS) (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Moderation actions require authentication and authorization; audit logs are tamper-evident (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Moderator interface follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `moderation` module with NestJS CLI
   - [ ] Define ModerationDecision entity (TypeORM) with fields: id, moderatorId (User reference), entityType (Listing/Animal), entityId, decision (APPROVED/REJECTED/CHANGES_REQUESTED), reason (enum), notes (optional), createdAt
   - [ ] Add moderationStatus field to Listing and Animal entities (or create association table)
   - [ ] Implement ModerationController (get queue, get item details, submit decision)
   - [ ] Implement ModerationService (business logic for queue retrieval, decision processing, notification triggering)
   - [ ] Create moderation reason enum and configuration mechanism (via Admin Domain)
   - [ ] Set up rate limiting for moderation endpoints
   - [ ] Write unit and integration tests for moderation flows
   - [ ] Create OpenAPI (Swagger) docs for moderation endpoints

2. **Frontend (React)**
   - [ ] Create moderation queue page (part of admin panel)
   - [ ] Implement item detail view (show listing/animal details with moderation controls)
   - [ ] Implement decision submission form (reason selection, notes)
   - [ ] Create moderator role-based route protection
   - [ ] Implement real-time queue updates (via WebSocket or polling)
   - [ ] Write unit and e2e tests for moderation flows

3. **Infrastructure**
   - [ ] Configure PostgreSQL indexes for moderation queue queries (by status, entityType, createdAt)
   - [ ] Set up Redis caching for moderation queue (optional, for performance)
   - [ ] Add security headers and CORS configuration
   - [ ] Implement logging for moderation events (decision made, queue accessed)

## Verification Criteria
- [ ] Unit tests achieve >90% coverage for moderation module (backend)
- [ ] Integration tests cover: queue retrieval, decision submission (all decision types), notification triggering, audit log creation
- [ ] E2E tests (Cypress/Playwright) cover full moderator flow: login -> view queue -> review item -> submit decision -> verify notification sent
- [ ] Manual testing: verify moderation decision persists correctly, audit log is immutable, notifications are sent
- [ ] Performance: moderation API latency < 800ms for 95% of requests under load test (50 RPS)
- [ ] Security: verify that only MODERATOR and ADMIN roles can access moderation endpoints
- [ ] Documentation: OpenAPI spec generated and available at /api/docs
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented