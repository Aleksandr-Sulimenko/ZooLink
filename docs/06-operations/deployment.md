# Deployment Strategies for ZooLink

**Status**: Draft  
**Date**: 2026-06-13  

## Overview

This document outlines the deployment strategies, environment configurations, and release procedures for the ZooLink platform. The deployment approach is designed to support the microservices-ready modular monolith architecture using NestJS, PostgreSQL, Redis, and S3-compatible storage.

## Deployment Environments

ZooLink maintains four distinct environments to support development, testing, staging, and production workflows:

### 1. Development Environment
- **Purpose**: Individual developer workspaces and feature branch testing
- **Infrastructure**: Local Docker Compose or individual service containers
- **Configuration**: 
  - Database: PostgreSQL with sample data
  - Cache: Redis (local)
  - Storage: MinIO (S3-compatible, local)
  - External services: Mocked or using free-tier sandboxes
- **Deployment**: Manual via `docker-compose up` or IDE-integrated container tools
- **Access**: localhost:3000 (API), localhost:3001 (frontend)

### 2. Testing Environment
- **Purpose**: Automated integration and end-to-end testing
- **Infrastructure**: Isolated Kubernetes namespace or Docker swarm
- **Configuration**:
  - Database: PostgreSQL with test dataset
  - Cache: Redis (separate instance)
  - Storage: MinIO bucket per test run
  - External services: Test accounts/sandboxes
- **Deployment**: Triggered by CI pipeline on merge requests
- **Access**: Internal cluster access only

### 3. Staging Environment
- **Purpose**: Pre-production validation, performance testing, and stakeholder review
- **Infrastructure**: Kubernetes cluster with production-parity configuration
- **Configuration**:
  - Database: PostgreSQL (readonly replica of prod schema, anonymized data)
  - Cache: Redis Cluster
  - Storage: S3-compatible (MinIO or AWS, separate bucket)
  - External services: Sandbox/test accounts with production-like limits
- **Deployment**: Manual promotion from testing after validation
- **Access**: staging.zoolink.internal (VPN required)

### 4. Production Environment
- **Purpose**: Live user-facing platform
- **Infrastructure**: Kubernetes cluster (managed service or self-managed)
- **Configuration**:
  - Database: PostgreSQL Primary-Replica setup with automated failover
  - Cache: Redis Cluster with persistence
  - Storage: Yandex Object Storage / VK / Selectel (S3-compatible), or self-hosted MinIO — ADR-0008 (AWS S3 is RF-blocked)
  - External services: Production API keys with monitoring
  - CDN: Yandex Cloud CDN / VK / Selectel / Ngenix — ADR-0008 (CloudFront/Cloudflare are RF-blocked)
- **Deployment**: Automated via GitOps or manual approval gates
- **Access**: Publicly accessible at app.zoolink.com

## Deployment Technologies

### Containerization
- All services packaged as Docker images
- Multi-stage builds to minimize image size
- Base images: Node.js 18-alpine for NestJS servizi
- Security scanning integrated into build pipeline

### Orchestration
- Primary: Kubernetes (EKS, GKE, or self-managed)
- Alternative for dev/testing: Docker Compose or Docker Swarm
- Helm charts for consistent service deployment
- Namespace isolation per environment

### Infrastructure as Code
- Terraform for cloud provisioning (where applicable)
- Kubernetes manifests managed via Helm
- Environment-specific values files
- Version-controlled infrastructure definitions

## Continuous Integration/Continuous Deployment (CI/CD)

### Pipeline Stages
1. **Code Commit**: Triggered on push to any branch
2. **Build**: 
   - Docker image creation
   - Unit test execution
   - Security scanning (SAST)
   - Dependency vulnerability check
3. **Test**:
   - Integration tests against ephemeral services
   - Contract testing (Pact) for API compatibility
   - Performance benchmarks
4. **Staging Deploy**: Automatic deployment to testing/staging on main branch
5. **Manual Approval**: Required for production deployment
6. **Production Deploy**: Blue/green or rolling update strategy
7. **Post-Deploy**: Smoke tests and monitoring validation

### Tools
- CI Platform: GitHub Actions, GitLab CI, or Jenkins
- Image Registry: GitHub Packages, Google Container Registry, or Docker Hub
- Security: Trivy, Snyk, or similar for vulnerability scanning
- Testing: Jest for unit, SuperTest for API, Cypress for E2E

## Deployment Patterns

### Blue/Green Deployment
- Used for major releases with potential breaking changes
- Two identical production environments (blue and green)
- Traffic switched via load balancer after validation
- Quick rollback by switching traffic back

### Rolling Update
- Used for minor/patch releases
- Gradual replacement of pods across nodes
- Maintains availability during deployment
- Monitored for degradation during rollout

### Canary Release
- Used for feature flags or risky changes
- Small percentage of traffic routed to new version
- Gradual increase based on metrics and error rates
- Full rollout or rollback based on success criteria

