import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { AppLoggerModule } from './lib/logging/logger.module';
import { DbModule } from './lib/db/db.module';
import { RedisModule } from './lib/redis/redis.module';
import { RateLimitModule } from './lib/rate-limit/rate-limit.module';
import { MetricsModule } from './lib/metrics/metrics.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './health/health.module';

/**
 * Root module. Phase 0 wires the platform foundation only:
 * config, logging, data-access (Prisma+Kysely), Redis, rate limiting, metrics, and health.
 * Auth, outbox, and domain modules arrive in later phases.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DbModule,
    RedisModule,
    RateLimitModule,
    MetricsModule,
    AuthModule,
    HealthModule,
  ],
})
export class AppModule {}
