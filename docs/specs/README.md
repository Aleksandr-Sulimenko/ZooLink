---
version: "1.2"
lastUpdated: "2026-05-28"
author: "System Analyst"
status: "Approved"
---

# ZooLink Specifications

This directory contains Spec-Driven Development (SDD) artifacts for the ZooLink project.
Each specification follows the SDD template and serves as the source of truth for development.

## Specifications

1. [01-identity-domain.md](01-identity-domain.md) - Authentication, authorization, and user management
2. [02-animal-domain.md](02-animal-domain.md) - Animal entity as aggregate root
3. [03-pet-marketplace-domain.md](03-pet-marketplace-domain.md) - Pet listings marketplace
4. [04-livestock-marketplace-domain.md](04-livestock-marketplace-domain.md) - Livestock listings marketplace
5. [05-matching-domain.md](05-matching-domain.md) - Breeding matching functionality
6. [06-admin-domain.md](06-admin-domain.md) - Administrative and moderation functions
7. [07-geo-search-service.md](07-geo-search-service.md) - Geographic search capabilities
8. [08-frontend-architecture.md](08-frontend-architecture.md) - Three-layer frontend architecture (View→Domain→System)
9. [09-testing-strategy.md](09-testing-strategy.md) - Comprehensive testing approach
10. [10-implementation-roadmap.md](10-implementation-roadmap.md) - Phased implementation plan
11. [11-organization-domain.md](11-organization-domain.md) - Organizations (clinics, kennels, shelters, farms): branches, org users, INN/KPP legal-entity identity
12. [12-moderation-domain.md](12-moderation-domain.md) - Moderation queue for user-generated content: approve/reject/request-changes decisions with an immutable audit trail
13. [13-notification-domain.md](13-notification-domain.md) - Email & SMS transactional/promotional notifications (Unisender/SMS.RU), templates, delivery tracking, user preferences
14. [14-payment-domain.md](14-payment-domain.md) - Secure payment & payout processing (ЮKassa + СБП), refunds, 54-ФЗ fiscal receipts, minimized PCI scope
15. [15-api-gateway-domain.md](15-api-gateway-domain.md) - Cross-cutting entry point (auth, RBAC, rate limiting, routing); MVP realized by NestJS guards/interceptors behind a reverse proxy
16. [16-contact-exchange.md](16-contact-exchange.md) - Buyer-reaches-seller contact-reveal mechanism for the no-chat MVP: gated, rate-limited, ФЗ-152 privacy
17. [17-media-handling.md](17-media-handling.md) - End-to-end media pipeline for photos/avatars/logos: pre-signed S3 upload, validation, variants, lifecycle, privacy
18. [18-reputation.md](18-reputation.md) - Reputation & confirmed-sale primitive (FORM-first)

## How to Use These Specifications

1. **Read the specification** for the feature you're working on
2. **Verify implementation** against the specification's Task Breakdown and Verification Criteria
3. **Update the specification** if requirements change (specifications are the source of truth)
4. **Create tests** based on the Verification Criteria
5. **Implement features** following the Task Breakdown

## S-D-D (Spec-Driven Development) Process

1. **Write or update specification** before starting work
2. **Review specification** with team/stakeholders
3. **Implement** according to specification
4. **Verify** implementation meets specification criteria
5. **Update specification** if learned during implementation

All specifications are written in Markdown and should be kept up-to-date as the single source of truth.