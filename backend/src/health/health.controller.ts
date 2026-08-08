import { Controller, Get, Logger, ServiceUnavailableException, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../lib/auth/public.decorator';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';

/**
 * The readiness `detail`. A CONSTANT, and it must stay one: NEVER a template, never interpolated,
 * never `` `...: ${host}` ``. This is precisely the line someone will "improve" into
 * `unavailable: redis at 10.0.0.5:6399` a month from now because that is handier to debug — and
 * `/health/*` is @Public(), so that convenience is a topology leak to the unauthenticated internet.
 * The temptation is meant to hit a RED suite, not somebody's good intentions: the e2e and the unit
 * spec sweep the whole 503 body with endpoint-shaped regexes (IPv4 literal, `host:port`, URL scheme,
 * `user@host`, bracketed IPv6), so an interpolation here fails the gate wherever it is spelled.
 * Diagnosis belongs in `errors` (check names) and in the server log.
 */
const DEGRADED_DETAIL = 'One or more dependencies are unavailable.';

/** The per-check `message`. Also a constant, and for the same reason — it is the second temptation. */
const CHECK_DOWN = 'down';

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
  private readonly logger = new Logger(HealthController.name);

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

  /**
   * Readiness: dependencies (PostgreSQL + Redis) are reachable.
   *
   * On failure the answer names the failed checks in the STANDARD `errors` shape
   * (`[{ field: 'redis', message: 'down' }]`) — machine-readable for an operator, human or AGENT
   * (ADR-0006), which the bare 503 was not. It carries no indicator message: see
   * `failedCheckProblem` for why that is a security requirement, not a style choice.
   */
  @Get('ready')
  @HealthCheck()
  async ready() {
    try {
      return await this.health.check([
        () => this.prisma.isHealthy('postgres'),
        () => this.redis.isHealthy('redis'),
      ]);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw this.failedCheckProblem(error);
      throw error;
    }
  }

  /**
   * ADR-0043 rule 3 — `/health/*` reports check NAMES, never indicator strings.
   *
   * Terminus throws its whole report as the exception payload (`{ status, info, error, details }`),
   * and each indicator's `message` is driver text: for redis the ioredis
   * `connect ECONNREFUSED <host>:<port>`, for prisma a connection fragment. This endpoint is
   * `@Public()`, so passing that report through would publish the topology to the unauthenticated
   * internet at the exact moment the system is degraded. We therefore keep only the KEYS of the
   * failed checks; the strings stay in the server log, which Terminus already writes before throwing.
   * If deeper detail is ever wanted over HTTP it goes behind the EXISTING ops-token gate
   * (`lib/metrics/metrics.guard.ts`) — never a second public surface.
   *
   * The names travel in the ONE published `errors` shape — an array of objects, `{ field, message }`
   * (API_CONVENTIONS §4, repeated verbatim in all 12 api-contract yamls and their 12 RU mirrors).
   * An array of bare names was considered and REJECTED: one member carrying two different forms
   * depending on the class of error is a mine — the consumer is obliged to discriminate the form by
   * context, and nobody tells it the context.
   */
  private failedCheckProblem(failure: ServiceUnavailableException): ServiceUnavailableException {
    return new ServiceUnavailableException({
      message: DEGRADED_DETAIL,
      errors: this.failedCheckNames(failure.getResponse()).map((field) => ({
        field,
        message: CHECK_DOWN,
      })),
    });
  }

  /** Failed check names from a Terminus report: `error` keys, else the non-`up` entries of `details`. */
  private failedCheckNames(report: unknown): string[] {
    if (typeof report !== 'object' || report === null) return this.unrecognisedReport();
    const { status, error, details } = report as {
      status?: unknown;
      error?: unknown;
      details?: unknown;
    };

    if (typeof error === 'object' && error !== null) {
      const names = Object.keys(error);
      if (names.length > 0) return names.sort();
    }
    if (typeof details === 'object' && details !== null) {
      const down = Object.entries(details as Record<string, unknown>)
        .filter(([, value]) => {
          if (typeof value !== 'object' || value === null) return false;
          return (value as { status?: unknown }).status !== 'up';
        })
        .map(([name]) => name);
      if (down.length > 0) return down.sort();
    }
    // 'shutting_down' is a 503 with no failed check — an empty list is the honest answer, not a defect.
    if (status === 'shutting_down') return [];
    return this.unrecognisedReport();
  }

  /** A report we cannot read (e.g. after a Terminus upgrade): answer with no names, and say so. */
  private unrecognisedReport(): string[] {
    this.logger.warn(
      'Readiness report shape not recognised — answering 503 with no check names. ' +
        'Verify the @nestjs/terminus report contract (ADR-0043 rule 3).',
    );
    return [];
  }
}
