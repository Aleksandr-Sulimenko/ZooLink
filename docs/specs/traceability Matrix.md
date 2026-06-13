---
version: "1.2"
lastUpdated: "2026-06-06"
author: "System Analyst"
status: "Approved"
#

# Traceability Matrix

| Business Requirement ID | Source (Backlog) | Specification Number | Related Sections | Verification Criteria | Related ADR | Related Database Schema | Related API Endpoints |
|-------------------------|------------------|----------------------|------------------|-----------------------|-------------|-------------------------|-----------------------|
| BR-001 | BACKLOG-001 | 01-identity-domain.md | 2.1, 2.2, 2.3 | UC-ID-01, UC-ID-02, UC-ID-03, UC-ID-04, UC-ID-05, Perf-ID-01 | 0001-tech-stack.md | users (id, phone_hash, oauth_*, full_name, city_id, avatar_url, email, email_verified, password_hash, role, is_active, last_login_at, deactivated_at, created_at, updated_at) | auth-api.yaml (POST /auth/login, POST /auth/refresh, POST /auth/logout, GET /auth/me, etc.) |
| BR-002 | BACKLOG-002 | 02-animal-domain.md | 3.1, 3.2 | UC-AN-01, UC-AN-02, UC-AN-03, UC-AN-04, UC-AN-05, Perf-AN-01 | 0001-tech-stack.md | animals (id, owner_id, organization_id, species_id, breed_id, breed_text, nickname, sex, date_of_birth, color_coat, microchip_id, tattoo_brand_id, is_active, health_records, reproductive_data, owned_since, mother_id, father_id, created_at, updated_at, deactivated_at) | animals-api.yaml (GET /animals, POST /animals, GET /animals/{id}, PATCH /animals/{id}, DELETE /animals/{id}, GET /animals/{id}/ownership-history, PATCH /animals/{id}/deactivate, PATCH /animals/{id}/reactivate) |
| BR-003 | BACKLOG-003 | 03-pet-marketplace-domain.md | 4.1, 4.2, 4.3 | UC-PM-01, UC-PM-02, UC-PM-03, UC-PM-04, UC-PM-05, Perf-PM-01 | 0001-tech-stack.md | listings (for pet listings, see animal_id and listing_type) | listings-api.yaml (GET /listings, POST /listings, GET /listings/{id}, PATCH /listings/{id}, DELETE /listings/{id}) |
| BR-004 | BACKLOG-004 | 04-livestock-marketplace-domain.md | 5.1, 5.2 | UC-LM-01, UC-LM-02, UC-LM-03, UC-LM-04, UC-LM-05, Perf-LM-01 | 0001-tech-stack.md | listings (for livestock listings, see animal_id and listing_type) | listings-api.yaml (same as above) |
| BR-005 | BACKLOG-005 | 05-matching-domain.md | 6.1 | UC-MT-01, UC-MT-02, UC-MT-03, UC-MT-04, UC-MT-05, Perf-MT-01 | 0001-tech-stack.md | animals (reproductive_data), listings (breeding listings) | matching-api.yaml (assumed endpoints for matching) |
| BR-006 | BACKLOG-006 | 06-admin-domain.md | 7.1, 7.2 | UC-AD-01, UC-AD-02, UC-AD-03, UC-AD-04, UC-AD-05 | 0001-tech-stack.md | organizations, branches, organization_users, feature_toggles, outbox_events | admin-api.yaml, organization-api.yaml, branch-api.yaml |
| BR-007 | BACKLOG-007 | 07-geo-search-service.md | 8.1 | UC-GS-01, UC-GS-02, UC-GS-03, Perf-GS-01 | 0001-tech-stack.md | listings (location_point, search_radius_m), cities | listings-api.yaml (geo-search parameters in GET /listings) |
| BR-008 | BACKLOG-008 | 08-frontend-architecture.md | 9.1, 9.2 | UC-FE-01, UC-FE-02, Perf-FE-01 | 0001-tech-stack.md | (N/A) | All API endpoints (frontend consumes them) |
| BR-009 | BACKLOG-009 | 09-testing-strategy.md | 10.1 | UC-TS-01, UC-TS-02, UC-TS-03, UC-TS-04, UC-TS-05, Test coverage >90%, Load testing | 0001-tech-stack.md | (N/A) | (N/A) |
| BR-010 | BACKLOG-010 | 10-implementation-roadmap.md | 11.1 | Implementation phases, Success criteria | 0001-tech-stack.md | (N/A) | (N/A) |