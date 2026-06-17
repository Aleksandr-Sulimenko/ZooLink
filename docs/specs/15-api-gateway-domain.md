---
version: "1.0"
lastUpdated: "2026-06-15"
author: "System Analyst"
status: "Draft"
---

# Spec: API Gateway Domain

## Outcome
Provide a secure, high-performance entry point for all client requests to the ZooLink platform. Handle cross-cutting concerns such as authentication, rate limiting, request/response transformation, routing, and load balancing while ensuring observability, security, and resilience.

> ⚠️ **MVP vs Target State.** Per [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md), the MVP "API Gateway" is **not** a separate service or Kubernetes ingress. In the MVP modular monolith it is realized by **NestJS global guards/interceptors/filters** (auth, RBAC, rate-limiting via `@nestjs/throttler`+Redis, validation, error envelope) behind a **reverse proxy (Nginx/Caddy)** that terminates TLS. Kubernetes/HPA, ELK, Jaeger, circuit-breakers and the 10k RPS target in this spec are **Target State (Фаза 2+)**; MVP load targets are in `performance_specification.md` (50 RPS avg / 200 peak).

## Scope & Boundaries
**In Scope:**
- Request routing to appropriate backend services (modules) based on path and method
- Authentication verification (JWT validation, session validation)
- Authorization checks (role-based access control) for protected endpoints
- Rate limiting (per IP, per user, per endpoint) to prevent abuse
- Request/response transformation (header manipulation, body enrichment)
- SSL/TLS termination and certificate management
- Request/response logging and monitoring (access logs, metrics)
- Integration with Identity Domain for user context and token validation
- Support for versioning (URL versioning, header versioning)
- CORS handling and preflight request management
- Request size limits and payload validation
- Graceful degradation and circuit breaker patterns for downstream service failures
- Health check endpoints for platform monitoring
- Support for both RESTful APIs and WebSocket connections (future)

**Out of Scope:**
- Business logic implementation (handled by individual domain modules)
- Data storage or retrieval (handled by respective domain modules)
- Complex workflow orchestration (handled by domain services or saga patterns)
- Message queue consumption (handled by workers)
- Long-running background job processing
- Direct database access (gateway should not query databases directly)
- Microservice service discovery (if using service mesh, handled by mesh)
- Load balancing across multiple gateway instances (handled by external load balancer)

## Constraints
- **Performance:** Gateway must add minimal latency (<50ms) to request processing; handle 10k+ RPS with horizontal scaling.
- **Security:** Must protect against OWASP Top 10 vulnerabilities (injection, broken auth, sensitive data exposure, etc.).
- **Reliability:** Must be highly available; failure of gateway should not take down entire platform (design for failure).
- **Scalability:** Must support horizontal scaling; stateless design preferred for easy replication.
- **Observability:** Must provide comprehensive logging, metrics, and tracing for debugging and monitoring.
- **Technology:** Must align with selected stack (NestJS, TypeScript) but can leverage specialized gateway libraries or patterns.
- **Compatibility:** Must be compatible with existing NestJS modules and their communication patterns.
- **Deployability:** Must be deployable in containerized environments (Kubernetes) and support rolling updates.

