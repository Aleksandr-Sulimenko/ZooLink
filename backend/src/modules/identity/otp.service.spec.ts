import { createHash } from 'node:crypto';
import {
  OtpService,
  OtpCooldownError,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_SECONDS,
} from './otp.service';
import type { RedisService } from '../../lib/redis/redis.service';

const digest = (code: string) => createHash('sha256').update(code).digest('hex');

function makeOtp() {
  const client = {
    ttl: jest.fn().mockResolvedValue(-2),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    exists: jest.fn().mockResolvedValue(0),
  };
  const svc = new OtpService({ client } as unknown as RedisService);
  return { svc, client };
}

const PH = 'phone-hash-1';

describe('OtpService.issue', () => {
  it('issues a 6-digit code with the TTL window and sets a cooldown', async () => {
    const { svc, client } = makeOtp();
    const res = await svc.issue(PH);
    expect(res.code).toMatch(/^\d{6}$/);
    expect(res.expiresInSeconds).toBe(OTP_TTL_SECONDS);
    expect(client.set).toHaveBeenCalledWith(`otp:code:${PH}`, expect.any(String), 'EX', OTP_TTL_SECONDS);
    expect(client.set).toHaveBeenCalledWith(`otp:cooldown:${PH}`, '1', 'EX', expect.any(Number));
  });

  it('throws OtpCooldownError while the cooldown is active', async () => {
    const { svc, client } = makeOtp();
    client.ttl.mockResolvedValueOnce(42);
    await expect(svc.issue(PH)).rejects.toBeInstanceOf(OtpCooldownError);
  });
});

describe('OtpService.verify', () => {
  it('returns OK and clears state on a matching code', async () => {
    const { svc, client } = makeOtp();
    client.get.mockResolvedValueOnce(digest('123456'));
    await expect(svc.verify(PH, '123456')).resolves.toBe('OK');
    expect(client.del).toHaveBeenCalled();
  });

  it('returns INVALID on a wrong code and counts the attempt', async () => {
    const { svc, client } = makeOtp();
    client.get.mockResolvedValueOnce(digest('123456'));
    client.incr.mockResolvedValueOnce(2);
    await expect(svc.verify(PH, '000000')).resolves.toBe('INVALID');
    expect(client.incr).toHaveBeenCalledWith(`otp:attempts:${PH}`);
  });

  it('returns LOCKED when already locked', async () => {
    const { svc, client } = makeOtp();
    client.exists.mockResolvedValueOnce(1);
    await expect(svc.verify(PH, '123456')).resolves.toBe('LOCKED');
  });

  it('locks out once attempts reach the max', async () => {
    const { svc, client } = makeOtp();
    client.get.mockResolvedValueOnce(digest('123456'));
    client.incr.mockResolvedValueOnce(OTP_MAX_ATTEMPTS);
    await expect(svc.verify(PH, '000000')).resolves.toBe('LOCKED');
    expect(client.set).toHaveBeenCalledWith(`otp:lock:${PH}`, '1', 'EX', expect.any(Number));
  });
});
