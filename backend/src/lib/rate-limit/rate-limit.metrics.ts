import { Logger } from '@nestjs/common';
import { Counter } from 'prom-client';
import { MetricsService } from '../metrics/metrics.service';
import type { PeerClass, TrackerFallbackReason } from './client-ip';

const METRIC_NAME = 'zoolink_ratelimit_tracker_fallback_total';

/**
 * THE ALERT RULE:  zoolink_ratelimit_tracker_fallback_total{source="absent",peer="network"} == 0
 *
 * Kept as one line, next to the code that feeds it, because the rule is useless without the premise
 * spelled out below — and a future reader (or a weaker model) must not have to re-derive it.
 */
const ALERT_RULE = 'ALERT on absent{peer="network"} != 0';

/**
 * Security co-sign У-4b (+ amendment) — a SECOND alarm for "the edge stopped writing the client-IP
 * header", independent of 429s.
 *
 * If `deploy/Caddyfile` ever loses its `header_up X-Real-IP` (new route, refactor, rollback), the
 * platform silently returns to one shared bucket. A 429 spike would be an ambiguous symptom; a request
 * that arrived with NO header is unambiguous.
 *
 * ── THE INVARIANT THE RULE RESTS ON (name it out loud) ──────────────────────────────────────────────
 * "A non-zero `absent` means the edge stopped identifying clients" is only true while a second,
 * previously UNWRITTEN invariant holds: **no internal component calls the API over HTTP.** True today.
 * The moment someone adds one — an ops `curl` inside the container, a smoke script, an in-container
 * cron — the baseline becomes permanently non-zero, the signal becomes noise, the noise gets muted,
 * and a REAL loss of the edge header becomes invisible. That is how a working alarm rots quietly.
 *
 * The `peer` label makes the rule immune to that:
 *   · `peer="loopback"` — an in-container caller. Expected to be header-less; NOT an alarm.
 *   · `peer="network"`  — arrived over the network, i.e. through the edge, therefore the edge MUST
 *                         have written the header. A single one is a real finding.
 * So a new loopback caller cannot erode the signal, and a new NETWORK-side internal caller trips the
 * alarm once, loudly, forcing a deliberate decision instead of silent drift.
 *
 * ── WHY THESE LABELS ───────────────────────────────────────────────────────────────────────────────
 * `source` is a REASON, not "edge vs internal": the only IN-REQUEST signals that would separate an
 * edge-forwarded call from an internal one are themselves client-settable headers, so such a label
 * would be a guess dressed as a fact. Both values are directly observed — `absent` (no header at all)
 * and `malformed` (present but not a single IP literal — the shape a spoof attempt takes).
 *
 * `peer` is NOT a header-derived guess: it is a property of the TCP connection (`req.ip` with no
 * hop-count trust enabled), which no header can alter — the same basis `metrics.guard.ts` already
 * uses. It carries NO subnet constants (see `classifyPeer`): a hard-coded "our edge network" CIDR
 * would go stale against Docker's dynamic subnets and then mislabel silently.
 *
 * Cardinality is bounded at 2 × 2 = 4 series.
 *
 * A plain class, constructed by the throttler factory (not a Nest provider): the factory is the only
 * consumer. If it is ever built WITHOUT a MetricsService, that is announced at bootstrap (below)
 * rather than degrading silently — exactly how `zoolink_audit_actions_total` died unnoticed.
 */
export class RateLimitMetrics {
  private static readonly logger = new Logger(RateLimitMetrics.name);
  private readonly counter?: Counter<'source' | 'peer'>;

  constructor(metrics?: MetricsService) {
    if (!metrics) {
      // Loud at construction time, not at the first lost signal. A context that legitimately has no
      // scrape endpoint (worker) will say so once in its boot log; the API saying it is a defect.
      RateLimitMetrics.logger.warn(
        `No MetricsService: ${METRIC_NAME} will NOT be exported, so the edge-client-IP alarm ` +
          `(${ALERT_RULE}) is BLIND in this process. Expected in a worker/no-scrape context; ` +
          `in the HTTP API this is a wiring defect — RateLimitModule must import MetricsModule.`,
      );
      return;
    }
    // Idempotent: a second construction against the same registry reuses the metric instead of
    // throwing prom-client's "already registered".
    const existing = metrics.registry.getSingleMetric(METRIC_NAME);
    this.counter =
      (existing as Counter<'source' | 'peer'> | undefined) ??
      new Counter({
        name: METRIC_NAME,
        help:
          'Rate-limit tracker fell back to the socket address instead of the edge-supplied client IP. ' +
          `${ALERT_RULE}: a network peer reached the API without X-Real-IP, so the edge stopped ` +
          'identifying clients and every client shares one bucket. ' +
          'peer="loopback" is an in-container caller and is NOT an alarm — that split is what keeps ' +
          'the rule valid if an internal HTTP caller is ever added. ' +
          'source="malformed" = header present but not a single IP literal.',
        labelNames: ['source', 'peer'],
        registers: [metrics.registry],
      });
  }

  recordFallback(source: TrackerFallbackReason, peer: PeerClass): void {
    this.counter?.inc({ source, peer });
  }
}
