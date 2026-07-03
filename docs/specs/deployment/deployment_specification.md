# Deployment Specification - ZooLink

## Overview
This document specifies the deployment strategies, environment configurations, release procedures, and operational considerations for the ZooLink platform. It defines measurable targets for deployment reliability, rollback capabilities, and environment consistency to ensure stable and predictable releases.

## Deployment Goals & Requirements

### Deployment Environments
| Environment | Purpose | Access | Deployment Trigger |
|-------------|---------|--------|-------------------|
| **Development** | Individual developer workspaces and feature branch testing | localhost:3000 (API), localhost:3001 (frontend) | Manual via Docker Compose or IDE |
| **Testing** | Automated integration and end-to-end testing | Internal cluster access only | CI pipeline on merge requests |
| **Staging** | Pre-production validation, performance testing, stakeholder review | staging.zoolink.internal (VPN required) | Manual promotion from testing after validation |
| **Production** | Live user-facing platform | Publicly accessible at app.zoolink.com | Automated via GitOps or manual approval gates |

### Deployment Technologies
| Technology | Purpose | Condition |
|------------|---------|-----------|
| **Containerization** | All services packaged as Docker images with multi-stage builds | Base images: Node.js 18-alpine |
| **Orchestration** | Primary: Kubernetes (EKS, GKE, or self-managed); Alternative: Docker Compose/Swarm for dev/testing | Helm charts for consistent deployment |
| **Infrastructure as Code** | Terraform for cloud provisioning; Kubernetes manifests via Helm | Environment-specific values files |
| **CI/CD Pipeline** | GitHub Actions, GitLab CI, or Jenkins with security scanning | Automated testing and deployment stages |

### Deployment Patterns
| Pattern | Use Case | Characteristics |
|---------|----------|-----------------|
| **Blue/Green Deployment** | Major releases with potential breaking changes | Two identical environments, traffic switched via load balancer |
| **Rolling Update** | Minor/patch releases | Gradual pod replacement, maintains availability |
| **Canary Release** | Feature flags or risky changes | Small percentage traffic routed, gradual increase |
| **Database Migration** | Schema changes | Backward-compatible only, feature flags for transition |

### Configuration Management
| Aspect | Requirement | Condition |
|--------|-------------|-----------|
| **Environment Variables** | Secrets in Kubernetes Secrets/cloud secret manager; non-secrets in ConfigMaps | 12-factor app compliant |
| **Shared Configuration** | Base configuration files with environment-specific overlays | Feature flags managed via LaunchDarkly (future) |
| **Secret Management** | Automatic rotation for database passwords and API keys; audit logging | Limited permissions via RBAC |

### Monitoring & Health Checks
| Check Type | Endpoint | Purpose |
|------------|----------|---------|
| **Liveness Probe** | `/health/live` | Process running check |
| **Readiness Probe** | `/health/ready` | Dependency check (database, cache, storage) |
| **Startup Probe** | For slow-starting apps | Initialization time before liveness/readiness |

### Rollback Procedures
| Type | Trigger | Procedure |
|------|---------|-----------|
| **Automated Rollback** | Health check failures or metric thresholds | Revert to previous known-good deployment |
| **Manual Rollback** | Deployment dashboard or kubectl commands | Database rollback requires point-in-time restore |
| **Data Migration Rollback** | Forward-compatible schema changes | Reversible migrations where possible |

### Performance & Scaling Considerations
| Aspect | Target | Condition |
|--------|--------|-----------|
| **Resource Requests/Limits** | Based on load testing | HPA for web services, VPA considered for batch/worker |
| **Scaling Triggers** | HTTP request rate (primary) | Queue depth for workers, DB connection pool utilization |
| **Caching Strategy** | Redis for sessions, rate limiting, computed results | Cache warming for predictable traffic patterns |

### Security Considerations in Deployment
| Area | Requirement | Condition |
|------|-------------|-----------|
| **Image Security** | Base images scanned, non-root execution, read-only root FS where possible | Dropped capabilities and restricted syscalls |
| **Network Security** | Network policies restricting inter-service communication | Service mesh (Istio/Linkerd) considered for phase 2 |
| **Secrets Protection** | Secrets mounted as volumes or injected via env; no secrets visible to ps | Regular rotation of long-lived credentials |

