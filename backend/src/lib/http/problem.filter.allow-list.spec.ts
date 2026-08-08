/**
 * ADR-0043 — the RFC 7807 seam is a NORMALISER: it projects an exception payload onto the problem
 * document through an explicit allow-list (`message` → `detail`, `code`, `errors`) and drops
 * everything else. Two properties are asserted here as a CLASS, not as the health case that
 * happened to expose them:
 *
 *   axis CLASS        an HttpException payload carrying members outside the list produces a
 *                     deterministic body (members absent) AND a warn line that NAMES the dropped
 *                     members. Before ADR-0043 there was no line at all — the loss was silent.
 *   axis PUBLIC LEAK  a member holding a secret-shaped string (`host:port`) never appears in the
 *                     response body; only its NAME appears in the log. `/health/*` is @Public(),
 *                     so "echo the payload" is a topology leak to the unauthenticated internet.
 *
 * Plus the paired NO-REGRESS axis: today's consumers of `message`/`code`/`errors` — including the
 * moderation ALREADY_CLAIMED holder context, which landed as its own fix — behave identically, and
 * members the filter deliberately consumes elsewhere (`retryAfter`, `rateLimit`) or that Nest itself
 * adds (`statusCode`, `error`) must NOT be reported as dropped, or the line would fire on nearly
 * every error in the system and mean nothing.
 */
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ProblemExceptionFilter } from './problem.filter';

interface HostOptions {
  method?: string;
  url?: string;
  routePath?: string;
}

function makeHost({ method = 'GET', url = '/v1/listings', routePath }: HostOptions = {}) {
  const json = jest.fn();
  const setHeader = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ setHeader, json });
  const res = { status, setHeader, json, getHeader: jest.fn().mockReturnValue('req-1') };
  const req: Record<string, unknown> = { method, originalUrl: url, baseUrl: '' };
  if (routePath !== undefined) req.route = { path: routePath };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  status.mockReturnValue({ setHeader: setHeader.mockReturnThis(), json });
  return { host, status, json, setHeader };
}

function bodyOf(json: jest.Mock): Record<string, unknown> {
  return json.mock.calls[0][0] as Record<string, unknown>;
}

