import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { weakEtag } from '../../lib/http/etag.util';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { AuthService } from '../auth/auth.service';

const baseUser = {
  id: 'u1',
  full_name: 'Ann',
  role: 'USER',
  status: 'ACTIVE',
  city_id: null,
  email: null,
  email_verified: false,
  avatar_url: null,
  preferred_language: 'ru',
  created_at: new Date('2026-06-19T00:00:00Z'),
  updated_at: new Date('2026-06-19T00:00:00Z'),
  deactivated_at: null,
};

function setup(user: Record<string, unknown> | null = baseUser, updateImpl?: jest.Mock) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const update = updateImpl ?? jest.fn().mockResolvedValue({ ...baseUser, updated_at: new Date('2026-06-20T00:00:00Z') });
  const prisma = { users: { findUnique, update } } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const logout = jest.fn().mockResolvedValue(undefined);
  const auth = { logout } as unknown as AuthService;
  return { svc: new ProfileService(prisma, audit, auth), findUnique, update, record, logout };
}

const currentEtag = weakEtag(baseUser.id, baseUser.updated_at);

describe('ProfileService.getMe', () => {
  it('returns the profile and a weak ETag', async () => {
    const { svc } = setup();
    const { profile, etag } = await svc.getMe('u1');
    expect(profile.id).toBe('u1');
    expect(etag).toBe(currentEtag);
  });
});

describe('ProfileService.updateMe', () => {
  it('428s when If-Match is missing', async () => {
    const { svc } = setup();
    await expect(svc.updateMe('u1', { fullName: 'Bob' }, undefined)).rejects.toMatchObject({
      status: 428, // PreconditionRequired
    });
  });

  it('412s when If-Match is stale', async () => {
    const { svc } = setup();
    await expect(svc.updateMe('u1', { fullName: 'Bob' }, 'W/"stale"')).rejects.toMatchObject({
      status: 412,
    });
  });

  it('updates and returns a fresh ETag with a valid If-Match', async () => {
    const { svc, update } = setup();
    const { profile, etag } = await svc.updateMe('u1', { fullName: 'Bob', cityId: 2 }, currentEtag);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ full_name: 'Bob', city_id: 2 }) }),
    );
    expect(profile.id).toBe('u1');
    expect(etag).not.toBe(currentEtag); // updated_at changed
  });

  it('maps unknown cityId (P2003) to 400', async () => {
    const { Prisma } = await import('@prisma/client');
    const update = jest
      .fn()
      .mockRejectedValue(new Prisma.PrismaClientKnownRequestError('e', { code: 'P2003', clientVersion: 't' }));
    const { svc } = setup(baseUser, update);
    await expect(svc.updateMe('u1', { cityId: 999 }, currentEtag)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});

describe('ProfileService.deactivateMe', () => {
  it('deactivates an active account and revokes sessions', async () => {
    const { svc, update, logout } = setup();
    await svc.deactivateMe('u1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DEACTIVATED', is_active: false }) }),
    );
    expect(logout).toHaveBeenCalledWith('u1');
  });

  it('is idempotent when already deactivated', async () => {
    const { svc, update } = setup({ ...baseUser, status: 'DEACTIVATED' });
    await svc.deactivateMe('u1');
    expect(update).not.toHaveBeenCalled();
  });
});

describe('ProfileService.reactivateMe', () => {
  it('reactivates within the grace window', async () => {
    const { svc, update } = setup(
      { ...baseUser, status: 'DEACTIVATED', deactivated_at: new Date() },
      jest.fn().mockResolvedValue({ ...baseUser, status: 'ACTIVE' }),
    );
    const profile = await svc.reactivateMe('u1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE', deactivated_at: null }) }),
    );
    expect(profile.status).toBe('ACTIVE');
  });

  it('400s when the account is not deactivated', async () => {
    const { svc } = setup();
    await expect(svc.reactivateMe('u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s when the grace period has elapsed', async () => {
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    const { svc } = setup({ ...baseUser, status: 'DEACTIVATED', deactivated_at: old });
    await expect(svc.reactivateMe('u1')).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ConflictException path: deactivating from a non-active state
describe('ProfileService.deactivateMe (guard)', () => {
  it('409s when deactivating from a non-active state', async () => {
    const { svc } = setup({ ...baseUser, status: 'SUSPENDED' });
    await expect(svc.deactivateMe('u1')).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ProfileService.eraseMe', () => {
  it('deactivates an active account, revokes sessions, and records the request', async () => {
    const { svc, update, logout, record } = setup();
    await svc.eraseMe('u1');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DEACTIVATED', is_active: false }) }),
    );
    expect(logout).toHaveBeenCalledWith('u1');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'identity.erasure_requested' }),
    );
  });

  it('does not re-deactivate an already-deactivated account but still records the request', async () => {
    const { svc, update, record } = setup({ ...baseUser, status: 'DEACTIVATED', deactivated_at: new Date() });
    await svc.eraseMe('u1');
    expect(update).not.toHaveBeenCalled();
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'identity.erasure_requested' }),
    );
  });
});
