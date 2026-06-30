# Security Non-Functional Requirements: ZooLink

## Purpose
Defines security requirements to protect user data, prevent unauthorized access, ensure compliance with regulations (ФЗ-152, GDPR principles), and maintain platform integrity.

## Scope
Applies to all system components: backend APIs, frontend applications, databases, file storage, and integrations.

## Core Security Principles
1. **Defense in Depth**: Multiple layers of security controls.
2. **Least Privilege**: Users and services have only the permissions they need.
3. **Fail Securely**: Default to denial of access in case of error.
4. **Complete Mediation**: Every access request is checked for authorization.
5. **Economy of Mechanism**: Keep security mechanisms simple and small.
6. **Open Design**: Security does not rely on secrecy of implementation.
7. **Psychological Acceptability**: Security measures should not hinder usability excessively.

## Authentication Requirements
### Password Policy (if using password-based auth)
- Minimum length: 12 characters
- Require mix of uppercase, lowercase, numbers, and special characters
- Prevent reuse of last 5 passwords
- Lock account after 5 failed attempts for 15 minutes
- Store passwords using bcrypt with cost factor ≥12
- Never store or transmit passwords in plain text

### Multi-Factor Authentication (MFA)
- **Planned for Фаза 2+**: 
  - Optional TOTP (Google Authenticator, etc.) for all users
  - Required for ADMIN role and users with elevated privileges
- **MVP**: **No MFA** — there is **no MFA field/infrastructure in the MVP schema** (GAP-013).
  > **ЧТО:** removed the false claim that MVP "infrastructure is prepared (MFA field in user schema)".
  > No such column exists in `database_schema.sql` (`users` / `refresh_tokens`), and migration 0020
  > (B2) deliberately added refresh-token session columns **without** an MFA placeholder.
  > **ПОЧЕМУ:** the statement was a doc↔schema lie — a reader/auditor would assume an MFA seam that
  > isn't there. **ПОЧЕМУ ТАК ЛУЧШЕ:** MFA is deferred to Фаза 2, and a speculative empty column
  > would be dead schema (IMPLEMENTATION_PLAYBOOK §5 — add a form only when it is the irreversible
  > artifact). When MFA lands in Фаза 2 it gets its own ADR + migration; the doc now states the true
  > MVP posture. See `data-model.md` §refresh_tokens.

### Session Management
- Session tokens (JWT) with short expiration: 15 minutes for access token
- Refresh token rotation: new refresh token issued on each use, old one invalidated
- Refresh token expiration: 7 days
- Secure cookie flags: HttpOnly, Secure, SameSite=Strict
- Session invalidation on password change, role change, or explicit logout
- Concurrent session limit: 5 active sessions per user (configurable)
- Session storage: encrypted in Redis with TTL matching refresh token

### API Security
- All API endpoints require valid authentication (except public registration/login)
- Rate limiting: 
  - Auth endpoints: 5 attempts per 15 minutes per IP
  - General API: 100 requests per minute per user (burst 200)
  - Moderation actions: 10 actions per minute per moderator
  - Contact reveal: 10 reveals per hour per user (pet), 5 per hour (livestock)
- Input validation: 
  - All inputs validated against strict schemas (white-list approach)
  - Protection against SQL injection (via ORM/parameterized queries)
  - Protection against XSS (output encoding in frontend)
  - Protection against CSRF (SameSite cookies and double-submit cookie for state-changing ops)
- Audit logging: 
  - All authentication events (success/failure)
  - All privilege escalation attempts
  - All data access and modification by privileged roles
  - Logs exclude sensitive data (passwords, tokens, full PII)

## Authorization Requirements
### Role-Based Access Control (RBAC)
- Clear separation between USER, MODERATOR, ADMIN roles
- Permissions defined per role and resource (see domain documents for specifics)
- Dynamic permissions: some permissions based on ownership (e.g., can edit own profile)
- Permission checks enforced at both API gateway and service level
- Principle of least privilege: start with no permissions, grant only what's needed

### Data Access Controls
- Users can only access:
  - Their own profile and animals
  - Listings they created (unless ACTIVE, then public with restrictions)
  - Public listings (ACTIVE status only)
  - Moderation queue and actions only if MODERATOR or ADMIN role
- Object-level authorization: 
  - Before returning a resource, verify the requesting user has permission to access that specific instance
  - Example: User can only update their own listings, not others'
