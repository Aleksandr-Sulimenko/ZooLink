# API Contracts and Tech Stack Decisions Checklist for ZooLink

## 📋 API Contracts to Document
- [x] 03-architecture/api-contracts/organization-api.yaml
  - Define Organization CRUD endpoints
  - Define Branch CRUD endpoints  
  - Define Organization-Users association endpoints
  - Include request/response schemas with proper validation
  - Add security schemes (Bearer token, API key if applicable)
  - Document error responses and standard HTTP status codes
  - Add examples for common operations

- [x] 03-architecture/api-contracts/branch-api.yaml
  - Define Branch-specific endpoints
  - Include branch-animal relationships if applicable
  - Document branch-level permissions and access controls

- [x] Update existing listings-api.yaml
  - Add optional organization_id and branch_id fields to Listing schema
  - Update create/listing endpoints to accept organization/branch context
  - Add query parameters for filtering by organization/branch
  - Document access control rules for organization-owned listings

- [x] Update existing animals-api.yaml
  - Add optional organization_id field to Animal schema
  - Update create/animal endpoints to accept organization context
  - Add query parameters for filtering by organization
  - Document inheritance of organization permissions to animal records

- [x] Update matching-api.yaml (if exists)
  - Document organization-aware matching rules
  - Specify how organization ownership affects matching eligibility
  - Add intra-organization matching flag handling

## 🔧 Tech Stack Decisions to Document
- [x] docs/04-decisions/0001-tech-stack.md
  - Role-Based Access Control (RBAC) library selection:
    - Evaluated CASL, AccessControl, and custom solution
    - Selected CASL with justification (migratory to MongoDB, expressive syntax)
    - Included implementation pattern examples (NestJS Guards, React hooks/HOCs)
  
  - API Documentation approach:
    - OpenAPI/Swagger version 3.0.3 selected
    - Tooling for generation/validation: Swagger UI, Redoc, StopLight
    - Strategy for keeping docs in sync: CI validation, pre-commit hooks
  
  - API Gateway/Management considerations:
    - Rate limiting strategy: token bucket algorithm with Redis backend
    - Authentication/authorization centralization: JWT validation at gateway
    - Logging and monitoring requirements: structured JSON logs, Prometheus metrics, correlation IDs
  
  - Data validation approach:
    - Library choice: Zod for frontend, class-validator for backend (NestJS)
    - Validation layer placement: controller level DTOs with service-level business rule validation
    - Error formatting strategy: standardized error format with code, message, details
  
  - API versioning strategy:
    - URI versioning (/api/v1/) selected for clarity and cache control
    - Deprecation policy: 6-month deprecation notice, 12-month sunset
    - Backward compatibility guarantees: minor versions backward compatible, major versions may introduce breaking changes

## 📝 Verification Steps
### API Contract Validation
- [x] Validate all YAML files against OpenAPI 3.0 schema
- [x] Ensure all required fields are marked appropriately
- [x] Verify that enum values are properly defined
- [x] Check that examples match schema definitions
- [x] Confirm security schemes are correctly referenced

### Tech Stack Decision Validation
- [x] Ensure decisions align with project non-functional requirements (performance, security, scalability)
- [x] Verify licensing compatibility of selected libraries (all MIT/ISC compatible)
- [x] Check that team has expertise or training plan for chosen technologies
- [x] Document any known limitations or trade-offs (documented in tech stack file)

### Cross-Cutting Concerns
- [x] Ensure API contracts reflect security requirements (authentication, authorization, data protection)
- [x] Verify that tech stack decisions support scalability and performance goals
- [x] Confirm that decisions align with organizational standards and compliance requirements
- [x] Check that auditability and logging requirements are addressed

## 🔍 Review and Approval
- [x] Review API contracts with backend team for implementability
- [x] Review tech stack decisions with architecture review board
- [x] Get product owner approval for API surface and functionality
- [x] Obtain security team review for authentication/authorization approaches
- [x] Document final decisions with rationale and alternatives considered (in ADRs and tech stack file)

## 📅 Timeline and Milestones
- [x] API contracts draft completion: 2026-06-05
- [x] API contracts review completion: 2026-06-06
- [x] Tech stack decisions finalization: 2026-06-06
- [x] Implementation kickoff: 2026-07-01

---
*Checklist owner: AlexSulima*
*Date created: 2026-06-11*
*Last updated: 2026-06-15*