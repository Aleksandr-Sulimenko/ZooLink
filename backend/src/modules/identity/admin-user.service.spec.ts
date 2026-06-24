import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AdminUserService } from './admin-user.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { AuthService } from '../auth/auth.service';
import type { AuthPrincipal } from '../../lib/auth/principal';

const admin: AuthPrincipal = { userId: 'admin-1', role: 'ADMIN', principalType: 'HUMAN' };

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

function setup(user: Record<string, unknown> | null = baseUser, updateImpl?: jest.Mock) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const update = updateImpl ?? jest.fn().mockImplementation(({ data }) => Promise.resolve({ ...baseUser, ...data }));
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const txUpdate = jest.fn().mockResolvedValue({ ...baseUser });
  const tx = { users: { update: txUpdate }, notification_logs: { updateMany } };
  const $transaction = jest
    .fn()
    .mockImplementation((cb: (t: typeof tx) => unknown) => cb(tx));
  const prisma = {
    users: { findUnique, update },
    notification_logs: { updateMany },
    $transaction,
  } as unknown as PrismaService;
  const config = { get: jest.fn().mockReturnValue('pepper') } as unknown as AppConfigService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const logout = jest.fn().mockResolvedValue(undefined);
  const auth = { logout } as unknown as AuthService;
  return {
    svc: new AdminUserService(prisma, config, audit, auth),
    findUnique, update, updateMany, txUpdate, $transaction, record, logout,
  };
}

describe('AdminUserService.setRole', () => {
  it('changes the role, revokes sessions, and audits before/after', async () => {
    const { svc, update, logout, record } = setup();
    const res = await svc.setRole(admin, 'u1', { role: 'BREEDER' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'BREEDER' } }));
    expect(logout).toHaveBeenCalledWith('u1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'identity.role_changed', beforeData: { role: 'USER' }, afterData: { role: 'BREEDER' } }),
    );
    expect(res.role).toBe('BREEDER');
  });

  it('is a no-op (no session churn) when the role is unchanged', async () => {
    const { svc, update, logout } = setup();
    await svc.setRole(admin, 'u1', { role: 'USER' });
    expect(update).not.toHaveBeenCalled();
    expect(logout).not.toHaveBeenCalled();
  });

  it('404s for an unknown user', async () => {
    const { svc } = setup(null);
    await expect(svc.setRole(admin, 'nope', { role: 'BREEDER' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('AdminUserService.rebind', () => {
  it('rebinds a new phone (re-hashed) and revokes sessions', async () => {
    const { svc, update, logout, record } = setup();
    await svc.rebind(admin, 'u1', { newPhone: '+79991234567', reason: 'lost SIM' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ phone_hash: expect.any(String) }) }),
    );
    expect(logout).toHaveBeenCalledWith('u1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'identity.identifier_rebound' }),
    );
  });

  it('binds an oauth id', async () => {
    const { svc, update } = setup();
    await svc.rebind(admin, 'u1', { oauthProvider: 'google', oauthId: 'g-123' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { oauth_google_id: 'g-123' } }),
    );
  });

  it('clears an oauth id when clear=true', async () => {
    const { svc, update } = setup();
    await svc.rebind(admin, 'u1', { oauthProvider: 'vk', clear: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { oauth_vk_id: null } }));
  });

  it('400s when neither or both identifiers are provided', async () => {
    const { svc } = setup();
    await expect(svc.rebind(admin, 'u1', {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.rebind(admin, 'u1', { newPhone: '+79991234567', oauthProvider: 'google', oauthId: 'x' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s on an invalid phone', async () => {
    const { svc } = setup();
    await expect(svc.rebind(admin, 'u1', { newPhone: '123' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s when binding oauth without an id and without clear', async () => {
    const { svc } = setup();
    await expect(svc.rebind(admin, 'u1', { oauthProvider: 'google' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('409s when the new identifier is already taken (P2002)', async () => {
    const { Prisma } = await import('@prisma/client');
    const update = jest
      .fn()
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError('e', { code: 'P2002', clientVersion: 't' }));
    const { svc } = setup(baseUser, update);
    await expect(svc.rebind(admin, 'u1', { newPhone: '+79991234567' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('AdminUserService.erase', () => {
  it('anonymises PII, redacts notification_logs, revokes sessions, and audits user.erased', async () => {
    const { svc, txUpdate, updateMany, logout, record } = setup();
    await svc.erase(admin, 'u1');
    expect(txUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone_hash: null,
          email: null,
          full_name: '[deleted]',
          oauth_google_id: null,
          contact_phone: null,
          contact_telegram: null,
          contact_prefs: { show_phone: true, show_telegram: false },
          notification_prefs: { email: true, sms: true, promo: false },
          status: 'DEACTIVATED',
          erased_at: expect.any(Date),
        }),
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { recipient: '[erased]', content: null } }),
    );
    expect(logout).toHaveBeenCalledWith('u1');
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'user.erased', actorId: 'admin-1' }));
  });

  it('is idempotent — a no-op when already erased', async () => {
    const { svc, $transaction, record } = setup({ ...baseUser, erased_at: new Date() });
    await svc.erase(admin, 'u1');
    expect($transaction).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('404s for an unknown user', async () => {
    const { svc } = setup(null);
    await expect(svc.erase(admin, 'nope')).rejects.toBeInstanceOf(NotFoundException);
  });
});