- Secure direct object references: use indirect references (UUIDs) and verify ownership

## Data Protection Requirements
### Data at Rest Encryption
- **Database**: 
  - Enable Transparent Data Encryption (TDE) if using managed PostgreSQL service
  - For self-managed: consider filesystem-level encryption or pgcrypto for sensitive columns
  - Sensitive data to encrypt: 
    - Phone number hashes (already hashed)
    - Refresh tokens (encrypted)
    - OAuth tokens (encrypted)
    - Email addresses (considered PII, encrypt if storing long-term)
- **File Storage**:
  - Server-side encryption (SSE-S3 or SSE-KMS) for object storage
  - Client-side encryption not required for MVP (images are not sensitive)
  - Future consideration: encrypted storage for documents (Contracts, health records) in Фаза 2+
- **Backups**: 
  - Encrypted backups with separate key management
  - Retention period aligned with data retention policy (e.g., 30 days for active, 1 year for audits)

### Data in Transit Encryption
- **TLS 1.2+** enforced for all external communications
- HTTPS redirect for all HTTP requests
- Strong cipher suites: prioritize TLS_ECDHE_* with PFS
- HSTS header with max-age=31536000 (1 year) and includeSubDomains
- Internal service communication: 
  - Within same network segment: may allow plaintext if physically isolated
  - Cross-network or over public networks: always TLS

### Data Minimization & Retention
- Collect only necessary data for stated purpose (see domain models)
- Personal data (PII): 
  - Phone number (hashed for lookup)
  - Email (if provided)
  - Name
  - City (for geo-search)
  - IP address (logged for security, retained 30 days)
- Data retention schedule:
  - User data: retained until account deletion + 30 days grace period
  - Listing data: retained until deletion/completion + 60 days
  - Moderation logs: retained 1 year
  - Audit logs: retained 2 years (per compliance needs)
  - Analytics data: aggregated and anonymized after 90 days
- Anonymization/Pseudonymization:
  - For analytics: remove or hash PII before storage
  - For testing/development: use synthetic or masked data
  - ФЗ-152 right to erasure: **implemented in MVP** — `erase_user` anonymise-in-place workflow (`docs/specs/data-governance.md` §2, migration 0015); NOT deferred.

## Vulnerability Management
### Dependency Scanning
- Automated vulnerability scanning for:
  - Node.js/npm packages (using npm audit or similar)
  - Docker images (using Trivy or similar)
  - Infrastructure as Code (Terraform/CloudFormation scanning)
- Frequency: on every pull request and weekly for main branch
- Critical vulnerabilities: must be fixed within 48 hours
- High vulnerabilities: within 1 week
- Medium/Low: addressed in next regular cycle

### Security Testing
- **Penetration Testing**: 
  - Conducted before major releases (Phase 2+, 3+)
  - Performed by qualified third party or internal red team
  - Scope: network, application, API, authentication
- **Static Application Security Testing (SAST)**:
  - Integrated into CI pipeline (e.g., SonarQube, Semgrep)
  - Rules: OWASP Top 10, CWE/SANS Top 25
- **Dynamic Application Security Testing (DAST)**:
  - Scheduled regularly (e.g., weekly) on staging environment
  - Tools: OWASP ZAP, Nikto
- **Dependency Checking**: 
  - As part of build pipeline, flag known vulnerable libraries

### Incident Response
- **Monitoring**: 
  - Real-time alerts for:
    - Multiple failed login attempts
    - Privilege escalation events
    - Unusual data access patterns
    - WAF (Web Application Firewall) alerts
- **Response Plan**: 
  - Identification: automated alerts + manual triage
  - Containment: isolate affected systems, revoke compromised tokens
  - Eradication: remove malware, patch vulnerabilities
  - Recovery: restore from clean backups, monitor for recurrence
  - Lessons learned: post-incident report and update controls
