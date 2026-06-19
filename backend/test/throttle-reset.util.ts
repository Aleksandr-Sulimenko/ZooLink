import type { INestApplication } from '@nestjs/common';
import { RedisService } from '../src/lib/redis/redis.service';

/**
 * Clear @nestjs/throttler rate-limit keys so a shared/persistent Redis cannot leak hits or
 * `:blocked` markers between e2e runs and produce spurious 429s. Rate limiting itself is covered
 * by unit tests; HTTP e2e asserts business flows, so a clean throttle slate at suite start makes
 * the suite deterministic regardless of prior runs. Targets only throttler keys (`…}:hits` /
 * `…}:blocked`) — OTP/recovery state and any other keys are left untouched.
 */
export async function resetThrottle(app: INestApplication): Promise<void> {
  const redis = app.get(RedisService).client;
  const keys = [...(await redis.keys('*}:hits')), ...(await redis.keys('*}:blocked'))];
  if (keys.length > 0) await redis.del(...keys);
}
