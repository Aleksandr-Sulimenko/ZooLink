/**
 * ADR-0043 rule 3 — `/health/*` answers with check NAMES, never with indicator strings.
 *
 * `/health/*` is `@Public()`: reachable unauthenticated. Terminus reports each indicator's `message`,
 * and ours carry driver text — for redis the ioredis `connect ECONNREFUSED <host>:<port>`, for prisma
 * a connection fragment. Surfacing that report to satisfy "the operator cannot see WHICH dependency
 * is down" would publish the topology exactly when the system is degraded. So the controller converts
 * the report into the published `errors` shape — `[{ field: '<check>', message: 'down' }]`, objects,
 * as API_CONVENTIONS §4 and all 24 api-contract yamls declare — before it ever reaches the RFC 7807
 * filter; the strings stay in the server log (Terminus already writes them).
 *
 * The e2e (test/health-redis-down.e2e-spec.ts) proves this against a REAL dead Redis. These unit
 * cases cover the shapes an e2e cannot conjure: the `details`-only fallback, `shutting_down`, and an
 * unrecognised report after a Terminus upgrade — the body must stay clean in every one of them.
 *
 * `expectNoEndpointShape` is the standing lock on `detail`/`message` being CONSTANTS: it sweeps the
 * whole serialised body for anything endpoint-shaped rather than for known field values, so a future
 * `` `unavailable: ${host}:${port}` `` fails here no matter which member it is spelled into.
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import type { HealthCheckService } from '@nestjs/terminus';
import { HealthController } from './health.controller';
import type { PrismaHealthIndicator } from './indicators/prisma.health';
import type { RedisHealthIndicator } from './indicators/redis.health';

const REDIS_DRIVER_TEXT = 'connect ECONNREFUSED 10.42.7.19:6379';

/**
 * Endpoint shapes — a host or a port cannot reach the body in ANY of these disguises. Verified clean
 * against the real wire body (whose `"status":503` and UUID `requestId` deliberately do NOT match:
 * `host:port` requires an alphanumeric character immediately before the colon, which a JSON key's
 * closing quote is not).
 */
const ENDPOINT_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ['IPv4 literal', /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ['host:port token', /[A-Za-z0-9._-]+:\d{2,5}(?!\d)/],
  ['URL scheme', /\b[a-z][a-z0-9+.-]*:\/\//i],
  ['userinfo@host', /[A-Za-z0-9._-]+@[A-Za-z0-9._-]+/],
  ['bracketed IPv6', /\[[0-9a-fA-F:]+\]/],
];

function expectNoEndpointShape(body: unknown): void {
  const serialised = JSON.stringify(body);
  for (const [name, shape] of ENDPOINT_SHAPES) {
    const hit = shape.exec(serialised);
    if (hit) {
      throw new Error(
        `the 503 body leaked something endpoint-shaped (${name}): ${JSON.stringify(hit[0])} — ` +
          'detail/message must stay CONSTANTS (ADR-0043 rule 3)',
      );
    }
  }
}

function makeController(check: jest.Mock) {
  const health = { check } as unknown as HealthCheckService;
  const prisma = { isHealthy: jest.fn() } as unknown as PrismaHealthIndicator;
  const redis = { isHealthy: jest.fn() } as unknown as RedisHealthIndicator;
  return new HealthController(health, prisma, redis);
}

async function payloadOfThrow(run: () => Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    return (error as ServiceUnavailableException).getResponse() as Record<string, unknown>;
  }
  throw new Error('expected the readiness probe to throw');
}

