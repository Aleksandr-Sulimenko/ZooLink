/**
 * Unit tests for RefreshTokenService rotation + reuse detection (spec 01 round-4). Prisma is
 * mocked so this asserts the BRANCHING logic in isolation: a presented-but-already-revoked token
 * MUST burn the whole family (revokeFamily) and reject; a live token rotates atomically.
 * The end-to-end behavior over HTTP+PG is covered in test/auth-refresh.e2e-spec.ts.
 */
import { UnauthorizedException } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';
import { PrismaService } from '../../lib/db/prisma.service';
import { AppConfigService } from '../../config/app-config.service';

type RefreshRow = {
  id: string;
  user_id: string;
  family_id: string;
  device_label: string | null;
  revoked_at: Date | null;
  expires_at: Date;
};

describe('RefreshTokenService.rotate', () => {
  let prisma: {
    refresh_tokens: {
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: RefreshTokenService;

  beforeEach(() => {
    prisma = {
      refresh_tokens: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      // The happy path wraps revoke+create in a transaction; resolve it transparently.
      $transaction: jest.fn().mockResolvedValue([{}, {}]),
    };
    const config = { get: jest.fn().mockReturnValue('7d') } as unknown as AppConfigService;
    service = new RefreshTokenService(prisma as unknown as PrismaService, config);
  });

  it('rotates a LIVE token: revokes the presented row and issues a new one in the same family', async () => {
    const row: RefreshRow = {
      id: 'row-1',
      user_id: 'user-1',
      family_id: 'fam-1',
      device_label: 'web',
      revoked_at: null,
      expires_at: new Date(Date.now() + 60_000),
    };
    prisma.refresh_tokens.findUnique.mockResolvedValue(row);

    const result = await service.rotate('presented-token');

    expect(result.userId).toBe('user-1');
    expect(result.familyId).toBe('fam-1');
    expect(result.token).toEqual(expect.any(String));
    // The rotation ran inside a single transaction (atomic revoke-old + create-new).
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // It did NOT burn the family on the happy path.
    expect(prisma.refresh_tokens.updateMany).not.toHaveBeenCalled();
  });

  it('REUSE: a presented-but-already-revoked token burns the WHOLE family and throws 401', async () => {
    const revoked: RefreshRow = {
      id: 'row-2',
      user_id: 'user-1',
      family_id: 'fam-burn',
      device_label: null,
      revoked_at: new Date(), // already rotated/revoked → reuse/theft
      expires_at: new Date(Date.now() + 60_000),
    };
    prisma.refresh_tokens.findUnique.mockResolvedValue(revoked);

    await expect(service.rotate('stolen-token')).rejects.toMatchObject({
      response: { code: 'UNAUTHENTICATED' },
    });
    // revokeFamily was invoked for the whole family, only on still-live rows.
    expect(prisma.refresh_tokens.updateMany).toHaveBeenCalledWith({
      where: { family_id: 'fam-burn', revoked_at: null },
      data: { revoked_at: expect.any(Date) },
    });
    // No new token was minted on the reuse path.
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown token with 401 (no family touched)', async () => {
    prisma.refresh_tokens.findUnique.mockResolvedValue(null);
    await expect(service.rotate('ghost')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.refresh_tokens.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an EXPIRED (but not revoked) token with 401 without rotating', async () => {
    const expired: RefreshRow = {
      id: 'row-3',
      user_id: 'user-1',
      family_id: 'fam-old',
      device_label: null,
      revoked_at: null,
      expires_at: new Date(Date.now() - 1000), // past
    };
    prisma.refresh_tokens.findUnique.mockResolvedValue(expired);
    await expect(service.rotate('expired')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // Expiry is not theft → the family is NOT burned.
    expect(prisma.refresh_tokens.updateMany).not.toHaveBeenCalled();
  });
});