### Database Migration Strategy
- Backward-compatible schema changes only
- Migration scripts run as initContainers or separate jobs
- Feature flags for table/column usage during transition
- Automated rollback on failure detection
- PostgreSQL-specific:
  - ADD COLUMN with DEFAULT NULL (avoid table rewrite)
  - CREATE INDEX CONCURRENTLY
  - Validate NOT NULL constraints in separate step

## Configuration Management

### Environment Variables
- Secrets stored in Kubernetes Secrets or cloud secret manager
- Non-secrets in ConfigMaps
- 12-factor app compliant configuration
- Per-environment overrides via Helm values

### Shared Configuration
- Common settings in base configuration files
- Environment-specific overlays
- Feature flags managed via LaunchDarkly or similar (future)
- Runtime reloading where possible (without restart)

### Secret Management
- Kubernetes Secrets (base64 encoded) or cloud equivalents
- Automatic rotation for database passwords and API keys
- Audit logging for secret access
- Limited permissions via RBAC

## Monitoring and Health Checks

### Liveness Probes
- HTTP endpoint `/health/live` returning 200 when process is running
- Checks for deadlocks or severe degradation
- Configured with appropriate failure thresholds

### Readiness Probes
- HTTP endpoint `/health/ready` returning 200 when service can accept traffic
- Checks dependencies: database connectivity, cache availability, storage access
- Prevents sending traffic to unhealthy instances

### Startup Probes
- For applications with slow startup (migrations, cache warming)
- Gives application time to initialize before liveness/readiness checks

## Rollback Procedures

### Automated Rollback
- Triggered by health check failures or metric thresholds
- Reverts to previous known-good deployment
- Notification sent to on-call team

### Manual Rollback
- Initiated via deployment dashboard or kubectl commands
- Database rollback requires separate procedure (point-in-time restore)
- Communication plan for user impact

### Data Migration Rollback
- Schema changes designed to be forward-compatible
- Data migrations written to be reversible where possible
- Backup taken before risky migrations

## Performance and Scaling Considerations

### Resource Requests/Limits
- CPU and memory requests based on load testing
- Horizontal Pod Autoscaler (HPA) configured for web services
- Vertical Pod Autoscaler (VPA) considered for batch/worker services
- Resource quotas per namespace to prevent noisy neighbors

### Scaling Triggers
- HTTP request rate (primary)
- Queue depth (for worker services)
- Database connection pool utilization
- Custom metrics (business logic specific)

### Caching Strategy
- Redis used for:
  - Session storage
  - Rate limiting counters
  - Computed query results (short-term TTL)
  - Leaderboards and real-time counters
- Cache warming procedures for predictable traffic patterns

## Security Considerations in Deployment

### Image Security
- Base images scanned for vulnerabilities
- Non-root user execution in containers
- Read-only root filesystem where possible
- Dropped capabilities and restricted syscalls

### Network Security
- Network policies restricting inter-service communication
- Service mesh (Istio/Linkerd) considered for phase 2
- Ingress controllers with WAF capabilities
- TLS termination at ingress or load balancer

### Secrets Protection
- Secrets mounted as volumes or injected via environment
- No secrets in environment variables visible to ps
- Regular rotation of long-lived credentials

## Disaster Recovery

### Backup Strategy
- Database: Daily logical backups, hourly WAL archiving
- Object storage: Versioning enabled, cross-region replication
- Configuration: Git repository as source of truth
- Test restore procedures quarterly

### Recovery Time Objectives (RTO)
- Critical services: < 30 minutes
- Full platform: < 2 hours
- Dependent on backup frequency and restoration procedures

### Recovery Point Objectives (RPO)
- Database: < 1 hour (point-in-time recovery possible)
- Object storage: < 15 minutes (replication lag)
- User-generated content: Mirrors with delayed deletion

## Deployment Documentation

### Runbooks
- Common deployment procedures documented
- Incident response procedures for deployment failures
- Environment-specific troubleshooting guides

### Change Management
- All deployments linked to tickets or merge requests
- Post-deployment review for significant changes
- Audit trail of who deployed what and when

## Related Decisions

- **ADR-0001**: Tech stack choice (influences containerization and orchestration choices)
- **Architecture Decisions**: Microservices-ready modular monolith affects deployment boundaries
- **Non-Functional Requirements**: Performance and availability targets inform scaling strategies

## References

- Kubernetes Documentation: https://kubernetes.io/docs/
- Docker Best Practices: https://docs.docker.com/develop/dev-best-practices/
- Helm Chart Guidelines: https://helm.sh/docs/topics/charts/
- Twelve-Factor App: https://12factor.net/
- PostgreSQL Zero-Downtime Migrations: https://severalnines.com/database-blog/postgresql-zero-downtime-migrations
