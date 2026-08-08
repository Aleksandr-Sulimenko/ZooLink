import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsGuard } from './metrics.guard';
import { MetricsService } from './metrics.service';

/**
 * Prometheus metrics on GET /metrics (version-neutral, so the scrape path is stable across API
 * versions). Default Node/process metrics now; domain counters/histograms register on the shared
 * `MetricsService.registry`.
 *
 * `@Global()` — deliberate, and the reason is load-bearing (AUDIT5 mini-pack A). Instrumentation is
 * cross-cutting: a counter belongs next to the code it measures (`lib/audit/audit.metrics.ts`,
 * `lib/rate-limit/rate-limit.metrics.ts`, later domain counters), which sits in modules that have no
 * other reason to import the metrics module. Requiring each of them to add an `imports: [MetricsModule]`
 * is exactly how `zoolink_audit_actions_total` came to be DEAD FROM BIRTH: `AuditModule` injected
 * `MetricsService` `@Optional()`, never imported this module, and silently got `undefined` forever.
 *
 * Being global also keeps the `@Optional()` contract meaningful instead of breaking it: whether a
 * process is observable is now decided in ONE place — the composition root. The API root imports this
 * module, so every instrumented provider there gets the real registry; `worker.module.ts` does NOT
 * import it (a worker serves no scrape endpoint), so the same providers degrade to a documented no-op.
 * Importing MetricsModule into AuditModule instead would have dragged the registry (and
 * `collectDefaultMetrics`) into the worker, where nothing can ever scrape it.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsGuard],
  exports: [MetricsService],
})
export class MetricsModule {}
