import { ForbiddenException, HttpException } from '@nestjs/common';
import { RecoveryService } from './recovery.service';
import { OtpCooldownError, type OtpVerifyResult } from './otp.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { OtpService } from './otp.service';
import type { AuthService } from '../auth/auth.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { EmailProvider } from '../../lib/providers';

const baseUser = {
  id: 'u1',
  full_name: 'Ann',
  role: 'USER',
  principal_type: 'HUMAN',
  status: 'ACTIVE',
  city_id: null,
  email: 'ann@example.com',
  email_verified: true,
  avatar_url: null,
  preferred_language: 'ru',
  created_at: new Date('2026-06-19T00:00:00Z'),
  updated_at: new Date('2026-06-19T00:00:00Z'),
  deactivated_at: null,
  erased_at: null,
};

function setup(opts: {
  user?: Record<string, unknown> | null;
  verifyResult?: OtpVerifyResult;
  issueThrows?: Error;
} = {}) {
  const user = opts.user === undefined ? baseUser : opts.user;
  const findFirst = jest.fn().mockResolvedValue(user);
  const update = jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...baseUser, ...data }));
  const prisma = { users: { findFirst, update } } as unknown as PrismaService;
  const config = { get: jest.fn().mockReturnValue('pepper') } as unknown as AppConfigService;
  const issue = opts.issueThrows
    ? jest.fn().mockRejectedValue(opts.issueThrows)
    : jest.fn().mockResolvedValue({ code: '123456', expiresInSeconds: 300 });
  const verify = jest.fn().mockResolvedValue(opts.verifyResult ?? 'OK');
  const otp = { issue, verify } as unknown as OtpService;
  const issueSession = jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' });
  const auth = { issueSession } as unknown as AuthService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const sendEmail = jest.fn().mockResolvedValue({ accepted: true, providerMessageId: null });
  const email = { sendEmail } as unknown as EmailProvider;
  return {
    svc: new RecoveryService(prisma, config, otp, auth, audit, email),
    findFirst, update, issue, verify, issueSession, record, sendEmail,
  };
}

describe('RecoveryService.requestEmail', () => {
  it('sends an OTP and audits when a recoverable verified-email account exists', async () => {
    const { svc, issue, sendEmail, record } = setup();
    const res = await svc.requestEmail({ email: 'Ann@Example.com' });
    expect(res).toEqual({ status: 'VERIFICATION_REQUIRED', expiresInSeconds: 300 });
    expect(issue).toHaveBeenCalledWith(expect.any(String), 'recover:email');
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'ann@example.com' }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.recovery_requested' }));
  });

  it('returns 202 shape WITHOUT sending when no account matches (no enumeration)', async () => {
    const { svc, issue, sendEmail } = setup({ user: null });
    const res = await svc.requestEmail({ email: 'nobody@example.com' });
    expect(res).toEqual({ status: 'VERIFICATION_REQUIRED', expiresInSeconds: 300 });
    expect(issue).not.toHaveBeenCalled();
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('does not send for a SUSPENDED account', async () => {
    const { svc, issue } = setup({ user: { ...baseUser, status: 'SUSPENDED' } });
    await svc.requestEmail({ email: 'ann@example.com' });
    expect(issue).not.toHaveBeenCalled();
  });

  it('surfaces 429 on cooldown for a real account', async () => {
    const { svc } = setup({ issueThrows: new OtpCooldownError(42) });
    await expect(svc.requestEmail({ email: 'ann@example.com' })).rejects.toBeInstanceOf(HttpException);
  });
});

describe('RecoveryService.verifyEmail', () => {
  it('issues a session on a valid code', async () => {
    const { svc, issueSession, record } = setup({ verifyResult: 'OK' });
    const res = await svc.verifyEmail({ email: 'ann@example.com', code: '123456' });
    expect(res.accessToken).toBe('a');
    expect(issueSession).toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'identity.recovery_succeeded' }));
  });

  it('400s on an invalid code', async () => {
    const { svc } = setup({ verifyResult: 'INVALID' });
    await expect(svc.verifyEmail({ email: 'ann@example.com', code: '000000' })).rejects.toMatchObject({ status: 400 });
  });

  it('400s (not 500) when no account matches', async () => {
    const { svc, verify } = setup({ user: null });
    await expect(svc.verifyEmail({ email: 'nobody@example.com', code: '123456' })).rejects.toMatchObject({ status: 400 });
    expect(verify).not.toHaveBeenCalled();
  });

  it('429s when locked out', async () => {
    const { svc } = setup({ verifyResult: 'LOCKED' });
    await expect(svc.verifyEmail({ email: 'ann@example.com', code: '123456' })).rejects.toMatchObject({ status: 429 });
  });

  it('403s for a SUSPENDED account even with a valid code', async () => {
    const { svc } = setup({ user: { ...baseUser, status: 'SUSPENDED' }, verifyResult: 'OK' });
    await expect(svc.verifyEmail({ email: 'ann@example.com', code: '123456' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reactivates a DEACTIVATED account within grace', async () => {
    const { svc, update, issueSession } = setup({
      user: { ...baseUser, status: 'DEACTIVATED', deactivated_at: new Date() },
      verifyResult: 'OK',
    });
    const res = await svc.verifyEmail({ email: 'ann@example.com', code: '123456' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', deactivated_at: null }) }),
    );
    expect(res.accessToken).toBe('a');
    expect(issueSession).toHaveBeenCalled();
  });

  it('403s for a DEACTIVATED account past grace', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const { svc } = setup({
      user: { ...baseUser, status: 'DEACTIVATED', deactivated_at: old },
      verifyResult: 'OK',
    });
    await expect(svc.verifyEmail({ email: 'ann@example.com', code: '123456' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
