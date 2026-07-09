import { BadRequestException, ConflictException } from '@nestjs/common';
import { ProfileService } from './profile.service';
import { weakEtag } from '../../lib/http/etag.util';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { AuthService } from '../auth/auth.service';
import { CryptoService } from '../../lib/crypto/crypto.service';
import type { AppConfigService } from '../../config/app-config.service';

const testCrypto = new CryptoService({ get: () => 'test_pii_key_0000000000000000000000000000' } as unknown as AppConfigService);

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

function setup(user: Record<string, unknown> | null = baseUser, updateImpl?: jest.Mock, consentGranted = false) {
  const findUnique = jest.fn().mockResolvedValue(user);
  const update = updateImpl ?? jest.fn().mockResolvedValue({ ...baseUser, updated_at: new Date('2026-06-20T00:00:00Z') });
  const consents = { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) };
  // service_credentials.updateMany: ADR-0036 §4 cascade-revoke in the deactivate tx (no-op for non-agents).
  const tx = { users: { update }, consents, service_credentials: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) } };
  const prisma = {
    users: { findUnique, update },
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const logout = jest.fn().mockResolvedValue(undefined);
  const auth = { logout } as unknown as AuthService;
  // ADR-0020: ConsentService stub — currentlyGranted returns the seeded state; record captures the write.
  const consentRecord = jest.fn().mockResolvedValue(undefined);
  const currentlyGranted = jest.fn().mockResolvedValue(consentGranted);
  const consent = { record: consentRecord, currentlyGranted } as unknown as import('./consent.service').ConsentService;
  return { svc: new ProfileService(prisma, audit, auth, testCrypto, consent), findUnique, update, record, logout, consentRecord, currentlyGranted };
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

  // ── ADR-0020: contact-channel opt-in records a CONTACT_DISTRIBUTION consent in the same tx ──
  it('opt-in (showPhone true, not yet granted) records a CONTACT_DISTRIBUTION grant + encrypts the phone', async () => {
    const { svc, update, consentRecord } = setup(baseUser, undefined, false);
    await svc.updateMe('u1', { contactPhone: '+79990001122', showPhone: true }, currentEtag);
    const data = update.mock.calls[0][0].data as Record<string, unknown>;
    expect(typeof data.contact_phone).toBe('string');
    expect(String(data.contact_phone).startsWith('enc:v1:')).toBe(true); // ADR-0019 field-encrypted
    expect(data.contact_prefs).toEqual({ show_phone: true, show_telegram: false });
    expect(consentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CONTACT_DISTRIBUTION', granted: true, source: 'PROFILE_SETTINGS', actorId: 'u1', actorPrincipalType: 'HUMAN' }),
      expect.anything(),
    );
  });

  it('turning all channels off while granted records a withdrawal (granted=false)', async () => {
    const { svc, consentRecord } = setup({ ...baseUser, contact_prefs: { show_phone: true, show_telegram: false } }, undefined, true);
    await svc.updateMe('u1', { showPhone: false }, currentEtag);
    expect(consentRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CONTACT_DISTRIBUTION', granted: false }),
      expect.anything(),
    );
  });

  it('an unrelated edit (no show_* toggles) records NO consent row', async () => {
    const { svc, consentRecord } = setup();
    await svc.updateMe('u1', { fullName: 'Bob' }, currentEtag);
    expect(consentRecord).not.toHaveBeenCalled();
  });

  it('re-affirming an already-granted channel does not append a duplicate consent row', async () => {
    const { svc, consentRecord } = setup({ ...baseUser, contact_prefs: { show_phone: true, show_telegram: false } }, undefined, true);
    await svc.updateMe('u1', { showPhone: true }, currentEtag);
    expect(consentRecord).not.toHaveBeenCalled();
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
