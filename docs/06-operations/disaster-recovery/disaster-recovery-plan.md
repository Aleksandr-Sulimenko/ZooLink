# Disaster Recovery Plan for ZooLink

**Status**: Draft  
**Date**: 2026-06-13  

## Overview

This document outlines the disaster recovery (DR) strategies, procedures, and objectives for the ZooLink platform. The goal is to ensure business continuity and minimize data loss and downtime in the event of a catastrophic failure affecting primary infrastructure, data centers, or critical services.

## Backup Strategy

### Database (PostgreSQL)
- **Logical Backups**: Daily full logical backups using `pg_dump` stored in secure object storage.
- **WAL Archiving**: Hourly archiving of Write-Ahead Log (WAL) segments to enable point-in-time recovery (PITR).
- **Retention**: 
  - Daily backups retained for 30 days.
  - Weekly backups (full) retained for 12 weeks.
  - Monthly backups retained for 12 months.
- **Storage**: Backups stored in geographically distributed, version-enabled object storage (AWS S3 or equivalent) with cross-region replication.

### Object Storage (User-Generated Content)
- **Versioning**: Enabled on all buckets to preserve previous versions of objects.
- **Cross-Region Replication**: Asynchronous replication to a secondary region with a target lag of <15 minutes.
- **Retention**: Versioning retained per lifecycle rules (e.g., keep 30 days of previous versions, then delete).
- **Delayed Delete**: User-generated content is retained for 30 days after deletion request to allow recovery from accidental deletion.

### Configuration
- **Source of Truth**: Git repository (infrastructure-as-code, Kubernetes manifests, configuration files) mirrored to multiple locations.
- **Backup Frequency**: Continuous via Git mirroring; snapshots taken every 6 hours.

### Application State
- ** Stateless Services**: No persistent state to back up; recovery via redeployment from container images.
- ** Stateful Services** (e.g., Redis): Persisted snapshots (RDB) taken every 6 hours and appended-only log (AOF) enabled; snapshots shipped to object storage.

## Recovery Time Objective (RTO)
- **Critical Services** (API gateway, authentication, core listing service): < 30 minutes
- **Full Platform** (all services, including non-critical batch workers): < 2 hours
- **RTO Measurement**: Time from disaster declaration to service availability for end‑user requests.

## Recovery Point Objective (RPO)
- **Database**: < 1 hour (point‑in‑time recovery possible via hourly WAL and daily logical backups)
- **Object Storage**: < 15 minutes (replication lag for cross‑region object storage)
- **User‑Generated Content**: Mirrors with delayed deletion; effective RPO < 15 minutes for active content, with ability to restore deleted content within 30 days.
- **Configuration**: Near‑zero RPO due to Git mirroring; recovery to most recent commit.

## Recovery Procedures

### Phase 1: Failure Detection and Declaration
1. **Monitoring Alerts**: Automated alerts via Prometheus/Alertmanager for infrastructure failures, data corruption, or regional outages.
2. **Manual Trigger**: Disaster can be declared manually by platform engineer or incident commander based on observed impact.
3. **Notification**: On‑call team notified via PagerDuty, SMS, and email; war room convened.

### Phase 2: Environment Provisioning (Secondary Region)
1. **Infrastructure**: Provision Kubernetes cluster, networking, and foundational services (Ingress, monitoring) in secondary region using Terraform (IaC).
2. **Services**: Deploy container images from registry; configure environment‑specific values (secrets, feature flags).
3. **Data Access**:
   - Point PostgreSQL connection strings to standby replica or initiate PITR using latest WAL.
   - Attach replicated object storage buckets as primary storage.
   - Restore Redis snapshots and AOF logs to primary cache cluster.

### Phase 3: Data Restoration
1. **Database**:
   - If using standby replica: promote to primary and begin accepting writes.
   - If performing PITR: restore latest base backup, replay WAL up to target time, then open database.
2. **Object Storage**: Begin serving traffic from replicated bucket; verify version consistency.
3. **Redis**: Load latest RDB snapshot, replay AOF logs to restore in‑memory state.
4. **Application State**: No additional restoration needed; services start with empty state and rebuild from database/cache as needed.

