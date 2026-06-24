import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { AppLoggerModule } from './lib/logging/logger.module';
import { DbModule } from './lib/db/db.module';
import { RedisModule } from './lib/redis/redis.module';
import { ProvidersModule } from './lib/providers/providers.module';
import { AuditModule } from './lib/audit/audit.module';
import { FeatureToggleModule } from './lib/feature-toggle/feature-toggle.module';
import { OutboxModule } from './lib/outbox/outbox.module';
import { OutboxRelayModule } from './lib/outbox/outbox-relay.module';
import { SchedulerModule } from './lib/scheduler/scheduler.module';

/**
 * Worker context — shares the platform foundation with the API but hosts no HTTP layer.
 * Providers are wired here too: the outbox relay dispatches SMS/email via the same ports.
 * The relay (OutboxRelayModule) runs here; domain consumers register under OUTBOX_CONSUMERS.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DbModule,
    RedisModule,
    ProvidersModule,
    AuditModule,
    FeatureToggleModule,
    OutboxModule,
    OutboxRelayModule,
    SchedulerModule,
  ],
})
export class WorkerModule {}
