---
version: "1.4"
lastUpdated: "2026-07-07"
author: "System Analyst"
status: "Approved"
#

# Traceability Matrix

| Business Requirement ID | Source (Backlog) | Specification Number | Related Sections | Verification Criteria | Related ADR | Related Database Schema | Related API Endpoints |
|-------------------------|------------------|----------------------|------------------|-----------------------|-------------|-------------------------|-----------------------|
| BR-001 | BACKLOG-001 | 01-identity-domain.md | 2.1, 2.2, 2.3 | UC-ID-01, UC-ID-02, UC-ID-03, UC-ID-04, UC-ID-05, Perf-ID-01 | 0001-tech-stack.md, 0006-agent-as-principal, 0007-orm-strategy, 0008-rf-provider-matrix | users (id, phone_hash [HMAC, unique], oauth_*, full_name, city_id, avatar_url, email, email_verified, password_hash [operator-only], role, principal_type, status [source of truth], verification_attempts, notification_prefs, preferred_language, is_active [derived], last_login_at, suspended_at, deactivated_at, erased_at [ФЗ-152], created_at, updated_at), refresh_tokens, notification_logs [redacted on erase] | auth-api.yaml (POST /auth/register/phone, POST /auth/register/oauth/{provider}, POST /auth/verify-phone, POST /auth/refresh, POST /auth/logout, GET /me, PATCH /me, POST /me/deactivate, POST /me/reactivate, POST /auth/recover/email/request, POST /auth/recover/email/verify, PATCH /admin/users/{userId}/role, POST /admin/users/{userId}/rebind, POST /admin/users/{userId}/erase, POST /me/erase) — passwordless, no /auth/login (round-4); Slice-4 recovery/role-elevation/erasure |
| BR-002 | BACKLOG-002 | 02-animal-domain.md | 3.1, 3.2 | UC-AN-01, UC-AN-02, UC-AN-03, UC-AN-04, UC-AN-05, Perf-AN-01 | 0001-tech-stack.md | animals (id, owner_id, organization_id, species_id, breed_id, breed_text, nickname, sex, date_of_birth, color_coat, microchip_id, tattoo_brand_id, is_active, health_records, reproductive_data, owned_since, mother_id, father_id, created_at, updated_at, deactivated_at), ownership_transfers, animal_ownership_history (ADR-0013) | animals-api.yaml (GET /animals, POST /animals, GET /animals/{id}, PATCH /animals/{id}, DELETE /animals/{id}, GET /animals/{id}/ownership-history, PATCH /animals/{id}/deactivate, PATCH /animals/{id}/reactivate); transfers-api.yaml (POST /animals/{id}/transfers, POST /transfers/{transferId}/accept, /decline, /cancel, GET /transfers, GET /transfers/{transferId}) — ownership transfer, ADR-0013 |
| BR-003 | BACKLOG-003 | 03-pet-marketplace-domain.md | 4.1, 4.2, 4.3 | UC-PM-01, UC-PM-02, UC-PM-03, UC-PM-04, UC-PM-05, Perf-PM-01 | 0001-tech-stack.md | listings (for pet listings, see animal_id and listing_type) | listings-api.yaml (GET /listings, POST /listings, GET /listings/{id}, PATCH /listings/{id}, DELETE /listings/{id}) |
| BR-004 | BACKLOG-004 | 04-livestock-marketplace-domain.md | 5.1, 5.2 | UC-LM-01, UC-LM-02, UC-LM-03, UC-LM-04, UC-LM-05, Perf-LM-01 | 0001-tech-stack.md | listings (for livestock listings, see animal_id and listing_type) | listings-api.yaml (same as above) |
| BR-005 | BACKLOG-005 | 05-matching-domain.md | 6.1 | UC-MT-01, UC-MT-02, UC-MT-03, UC-MT-04, UC-MT-05, Perf-MT-01 | 0001-tech-stack.md | animals (reproductive_data), listings (breeding listings) | matching-api.yaml (assumed endpoints for matching) |
| BR-006 | BACKLOG-006 | 06-admin-domain.md | 7.1, 7.2 | UC-AD-01, UC-AD-02, UC-AD-03, UC-AD-04, UC-AD-05 | 0001-tech-stack.md | organizations, branches, organization_users, feature_toggles, outbox_events | admin-api.yaml, organization-api.yaml, branch-api.yaml |
| BR-007 | BACKLOG-007 | 07-geo-search-service.md | 8.1 | UC-GS-01, UC-GS-02, UC-GS-03, Perf-GS-01 | 0001-tech-stack.md | listings (location_point, search_radius_m), cities | geo-search-api.yaml (GET /geo-search, /geo/geocode, /saved-searches), listings-api.yaml (geo params) |
| BR-008 | BACKLOG-008 | 08-frontend-architecture.md | 9.1, 9.2 | UC-FE-01, UC-FE-02, Perf-FE-01 | 0001-tech-stack.md | (N/A) | All API endpoints (frontend consumes them) |
| BR-009 | BACKLOG-009 | 09-testing-strategy.md | 10.1 | UC-TS-01, UC-TS-02, UC-TS-03, UC-TS-04, UC-TS-05, Test coverage >90%, Load testing | 0001-tech-stack.md | (N/A) | (N/A) |
| BR-010 | BACKLOG-010 | 10-implementation-roadmap.md | 11.1 | Implementation phases, Success criteria | 0001-tech-stack.md | (N/A) | (N/A) |
| BR-011 | BACKLOG-011 | 11-organization-domain.md | 12.1 | (see spec User Stories) | 0002-hard-split-markets.md | organizations, branches, organization_users (role_in_org), animals (organization_id) | organization-api.yaml, branch-api.yaml |
| BR-012 | BACKLOG-012 | 12-moderation-domain.md | 13.1 | (see spec User Stories) | 0003-pre-moderation-workflow.md, 0006-ai-agents-operate-platform.md | moderation_reasons, moderation_decisions (append-only), content_reports, listings.moderation_status | moderation-api.yaml |
| BR-013 | BACKLOG-013 | 13-notification-domain.md | 14.1 | (see spec User Stories) | 0001-tech-stack.md | notification_templates, notification_logs, users.notification_prefs | notification-api.yaml |
| BR-014 | BACKLOG-014 | 14-payment-domain.md | 15.1 | (see spec User Stories) | 0006-ai-agents-operate-platform.md | payment_transactions, refunds, listings.transaction_id, feature_toggles.payments | payment-api.yaml |
| BR-015 | BACKLOG-015 | 15-api-gateway-domain.md | 16.1 | (see spec User Stories) | 0001-tech-stack.md | (cross-cutting; auth, rate limiting) | auth-api.yaml + gateway concerns across all contracts |
| BR-016 | BACKLOG-016 | 03-pet-marketplace-domain.md, 07-geo-search-service.md | (MVP additions) | (favorites, saved searches, content reports) | 0003-pre-moderation-workflow.md | favorites, saved_searches, content_reports | geo-search-api.yaml (/saved-searches); favorites-api.yaml (GET /favorites, POST/DELETE /listings/{id}/favorite) |
| BR-017 | BACKLOG-017 | 01-identity-domain.md, ADR-0006 | (AI-agent principals) | (principal HUMAN/AGENT) | 0006-ai-agents-operate-platform.md | users.principal_type, moderation_decisions.moderator_id, service_credentials (migration 0017) | auth-api.yaml; service_credentials — agent-service-auth FORM (hashed-secret by AGENT principal, rotatable/revocable, gated, not seeded in MVP) |