describe('HealthController — readiness reports names, never strings (ADR-0043)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('healthy: passes the Terminus result through unchanged (200 path untouched)', async () => {
    const ok = {
      status: 'ok',
      info: { postgres: { status: 'up' }, redis: { status: 'up' } },
      error: {},
      details: { postgres: { status: 'up' }, redis: { status: 'up' } },
    };
    const check = jest.fn().mockResolvedValue(ok);

    await expect(makeController(check).ready()).resolves.toEqual(ok);
    expect(check).toHaveBeenCalledTimes(1);
    expect((check.mock.calls[0][0] as unknown[]).length).toBe(2);
  });

  it('degraded: `errors` names the failed check in the PUBLISHED object shape', async () => {
    const check = jest.fn().mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        info: { postgres: { status: 'up' } },
        error: { redis: { status: 'down', message: REDIS_DRIVER_TEXT } },
        details: {
          postgres: { status: 'up' },
          redis: { status: 'down', message: REDIS_DRIVER_TEXT },
        },
      }),
    );

    const payload = await payloadOfThrow(() => makeController(check).ready());

    // Objects, `{ field, message }` — the ONE published `errors` shape (API_CONVENTIONS §4). A bare
    // name array was rejected: one member with two forms per error class forces the consumer to
    // discriminate by a context nobody hands it.
    expect(payload.errors).toEqual([{ field: 'redis', message: 'down' }]);
    const serialised = JSON.stringify(payload);
    expect(serialised).not.toContain('10.42.7.19');
    expect(serialised).not.toContain('6379');
    expect(serialised).not.toContain('ECONNREFUSED');
    expectNoEndpointShape(payload);
    // Neither the raw Terminus members nor an indicator message may ride along.
    expect(Object.keys(payload).sort()).toEqual(['errors', 'message']);
  });

  it('axis CONSTANT DETAIL: no port digits and no host survive in the body, in any disguise', async () => {
    // The shapes a future `detail`/`message` template would produce, one per disguise. Each must be
    // caught by the sweep the production path is guarded with — the helper itself is proven here, so
    // the guard cannot rot into a no-op that passes everything.
    const disguises = [
      { detail: 'unavailable: redis at 10.0.0.5:6399' },
      { detail: 'unavailable: cache-01:6379' },
      { detail: 'unavailable: redis://cache-01/0' },
      { detail: 'unavailable: user@db-primary' },
      { detail: 'unavailable: [fd00::1]' },
    ];
    for (const leak of disguises) {
      expect(() => expectNoEndpointShape(leak)).toThrow(/endpoint-shaped/);
    }

    // ...and the real production body passes it.
    const check = jest.fn().mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        error: { redis: { status: 'down', message: REDIS_DRIVER_TEXT } },
        details: { redis: { status: 'down', message: REDIS_DRIVER_TEXT } },
      }),
    );
    const payload = await payloadOfThrow(() => makeController(check).ready());
    expectNoEndpointShape(payload);
    expect(payload.message).toBe('One or more dependencies are unavailable.');
    expect(String(payload.message)).not.toMatch(/\$\{|`/); // not a template, by construction
  });

  it('degraded: falls back to `details` when `error` is missing, still names only', async () => {
    const check = jest.fn().mockRejectedValue(
      new ServiceUnavailableException({
        status: 'error',
        details: {
          postgres: { status: 'down', message: 'P1001 cannot reach database server at db:5432' },
          redis: { status: 'down', message: REDIS_DRIVER_TEXT },
        },
      }),
    );

    const payload = await payloadOfThrow(() => makeController(check).ready());

    expect(payload.errors).toEqual([
      { field: 'postgres', message: 'down' },
      { field: 'redis', message: 'down' },
    ]);
    expect(JSON.stringify(payload)).not.toContain('db:5432');
    expect(JSON.stringify(payload)).not.toContain('10.42.7.19');
    expectNoEndpointShape(payload);
  });

  it('shutting_down: no failed check, empty names, and no false alarm in the log', async () => {
    const check = jest.fn().mockRejectedValue(
      new ServiceUnavailableException({
        status: 'shutting_down',
        info: { postgres: { status: 'up' } },
        error: {},
        details: { postgres: { status: 'up' } },
      }),
    );

    const payload = await payloadOfThrow(() => makeController(check).ready());

    expect(payload.errors).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('unrecognised report (Terminus upgrade): body stays clean and the SHAPE is warned about', async () => {
    const check = jest
      .fn()
      .mockRejectedValue(new ServiceUnavailableException({ somethingNew: REDIS_DRIVER_TEXT }));

    const payload = await payloadOfThrow(() => makeController(check).ready());

    expect(payload.errors).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('10.42.7.19');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).not.toContain('10.42.7.19');
  });

  it('a non-Terminus failure is re-thrown untouched (we only reshape the health report)', async () => {
    const boom = new TypeError('programmer error');
    const check = jest.fn().mockRejectedValue(boom);

    await expect(makeController(check).ready()).rejects.toBe(boom);
  });

  it('liveness is unchanged', () => {
    expect(makeController(jest.fn()).live()).toEqual({ status: 'ok' });
  });
});
