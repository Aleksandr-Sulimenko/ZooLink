---
version: "1.0"
lastUpdated: "2026-06-15"
author: "System Analyst"
status: "Draft"
---

# Spec: Notification Domain

## Outcome
Provide a reliable notification service for delivering timely alerts to users via email and SMS. Enable the platform to send transactional notifications (account actions, moderation decisions, matching suggestions) and promotional notifications (service updates, feature announcements) while ensuring delivery reliability, tracking, and compliance with communication regulations.

## Scope & Boundaries
**In Scope:**
- Email notification service (via SendGrid or similar provider)
- SMS notification service (via Twilio or similar provider)
- Template-based notification content with localization support
- Delivery tracking (sent, delivered, failed, bounced)
- Rate limiting and throttling to comply with provider limits
- User notification preferences (opt-in/out for different notification types)
- Queuing mechanism for handling notification spikes
- Retry logic for failed deliveries (exponential backoff)
- Integration with other domains (Identity, Moderation, Matching, etc.) via events or direct service calls
- Support for both transactional and promotional notifications
- Unsubscribe mechanism for promotional communications
- Localization of notification content (English/Russian)
- Support for rich content (HTML emails, Unicode SMS)

**Out of Scope:**
- Push notifications (mobile/app) - deferred to phase 2
- In-app notifications (within web interface) - deferred to phase 2
- Voice notifications - deferred to phase 2
- Chatbot notifications (Telegram, WhatsApp) - deferred to phase 2
- Advanced analytics (A/B testing, engagement tracking) - deferred to phase 2
- Notification scheduling (send at specific time) - deferred to phase 2

## Constraints
- **Legal:** Must comply with Russian Federal Law 152-ФЗ (Personal Data) when handling user contact information. Must adhere to Russian communication laws (advertising, spam prevention). Must comply with international regulations (CAN-SPAM, GDPR where applicable).
- **Performance:** Notification API call latency < 500ms; actual delivery time depends on provider but should be < 10s for SMS, < 30s for email under normal conditions.
- **Reliability:** System must achieve >99% delivery success rate for valid notifications; failed notifications must be retryable.
- **Usability:** Notification content must be clear, concise, and actionable; users must easily understand how to unsubscribe or manage preferences.
- **Scalability:** System must support 100k+ notifications per day.
- **Technology:** Must align with selected stack (NestJS, TypeScript, PostgreSQL, Redis).
- **Data:** Notification logs must be stored for audit and troubleshooting; personal data (email, phone) must be handled per 152-ФЗ.
- **Cost:** Notification costs must be monitored and optimized; free tiers/utilization should be maximized before incurring costs.

## Prior Decisions
- Notification service is implemented as a dedicated NestJS module with providers for email and SMS.
- Uses external service providers (SendGrid for email, Twilio for SMS) via their APIs.
- Notification templates are stored as handlebars templates with localization support.
- Notification requests are queued in Redis (or database) for asynchronous processing to prevent blocking API calls.
- Each notification attempt is logged with status, provider response, and timestamps.
- User notification preferences are stored in the Identity Domain (user entity or separate preferences table).
- Rate limiting is implemented at the service level to respect provider limits.
- Failed notifications are retried with exponential backoff (max 3 attempts).
- Notification content localization uses the same mechanism as the frontend (i18n libraries).
- Unsubscribe links are included in promotional notifications and managed via Identity Domain.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Notification API latency < 500ms for 95% of requests under load test (100 RPS) (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Notification service protects user contact information; API keys are stored securely (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Notification content follows accessibility guidelines for readability (see docs/02-requirements/nfr/accessibility.md)

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `notification` module with NestJS CLI
   - [ ] Define NotificationLog entity (TypeORM) with fields: id, userId, type (EMAIL/SMS), templateId, recipient, subject/content, status (SENT/DELIVERED/FAILED/BOUNCED), providerResponse, attempts, createdAt, updatedAt
   - [ ] Define NotificationTemplate entity (TypeORM) for managing templates (id, name, type, subjectTemplate, bodyTemplate, language, isActive)
   - [ ] Implement NotificationController (send notification, get logs, manage preferences)
   - [ ] Implement NotificationService (business logic for queuing, template rendering, provider integration)
   - [ ] Create providers for SendGrid and Twilio abstractions
   - [ ] Implement notification queue (Redis-based or database-based)
   - [ ] Implement retry mechanism with exponential backoff
   - [ ] Implement rate limiting per provider and per user
   - [ ] Create template rendering service (handlebars with localization)
   - [ ] Write unit and integration tests for notification flows
   - [ ] Create OpenAPI (Swagger) docs for notification endpoints

2. **Infrastructure**
   - [ ] Configure Redis for notification queue (or use database tables)
   - [ ] Set up external provider credentials (SendGrid API key, Twilio Account SID/Auth Token) in environment
   - [ ] Configure logging for notification events (sent, failed, retried)
   - [ ] Add security headers and CORS configuration
   - [ ] Implement monitoring for notification delivery rates and provider costs

3. **Verification Criteria**
   - [ ] Unit tests achieve >90% coverage for notification module (backend)
   - [ ] Integration tests cover: notification queuing, template rendering, provider integration (mocked), retry logic, rate limiting
   - [ ] Manual testing: verify email/SMS delivery with actual providers (using test credentials), check logs, verify preference handling
   - [ ] Performance: notification API latency < 500ms for 95% of requests under load test (100 RPS)
   - [ ] Reliability: achieve >99% delivery success rate in test scenarios with simulated provider failures
   - [ ] Security: verify that API keys are not exposed in logs or responses
   - [ ] Documentation: OpenAPI spec generated and available at /api/docs
   - [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented