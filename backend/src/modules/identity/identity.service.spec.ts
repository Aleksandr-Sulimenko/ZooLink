import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { IdentityService } from './identity.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { OtpService } from './otp.service';
import type { AuthService } from '../auth/auth.service';
import type { SmsProvider } from '../../lib/providers';

function setup(overrides: {
  findFirst?: jest.Mock;
  create?: jest.Mock;
  update?: jest.Mock;
  otpIssue?: jest.Mock;
  otpVerify?: jest.Mock;
  otpAttempts?: jest.Mock;
  issueSession?: jest.Mock;
  sendSms?: jest.Mock;
} = {}) {
  const prisma = {
    users: {
      findFirst: overrides.findFirst ?? jest.fn().mockResolvedValue(null),
      create: overrides.create ?? jest.fn().mockResolvedValue({}),
      update:
        overrides.update ??
        jest.fn().mockResolvedValue({
          id: 'u1',
          full_name: 'Ann',
          role: 'USER',
          status: 'ACTIVE',
          principal_type: 'HUMAN',
          city_id: null,
          email: null,
          email_verified: false,
          avatar_url: null,
          preferred_language: 'ru',
          created_at: new Date('2026-06-19T00:00:00Z'),
        }),
    },
  } as unknown as PrismaService;
  const config = { get: () => 'p'.repeat(32) } as unknown as AppConfigService;
  const otp = {
    issue: overrides.otpIssue ?? jest.fn().mockResolvedValue({ code: '123456', expiresInSeconds: 300 }),
    verify: overrides.otpVerify ?? jest.fn().mockResolvedValue('OK'),
    attempts: overrides.otpAttempts ?? jest.fn().mockResolvedValue(1),
  } as unknown as OtpService;
  const auth = {
    issueSession:
      overrides.issueSession ?? jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
  } as unknown as AuthService;
  const sendSms = overrides.sendSms ?? jest.fn().mockResolvedValue({ accepted: true });
  const sms = { sendSms } as unknown as SmsProvider;
  const mocks = {
    create: (prisma.users as unknown as { create: jest.Mock }).create,
    update: (prisma.users as unknown as { update: jest.Mock }).update,
    issueSession: (auth as unknown as { issueSession: jest.Mock }).issueSession,
    sendSms,
  };
  return { svc: new IdentityService(prisma, config, otp, auth, sms), mocks };
}

describe('IdentityService.registerPhone', () => {
  it('creates a pending user and sends an OTP', async () => {
    const { svc, mocks } = setup();
    const res = await svc.registerPhone({ phone: '+79991234567', fullName: 'Ann' });
    expect(res).toEqual({ status: 'VERIFICATION_REQUIRED', expiresInSeconds: 300 });
    expect(mocks.create).toHaveBeenCalled();
    expect(mocks.sendSms).toHaveBeenCalledWith(expect.objectContaining({ to: '+79991234567' }));
  });

  it('409s when the phone already owns an active account', async () => {
    const { svc } = setup({ findFirst: jest.fn().mockResolvedValue({ id: 'u1', status: 'ACTIVE' }) });
    await expect(svc.registerPhone({ phone: '+79991234567', fullName: 'Ann' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rejects an invalid phone with 400', async () => {
    const { svc } = setup();
    await expect(svc.registerPhone({ phone: '123', fullName: 'Ann' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('IdentityService.verifyPhone', () => {
  const pending = { id: 'u1', status: 'PENDING_VERIFICATION', role: 'USER', principal_type: 'HUMAN' };

  it('activates the account and issues a session on a valid code', async () => {
    const { svc, mocks } = setup({ findFirst: jest.fn().mockResolvedValue(pending) });
    const res = await svc.verifyPhone({ phone: '+79991234567', code: '123456' });
    expect(res.accessToken).toBe('a');
    expect(res.user.status).toBe('ACTIVE');
    expect(mocks.issueSession).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });

  it('400s on an invalid code', async () => {
    const { svc } = setup({
      findFirst: jest.fn().mockResolvedValue(pending),
      otpVerify: jest.fn().mockResolvedValue('INVALID'),
    });
    await expect(svc.verifyPhone({ phone: '+79991234567', code: '000000' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('429s when locked out', async () => {
    const { svc } = setup({
      findFirst: jest.fn().mockResolvedValue(pending),
      otpVerify: jest.fn().mockResolvedValue('LOCKED'),
    });
    await expect(svc.verifyPhone({ phone: '+79991234567', code: '000000' })).rejects.toBeInstanceOf(
      HttpException,
    );
  });
});