## Implementation status — Waves A–D (as of 2026-07-07, HEAD `deb8b37`)

The rows above are BR→spec anchors; the slices below record what has since been **built** against those BRs. Each carries its ADR and migration so the matrix stays a live contract, not a snapshot. (Doc-only summary; the per-migration meaning is authoritative in `ZooLink/CLAUDE.md`, DB = 37 tables, migrations 0001–0034.)

| BR | Slice (Wave) | ADR / migration | Status |
|----|--------------|-----------------|--------|
| BR-001 | PII-at-rest crypto seam (email/phone encrypt + blind index) | ADR-0019 / 0028 | ✅ built |
| BR-001 | Versioned consent-record model + contact-prefs default-OFF (ст.10.1) | ADR-0020 / 0029 | ✅ built |
| BR-001 / BR-017 | `user_roles` multi-role junction (**dormant** — `users.role` stays sole authz source) | ADR-0022 / 0034 | ✅ form built, behaviour deferred |
| BR-002 | Ownership transfer + recipient-minted **claim code** counterparty discovery | ADR-0013 / 0023 | ✅ built |
| BR-002 / BR-013 | Ownership-transfer notification path (first real outbox consumer, IN_APP channel) | ADR-0021 / 0030 | ✅ built |
| BR-003 / BR-004 | Listing **view-count** capture (GAP-TRACE-006 — the one irreversibly-lost signal) | 0031 | ✅ built |
| BR-003 / BR-004 | **Contact-exchange** revival — `contact_reveals` dedup + billing-unit UNIQUE | ADR-0020 / 0029 | ✅ built |
| BR-003 / BR-004 / BR-007 | **OfferingRef** polymorphic seam on favorites + saved_searches (`offering_type/offering_id`) | ADR-0014 / 0032 | ✅ form built (ANIMAL_LISTING only) |
| BR-003 / BR-004 / BR-007 | **derived-`market` cache** — decouple discovery/moderation reads from `animals ⋈ species` | ADR-0018 / 0033 | ✅ built (Part-2 D8/D8b done) |
| BR-007 | `geo_anchor` / near-me endpoint reconciliation (point-form; PostGIS gated) | ADR-0014 (D7) | ✅ reconciled |
| BR-012 | Moderation SLA-escalation (`Moderation.Escalated`, pet-4h/livestock-6h) | 0024 | ✅ built |
| BR-016 | Favorites controller (`GET /favorites`, `POST/DELETE /listings/{id}/favorite`) | 0032 (D11) | ✅ built |
| (future) | `monetization_type` `{LEAD_GEN,SUBSCRIPTION,TAKE_RATE,NONE}` spec reservation | ADR-0014 §Amendment (D9) | ⏸ spec-only, model deferred |

