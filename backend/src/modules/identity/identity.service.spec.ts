import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IdentityService } from './identity.service';
import { OtpCooldownError } from './otp.service';
import { OAuthVerificationError, type OAuthProvider } from './oauth/oauth.types';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { OtpService } from './otp.service';
import type { AuthService } from '../auth/auth.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { OAuthRegistry } from './oauth/oauth.registry';
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
  oauthResolve?: jest.Mock;
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
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const resolve = overrides.oauthResolve ?? jest.fn();
  const oauth = { resolve } as unknown as OAuthRegistry;
  const mocks = {
    create: (prisma.users as unknown as { create: jest.Mock }).create,
    update: (prisma.users as unknown as { update: jest.Mock }).update,
    issueSession: (auth as unknown as { issueSession: jest.Mock }).issueSession,
    sendSms,
    record,
    resolve,
  };
  return { svc: new IdentityService(prisma, config, otp, auth, audit, oauth, sms), mocks };
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('e', { code, clientVersion: 'test' });
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

  it('maps a unique-violation race (P2002) to 409', async () => {
    const { svc } = setup({ create: jest.fn().mockRejectedValue(prismaError('P2002')) });
    await expect(svc.registerPhone({ phone: '+79991234567', fullName: 'Ann' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('maps an unknown cityId FK error (P2003) to 400', async () => {
    const { svc } = setup({ create: jest.fn().mockRejectedValue(prismaError('P2003')) });
    await expect(
      svc.registerPhone({ phone: '+79991234567', fullName: 'Ann', cityId: 999999 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps OTP resend cooldown to 429', async () => {
    const { svc } = setup({ otpIssue: jest.fn().mockRejectedValue(new OtpCooldownError(42)) });
    await expect(svc.registerPhone({ phone: '+79991234567', fullName: 'Ann' })).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('writes an audit record on successful registration', async () => {
    const { svc, mocks } = setup({ create: jest.fn().mockResolvedValue({ id: 'u9' }) });
    await svc.registerPhone({ phone: '+79991234567', fullName: 'Ann' });
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'identity.register_initiated', entityId: 'u9' }),
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

  it('400s when no account is awaiting verification for the phone', async () => {
    const { svc } = setup({ findFirst: jest.fn().mockResolvedValue(null) });
    await expect(svc.verifyPhone({ phone: '+79991234567', code: '123456' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('409s if the account is not awaiting verification (e.g. already ACTIVE)', async () => {
    const { svc } = setup({
      findFirst: jest.fn().mockResolvedValue({ ...pending, status: 'ACTIVE' }),
    });
    await expect(svc.verifyPhone({ phone: '+79991234567', code: '123456' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

describe('IdentityService.oauthLogin', () => {
  const fakeProvider = (verify: jest.Mock): OAuthProvider =>
    ({ name: 'google', verify } as unknown as OAuthProvider);

  const activeRow = {
    id: 'u1',
    full_name: 'Bob',
    role: 'USER',
    status: 'ACTIVE',
    principal_type: 'HUMAN',
    city_id: null,
    email: null,
    email_verified: false,
    avatar_url: null,
    preferred_language: 'ru',
    created_at: new Date('2026-06-19T00:00:00Z'),
  };

  it('registers a new OAuth user (201/isNew) ACTIVE and issues a session', async () => {
    const verify = jest.fn().mockResolvedValue({ providerId: 'g-1', fullName: 'Bob' });
    const { svc, mocks } = setup({
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(activeRow),
      oauthResolve: jest.fn().mockReturnValue(fakeProvider(verify)),
    });
    const { response, isNew } = await svc.oauthLogin('google', { code: 'g-1', fullName: 'Bob' });
    expect(isNew).toBe(true);
    expect(response.user.status).toBe('ACTIVE');
    expect(mocks.issueSession).toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'identity.oauth_register' }),
    );
  });

  it('logs in an existing OAuth user (200/!isNew)', async () => {
    const verify = jest.fn().mockResolvedValue({ providerId: 'g-1' });
    const { svc, mocks } = setup({
      findFirst: jest.fn().mockResolvedValue(activeRow),
      update: jest.fn().mockResolvedValue(activeRow),
      oauthResolve: jest.fn().mockReturnValue(fakeProvider(verify)),
    });
    const { isNew } = await svc.oauthLogin('google', { code: 'g-1', fullName: 'Bob' });
    expect(isNew).toBe(false);
    expect(mocks.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'identity.oauth_login' }),
    );
  });

  it('401s when provider verification fails', async () => {
    const verify = jest.fn().mockRejectedValue(new OAuthVerificationError('bad'));
    const { svc } = setup({ oauthResolve: jest.fn().mockReturnValue(fakeProvider(verify)) });
    await expect(svc.oauthLogin('google', { code: 'x', fullName: 'Bob' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('403s when an existing OAuth account is suspended', async () => {
    const verify = jest.fn().mockResolvedValue({ providerId: 'g-1' });
    const { svc } = setup({
      findFirst: jest.fn().mockResolvedValue({ ...activeRow, status: 'SUSPENDED' }),
      oauthResolve: jest.fn().mockReturnValue(fakeProvider(verify)),
    });
    await expect(svc.oauthLogin('google', { code: 'g-1', fullName: 'Bob' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
