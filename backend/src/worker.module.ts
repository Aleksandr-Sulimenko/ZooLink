import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { AppLoggerModule } from './lib/logging/logger.module';
import { DbModule } from './lib/db/db.module';
import { RedisModule } from './lib/redis/redis.module';

/**
 * Worker context — shares the platform foundation with the API but hosts no HTTP layer.
 * Outbox relay / cron / job consumers register here in Phase 1+.
 */
@Module({
  imports: [AppConfigModule, AppLoggerModule, DbModule, RedisModule],
})
export class WorkerModule {}
