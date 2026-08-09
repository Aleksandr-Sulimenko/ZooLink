/**
 * ADR-0017 п.6 at the PRE-BOOTSTRAP seam. main.ts calls initSentry from raw `process.env` BEFORE
 * NestFactory.create — therefore before validateEnv. So a boot-time-only residency check is not
 * enough: with a foreign DSN, Sentry would already be live when validation throws, the rejection
 * would escape `void bootstrap()`, and the process guard would hand the "invalid residency config"
 * error to Sentry.captureException — delivering it abroad. These axes prove initSentry itself
 * refuses, and that the lawful modes (sink off / self-hosted / RF) are untouched.
 *
 * The real SDK is mocked out: loading @sentry/node costs seconds, and asserting on `init` is the
 * whole point.
 */
jest.mock('@sentry/node', () => ({ init: jest.fn() }));

import * as Sentry from '@sentry/node';
import { initSentry } from './sentry';

const init = Sentry.init as jest.Mock;
const FOREIGN = 'https://publickey@o4507.ingest.sentry.io/42';

let stderr: jest.SpyInstance;

beforeEach(() => {
  init.mockClear();
  stderr = jest
    .spyOn(process.stderr, 'write')
    .mockImplementation(() => true) as jest.SpyInstance;
});

afterEach(() => {
  stderr.mockRestore();
});

describe('initSentry — error-sink residency (ADR-0017 п.6)', () => {
  it('REFUSES to initialise against a foreign ingest in production', () => {
    const started = initSentry({ SENTRY_DSN: FOREIGN, NODE_ENV: 'production' });
    expect(started).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('warns to stderr naming the HOST, never the DSN credential', () => {
    initSentry({ SENTRY_DSN: FOREIGN, NODE_ENV: 'production' });
    const written = stderr.mock.calls.map((c) => String(c[0])).join('');
    expect(written).toContain('o4507.ingest.sentry.io');
    expect(written).toContain('ADR-0017');
    expect(written).not.toContain('publickey');
  });

  it('is a no-op with an empty DSN (sink disabled — the live default)', () => {
    expect(initSentry({ SENTRY_DSN: '', NODE_ENV: 'production' })).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it.each([
    'http://key@sentry:9000/2',
    'http://key@127.0.0.1:9000/2',
    'https://key@sentry.zoolink.ru/2',
  ])('initialises normally against an allowed sink %p', (dsn) => {
    expect(initSentry({ SENTRY_DSN: dsn, NODE_ENV: 'production' })).toBe(true);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn, environment: 'production' }),
    );
  });

  it('REFUSES an unparseable DSN (fail-closed)', () => {
    expect(initSentry({ SENTRY_DSN: 'not-a-url', NODE_ENV: 'production' })).toBe(
      false,
    );
    expect(init).not.toHaveBeenCalled();
  });

  it('honours the dev bypass outside production, and IGNORES it in production', () => {
    expect(
      initSentry({
        SENTRY_DSN: FOREIGN,
        NODE_ENV: 'development',
        RESIDENCY_ALLOW_NON_RF_DEV: true,
      }),
    ).toBe(true);
    init.mockClear();
    expect(
      initSentry({
        SENTRY_DSN: FOREIGN,
        NODE_ENV: 'production',
        RESIDENCY_ALLOW_NON_RF_DEV: true,
      }),
    ).toBe(false);
    expect(init).not.toHaveBeenCalled();
  });

  it('is strict in dev WITHOUT the bypass (the flag must be explicit)', () => {
    expect(initSentry({ SENTRY_DSN: FOREIGN, NODE_ENV: 'development' })).toBe(
      false,
    );
    expect(init).not.toHaveBeenCalled();
  });
});
