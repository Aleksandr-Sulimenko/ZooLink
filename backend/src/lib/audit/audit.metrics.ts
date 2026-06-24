import { Injectable, Optional } from '@nestjs/common';
import { Counter } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
import type { PrincipalType } from '../auth/principal';

/**
 * B8 observability — a Prometheus counter for privileged/audited actions, labelled by
 * `principal_type` so an operator (human OR AI agent) can see the human-vs-agent split of
 * moderation/admin/audit activity (ADR-0006 agent-as-principal, OPS-06).
 *
 * MetricsService is registered in the HTTP API only (it owns the /metrics scrape endpoint), so it
 * is injected @Optional(): in the worker context (no scrape endpoint) this degrades to a no-op
 * rather than failing to construct. The label set is deliberately low-cardinality (`principal_type`
 * + a stable `action` verb) to avoid metric explosion.
 */
@Injectable()
export class AuditMetrics {
  private readonly counter?: Counter<'principal_type' | 'action'>;

  constructor(@Optional() metrics?: MetricsService) {
    if (!metrics) return;
    this.counter = new Counter({
      name: 'zoolink_audit_actions_total',
      help: 'Count of audited privileged actions, by acting principal type and action verb.',
      labelNames: ['principal_type', 'action'],
      registers: [metrics.registry],
    });
  }

  record(action: string, principalType: PrincipalType): void {
    this.counter?.inc({ principal_type: principalType, action });
  }
}
