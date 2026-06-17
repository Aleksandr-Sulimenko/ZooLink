# Operations Runbooks

This directory holds operational runbooks — step-by-step procedures executed during incidents and routine operations. During the specification phase these are placeholders; each runbook will be filled in before the corresponding capability goes live.

## Index

| Runbook | Scope | Status |
|---|---|---|
| `database-failover.md` | Promote standby PostgreSQL, repoint application, verify replication | Planned |
| `storage-failover.md` | Switch object storage to secondary region/bucket, validate media access | Planned |
| `service-restoration.md` | Restart/redeploy services, drain queues, verify health checks | Planned |

## Related documents

- [Disaster Recovery Plan](../disaster-recovery/disaster-recovery-plan.md) — references these runbooks for failover procedures
- [Deployment](../deployment.md) — environment management, rollback, scaling
- [Monitoring](../monitoring.md) — alerting and health checks that trigger DR awareness
- [Deployment Specification](../../specs/deployment/deployment_specification.md) — strategic backup/recovery design

> RU mirror: [`docsRU/06-operations/runbooks/README.md`](../../../docsRU/06-operations/runbooks/README.md)
