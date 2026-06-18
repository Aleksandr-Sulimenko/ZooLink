import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './indicators/prisma.health';
import { RedisHealthIndicator } from './indicators/redis.health';

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
