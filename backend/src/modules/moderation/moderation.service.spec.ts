import { ConflictException, ForbiddenException, HttpException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ModerationService } from './moderation.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { AuditLogService } from '../../lib/audit/audit-log.service';
import type { FeatureToggleService } from '../../lib/feature-toggle/feature-toggle.service';
import type { AuthPrincipal } from '../../lib/auth/principal';
import type { ModerationActionDto, ModerationQueueQueryDto } from './dto/moderation.dto';

const queueQuery = (over: Partial<ModerationQueueQueryDto> = {}): ModerationQueueQueryDto => ({
  page: 1,
  limit: 20,
  skip: 0,
  ...over,
});

const MOD = '11111111-1111-1111-1111-111111111111';
const MOD2 = '22222222-2222-2222-2222-222222222222';
const SELLER = '33333333-3333-3333-3333-333333333333';
const LISTING = '44444444-4444-4444-4444-444444444444';
const DECISION = '55555555-5555-5555-5555-555555555555';

const p = (id: string, role: AuthPrincipal['role'] = 'MODERATOR', pt: AuthPrincipal['principalType'] = 'HUMAN'): AuthPrincipal => ({ userId: id, role, principalType: pt });
const future = () => new Date(Date.now() + 10 * 60_000);
const past = () => new Date(Date.now() - 60_000);

function listingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: LISTING,
    animal_id: 'a1',
    seller_id: SELLER,
    organization_id: null,
    title_localized: { en: 'L', ru: 'Л' },
    status: 'PENDING_MODERATION',
    moderation_status: 'PENDING',
    moderation_enqueued_at: new Date(Date.now() - 3600_000),
    assigned_to: null,
    locked_at: null,
    lock_expires_at: null,
    ...over,
  };
}

function decisionRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: DECISION,
    moderator_id: MOD,
    entity_type: 'LISTING',
    entity_id: LISTING,
    decision: 'APPROVED',
    reason: null,
    notes: null,
    actor_principal_type: 'HUMAN',
    actor_role: 'MODERATOR',
    supersedes_decision_id: null,
    is_human_override: false,
    created_at: new Date(),
    ...over,
  };
}

interface SetupOpts {
  listing?: Record<string, unknown> | null;
  reasonActive?: boolean;
  template?: Record<string, unknown> | null;
  superseded?: Record<string, unknown> | null;
  agentEnabled?: boolean;
  claimCount?: number;
  latestDecision?: Record<string, unknown> | null;
  orgAdmin?: boolean;
}

