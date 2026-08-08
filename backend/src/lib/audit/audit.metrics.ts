import { Injectable, Logger, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { Counter } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
import type { PrincipalType } from '../auth/principal';

/**
 * B8 observability — a Prometheus counter for privileged/audited actions, labelled by
 * `principal_type` so an operator (human OR AI agent) can see the human-vs-agent split of
 * moderation/admin/audit activity (ADR-0006 agent-as-principal, OPS-06).
 *
 * WHY THIS COUNTER IS NOT DECORATION. The append-only `audit_log` (see {@link AuditLogService}) is a
 * separate, DB-enforced trail and was never affected — but a trail is FORENSICS ON DEMAND: somebody
 * must already suspect something and go query it. This counter is the REAL-TIME channel: the
 * human-vs-agent split is the signal that says an AGENT principal acting as MODERATOR/ADMIN has gone
 * off the rails (a burst of `listing.reject` from `principal_type="AGENT"`), which is alertable in
 * seconds. While it was dead, agent detection had degraded from "alertable" to "forensics if asked".
 * That is why the architect/security gate treats a live counter as a PRECONDITION for turning the
 * AGENT-principal moderation toggle on, not as a nice-to-have.
 *
 * MetricsService is registered in the HTTP API only (it owns the /metrics scrape endpoint), so it
 * is injected @Optional(): in the worker context (no scrape endpoint) this degrades to a no-op
 * rather than failing to construct. `MetricsModule` is `@Global()` precisely so this @Optional()
 * dependency means "this process has no metrics registry" and NOT "somebody forgot an import" — the
 * second reading is what killed `zoolink_audit_actions_total` from birth (AUDIT5 mini-pack A).
 *
 * The label set is deliberately low-cardinality (`principal_type` + a stable `action` verb) to avoid
 * metric explosion, and carries no PII.
 *
 * SECOND LOCK — degradation is ANNOUNCED, never silent (see {@link onApplicationBootstrap}). Silence
 * is what made the defect permanent: a no-op counter and a correctly wired one looked identical from
 * the outside. On bootstrap this provider now says which of the two it is, and the "registry exists in
 * this process but I did not get it" case — the exact original bug — is logged as an ERROR.
 */
@Injectable()
export class AuditMetrics implements OnApplicationBootstrap {
  private readonly logger = new Logger(AuditMetrics.name);
  private readonly counter?: Counter<'principal_type' | 'action'>;

  constructor(
    @Optional() metrics?: MetricsService,
    /**
     * Only used to tell the two degradation cases apart at bootstrap (a metrics-less worker vs a
     * miswired API). @Optional() so the class stays constructible outside a Nest graph (unit tests).
     */
    @Optional() private readonly modules?: ModulesContainer,
  ) {
    if (!metrics) return;
    this.counter = new Counter({
      name: 'zoolink_audit_actions_total',
      help: 'Count of audited privileged actions, by acting principal type and action verb.',
      labelNames: ['principal_type', 'action'],
      registers: [metrics.registry],
    });
  }

  /** True when the counter is registered against a live Prometheus registry. */
  get isWired(): boolean {
    return this.counter !== undefined;
  }

  /**
   * Announce the wiring outcome once, at bootstrap, so a dead counter can never again be invisible.
   * The two cases are distinguished by whether THIS process provides a MetricsService at all:
   *  - it does, yet we were constructed without one → a wiring bug, and observability is silently
   *    gone. ERROR (this is the AUDIT5 mini-pack A defect signature).
   *  - it does not (worker: no /metrics endpoint) → the documented, legal no-op. Logged at info so
   *    an operator reading worker logs knows why audit metrics are absent there.
   */
  onApplicationBootstrap(): void {
    if (this.counter) return;
    if (this.processHasMetricsRegistry()) {
      this.logger.error(
        'zoolink_audit_actions_total is NOT registered although this process DOES provide a ' +
          'Prometheus registry: AuditMetrics was constructed without MetricsService. Audited actions ' +
          '(incl. the human-vs-agent principal split, ADR-0006) are invisible to /metrics and to any ' +
          'alert built on it. The append-only audit_log trail is unaffected. Fix the module wiring ' +
          '(MetricsModule is @Global — MetricsService must be visible to AuditModule).',
      );
      return;
    }
    this.logger.log(
      'zoolink_audit_actions_total not registered: this process provides no Prometheus registry ' +
        '(worker context serves no /metrics endpoint), so audit metrics degrade to a no-op by design. ' +
        'The append-only audit_log trail is unaffected.',
    );
  }

  record(action: string, principalType: PrincipalType): void {
    this.counter?.inc({ principal_type: principalType, action });
  }

  /** Is a MetricsService provided ANYWHERE in this process's module graph? */
  private processHasMetricsRegistry(): boolean {
    if (!this.modules) return false;
    for (const moduleRef of this.modules.values()) {
      if (moduleRef.providers.has(MetricsService)) return true;
    }
    return false;
  }
}