- **Communication Plan**: 
  - Internal: incident response team, management
  - External: users affected, regulators (if personal data breach per ФЗ-152)
  - Timelines (ФЗ-152, ст.21 ч.3.1, ред. ФЗ-266 от 14.07.2022): notify Роскомнадзор of the **fact** of the breach within **24 hours** of discovery (presumed cause, harm, response measures), and the **results of the internal investigation** (incl. persons responsible) within **72 hours**; users notified without undue delay.
  > **ЧТО:** corrected the breach-notification window from a single "72h" to the two-stage **24h fact + 72h investigation result**.
  > **ПОЧЕМУ:** "72h" is the GDPR art.33 window; RF ФЗ-152 ст.21 ч.3.1 (since ФЗ-266/2022) imposes a stricter two-stage duty to РКН — understating it would put the operator out of compliance on a hard statutory deadline.
  > **ПОЧЕМУ ТАК ЛУЧШЕ:** the incident-response runbook now carries the correct legally-binding clock; the 24h leg is the one most likely to be missed. Confidence: high; verify the current редакция of ст.21 before relying (analysis dated 2026-06-30).

## Compliance Requirements
### ФЗ-152 (Personal Data)
- **Lawful basis for processing (ст.6 ч.1 ФЗ-152):**
  - **п.5 ч.1 ст.6** — processing necessary to **perform the contract** to which the data subject is a party: the **публичная оферта + пользовательское соглашение** (registration, account, listing, contact-reveal, moderation, transactional notifications) is that contract. This is the primary basis for core service processing — **no separate consent is required** for it.
  - **ст.9 (separate, freely-revocable consent)** — required for **non-essential** processing: marketing communications, behavioural analytics/profiling, optional cookies. Captured by a distinct granular consent, never bundled with оферта acceptance.
  > **ЧТО:** replaced "consent + legitimate interest" with the correct RF bases — **contract performance (п.5 ч.1 ст.6)** for core service + **separate ст.9 consent** for marketing/analytics.
  > **ПОЧЕМУ:** "legitimate interest" is a GDPR art.6(1)(f) basis that **does not exist** as a general basis in ФЗ-152; relying on it would mean the operator has *no* valid RF basis for core processing. Bundling all processing under "consent (for registration)" is also wrong — consent that is a precondition of service is not "free" (ст.9 ч.1) and is challengeable.
  > **ПОЧЕМУ ТАК ЛУЧШЕ:** aligns the lawful-basis claim with the actual statute and with the drafted оферта (`docs/legal/`); core service runs on contract-performance (robust, non-revocable mid-contract), marketing runs on revocable consent (ФЗ-38 ст.18 opt-in also applies to ad messaging — see launch checklist). Confidence: high.
- **Data subject rights (ФЗ-152 ст.14, ст.20–21) implemented via:**
  - **Right to access (ст.14):** profile view/edit (self-service) — **MVP minimum**. Full machine-readable export on request is a Phase 2+ enhancement; the MVP minimum (показать состав обрабатываемых ПДн on lawful request) is met via profile + admin support.
  - **Right to rectification:** users edit their own profile — MVP.
  - **Right to erasure / withdrawal (ст.9 ч.2 / отзыв согласия):** **implemented in MVP** — `erase_user` (anonymise-in-place, keep UUID) per `docs/specs/data-governance.md` §2, migration 0015 (`users.erased_at`); 30-day grace, then anonymisation; legal-hold tables (audit_log / moderation_decisions / ownership_history / financial records) deliberately retained.
  - **Right to restrict processing:** account deactivation — MVP.
  - **Right to object:** opt out of non-essential (analytics/marketing) processing — withdraws the ст.9 consent.
  > **ЧТО:** moved erasure (and access-minimum) from "Фаза 2+" to **MVP**; access full-export stays Phase 2+.
  > **ПОЧЕМУ:** the doc was stale — `erase_user` is built and runnable (data-governance §2, migration 0015, `retention.service.ts`/`admin-user.service.ts`/`profile.service.ts`); claiming erasure is deferred misrepresents compliance posture to an auditor/РКН.
  > **ПОЧЕМУ ТАК ЛУЧШЕ:** the NFR now matches the implemented contract (truth-hierarchy: schema/code over stale spec) and the data-governance spec; erasure being live is a compliance strength, not a gap.
- Data Protection Officer (DPO) / **ответственный за организацию обработки ПДн (ст.22.1 ФЗ-152)** designated for compliance oversight (owner action — name + contact published in the privacy policy).
- **Privacy Policy and Terms of Service / публичная оферта — DRAFTED (status: DRAFT) in `docs/legal/` (RU mirror `docsRU/legal/`); owner must review, finalise operator identity, and publish + link in footer before go-live.**
  > **ЧТО:** corrected the false "published" claim to "DRAFTED, awaiting owner sign-off + publication".
  > **ПОЧЕМУ:** no offer/ToS/policy existed in the repo (audit BLOCKER) — the "published" line was a doc↔reality lie; without a published оферта there is no contract to ground the п.5 ч.1 ст.6 basis above.
  > **ПОЧЕМУ ТАК ЛУЧШЕ:** the artifacts now exist as drafts (`docs/legal/`), the publication step is an explicit launch-checklist gate, and the lawful-basis claim becomes true the moment the owner publishes. Confidence: high.
