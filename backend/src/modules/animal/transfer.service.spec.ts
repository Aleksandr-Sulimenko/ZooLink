import {
  ConflictException,
  ForbiddenException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TransferService } from './transfer.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import { weakEtag } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { ListTransfersQueryDto } from './dto/transfer.dto';

const listQuery = (over: Partial<ListTransfersQueryDto> = {}): ListTransfersQueryDto => ({
  page: 1,
  limit: 20,
  skip: 0,
  ...over,
});

const OWNER = '11111111-1111-1111-1111-111111111111';
const RECIP = '22222222-2222-2222-2222-222222222222';
const STRANGER = '33333333-3333-3333-3333-333333333333';
const ORG = '44444444-4444-4444-4444-444444444444';
const ANIMAL = '55555555-5555-5555-5555-555555555555';
const XFER = '66666666-6666-6666-6666-666666666666';

const p = (id: string, role: AuthPrincipal['role'] = 'USER', pt: AuthPrincipal['principalType'] = 'HUMAN'): AuthPrincipal => ({
  userId: id,
  role,
  principalType: pt,
});

const UPDATED = new Date('2026-06-26T00:00:00Z');

function transferRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: XFER,
    animal_id: ANIMAL,
    from_user_id: OWNER,
    from_organization_id: null,
    to_user_id: RECIP,
    to_organization_id: null,
    initiated_by_user_id: OWNER,
    responded_by_user_id: null,
    status: 'PENDING',
    failure_reason: null,
    transfer_reason: null,
    completed_at: null,
    initiated_by_principal_type: 'HUMAN',
    responded_by_principal_type: null,
    expires_at: new Date(Date.now() + 72 * 3600_000),
    created_at: new Date('2026-06-26T00:00:00Z'),
    updated_at: UPDATED,
    ...over,
  };
}

function animalRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: ANIMAL, owner_id: OWNER, organization_id: null, ...over };
}

interface SetupOpts {
  transfer?: Record<string, unknown> | null;
  animal?: Record<string, unknown> | null;
  orgAdmin?: boolean;
  recipientUserExists?: boolean;
}