## Prior Decisions
- API Gateway is implemented as a NestJS module using the `@nestjs/core` framework with custom middleware and guards.
- Uses NestJS interceptors for request/response transformation and logging.
- Uses NestJS guards for authentication and authorization checks.
- Uses NestJS middleware for rate limiting, logging, and CORS handling.
- Routes are defined dynamically based on registered modules (each module defines its own routes).
- Authentication strategy: JWT validation (access tokens) with optional refresh token handling.
- Authorization: Role-based access control (RBAC) using roles from Identity Domain.
- Rate limiting: Uses token bucket or fixed window algorithm; configurable per route and user type.
- Logging: Structured JSON logging with correlation IDs for request tracing.
- Monitoring: Exposes Prometheus metrics for request counts, latency, error rates.
- Error handling: Centralized exception filter that formats errors per standard error format.
- SSL/TLS: Terminated at external load balancer (ALB/Nginx); gateway works with HTTP internally.
- Versioning: API versioning via URL prefix (e.g., `/api/v1/`).
- Health checks: Liveness and readiness probes for Kubernetes.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Gateway adds <50ms latency; 95% of requests <200ms total latency under load test (10k RPS) (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Gateway protects against OWASP Top 10; implements secure headers, rate limiting, and auth validation (see docs/02-requirements/nfr/security.md)
- **Availability (NFR-AVAIL)**: Gateway designed for high availability with health checks and graceful degradation (see docs/02-requirements/nfr/availability.md)
- **Observability (NFR-OBS)**: Gateway provides structured logging, metrics, and tracing (see docs/02-requirements/nfr/observability.md)

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `api-gateway` module with NestJS CLI
   - [ ] Define routing mechanism: dynamic route registration from modules
   - [ ] Implement authentication guard (JwtAuthGuard) for validating access tokens
   - [ ] Implement authorization guard (RolesGuard) for checking user roles and permissions
   - [ ] Implement rate limiting middleware (using redis or in-memory store)
   - [ ] Implement logging middleware (request/response logging with correlation IDs)
   - [ ] Implement transformation interceptors (header enrichment, response formatting)
   - [ ] Implement CORS middleware (configurable origins, methods, headers)
   - [ ] Implement request size limiting middleware
   - [ ] Implement centralized exception filter for consistent error responses
   - [ ] Implement health check endpoints (liveness, readiness)
   - [ ] Implement metrics endpoint for Prometheus (request count, latency, error rates)
   - [ ] Write unit and integration tests for gateway functionality
   - [ ] Create OpenAPI (Swagger) docs that aggregate all module specifications

2. **Infrastructure**
   - [ ] Configure external load balancer (ALB/Nginx) for SSL/TLS termination and forwarding to gateway
   - [ ] Set up Redis for rate limiting store (if using distributed rate limiting)
   - [ ] Configure logging aggregation (ELK stack or similar)
   - [ ] Set up monitoring (Prometheus + Grafana) for gateway metrics
   - [ ] Configure tracing (Jaeger or similar) for request tracing
   - [ ] Configure security headers (Helmet) and CSP (Content Security Policy)
   - [ ] Implement rolling update strategy for gateway deployments
   - [ ] Plan for horizontal pod autoscaling (HPA) based on CPU/memory/custom metrics

3. **Verification Criteria**
   - [ ] Unit tests achieve >90% coverage for api-gateway module (backend)
   - [ ] Integration tests cover: routing, authentication, authorization, rate limiting, logging, transformation, error handling
   - [ ] Manual testing: verify endpoint protection, rate limiting behavior, CORS headers, request/response transformations
   - [ ] Performance: gateway adds <50ms latency; 95% of requests <200ms total latency under load test (10k RPS)
   - [ ] Security: verify OWASP Top 10 protections (e.g., SQLi attempts blocked, auth required for protected endpoints)
   - [ ] Reliability: verify graceful handling of downstream service failures (circuit breaker, fallback responses)
   - [ ] Observability: verify logs contain correlation IDs; metrics are exposed and scrapable; tracing works
   - [ ] Documentation: OpenAPI spec generated and available at /api/docs
   - [ ] NFR Traceability: Verify that performance, security, availability, and observability requirements are properly addressed and documented

---

## Related Documents

- [Glossary](glossary.md)
- [Auth API](../03-architecture/api-contracts/auth-api.yaml)
- [Identity Domain](01-identity-domain.md)
- [Frontend Architecture](08-frontend-architecture.md)
- 🌐 RU mirror: [docsRU/specs/15-api-gateway-domain.md](../../docsRU/specs/15-api-gateway-domain.md)