describe('ProblemExceptionFilter — payload allow-list (ADR-0043)', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const warnText = (): string => warn.mock.calls.map((c) => String(c[0])).join('\n');

  it('axis CLASS: unknown payload members are dropped from the body and NAMED in one warn line', () => {
    const { host, json } = makeHost({ method: 'POST', routePath: '/v1/listings' });
    new ProblemExceptionFilter().catch(
      new BadRequestException({
        message: 'Validation failed at the edge',
        code: 'VALIDATION_ERROR',
        debugSql: 'SELECT secret_column FROM users',
        internalHint: 'S3CRET-HINT-VALUE',
      }),
      host,
    );

    const body = bodyOf(json);
    // Deterministic body: exactly the documented envelope, nothing the caller smuggled in.
    expect(Object.keys(body).sort()).toEqual(
      ['type', 'title', 'status', 'code', 'detail', 'instance', 'requestId'].sort(),
    );
    expect(body.detail).toBe('Validation failed at the edge');
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(JSON.stringify(body)).not.toContain('debugSql');
    expect(JSON.stringify(body)).not.toContain('internalHint');

    // ...and the loss is NOT silent: one warn line, names only.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnText()).toContain('debugSql');
    expect(warnText()).toContain('internalHint');
    expect(warnText()).toContain('POST');
    expect(warnText()).toContain('/v1/listings');
    // Values are never logged — the line is a key inventory, not a payload dump.
    expect(warnText()).not.toContain('SELECT secret_column');
    expect(warnText()).not.toContain('S3CRET-HINT-VALUE');
  });

  it('axis PUBLIC LEAK: a host:port member reaches the LOG by name and the body never at all', () => {
    const { host, json } = makeHost({ url: '/health/ready', routePath: '/health/ready' });
    new ProblemExceptionFilter().catch(
      new ServiceUnavailableException({
        message: 'Service Unavailable',
        redisEndpoint: 'connect ECONNREFUSED 10.42.7.19:6379',
      }),
      host,
    );

    const serialised = JSON.stringify(bodyOf(json));
    expect(serialised).not.toContain('10.42.7.19');
    expect(serialised).not.toContain('6379');
    expect(serialised).not.toContain('redisEndpoint');

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warnText()).toContain('redisEndpoint');
    expect(warnText()).not.toContain('10.42.7.19');
  });

  it('dedups on ROUTE + key set: one line per route, so the second address is not lost', () => {
    const filter = new ProblemExceptionFilter();
    const payload = () => new BadRequestException({ message: 'm', mysteryMember: 'v' });

    filter.catch(payload(), makeHost({ method: 'GET', routePath: '/v1/animals' }).host);
    filter.catch(payload(), makeHost({ method: 'GET', routePath: '/v1/animals' }).host);
    expect(warn).toHaveBeenCalledTimes(1); // same route + same set → one line

    filter.catch(payload(), makeHost({ method: 'GET', routePath: '/v1/listings' }).host);
    expect(warn).toHaveBeenCalledTimes(2); // different route → its own line
    expect(warnText()).toContain('/v1/animals');
    expect(warnText()).toContain('/v1/listings');
  });

  it('no-regress: Nest’s own envelope members never count as dropped', () => {
    const { host, json } = makeHost();
    // `new NotFoundException('gone')` → { message, error: 'Not Found', statusCode: 404 }.
    new ProblemExceptionFilter().catch(new NotFoundException('gone'), host);

    expect(bodyOf(json).detail).toBe('gone');
    expect(warn).not.toHaveBeenCalled();
  });

  it('no-regress: retryAfter / rateLimit still become headers and are not reported as dropped', () => {
    const { host, setHeader } = makeHost({ method: 'POST', routePath: '/v1/listings/:id/contact' });
    new ProblemExceptionFilter().catch(
      new HttpException(
        { message: 'slow down', code: 'RATE_LIMITED', retryAfter: 30, rateLimit: { limit: 10, remaining: 0 } },
        429,
      ),
      host,
    );

    expect(setHeader).toHaveBeenCalledWith('Retry-After', '30');
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', '10');
    expect(setHeader).toHaveBeenCalledWith('X-RateLimit-Remaining', '0');
    expect(warn).not.toHaveBeenCalled();
  });

  it('no-regress: the moderation ALREADY_CLAIMED holder context passes through byte-identically', () => {
    const { host, status, json } = makeHost({ method: 'POST', routePath: '/v1/moderation/queue/:id/claim' });
    const holder = [
      { assignedTo: { actorId: 'mod-2', principalType: 'AGENT' }, lockExpiresAt: '2026-08-08T10:00:00.000Z' },
    ];
    new ProblemExceptionFilter().catch(
      new ConflictException({
        message: 'Item already claimed by another principal',
        code: 'ALREADY_CLAIMED',
        errors: holder,
      }),
      host,
    );

    expect(status).toHaveBeenCalledWith(409);
    const body = bodyOf(json);
    expect(body.code).toBe('ALREADY_CLAIMED');
    expect(body.detail).toBe('Item already claimed by another principal');
    expect(body.errors).toEqual(holder);
    expect(warn).not.toHaveBeenCalled();
  });

  it('no-regress: class-validator string[] messages still become field-level errors', () => {
    const { host, json } = makeHost();
    new ProblemExceptionFilter().catch(
      new BadRequestException({
        message: ['email must be an email', 'phone should not be empty'],
        error: 'Bad Request',
        statusCode: 400,
      }),
      host,
    );

    const body = bodyOf(json);
    expect(body.detail).toBe('Validation failed');
    expect(body.errors).toEqual([
      { field: 'email', message: 'email must be an email' },
      { field: 'phone', message: 'phone should not be empty' },
    ]);
    expect(warn).not.toHaveBeenCalled();
  });
});
