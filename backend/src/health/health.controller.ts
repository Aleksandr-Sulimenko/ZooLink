import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../lib/auth/public.decorator';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';

/**
 * @SkipThrottle (AUDIT5 §F1c) — health must never depend on the rate limiter, for two reasons:
 *
 *  1. The global ThrottlerGuard stores its counters in Redis. With Redis down the storage call
 *     rejects and the guard turns a dependency-FREE liveness probe into HTTP 500. The Dockerfile
 *     HEALTHCHECK polls /health/live and compose restarts on failure → a Redis blip became a restart
 *     loop the container could not exit while Redis stayed down.
 *  2. A probe must answer even when the caller's bucket is exhausted; an orchestrator killing a
 *     healthy container because a noisy neighbour spent the bucket is a self-inflicted outage.
 *
 * /health/ready keeps its HONEST verdict: it is skipped by the throttler, not by the dependency
 * check — with Redis down it reports 503 degraded (not 200, and not the guard's 500).
 * Precedent: metrics.controller.ts. The theoretical cost — an unthrottled endpoint — is accepted:
 * both probes are cheap and sit behind the edge (same trade-off /metrics already makes).
 */
@Public()
@SkipThrottle()
@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Liveness: process is up. No dependency checks (used by orchestrator restarts). */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: dependencies (PostgreSQL + Redis) are reachable. */
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.prisma.isHealthy('postgres'),
      () => this.redis.isHealthy('redis'),
    ]);
  }
}
