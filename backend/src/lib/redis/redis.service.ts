import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';

/** Cap on the reconnect backoff. Keeps a long Redis outage at one attempt every 2s, not a hot loop. */
const RECONNECT_BACKOFF_CAP_MS = 2_000;

/**
 * Shared ioredis client (health, throttler storage, caching, rate-limit).
 *
 * SURVIVES A DEAD REDIS (AUDIT5 §F1c, M-c2). Previously `onModuleInit` awaited `connect()`, whose
 * promise REJECTS when the first attempt fails — that rejection propagated out of Nest bootstrap and
 * out of `void bootstrap()`, so booting the API while Redis was down killed the process. Combined
 * with the Dockerfile HEALTHCHECK + `restart: unless-stopped`, that was a restart loop the container
 * could not leave until Redis came back.
 *
 * The fix is to treat the FIRST connection like every later one: log it and keep the process alive.
 * Measured against ioredis 5 (2026-08-07): after a rejected `connect()` the client's status is
 * `reconnecting` and it retries on its own — so it heals when Redis returns, with no code of ours.
 *
 * What deliberately does NOT change (that is AUDIT5 §F2): `maxRetriesPerRequest: 3` keeps COMMANDS
 * failing fast (~0.8s) rather than hanging on the offline queue. That bounded rejection is what lets
 * /health/ready answer an honest 503, and it is also why the throttler's Redis storage turns a dead
 * Redis into HTTP 500 on throttled routes. The DIRECTION of that failure (500 vs fail-open vs a
 * clean 429) is an architecture/security decision left to §F2 — this pack only stops the process
 * from dying and keeps the health probes truthful.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: AppConfigService) {
    this.client = new Redis(config.get('REDIS_URL'), {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      // Explicit rather than relying on the library default: retry FOREVER with a capped backoff, so
      // an outage degrades the process instead of ending its ability to recover.
      retryStrategy: (times: number) => Math.min(times * 50, RECONNECT_BACKOFF_CAP_MS),
    });
    // Registered before any connect attempt: an ioredis client without an 'error' listener turns
    // every connection error into an unhandled 'error' event.
    this.client.on('error', (err: Error) => this.logger.error(`Redis error: ${err.message}`));
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Redis connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      // Degrade, do not die. The client keeps reconnecting; /health/ready reports 503 until it lands.
      this.logger.warn(
        `Redis unavailable at startup (${message}) — continuing; the client will keep reconnecting. ` +
          `/health/live stays 200, /health/ready reports 503 until Redis is back.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      // QUIT is a command: on a client that never connected it rejects, which would otherwise turn a
      // clean shutdown into a failure. Fall back to tearing the socket down.
      await this.client.quit();
      this.logger.log('Redis disconnected');
    } catch {
      this.client.disconnect(false);
      this.logger.log('Redis client discarded (was not connected)');
    }
  }

  ping(): Promise<string> {
    return this.client.ping();
  }
}
