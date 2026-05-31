---
version: "1.2"
lastUpdated: "2026-05-28"
author: "Системный аналитик"
status: "Approved"
---

# Spec: Identity Domain

## Outcome
Provide secure authentication and authorization for users of ZooLink, including pet owners, breeders, farmers, moderators, and admins. Enable user registration, login, profile management, and role-based access control.

## Scope & Boundaries
**In Scope:**
- User registration via phone (SMS) and OAuth (Google, Apple, Telegram, VK)
- Email verification (optional)
- Phone verification via SMS code
- JWT-based authentication with refresh tokens
- User profile management (view, update)
- Role and permission management (pet owner, breeder, farmer, moderator, admin)
- Passwordless login (SMS code)
- Session management

**Out of Scope:**
- Social features (chat, forums, etc.) - deferred to phase 2
- Advanced security features (biometrics, hardware keys) - deferred
- Account deletion/gdpr right to be forgotten - deferred to phase 2
- Admin impersonation/support tools - deferred

## Constraints
- **Legal:** Must comply with Russian Federal Law 152-ФЗ (Personal Data) for storing and processing user data.
- **Security:** Passwords not used; authentication via phone/OAuth only. Protect against brute force, SIM swapping (rate limiting on SMS).
- **Usability:** Registration flow must be simple for non-technical users (mass market pet owners).
- **Performance:** Authentication latency < 1s under normal load.
- **Scalability:** System must support 100k+ active users.
- **Technology:** Must align with selected stack (NestJS, TypeScript, PostgreSQL, Redis).
- **Data:** Personal data (phone number, name) must be stored securely and minimally.

## Prior Decisions
- Technology Stack (ADR 0001): NestJS backend, React frontend, PostgreSQL, Redis.
- Authentication method: Phone (SMS) + OAuth providers; email optional.
- No username/password authentication.
- JWTs stored in frontend (httpOnly cookies or local storage with safeguards).
- Role-based access control (RBAC) with roles: USER, BREEDER, FARMER, MODERATOR, ADMIN.
- User entity includes: id, phoneNumber (verified), firstName, lastName, role, createdAt, updatedAt, isActive.

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `identity` module with NestJS CLI
   - [ ] Define User entity (TypeORM/Prasmic) with fields: id, phoneNumber, firstName, lastName, role, isActive, createdAt, updatedAt
   - [ ] Implement phone verification service (SMS sending via Twilio abstraction)
   - [ ] Implement OAuth verification strategies (Google, Apple, Telegram, VK)
   - [ ] Create AuthController (register, login, refresh, profile)
   - [ ] Create AuthService (validate credentials, generate JWT/refresh tokens)
   - [ ] Create JwtStrategy and RefreshTokenGuard
   - [ ] Implement role-based guards (RolesGuard)
   - [ ] Set up rate limiting for SMS endpoints
   - [ ] Write unit and integration tests for auth flows
   - [ ] Create OpenAPI (Swagger) docs for auth endpoints

2. **Frontend (React)**
   - [ ] Create auth pages: Register, Login, Profile
   - [ ] Implement phone input with country code selection
   - [ ] Implement SMS code verification form
   - [ ] Implement OAuth login buttons
   - [ ] Create auth context/hooks (useAuth, useUser) for state management
   - [ ] Protect routes based on authentication and role
   - [ ] Implement token refresh mechanism
   - [ ] Create user profile view/edit page
   - [ ] Write unit and e2e tests for auth flows

3. **Infrastructure**
   - [ ] Configure Redis for refresh token storage (or use JWT with database refresh tokens)
   - [ ] Set up SMS provider credentials (Twilio) in environment
   - [ ] Configure OAuth provider credentials (Google, Apple, etc.)
   - [ ] Add security headers (helmet) and CORS configuration
   - [ ] Implement logging for auth events (success/failure)

## Verification Criteria
- [ ] Unit tests achieve >90% coverage for identity module (backend)
- [ ] Integration tests cover: registration via phone, registration via OAuth, login, token refresh, profile update, role-based access
- [ ] E2E tests (Cypress/Playwright) cover full user flow: registration -> login -> access protected route -> logout
- [ ] Manual testing: verify SMS delivery timing (<10s), OAuth redirect flows work
- [ ] Security review: no sensitive data leaked in responses, tokens are HTTP-only or properly protected
- [ ] Performance: auth API latency < 800ms for 95% of requests under load test (100 RPS)
- [ ] Compliance: data storage adheres to 152-ФЗ (minimal personal data, consent for processing)
- [ ] Documentation: OpenAPI spec generated and available at /api/docs