### Data Residency (RF) — ADR-0017 (ФЗ-152 ст.18 ч.5)
> **WHAT** — All stores holding RF-citizens' personal data — primary PostgreSQL, every replica/HA standby, all backups/snapshots, PII-bearing object storage (S3/MinIO), any DR/failover target, and any PII-bearing log/observability sink — MUST be physically located in the **Russian Federation**. **Approved region-pin: `ru-central1`** (Yandex Cloud, ADR-0008; approved-zone set `ru-central1-a/b/c/d`). Cross-region / cross-border processing is permitted **only** for de-identified/aggregate data, and only after a separate ст.12 ФЗ-152 transfer review with legal (checklist C5). **WHY** — ФЗ-152 ст.18 ч.5 mandates RF-resident databases for RF-citizen PII; a non-RF replica/backup/DR is a launch BLOCKER (РКН block/fine risk). **WHY-BETTER** — fixed before data exists (zero-cost vs a costly post-launch migration) and enforced defense-in-depth so a config change can't silently ship PII abroad: **this documented pin → the CI residency gate (`scripts/check-rf-residency.sh`, fail-on-non-RF) → the boot-time refine (`env.validation.ts` `RF_ALLOWED_REGIONS`)** — one allowlist, three layers.

### Disaster Recovery
| Aspect | Target | Condition |
|--------|--------|-----------|
| **Backup Strategy** | Database: daily logical backups, hourly WAL archiving; Object storage: versioning, **in-region (RF) redundancy only — NO cross-region/cross-border replication** (ADR-0017, ФЗ-152 ст.18 ч.5) | Configuration: Git repo as source of truth |
| **Recovery Time Objective (RTO)** | Critical services: < 30 minutes; Full platform: < 2 hours | Dependent on backup frequency and restoration |
| **Recovery Point Objective (RPO)** | Database: < 1 hour (point-in-time possible); Object storage: < 15 minutes (in-RF replication lag) | User-generated content: RF-resident mirrors with delayed deletion |

## Deployment Acceptance Criteria
- All environments (dev, test, staging, prod) are consistently provisioned via IaC
- Deployment pipeline includes automated testing, security scanning, and performance benchmarks
- Blue/green deployment capability for major releases with zero-downtime rollback
- Database migration strategy ensures backward compatibility and automated rollback on failure
- Secret management prevents exposure of credentials in process lists or logs
- Monitoring and health checks prevent traffic to unhealthy instances
- Disaster recovery procedures tested quarterly with documented RTO/RPO
- Deployment runbooks and change management procedures are maintained and reviewed

## Deployment Optimization Roadmap

### MVP (Фаза 1)
- Four distinct environments (dev, test, staging, prod) with clear separation
- Containerization with Docker and orchestration via Kubernetes (or Docker Compose for dev)
- CI/CD pipeline with build, test, staging deploy, manual approval, production deploy stages
- Blue/green and rolling update deployment patterns
- Basic configuration management with environment variables and ConfigMaps/Secrets
- Liveness and readiness probes for all services
- Automated rollback triggered by health check failures
- Basic backup strategy for database and object storage
- Security scanning for container images and network policies

### Фаза 2 (Growth)
- Advanced deployment patterns: canary releases and feature flag-driven deployments
- Enhanced infrastructure as code with Terraform modules and Helm chart testing
- Automated canary analysis and progressive delivery
- Service mesh implementation (Istio/Linkerd) for traffic management and observability
- Advanced secret management with automatic rotation and cloud provider integrations
- Enhanced monitoring with distributed tracing and service-level objectives (SLOs)
- Chaos engineering experiments for deployment resilience testing
- In-RF disaster recovery failover testing (multi-AZ or a second RF region — residency-constrained per ADR-0017; **no cross-border DR** for PII-bearing stores)

### Фаза 3 (Maturity)
- GitOps-driven deployments with Argo CD or Flux
- Policy-as-code for deployments (OPA/Gatekeeper)
- Automated remediation and self-healing systems
- Machine learning for predictive scaling and anomaly detection
- Zero-trust network architecture and advanced encryption (in-use, at-rest, in-transit)
- Immutable infrastructure and container image signing
- Continuous deployment with automated quality gates and promotion
- Advanced disaster recovery with multi-cloud or hybrid cloud capabilities

## References
- Kubernetes Documentation
- Docker Best Practices
- Helm Chart Guidelines
- Twelve-Factor App
- PostgreSQL Zero-Downtime Migrations
- Terraform Documentation
- GitHub Actions, GitLab CI, Jenkins Documentation
- Trivy, Snyk, or similar vulnerability scanners
- Istio/Linkerd Service Mesh Documentation
- Prometheus and Grafana Monitoring
- Chaos Engineering Principles
- GitOps and Argo CD/Flux Documentation
- OPA/Gatekeeper Policy-as-Code