import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/**
 * /metrics access gate — defence-in-depth (AUDIT3 security.md).
 *
 * The Prometheus scrape exposes business volumes + route/label cardinality; it must NOT be
 * world-readable if the port is ever internet-reachable. We do NOT rely solely on the Caddy/edge
 * topology to hide it. Two layers, fail-CLOSED, 404-no-leak (never a 403/401 that confirms the route):
 *
 *   1) If `METRICS_TOKEN` is configured (ops credential), the request MUST present it as
 *      `Authorization: Bearer <token>` or `X-Metrics-Token: <token>` (constant-time compare) — else 404.
 *   2) If no token is configured, fall back to INTERNAL-ONLY: allow loopback/private-range clients
 *      (in-cluster Prometheus, local dev) and 404 everything else.
 *
 * `METRICS_TOKEN` is read straight from `process.env` (not the validated config surface) on purpose:
 * it is an ops/deploy secret, optional in dev, and not part of the app's typed env contract. Reading
 * it per-request means enabling the credential needs no code change.
 */
@Injectable()
export class MetricsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const configured = process.env.METRICS_TOKEN?.trim();

    if (configured) {
      const presented = this.extractToken(req);
      if (presented && this.constantTimeEquals(presented, configured)) return true;
      throw new NotFoundException({ message: 'Not found', code: 'NOT_FOUND' });
    }

    if (this.isInternalClient(req)) return true;
    throw new NotFoundException({ message: 'Not found', code: 'NOT_FOUND' });
  }

  private extractToken(req: Request): string | undefined {
    const header = req.headers['x-metrics-token'];
    if (typeof header === 'string' && header.length > 0) return header;
    const auth = req.headers.authorization;
    if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
    return undefined;
  }

  private constantTimeEquals(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }

  /** Loopback or RFC1918 private address (in-cluster / local). IPv4-mapped IPv6 is normalised. */
  private isInternalClient(req: Request): boolean {
    const raw = (req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
    if (raw === '' || raw === '::1' || raw === '127.0.0.1' || raw === 'localhost') return true;
    if (raw.startsWith('127.')) return true;
    if (raw.startsWith('10.')) return true;
    if (raw.startsWith('192.168.')) return true;
    // 172.16.0.0 – 172.31.255.255
    const m = /^172\.(\d{1,3})\./.exec(raw);
    if (m) {
      const second = Number(m[1]);
      if (second >= 16 && second <= 31) return true;
    }
    // fc00::/7 unique-local IPv6
    if (/^f[cd][0-9a-f]{2}:/i.test(raw)) return true;
    return false;
  }
}
