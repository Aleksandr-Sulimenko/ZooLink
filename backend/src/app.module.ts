import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { AppLoggerModule } from './lib/logging/logger.module';
import { DbModule } from './lib/db/db.module';
import { RedisModule } from './lib/redis/redis.module';
import { RateLimitModule } from './lib/rate-limit/rate-limit.module';
import { MetricsModule } from './lib/metrics/metrics.module';
import { ProvidersModule } from './lib/providers/providers.module';
import { AuditModule } from './lib/audit/audit.module';
import { CryptoModule } from './lib/crypto/crypto.module';
import { ConsentModule } from './modules/identity/consent.module';
import { FeatureToggleModule } from './lib/feature-toggle/feature-toggle.module';
import { OutboxModule } from './lib/outbox/outbox.module';
import { OrgMembershipModule } from './lib/org/org-membership.module';
import { AuthModule } from './modules/auth/auth.module';
import { AgentAuthModule } from './modules/agent-auth/agent-auth.module';
import { IdentityModule } from './modules/identity/identity.module';
import { AdminModule } from './modules/admin/admin.module';
import { AnimalModule } from './modules/animal/animal.module';
import { ListingModule } from './modules/listing/listing.module';
import { SavedSearchModule } from './modules/saved-search/saved-search.module';
import { FavoriteModule } from './modules/favorite/favorite.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { NotificationReadModule } from './modules/notification/notification-read.module';
import { HealthModule } from './health/health.module';

/**
 * Root module. Wires the platform foundation: config, logging, data-access (Prisma+Kysely),
 * Redis, rate limiting, metrics, external providers (ADR-0008), audit log, feature toggles,
 * the outbox writer, and health — plus auth. The outbox relay runs in the worker; domain
 * modules arrive in later phases.
 */
@Module({
  imports: [
    AppConfigModule,
    AppLoggerModule,
    DbModule,
    RedisModule,
    RateLimitModule,
    MetricsModule,
    ProvidersModule,
    AuditModule,
    CryptoModule,
    ConsentModule,
    FeatureToggleModule,
    OutboxModule,
    OrgMembershipModule,
    AuthModule,
    AgentAuthModule,
    IdentityModule,
    AdminModule,
    AnimalModule,
    ListingModule,
    SavedSearchModule,
    FavoriteModule,
    ModerationModule,
    NotificationReadModule,
    HealthModule,
  ],
})
export class AppModule {}
