import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { firstValueFrom, of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { RedisService } from '../redis/redis.service';

/**
 * Unit coverage for the in-flight branch of the idempotency interceptor (audit 2026-06-30: the
 * previous store-on-completion left a window where two identical POSTs both executed). The concurrent
 * `409 IDEMPOTENCY_KEY_IN_PROGRESS`, the `422 IDEMPOTENCY_KEY_REUSED`, and the completed-replay paths
 * were implemented but had no regression test — this closes them deterministically (no timing races).
 */

const METHOD = 'POST';
const URL = '/v1/listings/abc/contact-reveal';
const BODY = { note: 'hi' };

/** Mirror the interceptor's private hashRequest so we can seed matching / mismatching reservations. */
function reqHash(body: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify({ method: METHOD, url: URL, body: body ?? null }))
    .digest('hex');
}

interface FakeRes {
  statusCode: number;
  headers: Record<string, string>;
  setHeader: (k: string, v: string) => void;
  getHeader: (k: string) => string | undefined;
  status: (n: number) => void;
}

function makeCtx(headerVal: string | undefined, res: FakeRes): ExecutionContext {
  const req = {
    header: (name: string) => (name === 'Idempotency-Key' ? headerVal : undefined),
    method: METHOD,
    originalUrl: URL,
    body: BODY,
  };
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

function makeRes(): FakeRes {
  const headers: Record<string, string> = {};
  return {
    statusCode: 200,
    headers,
    setHeader: (k, v) => {
      headers[k.toLowerCase()] = v;
    },
    getHeader: (k) => headers[k.toLowerCase()],
    status: (n) => {
      /* captured via statusCode default */ void n;
    },
  };
}

/** A Redis double that honours SET ... NX (returns null when the key already exists). */
function makeRedis(seed: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(seed));
  const client = {
    set: jest.fn(
      (key: string, val: string, _ex: string, _ttl: number, nx?: string): Promise<string | null> => {
        if (nx === 'NX' && store.has(key)) return Promise.resolve(null);
        store.set(key, val);
        return Promise.resolve('OK');
      },
    ),
    get: jest.fn((key: string): Promise<string | null> => Promise.resolve(store.get(key) ?? null)),
    del: jest.fn((key: string): Promise<number> => {
      const had = store.delete(key);
      return Promise.resolve(had ? 1 : 0);
    }),
  };
  return { service: { client } as unknown as RedisService, client, store };
}

const KEY = 'idem:test-key-1';
const nextOf = (body: unknown): CallHandler => ({ handle: () => of(body) });

describe('IdempotencyInterceptor — in-flight / replay branches', () => {
  it('passes through unchanged when no Idempotency-Key header is present', async () => {
    const { service, client } = makeRedis();
    const interceptor = new IdempotencyInterceptor(service);
    const obs = await interceptor.intercept(makeCtx(undefined, makeRes()), nextOf('ok'));
    await expect(firstValueFrom(obs)).resolves.toBe('ok');
    expect(client.set).not.toHaveBeenCalled();
  });

  it('first request claims the key (SET NX) and executes the handler', async () => {
    const { service, client } = makeRedis();
    const interceptor = new IdempotencyInterceptor(service);
    const obs = await interceptor.intercept(makeCtx('test-key-1', makeRes()), nextOf({ ok: true }));
    await expect(firstValueFrom(obs)).resolves.toEqual({ ok: true });
    expect(client.set).toHaveBeenCalledWith(KEY, expect.any(String), 'EX', expect.any(Number), 'NX');
  });

  it('concurrent same-key + same-body while in-progress → 409 IDEMPOTENCY_KEY_IN_PROGRESS + Retry-After', async () => {
    const inProgress = JSON.stringify({ state: 'in-progress', requestHash: reqHash(BODY) });
    const { service } = makeRedis({ [KEY]: inProgress });
    const interceptor = new IdempotencyInterceptor(service);
    const res = makeRes();
    await expect(interceptor.intercept(makeCtx('test-key-1', res), nextOf('should-not-run'))).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS' },
    });
    expect(res.getHeader('Retry-After')).toBeDefined();
    // The reserved handler must NOT have run a second time.
  });

  it('rejects with ConflictException specifically for the in-progress collision', async () => {
    const inProgress = JSON.stringify({ state: 'in-progress', requestHash: reqHash(BODY) });
    const { service } = makeRedis({ [KEY]: inProgress });
    const interceptor = new IdempotencyInterceptor(service);
    await expect(interceptor.intercept(makeCtx('test-key-1', makeRes()), nextOf('x'))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('same-key + different-body → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const other = JSON.stringify({ state: 'in-progress', requestHash: reqHash({ different: 'payload' }) });
    const { service } = makeRedis({ [KEY]: other });
    const interceptor = new IdempotencyInterceptor(service);
    await expect(interceptor.intercept(makeCtx('test-key-1', makeRes()), nextOf('x'))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(interceptor.intercept(makeCtx('test-key-1', makeRes()), nextOf('x'))).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_KEY_REUSED' },
    });
  });

  it('completed request → replays the stored response (status + body + ETag + Idempotency-Replayed)', async () => {
    const done = JSON.stringify({
      state: 'done',
      requestHash: reqHash(BODY),
      status: 201,
      body: { cached: true },
      headers: { etag: 'W/"abc"' },
    });
    const { service } = makeRedis({ [KEY]: done });
    const interceptor = new IdempotencyInterceptor(service);
    const res = makeRes();
    const ranSecondTime = jest.fn();
    const next: CallHandler = { handle: () => { ranSecondTime(); return of('fresh'); } };
    const obs = await interceptor.intercept(makeCtx('test-key-1', res), next);
    await expect(firstValueFrom(obs)).resolves.toEqual({ cached: true });
    expect(ranSecondTime).not.toHaveBeenCalled(); // replay, never re-executes
    expect(res.getHeader('ETag')).toBe('W/"abc"');
    expect(res.getHeader('Idempotency-Replayed')).toBe('true');
  });
});
