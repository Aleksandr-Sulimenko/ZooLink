import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { RedisService } from '../redis/redis.service';

/**
 * Global rate limiting (@nestjs/throttler) backed by the shared Redis instance so limits hold
 * across multiple API replicas. Default window: 100 requests / 60s; per-route overrides via
 * @Throttle()/@SkipThrottle(). Sensitive endpoints (OTP, contact-reveal) tighten this later.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage: new ThrottlerStorageRedisService(redis.client),
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class RateLimitModule {}
