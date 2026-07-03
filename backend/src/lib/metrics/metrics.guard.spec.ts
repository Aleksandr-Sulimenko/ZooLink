import { NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { MetricsGuard } from './metrics.guard';

/**
 * /metrics gate (AUDIT3 security.md). Fail-closed, 404-no-leak. Covers both layers: the ops-token path
 * (when METRICS_TOKEN is set) and the internal-only fallback (when it is not).
 */
describe('MetricsGuard', () => {
  const guard = new MetricsGuard();
  const original = process.env.METRICS_TOKEN;

  afterEach(() => {
    if (original === undefined) delete process.env.METRICS_TOKEN;
    else process.env.METRICS_TOKEN = original;
  });

  const ctx = (opts: { headers?: Record<string, string>; ip?: string }): ExecutionContext =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ headers: opts.headers ?? {}, ip: opts.ip, socket: { remoteAddress: opts.ip } }),
      }),
    }) as unknown as ExecutionContext;

  describe('with METRICS_TOKEN configured', () => {
    beforeEach(() => {
      process.env.METRICS_TOKEN = 'secret-token';
    });

    it('404s when no credential is presented (even from loopback)', () => {
      expect(() => guard.canActivate(ctx({ ip: '127.0.0.1' }))).toThrow(NotFoundException);
    });

    it('404s on a wrong token', () => {
      expect(() => guard.canActivate(ctx({ headers: { 'x-metrics-token': 'wrong' } }))).toThrow(NotFoundException);
    });

    it('allows the correct X-Metrics-Token', () => {
      expect(guard.canActivate(ctx({ headers: { 'x-metrics-token': 'secret-token' } }))).toBe(true);
    });

    it('allows the correct Bearer token', () => {
      expect(guard.canActivate(ctx({ headers: { authorization: 'Bearer secret-token' } }))).toBe(true);
    });
  });

  describe('without METRICS_TOKEN (internal-only fallback)', () => {
    beforeEach(() => {
      delete process.env.METRICS_TOKEN;
    });

    it.each(['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.5', '192.168.1.2', '172.16.0.1'])(
      'allows internal client %s',
      (ip) => {
        expect(guard.canActivate(ctx({ ip }))).toBe(true);
      },
    );

    it.each(['203.0.113.7', '8.8.8.8', '172.32.0.1'])('404s external client %s', (ip) => {
      expect(() => guard.canActivate(ctx({ ip }))).toThrow(NotFoundException);
    });
  });
});