function setup(opts: SetupOpts = {}) {
  const listing = 'listing' in opts ? opts.listing : listingRow();
  const lUpdateMany = jest.fn().mockResolvedValue({ count: opts.claimCount ?? 1 });
  const lUpdate = jest.fn().mockResolvedValue(listing);
  const listings = {
    findUnique: jest.fn().mockResolvedValue(listing),
    findMany: jest.fn().mockResolvedValue(listing ? [listing] : []),
    updateMany: lUpdateMany,
    update: lUpdate,
  };
  const decCreate = jest.fn().mockImplementation((args: { data: Record<string, unknown> }) => Promise.resolve(decisionRow(args.data)));
  const moderation_decisions = {
    create: decCreate,
    findUnique: jest.fn().mockResolvedValue('superseded' in opts ? opts.superseded : null),
    findFirst: jest.fn().mockResolvedValue('latestDecision' in opts ? opts.latestDecision : null),
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };
  const moderation_reasons = {
    findUnique: jest.fn().mockResolvedValue(opts.reasonActive === false ? null : { code: 'poor_photos', is_active: true, description_localized: { en: 'Poor', ru: 'Плохо' }, applies_to: 'LISTING' }),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const decision_templates = {
    findFirst: jest.fn().mockResolvedValue('template' in opts ? opts.template : null),
    findMany: jest.fn().mockResolvedValue([]),
  };
  const users = { findUnique: jest.fn().mockResolvedValue({ principal_type: 'HUMAN', full_name: 'Mod' }) };
  const orgFind = jest.fn().mockResolvedValue(opts.orgAdmin ? { id: 'm' } : null);
  const tx = { moderation_decisions, listings };
  const prisma = {
    listings,
    moderation_decisions,
    moderation_reasons,
    decision_templates,
    users,
    animals: { findUnique: jest.fn().mockResolvedValue({ id: 'a1' }) },
    listing_photos: { findMany: jest.fn().mockResolvedValue([]) },
    organization_users: { findFirst: orgFind },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn().mockImplementation((cb: (t: unknown) => unknown) => cb(tx)),
  } as unknown as PrismaService;
  const record = jest.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditLogService;
  const toggles = { isEnabled: jest.fn().mockResolvedValue(opts.agentEnabled ?? false) } as unknown as FeatureToggleService;
  const svc = new ModerationService(prisma, audit, toggles);
  return { svc, listings, moderation_decisions, moderation_reasons, decision_templates, record, decCreate, lUpdate, lUpdateMany };
}

const act = (over: Partial<ModerationActionDto> = {}): ModerationActionDto => ({ listingId: LISTING, action: 'APPROVE', ...over });
// A listing the caller holds a live lock on.
const heldListing = (over: Record<string, unknown> = {}) => listingRow({ assigned_to: MOD, locked_at: new Date(), lock_expires_at: future(), ...over });

describe('ModerationService', () => {
  describe('claim — M-2/M-3', () => {
    it('claims a FREE item (guarded update count 1) and returns CLAIMED_BY_ME', async () => {
      const { svc } = setup({ listing: listingRow({ locked_at: new Date(), lock_expires_at: future() }) });
      const lock = await svc.claim(LISTING, p(MOD));
      expect(lock.lockState).toBe('CLAIMED_BY_ME');
      expect(lock.assignedTo.actorId).toBe(MOD);
    });

    it('M-2: a losing claim (count 0) → 409 ALREADY_CLAIMED with the holder', async () => {
      const { svc } = setup({ listing: listingRow({ assigned_to: MOD2, lock_expires_at: future() }), claimCount: 0 });
      const err = await svc.claim(LISTING, p(MOD)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      const body = (err as HttpException).getResponse() as { code: string; errors: { assignedTo: { actorId: string } }[] };
      expect(body.code).toBe('ALREADY_CLAIMED');
      expect(body.errors[0].assignedTo.actorId).toBe(MOD2);
    });

    it('rejects a claim on a non-PENDING listing (409 INVALID_STATE)', async () => {
      const { svc } = setup({ listing: listingRow({ status: 'ACTIVE' }) });
      await expect(svc.claim(LISTING, p(MOD))).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('release — M-4 family', () => {
    it('releases a lock the caller holds', async () => {
      const { svc, listings } = setup({ listing: heldListing() });
      await svc.release(LISTING, p(MOD));
      expect(listings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ assigned_to: null }) }));
    });

    it('is idempotent on an already-free item', async () => {
      const { svc, listings } = setup({ listing: listingRow() });
      await svc.release(LISTING, p(MOD));
      expect(listings.updateMany).not.toHaveBeenCalled();
    });

    it('409 NOT_LOCK_HOLDER when the caller is not the holder', async () => {
      const { svc } = setup({ listing: listingRow({ assigned_to: MOD2, lock_expires_at: future() }) });
      const err = await svc.release(LISTING, p(MOD)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'NOT_LOCK_HOLDER' });
    });

    it('ADMIN may release another principal’s lock', async () => {
      const { svc } = setup({ listing: listingRow({ assigned_to: MOD2, lock_expires_at: future() }) });
      await expect(svc.release(LISTING, p('admin', 'ADMIN'))).resolves.toBeUndefined();
    });
  });

  describe('action — lock gate (M-4/M-5)', () => {
    it('M-5: action on an item with no live lock → 409 ITEM_NOT_CLAIMED', async () => {
      const { svc } = setup({ listing: listingRow() });
      const err = await svc.action(act(), p(MOD)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'ITEM_NOT_CLAIMED' });
    });

    it('M-5: action on an item whose lock has expired → 409 ITEM_NOT_CLAIMED', async () => {
      const { svc } = setup({ listing: listingRow({ assigned_to: MOD, lock_expires_at: past() }) });
      const err = await svc.action(act(), p(MOD)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'ITEM_NOT_CLAIMED' });
    });

    it('M-4: action on an item locked by another principal → 409 NOT_LOCK_HOLDER', async () => {
      const { svc } = setup({ listing: listingRow({ assigned_to: MOD2, lock_expires_at: future() }) });
      const err = await svc.action(act(), p(MOD)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'NOT_LOCK_HOLDER' });
    });
  });

  describe('action — transitions + M-1 atomic + M-15 audit', () => {
    it('APPROVE → ACTIVE/APPROVED, decision appended + audited, lock released, one tx', async () => {
      const { svc, listings, decCreate, record } = setup({ listing: heldListing() });
      const out = await svc.action(act({ action: 'APPROVE' }), p(MOD));
      expect(out.decision).toBe('APPROVED');
      expect(decCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ decision: 'APPROVED', actor_principal_type: 'HUMAN', actor_role: 'MODERATOR' }) }));
      // The lifecycle flip is a status/holder/expiry-guarded updateMany (TOCTOU single-winner).
      expect(listings.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: LISTING, status: 'PENDING_MODERATION', assigned_to: MOD }),
          data: expect.objectContaining({ status: 'ACTIVE', moderation_status: 'APPROVED', assigned_to: null }),
        }),
      );
      expect(record).toHaveBeenCalledWith(expect.objectContaining({ action: 'moderation.approved' }), expect.anything());
    });

    it('REJECT → DEACTIVATED/REJECTED (reason required)', async () => {
      const { svc, listings } = setup({ listing: heldListing() });
      await svc.action(act({ action: 'REJECT', reason: 'poor_photos' }), p(MOD));
      expect(listings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DEACTIVATED', moderation_status: 'REJECTED', is_active: false }) }));
    });

    it('REQUEST_CHANGES → DRAFT/CHANGES_REQUESTED', async () => {
      const { svc, listings } = setup({ listing: heldListing() });
      await svc.action(act({ action: 'REQUEST_CHANGES', reason: 'poor_photos' }), p(MOD));
      expect(listings.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'DRAFT', moderation_status: 'CHANGES_REQUESTED' }) }));
    });

    it('M-P0: the P0 trigger RAISE (on the guarded flip) is mapped to a clean 422 (never 500)', async () => {
      const { svc, listings } = setup({ listing: heldListing() });
      listings.updateMany.mockRejectedValueOnce(new Prisma.PrismaClientUnknownRequestError('Listing x cannot be ACTIVE unless moderation_status = APPROVED', { clientVersion: '6' }));
      await expect(svc.action(act({ action: 'APPROVE' }), p(MOD))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('N1 TOCTOU loser: the guarded flip returns count 0 → 409, and NO decision / NO audit written', async () => {
      const { svc, listings, decCreate, record } = setup({ listing: heldListing() });
      // Pre-checks pass (1st findUnique = held), but the caller's lock expired mid-action (another
      // principal claimed+acted): the inner guarded flip finds 0 rows. The loser must roll back BEFORE
      // the decision + audit writes. The in-tx re-read (2nd findUnique) shows another live holder.
      listings.updateMany.mockResolvedValueOnce({ count: 0 });
      listings.findUnique
        .mockResolvedValueOnce(heldListing())
        .mockResolvedValueOnce({ status: 'PENDING_MODERATION', assigned_to: MOD2, lock_expires_at: future() });
      const err = await svc.action(act({ action: 'APPROVE' }), p(MOD)).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'NOT_LOCK_HOLDER' });
      expect(decCreate).not.toHaveBeenCalled(); // no orphan decision
      expect(record).not.toHaveBeenCalled(); // no audit row
    });

    it('N1 TOCTOU loser: guarded flip count 0 with no live lock → 409 ITEM_NOT_CLAIMED, writes nothing', async () => {
      const { svc, listings, decCreate, record } = setup({ listing: heldListing() });
      listings.updateMany.mockResolvedValueOnce({ count: 0 });
      listings.findUnique
        .mockResolvedValueOnce(heldListing())
        .mockResolvedValueOnce({ status: 'DRAFT', assigned_to: null, lock_expires_at: null });
      const err = await svc.action(act({ action: 'APPROVE' }), p(MOD)).catch((e: unknown) => e);
      expect((err as HttpException).getResponse()).toMatchObject({ code: 'ITEM_NOT_CLAIMED' });
      expect(decCreate).not.toHaveBeenCalled();
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe('action — reason/template (M-9/M-10)', () => {
    it('M-9: REJECT with no reason → 422', async () => {
      const { svc } = setup({ listing: heldListing() });
      await expect(svc.action(act({ action: 'REJECT' }), p(MOD))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('M-9: REJECT with an unknown reason code → 422', async () => {
      const { svc } = setup({ listing: heldListing(), reasonActive: false });
      await expect(svc.action(act({ action: 'REJECT', reason: 'nope' }), p(MOD))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('M-10: an unknown templateCode → 422', async () => {
      const { svc } = setup({ listing: heldListing(), template: null });
      await expect(svc.action(act({ action: 'REJECT', reason: 'poor_photos', templateCode: 'bad' }), p(MOD))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('M-10: a known templateCode resolves into the decision notes', async () => {
      const { svc, decCreate } = setup({ listing: heldListing(), template: { code: 'poor_photos_changes', body_localized: { en: 'Please improve photos', ru: 'Улучшите фото' }, is_active: true } });
      await svc.action(act({ action: 'REQUEST_CHANGES', reason: 'poor_photos', templateCode: 'poor_photos_changes' }), p(MOD));
      expect(decCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ notes: 'Please improve photos' }) }));
    });
  });

  describe('action — human override (M-7)', () => {
    it('writes a new override row (isHumanOverride + supersedes), never mutates the superseded', async () => {
      const { svc, decCreate } = setup({ listing: heldListing(), superseded: { id: 'old', entity_type: 'LISTING', entity_id: LISTING } });
      const out = await svc.action(act({ action: 'APPROVE', supersedesDecisionId: 'old' }), p(MOD));
      expect(out.isHumanOverride).toBe(true);
      expect(decCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ is_human_override: true, supersedes_decision_id: 'old' }) }));
    });

    it('M-7: superseding a decision on a different entity → 422', async () => {
      const { svc } = setup({ listing: heldListing(), superseded: { id: 'old', entity_type: 'LISTING', entity_id: 'other-listing' } });
      await expect(svc.action(act({ action: 'APPROVE', supersedesDecisionId: 'old' }), p(MOD))).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('M-7: an AGENT attempting an override → 403 (override is HUMAN-only)', async () => {
      const { svc } = setup({ listing: heldListing(), superseded: { id: 'old', entity_type: 'LISTING', entity_id: LISTING }, agentEnabled: true });
      await expect(svc.action(act({ action: 'APPROVE', supersedesDecisionId: 'old' }), p(MOD, 'MODERATOR', 'AGENT'))).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('action — agent-as-principal (M-8)', () => {
    it('an AGENT decision is rejected while the gate is off (403)', async () => {
      const { svc } = setup({ listing: heldListing(), agentEnabled: false });
      await expect(svc.action(act({ action: 'APPROVE' }), p(MOD, 'MODERATOR', 'AGENT'))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('with the gate ON, an AGENT decision snapshots actor_principal_type=AGENT (plumbing works)', async () => {
      const { svc, decCreate } = setup({ listing: heldListing(), agentEnabled: true });
      const out = await svc.action(act({ action: 'APPROVE' }), p(MOD, 'MODERATOR', 'AGENT'));
      expect(decCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actor_principal_type: 'AGENT' }) }));
      expect(out.actor.principalType).toBe('AGENT');
    });
  });

  describe('owner result — M-12', () => {
    it('returns the latest decision with agent-transparency to the owner', async () => {
      const { svc } = setup({ listing: listingRow(), latestDecision: decisionRow({ decision: 'REJECTED', reason: 'poor_photos', actor_principal_type: 'AGENT' }) });
      const out = await svc.getOwnerResult(LISTING, p(SELLER, 'USER'));
      expect(out?.decision).toBe('REJECTED');
      expect(out?.decidedByAgent).toBe(true);
    });

    it('M-12: a non-owner USER → 403 (no leak)', async () => {
      const { svc } = setup({ listing: listingRow(), latestDecision: decisionRow() });
      await expect(svc.getOwnerResult(LISTING, p('stranger', 'USER'))).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('MODERATOR may read any owner result', async () => {
      const { svc } = setup({ listing: listingRow(), latestDecision: decisionRow() });
      await expect(svc.getOwnerResult(LISTING, p(MOD, 'MODERATOR'))).resolves.toBeDefined();
    });

    it('returns null (→204) when there is no decision yet', async () => {
      const { svc } = setup({ listing: listingRow(), latestDecision: null });
      await expect(svc.getOwnerResult(LISTING, p(SELLER, 'USER'))).resolves.toBeNull();
    });

    it('404 when the listing does not exist', async () => {
      const { svc } = setup({ listing: null });
      await expect(svc.getOwnerResult(LISTING, p(SELLER, 'USER'))).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('queue — SLA/lock derivation (M-13)', () => {
    it('derives ESCALATED for a pet item waiting > 8h, and never transitions it', async () => {
      const { svc, listings } = setup();
      // The queue uses $queryRaw (species join) — feed a far-overdue pet row.
      const prismaQueryRaw = (svc as unknown as { prisma: { $queryRaw: jest.Mock } }).prisma.$queryRaw;
      prismaQueryRaw.mockResolvedValueOnce([
        { ...listingRow({ moderation_enqueued_at: new Date(Date.now() - 9 * 3600_000) }), market: 'pet', species_code: 'dog' },
      ]);
      const res = await svc.getQueue(queueQuery(), p(MOD));
      expect(res.items[0].slaState).toBe('ESCALATED');
      expect(res.meta.counts.bySlaState.ESCALATED).toBe(1);
      // No write path on timeout (M-13): the listing update was never called from the queue read.
      expect(listings.update).not.toHaveBeenCalled();
    });
  });
});
