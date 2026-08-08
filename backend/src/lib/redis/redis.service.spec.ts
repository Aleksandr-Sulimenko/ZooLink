import { RedisService } from './redis.service';
import type { AppConfigService } from '../../config/app-config.service';

/**
 * AUDIT5 §F1c / M-c2 — the process must SURVIVE a Redis that is down at boot. `connect()` rejects on
 * a failed first attempt; awaiting it unguarded propagated out of Nest bootstrap and killed the API,
 * which (with the container HEALTHCHECK + `restart: unless-stopped`) was a restart loop it could not
 * leave while Redis stayed down. Removing the try/catch in onModuleInit must turn this file RED.
 *
 * The live counterpart (a real dead port, real HTTP probes) is
 * `test/health-redis-down.e2e-spec.ts`.
 */
const config = (): AppConfigService =>
  ({ get: () => 'redis://127.0.0.1:6399' }) as unknown as AppConfigService;

describe('RedisService — Redis down at startup', () => {
  /** Also silences the expected Nest logger output for an unreachable Redis. */
  const build = (): { service: RedisService; warn: jest.SpyInstance } => {
    const service = new RedisService(config());
    const logger = service['logger'];
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    return { service, warn };
  };

  it('does not throw out of onModuleInit when the first connect fails', async () => {
    const { service, warn } = build();
    jest.spyOn(service.client, 'connect').mockRejectedValue(new Error('Connection is closed.'));

    await expect(service.onModuleInit()).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('Redis unavailable at startup');
    service.client.disconnect(false);
  });

  it('shuts down cleanly even when QUIT rejects (client never connected)', async () => {
    const { service } = build();
    jest.spyOn(service.client, 'quit').mockRejectedValue(new Error('Connection is closed.'));
    const disconnect = jest.spyOn(service.client, 'disconnect').mockImplementation(() => undefined);

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(disconnect).toHaveBeenCalledWith(false);
  });

  it('configures a capped, unbounded reconnect backoff so an outage degrades instead of ending', () => {
    const { service } = build();
    expect(service.client.options).toHaveProperty('retryStrategy', expect.any(Function));
    // Invoked through the options object so the reference is never detached from its receiver.
    const strategy = (times: number): number | void | null =>
      service.client.options.retryStrategy?.(times);
    expect(strategy(1)).toBe(50);
    expect(strategy(100)).toBe(2_000); // capped, not a hot loop
    expect(strategy(1_000_000)).toBe(2_000); // still retrying — never gives up
    service.client.disconnect(false);
  });

  it('keeps commands failing FAST rather than hanging (AUDIT5 §F2 owns the direction, not this pack)', () => {
    const { service } = build();
    // maxRetriesPerRequest bounds a command's wait, which is what lets /health/ready answer 503
    // instead of stalling. Deliberately unchanged by this pack.
    expect(service.client.options.maxRetriesPerRequest).toBe(3);
    expect(service.client.options.lazyConnect).toBe(true);
    service.client.disconnect(false);
  });
});