function setup(opts: SetupOpts = {}) {
  const transfer = 'transfer' in opts ? opts.transfer : transferRow();
  const animal = 'animal' in opts ? opts.animal : animalRow();

  // Mutable transfer state: guarded updateMany merges the data, findUnique reads it back (mirrors the
  // service's claim-then-reload pattern). claimCount lets a test force the TOCTOU loser (count 0).
  let current: Record<string, unknown> | null = transfer ? { ...transfer } : null;
  const otCreate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => {
    current = transferRow(args.data);
    return Promise.resolve(current);
  });
  const otUpdateMany = jest.fn().mockImplementation((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    // honour the status guard: only transition when the current row matches the where.status (if given).
    const matchesStatus = args.where.status === undefined || (current && current.status === args.where.status);
    if (current && matchesStatus) {
      current = { ...current, ...args.data };
      return Promise.resolve({ count: 1 });
    }
    return Promise.resolve({ count: 0 });
  });
  const ownership_transfers = {
    findUnique: jest.fn().mockImplementation(() => Promise.resolve(current)),
    findMany: jest.fn().mockResolvedValue(transfer ? [transfer] : []),
    count: jest.fn().mockResolvedValue(transfer ? 1 : 0),
    create: otCreate,
    updateMany: otUpdateMany,
  };
  const animals = {
    findUnique: jest.fn().mockResolvedValue(animal),
    update: jest.fn().mockResolvedValue(animal),
  };
  const animal_ownership_history = {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    create: jest.fn().mockResolvedValue({}),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const users = { findUnique: jest.fn().mockResolvedValue(opts.recipientUserExists === false ? null : { id: RECIP }) };
  const organizations = { findUnique: jest.fn().mockResolvedValue({ id: ORG }) };
  const orgFindFirst = jest.fn().mockResolvedValue(opts.orgAdmin ? { id: 'm' } : null);
  const orgFindMany = jest.fn().mockResolvedValue([]);

  const tx = { ownership_transfers, animals, animal_ownership_history, $executeRaw: jest.fn().mockResolvedValue(1) };
  const prisma = {
    ownership_transfers,
    animals,
    animal_ownership_history,
    users,
    organizations,
    organization_users: { findFirst: orgFindFirst, findMany: orgFindMany },
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const svc = new TransferService(prisma, audit);
  return { svc, ownership_transfers, animals, animal_ownership_history, users, record, orgFindFirst, tx };
}

const etagOf = (): string => weakEtag(`transfer:${XFER}`, UPDATED);

describe('TransferService', () => {
  describe('initiate (T1)', () => {
    it('creates a PENDING transfer to a user and snapshots the acting principal (INV-13)', async () => {
      const { svc, ownership_transfers, record } = setup({ transfer: null });
      const { transfer } = await svc.initiate(ANIMAL, { toUserId: RECIP }, p(OWNER));
      expect(transfer.status).toBe('PENDING');
      expect(ownership_transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ from_user_id: OWNER, to_user_id: RECIP, initiated_by_user_id: OWNER, initiated_by_principal_type: 'HUMAN' }) }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'animal.transfer_initiated' }), expect.anything());
    });

    it('snapshots an AGENT initiator (ADR-0006/0011)', async () => {
      const { svc, ownership_transfers } = setup({ transfer: null });
      await svc.initiate(ANIMAL, { toUserId: RECIP }, p(OWNER, 'ADMIN', 'AGENT'));
      expect(ownership_transfers.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ initiated_by_principal_type: 'AGENT' }) }),
      );
    });

    it('INV-3: both recipients set → 422 RECIPIENT_AMBIGUOUS', async () => {
      const { svc } = setup({ transfer: null });
      const err = await svc.initiate(ANIMAL, { toUserId: RECIP, toOrganizationId: ORG }, p(OWNER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnprocessableEntityException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'RECIPIENT_AMBIGUOUS' });
    });

    it('INV-3: neither recipient set → 422 RECIPIENT_REQUIRED', async () => {
      const { svc } = setup({ transfer: null });
      const err = await svc.initiate(ANIMAL, {}, p(OWNER)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'RECIPIENT_REQUIRED' });
    });

    it('INV-1: a non-owner initiating → 403 FORBIDDEN', async () => {
      const { svc } = setup({ transfer: null });
      await expect(svc.initiate(ANIMAL, { toUserId: RECIP }, p(STRANGER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('INV-2: recipient == current owner → 422 SELF_TRANSFER', async () => {
      const { svc } = setup({ transfer: null });
      const err = await svc.initiate(ANIMAL, { toUserId: OWNER }, p(OWNER)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'SELF_TRANSFER' });
    });

    it('recipient user must exist → 404', async () => {
      const { svc } = setup({ transfer: null, recipientUserExists: false });
      await expect(svc.initiate(ANIMAL, { toUserId: RECIP }, p(OWNER))).rejects.toBeInstanceOf(NotFoundException);
    });

    it('INV-4: second PENDING (23505 on partial-unique) → 409 TRANSFER_ALREADY_PENDING', async () => {
      const { svc, ownership_transfers } = setup({ transfer: null });
      ownership_transfers.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6', meta: { target: 'uq_owntransfer_one_pending' } }),
      );
      const err = await svc.initiate(ANIMAL, { toUserId: RECIP }, p(OWNER)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'TRANSFER_ALREADY_PENDING' });
    });

    it('an org-admin USER may initiate for an org-owned animal', async () => {
      const { svc } = setup({ transfer: null, animal: animalRow({ owner_id: null, organization_id: ORG }), orgAdmin: true });
      await expect(svc.initiate(ANIMAL, { toUserId: RECIP }, p(STRANGER))).resolves.toBeDefined();
    });
  });

  describe('accept (T2)', () => {
    it('re-attributes the animal + appends history under the GUC, atomically (INV-5/INV-14)', async () => {
      const { svc, animals, animal_ownership_history, ownership_transfers, tx, record } = setup();
      const { transfer } = await svc.accept(XFER, etagOf(), p(RECIP));
      expect(transfer.status).toBe('COMPLETED');
      // GUC set inside the txn before the re-attribution.
      expect((tx as { $executeRaw: jest.Mock }).$executeRaw).toHaveBeenCalled();
      expect(animals.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ owner_id: RECIP }) }));
      expect(animal_ownership_history.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { animal_id: ANIMAL, end_date: null }, data: expect.objectContaining({ end_date: expect.any(Date) }) }),
      );
      expect(animal_ownership_history.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ owner_id: RECIP, start_date: expect.any(Date) }) }),
      );
      // The terminal transition is a status-guarded conditional update (TOCTOU single-winner).
      expect(ownership_transfers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: XFER, status: 'PENDING' },
          data: expect.objectContaining({ status: 'COMPLETED', responded_by_user_id: RECIP, responded_by_principal_type: 'HUMAN' }),
        }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'animal.transfer_accepted' }), expect.anything());
    });

    it('INV-8: a non-recipient accepting → 403', async () => {
      const { svc } = setup();
      await expect(svc.accept(XFER, etagOf(), p(STRANGER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('INV-12: missing If-Match → 428', async () => {
      const { svc } = setup();
      const err = await svc.accept(XFER, undefined, p(RECIP)).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(428);
    });

    it('INV-12: stale If-Match → 412', async () => {
      const { svc } = setup();
      const err = await svc.accept(XFER, 'W/"stale"', p(RECIP)).catch((e: unknown) => e);
      expect((err as HttpException).getStatus()).toBe(412);
    });

    it('INV-10: accept on a terminal (COMPLETED) transfer → 409 TRANSFER_NOT_PENDING', async () => {
      const { svc } = setup({ transfer: transferRow({ status: 'COMPLETED' }) });
      const err = await svc.accept(XFER, etagOf(), p(RECIP)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'TRANSFER_NOT_PENDING' });
    });

    it('INV-11: accept after expiry → CANCELLED(expired) + 409 TRANSFER_EXPIRED', async () => {
      const { svc, ownership_transfers } = setup({ transfer: transferRow({ expires_at: new Date(Date.now() - 1000) }) });
      const err = await svc.accept(XFER, etagOf(), p(RECIP)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'TRANSFER_EXPIRED' });
      // It was transitioned to CANCELLED(expired) lazily, via the status-guarded update.
      expect(ownership_transfers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: XFER, status: 'PENDING' }, data: expect.objectContaining({ status: 'CANCELLED', failure_reason: 'expired' }) }),
      );
    });

    it('TOCTOU: a racer whose guarded claim returns count 0 → 409 TRANSFER_NOT_PENDING, no re-attribution', async () => {
      const { svc, ownership_transfers, animals, animal_ownership_history } = setup();
      // Simulate the loser: the inner guarded updateMany finds 0 PENDING rows (the winner already claimed).
      ownership_transfers.updateMany.mockResolvedValueOnce({ count: 0 });
      const err = await svc.accept(XFER, etagOf(), p(RECIP)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'TRANSFER_NOT_PENDING' });
      // Critical: the irreversible writes never ran for the loser.
      expect(animals.update).not.toHaveBeenCalled();
      expect(animal_ownership_history.create).not.toHaveBeenCalled();
    });
  });

  describe('decline (T3) / cancel (T4)', () => {
    it('decline by the recipient → CANCELLED(declined) + respondedBy snapshot', async () => {
      const { svc, ownership_transfers } = setup();
      const { transfer } = await svc.decline(XFER, etagOf(), p(RECIP));
      expect(transfer.status).toBe('CANCELLED');
      expect(ownership_transfers.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: XFER, status: 'PENDING' }, data: expect.objectContaining({ status: 'CANCELLED', failure_reason: 'declined', responded_by_user_id: RECIP }) }),
      );
    });

    it('INV-9: a non-initiator cancelling → 403', async () => {
      const { svc } = setup();
      await expect(svc.cancel(XFER, etagOf(), p(STRANGER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('cancel by the initiator → CANCELLED(cancelled_by_initiator), no responder snapshot', async () => {
      const { svc, ownership_transfers } = setup();
      await svc.cancel(XFER, etagOf(), p(OWNER));
      const call = ownership_transfers.updateMany.mock.calls[0][0] as { data: Record<string, unknown> };
      expect(call.data.failure_reason).toBe('cancelled_by_initiator');
      expect(call.data.responded_by_user_id).toBeUndefined();
    });

    it('INV-10: decline on an already-CANCELLED transfer → 409', async () => {
      const { svc } = setup({ transfer: transferRow({ status: 'CANCELLED', failure_reason: 'cancelled_by_initiator' }) });
      const err = await svc.decline(XFER, etagOf(), p(RECIP)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'TRANSFER_NOT_PENDING' });
    });
  });

  describe('getById — lazy expiry & visibility', () => {
    it('a non-party USER → 403', async () => {
      const { svc } = setup();
      await expect(svc.getById(XFER, p(STRANGER))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('MODERATOR may read any transfer', async () => {
      const { svc } = setup();
      await expect(svc.getById(XFER, p(STRANGER, 'MODERATOR'))).resolves.toBeDefined();
    });

    it('a PENDING-but-expired transfer reads as CANCELLED(expired) (lazy)', async () => {
      const { svc } = setup({ transfer: transferRow({ expires_at: new Date(Date.now() - 1000) }) });
      const { transfer } = await svc.getById(XFER, p(OWNER));
      expect(transfer.status).toBe('CANCELLED');
      expect(transfer.terminalReason).toBe('expired');
    });

    it('404 when the transfer is absent', async () => {
      const { svc } = setup({ transfer: null });
      await expect(svc.getById(XFER, p(OWNER))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('list — principal-scoped', () => {
    it('role=incoming scopes to the caller as recipient', async () => {
      const { svc, ownership_transfers } = setup();
      await svc.list(listQuery({ role: 'incoming' }), p(RECIP));
      const arg = ownership_transfers.findMany.mock.calls[0][0] as { where: { OR: unknown[] } };
      expect(arg.where.OR).toEqual([{ to_user_id: RECIP }]);
    });

    it('role=initiated scopes to the caller as initiator', async () => {
      const { svc, ownership_transfers } = setup();
      await svc.list(listQuery({ role: 'initiated', status: 'PENDING' }), p(OWNER));
      const arg = ownership_transfers.findMany.mock.calls[0][0] as { where: { OR: unknown[]; status?: string } };
      expect(arg.where.OR).toEqual([{ from_user_id: OWNER }]);
      expect(arg.where.status).toBe('PENDING');
    });
  });
});
