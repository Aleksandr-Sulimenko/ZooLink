import { Redis } from 'ioredis';
import { Registry } from 'prom-client';
import type { RedisService } from '../redis/redis.service';
import type { MetricsService } from '../metrics/metrics.service';
import { EDGE_CLIENT_IP_HEADER } from './client-ip';
import { RateLimitMetrics } from './rate-limit.metrics';
import { DEFAULT_THROTTLE_LIMIT, DEFAULT_THROTTLE_TTL_MS, buildThrottlerOptions } from './rate-limit.module';

/**
 * The WIRING axis (AUDIT5 §F1b). `client-ip.spec.ts` proves the resolver; this proves the resolver is
 * actually installed as the throttler's tracker. Without it the library default (`req.ip`) is used,
 * which behind the edge is one value for the whole internet — the exact defect §F1b fixes. Deleting
 * `getTracker` from the factory must turn this file RED.
 */
/**
 * The client must be a REAL ioredis instance: `ThrottlerStorageRedisService` accepts a client OR a
 * connection spec, and a duck-typed object falls into the "spec" branch, where it constructs its own
 * client and opens a socket (a leaked TCP handle in the suite). `lazyConnect` means nothing is dialled.
 */
const clients: Redis[] = [];
const fakeRedis = (): RedisService => {
  const client = new Redis({ lazyConnect: true, port: 6399, retryStrategy: () => null });
  clients.push(client);
  return { client } as unknown as RedisService;
};

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect(false);
});

const fakeMetrics = (): MetricsService => ({ registry: new Registry() }) as unknown as MetricsService;

/** The throttler passes the raw request; the factory's tracker is typed structurally. */
type TrackerFn = (req: unknown, context?: unknown) => string | Promise<string>;

const trackerFrom = (metrics?: RateLimitMetrics): TrackerFn => {
  const options = buildThrottlerOptions(fakeRedis(), metrics);
  if (Array.isArray(options)) throw new Error('expected the object form of ThrottlerModuleOptions');
  const tracker = options.getTracker;
  expect(tracker).toBeDefined(); // the point of this suite
  return tracker as unknown as TrackerFn;
};

describe('buildThrottlerOptions', () => {
  it('keeps the documented default bucket (100 req / 60s) under the name the decorators use', () => {
    const options = buildThrottlerOptions(fakeRedis());
    if (Array.isArray(options)) throw new Error('expected the object form');
    expect(options.throttlers).toEqual([
      { name: 'default', ttl: DEFAULT_THROTTLE_TTL_MS, limit: DEFAULT_THROTTLE_LIMIT },
    ]);
    expect(DEFAULT_THROTTLE_TTL_MS).toBe(60_000);
    expect(DEFAULT_THROTTLE_LIMIT).toBe(100);
  });

  it('installs a getTracker that keys on the edge header, not on req.ip', async () => {
    const tracker = trackerFrom();
    expect(await tracker({ headers: { [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, ip: '10.0.0.5' })).toBe(
      '203.0.113.7',
    );
  });

  it('installs a getTracker that separates two edge clients arriving on the same socket', async () => {
    const tracker = trackerFrom();
    const a = await tracker({ headers: { [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, ip: '10.0.0.5' });
    const b = await tracker({ headers: { [EDGE_CLIENT_IP_HEADER]: '198.51.100.4' }, ip: '10.0.0.5' });
    expect(a).not.toBe(b);
  });

  it('falls back to the socket address when the edge header is missing', async () => {
    const tracker = trackerFrom();
    expect(await tracker({ headers: {}, ip: '10.0.0.5' })).toBe('10.0.0.5');
  });
});

describe('RateLimitMetrics — the second alarm (У-4b + amendment)', () => {
  it('counts an absent header and a malformed header under distinct sources', async () => {
    const metricsService = fakeMetrics();
    const rlMetrics = new RateLimitMetrics(metricsService);
    const tracker = trackerFrom(rlMetrics);

    await tracker({ headers: { [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, ip: '10.0.0.5' }); // no fallback
    await tracker({ headers: {}, ip: '10.0.0.5' }); // absent
    await tracker({ headers: {}, ip: '10.0.0.5' }); // absent
    await tracker({ headers: { [EDGE_CLIENT_IP_HEADER]: 'garbage' }, ip: '10.0.0.5' }); // malformed

    const scrape = await metricsService.registry.metrics();
    expect(scrape).toContain('{source="absent",peer="network"} 2');
    expect(scrape).toContain('{source="malformed",peer="network"} 1');
  });

  it('splits the alarm series from the benign one — the rule is absent{peer="network"} == 0', async () => {
    const metricsService = fakeMetrics();
    const tracker = trackerFrom(new RateLimitMetrics(metricsService));

    // An in-container caller (smoke script, ops curl) legitimately has no header. It must NOT raise
    // the baseline of the alarm series, or the signal rots into noise and gets muted.
    await tracker({ headers: {}, ip: '127.0.0.1' });
    await tracker({ headers: {}, ip: '127.0.0.1' });
    // One network-side header-less request IS the finding.
    await tracker({ headers: {}, ip: '172.18.0.4' });

    const scrape = await metricsService.registry.metrics();
    expect(scrape).toContain('{source="absent",peer="loopback"} 2');
    expect(scrape).toContain('{source="absent",peer="network"} 1');
  });

  it('states the alert rule and its premise in the metric help (law №10 — for the next reader)', async () => {
    const metricsService = fakeMetrics();
    new RateLimitMetrics(metricsService);
    const scrape = await metricsService.registry.metrics();
    expect(scrape).toContain('ALERT on absent{peer="network"} != 0');
    expect(scrape).toContain('peer="loopback" is an in-container caller and is NOT an alarm');
  });

  it('does not count anything when the edge header is healthy', async () => {
    const metricsService = fakeMetrics();
    const tracker = trackerFrom(new RateLimitMetrics(metricsService));
    await tracker({ headers: { [EDGE_CLIENT_IP_HEADER]: '203.0.113.7' }, ip: '10.0.0.5' });
    expect(await metricsService.registry.metrics()).not.toContain('zoolink_ratelimit_tracker_fallback_total{');
  });

  it('announces a missing MetricsService at construction instead of degrading silently', () => {
    const warn = jest
      .spyOn(RateLimitMetrics['logger'], 'warn')
      .mockImplementation(() => undefined);
    try {
      new RateLimitMetrics(undefined);
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain('BLIND');
      expect(message).toContain('RateLimitModule must import MetricsModule');
    } finally {
      warn.mockRestore();
    }
  });

  it('is a no-op without a metrics service (worker//no-scrape context) and never throws', async () => {
    const warn = jest.spyOn(RateLimitMetrics['logger'], 'warn').mockImplementation(() => undefined);
    const tracker = trackerFrom(new RateLimitMetrics(undefined));
    expect(await tracker({ headers: {}, ip: '10.0.0.5' })).toBe('10.0.0.5');
    warn.mockRestore();
  });

  it('can be constructed twice against one registry without a duplicate-metric error', () => {
    const metricsService = fakeMetrics();
    new RateLimitMetrics(metricsService);
    expect(() => new RateLimitMetrics(metricsService)).not.toThrow();
  });
});
