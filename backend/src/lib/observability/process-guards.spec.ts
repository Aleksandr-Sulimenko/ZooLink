import { describeRejection, installProcessGuards } from './process-guards';

/**
 * AUDIT5 §F1c / M-c2. Node 20 KILLS the process on an unhandled rejection. For a long-lived API
 * behind `restart: unless-stopped` that turns one stray rejection into a restart loop. Removing the
 * guard must turn this file RED.
 */
describe('installProcessGuards', () => {
  it('registers a handler for unhandledRejection (and only that)', () => {
    const on = jest.fn();
    installProcessGuards({ target: { on } as unknown as NodeJS.Process, log: jest.fn(), capture: jest.fn() });

    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));
    // uncaughtException is deliberately NOT handled: after one, the process state is unknown.
    const events = on.mock.calls.map((call): unknown => call[0]);
    expect(events).not.toContain('uncaughtException');
  });

  it('reports the rejection and keeps the process alive (never exits)', () => {
    const log = jest.fn();
    const capture = jest.fn();
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      const handler = installProcessGuards({
        target: { on: jest.fn() } as unknown as NodeJS.Process,
        log,
        capture,
      });

      const boom = new Error('redis is gone');
      expect(() => handler(boom)).not.toThrow();

      expect(capture).toHaveBeenCalledWith(boom);
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain('unhandledRejection');
      expect(String(log.mock.calls[0][0])).toContain('redis is gone');
      expect(exit).not.toHaveBeenCalled();
    } finally {
      exit.mockRestore();
    }
  });

  it('still logs when the error sink itself throws', () => {
    const log = jest.fn();
    const handler = installProcessGuards({
      target: { on: jest.fn() } as unknown as NodeJS.Process,
      log,
      capture: () => {
        throw new Error('sentry down');
      },
    });

    expect(() => handler(new Error('original'))).not.toThrow();
    expect(String(log.mock.calls[0][0])).toContain('original');
  });

  it('describes non-Error rejection reasons without throwing', () => {
    expect(describeRejection(new TypeError('bad'))).toBe('TypeError: bad');
    expect(describeRejection('plain string')).toBe('plain string');
    expect(describeRejection({ code: 'ECONNREFUSED' })).toContain('ECONNREFUSED');
    expect(describeRejection(undefined)).toBe('undefined');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => describeRejection(circular)).not.toThrow();
  });
});
