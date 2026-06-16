---
version: "1.0"
lastUpdated: "2026-06-15"
author: "System Analyst"
status: "Draft"
---

# Spec: Payment Domain

## Outcome
Provide a secure and reliable payment processing service for handling financial transactions on the ZooLink platform. Enable users to make payments for services (listing promotions, premium features, etc.) and receive payouts (for sales, breeding fees, etc.) while ensuring compliance with financial regulations, protecting sensitive financial data, and providing clear transaction records.

## Scope & Boundaries
**In Scope:**
- Payment processing for platform services (listing promotions, featured placements, premium subscriptions)
- Payout processing for users (sale proceeds, breeding fees, service payments)
- Integration with payment gateways (Stripe, PayPal, etc.) - initial implementation with one provider
- Secure storage of payment metadata (transaction IDs, amounts, statuses) - NOT storing full card details
- Payment status tracking (pending, completed, failed, refunded, disputed)
- Refund processing for cancelled or failed transactions
- Payment receipts and invoices generation
- Webhook handling for payment gateway notifications (payment success, failure, dispute)
- Integration with Account/Billing system (to be implemented in future phases)
- Support for one-time payments and recurring payments (subscriptions)
- Localization of payment interface and receipts (English/Russian)
- Compliance with PCI DSS requirements (by using tokenization and not storing raw card data)
- Audit trail for all payment-related actions

**Out of Scope:**
- Direct handling of raw credit card numbers or sensitive authentication data (delegated to PCI-compliant gateways)
- Cryptocurrency payments - deferred to phase 2
- Escrow services for high-value transactions - deferred to phase 2
- Complex subscription management (proration, plan changes) - deferred to phase 2
- Multi-currency support (initially RUB only) - deferred to phase 2
- Tax calculation and reporting - deferred to phase 2
- Integration with accounting software (QuickBooks, etc.) - deferred to phase 2
- In-platform wallet/store credit system - deferred to phase 2

## Constraints
- **Legal:** Must comply with Russian Federal Law 161-ФЗ "On the National Payment System" and related regulations. Must adhere to data protection laws (152-ФЗ) for any personal data associated with payments.
- **Security:** Must achieve PCI DSS compliance by never storing, processing, or transmitting raw card data on our systems. Must use tokenization and encryption for payment metadata.
- **Performance:** Payment API call latency < 1s for initiating payment; actual processing time depends on gateway but should complete within reasonable time (<30s for most transactions).
- **Reliability:** System must handle payment gateway downtime gracefully (queueing, user notifications). Must ensure no financial loss due to system failures.
- **Usability:** Payment process must be simple and clear for users; error messages must be actionable.
- **Scalability:** System must support 1k+ payment transactions per day initially, scaling to 10k+.
- **Technology:** Must align with selected stack (NestJS, TypeScript, PostgreSQL, Redis).
- **Data:** Payment metadata must be stored securely; sensitive data must be tokenized/gateway-only.
- **Financial Integrity:** All transactions must be reconciled; system must prevent double-charging or missing payments.

## Prior Decisions
- Payment service is implemented as a dedicated NestJS module.
- Uses established payment gateways (Stripe recommended for initial implementation) via their APIs.
- No raw card data touches our servers; all payment information is handled directly by the gateway or via secure payment elements.
- We store only payment metadata: gateway transaction ID, amount, currency, status, user reference, purpose reference (listing ID, etc.), and timestamps.
- Payment intents are created via gateway API and confirmed client-side with user authentication.
- Webhooks from payment gateways are used to update transaction status asynchronously.
- Failed payments are retryable with clear user feedback.
- Refunds are processed via gateway API and recorded in our system.
- Payment metadata is linked to relevant entities (Listings, Users, etc.) via foreign keys.
- Payment service communicates with other domains via events or direct service calls (e.g., activating a promoted listing after successful payment).
- Payouts to users (for sales) will be handled separately and may involve manual processing initially.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Payment API latency < 1s for 95% of requests under load test (20 RPS) (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Payment service achieves PCI DSS compliance via tokenization; sensitive data never touches our servers (see docs/02-requirements/nfr/security.md)
- **Availability (NFR-AVAIL)**: Payment service handles gateway downtime gracefully with queuing and user notifications (see docs/02-requirements/nfr/availability.md)

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `payment` module with NestJS CLI
   - [ ] Define PaymentTransaction entity (TypeORM) with fields: id, userId, gatewayTransactionId, amount, currency, status (PENDING/COMPLETED/FAILED/REFUNDED/DISPUTED), purposeType (ListingPromotion/PremiumSubscription/etc.), purposeId, createdAt, updatedAt
   - [ ] Define Refund entity (TypeORM) for tracking refunds (id, paymentTransactionId, gatewayRefundId, amount, reason, status, createdAt)
   - [ ] Implement PaymentController (create payment intent, confirm payment, get transaction status, process refund, webhook handler)
   - [ ] Implement PaymentService (business logic for payment creation, status checking, refund processing)
   - [ ] Create payment gateway provider abstraction (Stripe/Twilio/PayPal)
   - [ ] Implement secure webhook endpoint for payment gateway notifications
   - [ ] Implement idempotency keys for payment requests to prevent double-charging
   - [ ] Set up logging for payment events (created, completed, failed, refunded)
   - [ ] Write unit and integration tests for payment flows (using gateway test modes)
   - [ ] Create OpenAPI (Swagger) docs for payment endpoints

2. **Frontend (React)**
   - [ ] Create payment UI components (secure payment form using gateway elements)
   - [ ] Implement payment flow: initiate payment -> confirm with gateway -> show result
   - [ ] Create payment history page for users
   - [ ] Implement refund initiation UI (where applicable)
   - [ ] Create invoice/receipt viewing and download functionality
   - [ ] Write unit and e2e tests for payment flows

3. **Infrastructure**
   - [ ] Configure environment variables for payment gateway API keys (test and live)
   - [ ] Set up logging for payment events and webhook deliveries
   - [ ] Add security headers and CORS configuration (with strict origins for webhooks)
   - [ ] Implement monitoring for payment success rates, failure reasons, and gateway latency
   - [ ] Plan for PCI DSS compliance validation (external audit)

4. **Verification Criteria**
   - [ ] Unit tests achieve >90% coverage for payment module (backend)
   - [ ] Integration tests cover: payment intent creation, confirmation (success/failure), webhook handling, refund processing, idempotency
   - [ ] Manual testing: verify payment flows work in test mode with gateways, check webhooks, verify transaction records
   - [ ] Performance: payment API latency < 1s for 95% of requests under load test (20 RPS)
   - [ ] Security: verify that no raw card data is stored in logs, database, or responses
   - [ ] Reliability: verify graceful handling of gateway downtime (queueing, user notifications)
   - [ ] Documentation: OpenAPI spec generated and available at /api/docs
   - [ ] NFR Traceability: Verify that performance, security, and availability requirements are properly addressed and documented

---

## Related Documents

- [Glossary](glossary.md)
- [Pet Marketplace](03-pet-marketplace-domain.md)
- [Livestock Marketplace](04-livestock-marketplace-domain.md)
- [Notification Domain](13-notification-domain.md)
- 🌐 RU mirror: [docsRU/specs/14-payment-domain.md](../../docsRU/specs/14-payment-domain.md)
