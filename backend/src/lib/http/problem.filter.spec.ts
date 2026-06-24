import { BadRequestException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { ProblemExceptionFilter } from './problem.filter';
import { ProviderError } from '../providers/provider-error';

function makeHost() {
  const json = jest.fn();
  const setHeader = jest.fn().mockReturnThis();
  const status = jest.fn().mockReturnValue({ setHeader, json });
  const res = { status, setHeader, json, getHeader: jest.fn().mockReturnValue('req-123') };
  const req = { method: 'GET', originalUrl: '/v1/listings' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  // status() returns the object holding setHeader/json:
  status.mockReturnValue({ setHeader: setHeader.mockReturnThis(), json });
  return { host, status, json };
}

describe('ProblemExceptionFilter', () => {
  it('maps a ProviderError to 503 UPSTREAM_UNAVAILABLE without leaking the provider message', () => {
    const { host, status, json } = makeHost();
    const filter = new ProblemExceptionFilter();

    filter.catch(
      new ProviderError('smsru', 'http', 'HTTP 500 secret-token=abc123 leaked body'),
      host,
    );

    expect(status).toHaveBeenCalledWith(503);
    const body = json.mock.calls[0][0] as { code: string; detail: string; status: number };
    expect(body.status).toBe(503);
    expect(body.code).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.detail).not.toContain('secret-token');
    expect(body.detail).not.toContain('abc123');
    expect(body.detail).toMatch(/upstream service/i);
  });

  it('still maps HttpExceptions normally (regression guard)', () => {
    const { host, status, json } = makeHost();
    const filter = new ProblemExceptionFilter();

    filter.catch(new BadRequestException({ message: 'bad', code: 'VALIDATION_ERROR' }), host);

    expect(status).toHaveBeenCalledWith(400);
    const body = json.mock.calls[0][0] as { code: string; detail: string };
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.detail).toBe('bad');
  });
});