### Ecosystem expansion (multi-sided platform vision) — where it is tracked

The multi-sided ecosystem vision (services + goods + expertise + find-nearby) is **promoted beyond discovery**: the strategic writeup lives in `docs/01-discovery/future-features.md` §Ecosystem Expansion, and it is decomposed into a tracked ADR plan in **`docs/04-decisions/ECOSYSTEM_ADR_PLAN.md`** (ADR-0014 offering seam, ADR-0015 market_scope, ADR-0016 provider tier, ADR-0018 cross-aggregate rule, ADR-0022 multi-role). **Open for architect/alpha-analyst:** formal apex business-requirement rows (BR-018+) in this matrix and in `docs/02-requirements/business-requirements/` do not yet exist — the vision is tracked as ADRs, not yet as numbered BRs. This is a decision-tier gap flagged for **architect**, not a doc-keeper mechanical fix.

### Known divergences — tracked, not yet reconciled

- **D10 — animal read-scope authz asymmetry.** `animal.getById` applies a CASL **owner-only** guard, whereas the animal **list** scope admits an **org-admin** read. A user who can see an animal in a list may be refused on the by-id fetch. This is a **known behavioural divergence** surfaced in Wave D10 (shared read-scope authz point); it is recorded here as a tracked issue for **architect/security** to rule on (is org-admin by-id read intended?) — **not** a code change made in this doc sweep. No requirement is dropped: the safer (narrower) owner-only guard currently holds on the sensitive path.
- **Contract server-URL vs runtime prefix.** All 13 OpenAPI contracts declare `servers: url: /api/v1`; the NestJS runtime uses URI versioning `/v1/*` with no `/api` prefix (`backend/src/main.ts`). This is a **cross-contract** canon question (intended reverse-proxy `/api` prefix, or align all 13 to `/v1`?) for **architect/backend** — deliberately **not** patched on a single contract, which would only break its parity with the other twelve.