### Phase 4: Validation and Cutover
1. **Smoke Tests**: Automated health checks (`/health/live`, `/health/ready`) and synthetic transactions.
2. **Data Integrity**: Spot‑check critical data (e.g., recent listings, user accounts) for consistency.
3. **Performance Validation**: Load testing to ensure services meet latency targets under recovery conditions.
4. **Traffic Switch**: Update DNS or global load balancer to point to secondary region; monitor for errors.
5. **Communication**: Publish status update to stakeholders and users (if applicable).

### Phase 5: Fallback (Optional)
Once primary region is restored, reverse the process:
1. Sync data back to primary region (using replication or backup/restore).
2. Validate primary environment.
3. Switch traffic back to primary region.
4. Decommission temporary secondary resources.

## Testing and Drills

### Regular Testing
- **Quarterly DR Drill**: Full‑scale exercise simulating regional outage; measures actual RTO/RPO.
- **Monthly Tabletop Exercise**: Review procedures, update runbooks, identify gaps.
- **Backup Verification**: Automated verification of backup integrity (checksum, test restore) weekly.
- **WAL Accessibility**: Test PITR to random point in time monthly.

### Metrics Collected During Drills
- Time to detect and declare disaster.
- Time to provision infrastructure in secondary region.
- Time to restore database to target RPO.
- Time to restore object storage and caches.
- Time to complete smoke tests and declare service ready.
- Total elapsed time (actual RTO).

## Roles and Responsibilities

### Incident Commander
- Declares disaster, activates DR plan, coordinates communication.
- Authority to invoke backup/restore procedures and cutover.

### Platform Engineer (On‑Call)
- Executes infrastructure provisioning via IaC.
- Oversees database and storage restoration.
- Validates service health and performance.

### Database Administrator
- Manages PostgreSQL backup/WAL procedures.
- Performs PITR or replica promotion.
- Validates database integrity post‑restore.

### Release Engineer
- Ensures container images and configuration are available in secondary region.
- Coordinates deployment of services.

### Communications Lead
- Sends status updates to internal stakeholders, customers (if public impact), and regulatory bodies.
- Manages public status page.

## Tools and Automation

- **Infrastructure Provisioning**: Terraform (state stored remotely, locked).
- **Configuration Management**: Helm charts with environment‑specific values files.
- **Backup Orchestration**: Custom cron jobs/scripts (or cloud‑native backup solutions) for logical dumps and WAL archiving.
- **Monitoring**: Prometheus alerts for backup success, replication lag, and storage utilization.
- **Testing**: Chaos Engineering tools (e.g., Gremlin) for fault injection; custom scripts for DR drill automation.

## Assumptions and Dependencies

- **Secondary Region Availability**: Assumes at least one secondary region remains operational during a regional disaster.
- **Network Connectivity**: Sufficient bandwidth between regions for WAL shipping and object replication (planned <15 min lag).
- **IaC Completeness**: All infrastructure (networking, security groups, IAM roles) is codified and can be applied without manual steps.
- **Image Registry Availability**: Container registry accessible from both primary and secondary regions.
- **Secret Management**: Secrets (passwords, keys) are stored in a regional‑agnostic secret manager (e.g., HashiCorp Vault, cloud KMS) or replicated via IaC.

## Related Documents

- **Deployment Specification**: Strategic backup and recovery considerations (see `/docs/specs/deployment/deployment_specification.md`, Disaster Recovery section).
- **Operational Documentation – Deployment**: Strategies for environment management, rollback, and scaling (`/docs/06-operations/deployment.md`).
- **Operational Documentation – Monitoring**: Alerting and health checks that trigger DR awareness (`/docs/06-operations/monitoring.md`).
- **Runbooks**: Specific procedures for database failover, storage failover, and service restoration (see `/docs/06-operations/runbooks/`).

## Revision History

| Version | Date       | Description                     | Author      |
|---------|------------|---------------------------------|-------------|
| 1.0     | 2026-06-13 | Initial draft – based on deployment spec DR section | Claude Code |

---