- Consent mechanisms: granular, independently-revocable consents per processing purpose (marketing, analytics) — never bundled with оферта acceptance (ст.9 ч.1 "free" requirement).

### GDPR Principles (for future EU expansion)
- Similar to ФЗ-152 with additional considerations:
  - Data transfer mechanisms for cross-border transfers (if applicable)
  - Privacy by Design and Default: integrated into development lifecycle
  - Data Protection Impact Assessments (DPIA) for high-risk processing
  - Records of Processing Activities (ROPA) maintained

### Industry-Specific
- **Veterinary/Animal Welfare**: 
  - No facilitation of illegal animal trade (e.g., endangered species)
  - Moderators trained to spot welfare concerns in listings
  - Cooperation with authorities upon valid legal request
- **Financial** (for future monetization):
  - PCI DSS compliance if handling card payments directly (planned to use certified payment gateways)
  - AML/KYC considerations for high-value transactions (livestock)

## Secure Development Practices
### Training
- All developers complete basic security training (OWASP Top 10, secure coding)
- Annual refresher training
- Specialized training for auth, crypto, and data handling

### Threat Modeling
- Conducted for each major feature before development
- Uses STRIDE or PASTA methodology
- Results informs security requirements and test cases

### Code Review
- Security considerations part of pull request review checklist
- Look for: injection flaws, auth bypass, insecure direct object references, sensitive data exposure
- Use of security linters in CI pipeline

### Dependency Management
- Private npm registry or proxy for approved packages
- Automated updates for security patches
- Vulnerability database monitoring

### Environment Separation
- Distinct environments: Development, Testing, Staging, Production
- No production data in non-production environments (or masked/anonymized if used)
- Strict access controls to production environment
- Infrastructure as Code (IaC) for reproducible environments

## Non-Repudiation & Auditing
### Audit Logging
- Immutable audit trail for security-relevant events:
  - Authentication (success/failure, MFA attempts)
  - Authorization (permission checks, role changes)
  - Data access (read/write/delete by privileged users)
  - Configuration changes (system settings, feature toggles)
  - Integration events (API key usage, third-party calls)
- Log format: JSON with standard fields (timestamp, event type, actor, action, outcome, details)
- Log storage: centralized, tamper-evident (write-once storage or signed logs)
- Log retention: minimum 1 year for security logs, 2 years for audit logs
- Log monitoring: SIEM-like alerts for correlations (e.g., failed login followed by success from different IP)

### Digital Signatures (Future Consideration)
- For critical documents (contracts, health certificates) in Фаза 2+:
  - Consider digital signatures for non-repudiation
  - Infrastructure for key management and validation

## Security Testing & Validation
### Regular Scans
- Monthly vulnerability scans of production infrastructure
- Quarterly penetration tests (or as dictated by release cycle)
- Web application firewall (WAF) rule updates monthly

### Compliance Checks
- Annual review against ФЗ-152 requirements
- External audit (if required by regulators or partners) facilitated by maintained documentation

### Bug Bounty
- Consider launching a responsible disclosure program post-MVP (Phase 2+)
- Clear policy: scope, rewards, safe harbor, communication channel

## Exceptions & Risk Acceptance
- Any exception to these requirements must be documented, approved by information security officer, and reviewed periodically.
- Known risks accepted for MVP with mitigation plans:
  - Limited MFA availability (planned for Фаза 2+)
  - No dedicated WAF on MVP (relying on application-level protections and cloud provider basic protections)
  - Security monitoring basics (alerts on auth failures) rather than full SIEM (planned for Фаза 2+)

## References
- OWASP ASVS (Application Security Verification Standard) v4.0.3
- NIST Cybersecurity Framework
- ФЗ-152 "О персональных данных"
- GDPR Recitals and Articles
- CCPA (for future reference)
- CIS Benchmarks for Linux, Docker, PostgreSQL, Node.js
