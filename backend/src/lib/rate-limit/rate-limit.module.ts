import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { MetricsModule } from '../metrics/metrics.module';
import { MetricsService } from '../metrics/metrics.service';
import { RedisService } from '../redis/redis.service';
import { resolveClientIpTracker, type TrackedRequestLike } from './client-ip';
import { RateLimitMetrics } from './rate-limit.metrics';

/** Default bucket: 100 requests / 60s PER CLIENT. Per-route overrides via @Throttle()/@SkipThrottle(). */
export const DEFAULT_THROTTLE_TTL_MS = 60_000;
export const DEFAULT_THROTTLE_LIMIT = 100;

/**
 * Build the global throttler configuration. Exported so the wiring itself is unit-testable — the
 * `getTracker` override is the whole point of AUDIT5 §F1b and must not be silently droppable.
 *
 * `getTracker` replaces the library default (`req.ip`). Behind Caddy `req.ip` is the EDGE address for
 * every request on the internet, which collapsed every bucket into one platform-wide bucket. See
 * `client-ip.ts` for what is trusted, why, and the two-sided edge contract it depends on.
 */
export function buildThrottlerOptions(
  redis: RedisService,
  metrics?: RateLimitMetrics,
): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: 'default', ttl: DEFAULT_THROTTLE_TTL_MS, limit: DEFAULT_THROTTLE_LIMIT }],
    storage: new ThrottlerStorageRedisService(redis.client),
    getTracker: (req: TrackedRequestLike): string => {
      const { tracker, fallback, peer } = resolveClientIpTracker(req);
      if (fallback !== undefined) metrics?.recordFallback(fallback, peer);
      return tracker;
    },
  };
}

/**
 * Global rate limiting (@nestjs/throttler) backed by the shared Redis instance so limits hold
 * across multiple API replicas. Buckets are keyed per CLIENT via the edge-supplied client IP
 * (AUDIT5 §F1b) — NOT the raw socket address, which is the reverse proxy for every request.
 *
 * Storage note (unchanged by this pack, tracked as AUDIT5 §F2): with Redis down the storage call
 * rejects and the global guard turns that into HTTP 500 on every throttled route. Health endpoints
 * opt out with @SkipThrottle so liveness never depends on Redis (§F1c).
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [MetricsModule],
      inject: [RedisService, MetricsService],
      useFactory: (redis: RedisService, metrics: MetricsService) =>
        buildThrottlerOptions(redis, new RateLimitMetrics(metrics)),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
