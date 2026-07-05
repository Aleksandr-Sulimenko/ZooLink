import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { OrgMembershipService } from '../../lib/org/org-membership.service';
import { OutboxService } from '../../lib/outbox/outbox.service';
import { type EventMarket } from '../../lib/outbox/outbox.types';
import { RedisService } from '../../lib/redis/redis.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ClaimCodeService, type ClaimRecipient } from './claim-code.service';
import {
  type ActorView,
  type ClaimCodeRequestDto,
  type ClaimCodeView,
  type ListTransfersQueryDto,
  type TransferInitiateDto,
  type TransferView,
} from './dto/transfer.dto';

/** Expiry window for a PENDING transfer (ADR-0013 OQ-2 = 72h, lazy-on-read; no worker in MVP). */
const EXPIRY_HOURS = 72;
/**
 * Per-principal, per-hour rate limits for the C5 counterparty-resolution surface (INV-C5-4). Redis
 * INCR gate, uniform with the contact-reveal limiter (listing.service) — the first hit sets the hour
 * TTL, a count over the limit → 429 `RATE_LIMITED` + `Retry-After` (from the key TTL, via the
 * problem-filter seam). Chosen over @nestjs/throttler for consistency with the established reveal
 * limiter and because our filter carries `retryAfter` → a real `Retry-After` header.
 */
const RATE_WINDOW_SEC = 3600;
const CLAIM_MINT_LIMIT_PER_HOUR = 10;
const INITIATE_LIMIT_PER_HOUR = 20;
/**
 * Audit actor label for a system-initiated act (lazy expiry has no human actor). 'system' is the
 * documented sentinel role for platform-initiated actions (it is NOT a user-role-canon value, so it
 * never collides with USER/MODERATOR/ADMIN/etc.); paired with principalType AGENT to align with the
 * agent-as-principal model (ADR-0006/0011) — a non-human principal performed it.
 */
const SYSTEM_ACTOR_ROLE = 'system';
/** Terminal reasons stored in `failure_reason` (mapped to the contract `terminalReason`). */
type TerminalReason = 'declined' | 'cancelled_by_initiator' | 'expired';

/** A raw `ownership_transfers` row, narrowed to the columns this slice reads. */
interface TransferRow {
  id: string;
  animal_id: string;
  from_user_id: string | null;
  from_organization_id: string | null;
  to_user_id: string | null;
  to_organization_id: string | null;
  initiated_by_user_id: string | null;
  responded_by_user_id: string | null;
  status: string;
  failure_reason: string | null;
  transfer_reason: string | null;
  completed_at: Date | null;
  initiated_by_principal_type: string;
  responded_by_principal_type: string | null;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface AnimalOwnerRow {
  id: string;
  owner_id: string | null;
  organization_id: string | null;
}

/**
 * Ownership-transfer service (transfers-api.yaml, ADR-0013; INV-1..INV-14 in 02-animal-domain.md
 * round-6). MVP simplified direct flow: PENDING → {COMPLETED | CANCELLED}. Reuses the platform
 * foundation (RFC7807, pagination, ETag/If-Match, agent-as-principal audit). The accept path is the
 * single GUC transaction that re-attributes the animal + appends history, atomically (INV-5/INV-14).
 */
@Injectable()
export class TransferService {
  private readonly logger = new Logger(TransferService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly orgMembership: OrgMembershipService,
    private readonly redis: RedisService,
    private readonly claimCodes: ClaimCodeService,
    private readonly outbox: OutboxService,
  ) {}

  // ── Mint claim code (C5, recipient opt-in) ───────────────────────────────────────────────────
  /**
   * Mint a single-use transfer claim code (transfers-api.yaml `mintTransferClaimCode`). The caller is
   * nominated as the recipient user; if `forOrganizationId` is set the caller MUST be that org's
   * admin (else 403) and the code nominates the org instead. Rate-limited per principal (INV-C5-4).
   * The plaintext code is returned ONCE.
   */
  async mintClaimCode(dto: ClaimCodeRequestDto, actor: AuthPrincipal): Promise<ClaimCodeView> {
    await this.enforceRateLimit(`transfer-claim-mint:${actor.userId}`, CLAIM_MINT_LIMIT_PER_HOUR);

    let recipient: ClaimRecipient;
    if (dto.forOrganizationId) {
      // Least-privilege: minting an ORG code requires an actual org-admin membership — a platform
      // ADMIN is NOT implicitly an admin of an arbitrary org (the code is the org's opt-in to receive).
      if (!(await this.orgMembership.isOrgAdmin(actor.userId, dto.forOrganizationId))) {
        throw new ForbiddenException({ message: 'Only an org-admin may mint a claim code for this organization', code: 'FORBIDDEN' });
      }
      recipient = { recipientOrganizationId: dto.forOrganizationId };
    } else {
      recipient = { recipientUserId: actor.userId };
    }

    const minted = await this.claimCodes.mint(recipient);
    this.logger.log(`Claim code minted (recipientType=${minted.recipientType}) by ${actor.userId}`);
    return {
      code: minted.code,
      expiresAt: new Date(Date.now() + minted.expiresInSeconds * 1000).toISOString(),
      recipientType: minted.recipientType,
    };
  }

  // ── Initiate (T1) ────────────────────────────────────────────────────────────────────────────
  async initiate(
    animalId: string,
    dto: TransferInitiateDto,
    actor: AuthPrincipal,
  ): Promise<{ transfer: TransferView; etag: string }> {
    // INV-3 / INV-C5 (recipient exactly-one-of), service-layer, before the DB CHECK. Three
    // mutually-exclusive selectors now (C5): claimCode / toUserId / toOrganizationId.
    const selectorCount = [dto.claimCode, dto.toUserId, dto.toOrganizationId].filter((v) => v != null).length;
    if (selectorCount > 1) {
      throw new UnprocessableEntityException({ message: 'Specify exactly one of claimCode, toUserId or toOrganizationId', code: 'RECIPIENT_AMBIGUOUS' });
    }
    if (selectorCount === 0) {
      throw new UnprocessableEntityException({ message: 'A recipient (claimCode, toUserId or toOrganizationId) is required', code: 'RECIPIENT_REQUIRED' });
    }

    // INV-C5-4: rate-limit initiate per principal (also throttles the raw-UUID 404 enumeration probe).
    await this.enforceRateLimit(`transfer-initiate:${actor.userId}`, INITIATE_LIMIT_PER_HOUR);

    const animal = await this.loadAnimalOwner(animalId);

    // INV-1: only the current owner (or org-admin of the owning org) may initiate. Checked BEFORE
    // consuming any claim code so a non-owner can neither burn a recipient's code nor probe codes.
    await this.assertIsCurrentOwner(actor, animal);

    // Resolve the recipient to a concrete user/org (C5 resolution order).
    let toUserId: string | null = null;
    let toOrganizationId: string | null = null;
    if (dto.claimCode != null) {
      // INV-C5-6: atomic single-use consume. INV-C5-1: every failure mode (nonexistent / expired /
      // consumed / malformed) is one uniform 422 — no existence oracle, no per-mode message/timing.
      const resolved = await this.claimCodes.consume(dto.claimCode);
      if (!resolved) {
        throw new UnprocessableEntityException({ message: 'The transfer claim code is invalid or has expired', code: 'TRANSFER_CLAIM_CODE_INVALID' });
      }
      toUserId = resolved.recipientUserId ?? null;
      toOrganizationId = resolved.recipientOrganizationId ?? null;
    } else if (dto.toUserId != null) {
      const u = await this.prisma.users.findUnique({ where: { id: dto.toUserId }, select: { id: true } });
      // INV-C5-2: generic 404 — does NOT reveal user-vs-org nor exists-vs-absent (closes AUDIT3 MINOR).
      if (!u) throw new NotFoundException({ message: 'Recipient not found', code: 'RECIPIENT_NOT_FOUND' });
      toUserId = dto.toUserId;
    } else {
      const o = await this.prisma.organizations.findUnique({ where: { id: dto.toOrganizationId }, select: { id: true } });
      if (!o) throw new NotFoundException({ message: 'Recipient not found', code: 'RECIPIENT_NOT_FOUND' });
      toOrganizationId = dto.toOrganizationId ?? null;
    }

    // INV-2 / INV-C5-5: recipient ≠ current owner (no self-transfer) — re-checked AFTER resolution.
    if (
      (toUserId && animal.owner_id === toUserId) ||
      (toOrganizationId && animal.organization_id === toOrganizationId)
    ) {
      throw new UnprocessableEntityException({ message: 'Cannot transfer an animal to its current owner', code: 'SELF_TRANSFER' });
    }

    const data: Prisma.ownership_transfersUncheckedCreateInput = {
      animal_id: animalId,
      from_user_id: animal.owner_id,
      from_organization_id: animal.organization_id,
      to_user_id: toUserId,
      to_organization_id: toOrganizationId,
      status: 'PENDING',
      transfer_reason: dto.transferReason ?? null,
      initiated_by_user_id: actor.userId,
      initiated_by_principal_type: actor.principalType,
      expires_at: new Date(Date.now() + EXPIRY_HOURS * 3600_000),
    };

    const market = await this.marketOfAnimal(animalId);
    const row = await this.mapWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const created = (await tx.ownership_transfers.create({ data })) as unknown as TransferRow;
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'animal.transfer_initiated',
            entityType: 'ownership_transfer',
            entityId: created.id,
            afterData: { animalId, toUserId: data.to_user_id, toOrganizationId: data.to_organization_id },
          },
          tx,
        );
        // Event seam (ADR-0021 §5, event-catalog §2) — emitted in the SAME tx as the state change so the
        // outbox row is atomic with it. Consumed by NotificationConsumer → notify the TO-party.
        await this.publishTransferEvent(tx, 'OwnershipTransfer.Initiated', created, market);
        return created;
      }),
    );

    this.logger.log(`Transfer ${row.id} initiated for animal ${animalId} by ${actor.userId}`);
    return { transfer: this.toView(row), etag: this.etag(row) };
  }

  // ── Read one (lazy-expires) ──────────────────────────────────────────────────────────────────
  async getById(transferId: string, actor: AuthPrincipal): Promise<{ transfer: TransferView; etag: string }> {
    let row = await this.loadOrThrow(transferId);
    await this.assertCanView(actor, row);
    row = await this.expireIfDue(row);
    return { transfer: this.toView(row), etag: this.etag(row) };
  }

  // ── Accept (T2) — the single GUC transaction ─────────────────────────────────────────────────
  async accept(
    transferId: string,
    ifMatch: string | undefined,
    actor: AuthPrincipal,
  ): Promise<{ transfer: TransferView; etag: string }> {
    let row = await this.loadOrThrow(transferId);
    await this.assertIsRecipient(actor, row);
    assertIfMatch(ifMatch, this.etag(row));

    // Lazy expiry (INV-11): a PENDING transfer past expiresAt → CANCELLED(expired); assertPending then
    // raises 409 TRANSFER_EXPIRED for that case, or 409 TRANSFER_NOT_PENDING for any other terminal state
    // (INV-10).
    row = await this.expireIfDue(row);
    this.assertPending(row);

    const market = await this.marketOfAnimal(row.animal_id);
    const completed = await this.mapWrite(() =>
      this.prisma.$transaction(async (tx) => {
        // INV-6: re-attribution is permitted only under the controlled GUC (set transaction-local).
        await tx.$executeRaw`SELECT set_config('app.ownership_transfer', 'on', true)`;

        // TOCTOU guard (INV-10/INV-14): the pre-tx assertPending ran outside this transaction, so two
        // ms-concurrent accepts with the same valid ETag could both reach here. Claim the transition
        // with a status-guarded conditional update FIRST — only one of the racers gets count===1; the
        // loser sees 0 → 409 TRANSFER_NOT_PENDING and its tx rolls back BEFORE any re-attribution or
        // history append. This makes the irreversible ownership-trail write single-winner.
        const claim = await tx.ownership_transfers.updateMany({
          where: { id: transferId, status: 'PENDING' },
          data: {
            status: 'COMPLETED',
            completed_at: new Date(),
            responded_by_user_id: actor.userId,
            responded_by_principal_type: actor.principalType,
            updated_at: new Date(),
          },
        });
        if (claim.count !== 1) {
          throw new ConflictException({ message: 'Transfer is no longer pending', code: 'TRANSFER_NOT_PENDING' });
        }

        const animal = await tx.animals.findUnique({
          where: { id: row.animal_id },
          select: { id: true, owner_id: true, organization_id: true },
        });
        if (!animal) throw new NotFoundException({ message: 'Animal not found', code: 'NOT_FOUND' });

        const today = new Date();
        const todayDate = new Date(`${today.toISOString().slice(0, 10)}T00:00:00.000Z`);

        // Re-attribute the animal (INV-5).
        await tx.animals.update({
          where: { id: row.animal_id },
          data: {
            owner_id: row.to_user_id,
            organization_id: row.to_organization_id,
            owned_since: todayDate,
            updated_at: today,
          },
        });

        // Close the prior open interval (INV-14: exactly one open interval is closed).
        await tx.animal_ownership_history.updateMany({
          where: { animal_id: row.animal_id, end_date: null },
          data: { end_date: todayDate },
        });
        // Open the new interval for the recipient.
        await tx.animal_ownership_history.create({
          data: {
            animal_id: row.animal_id,
            owner_id: row.to_user_id,
            organization_id: row.to_organization_id,
            start_date: todayDate,
            transfer_reason: row.transfer_reason,
          },
        });

        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'animal.transfer_accepted',
            entityType: 'ownership_transfer',
            entityId: transferId,
            beforeData: { animalId: row.animal_id, owner_id: animal.owner_id, organization_id: animal.organization_id },
            afterData: { owner_id: row.to_user_id, organization_id: row.to_organization_id },
          },
          tx,
        );

        // Event seam (ADR-0021 §5) — notify the FROM-party (initiator) that the recipient accepted.
        await this.publishTransferEvent(tx, 'OwnershipTransfer.Accepted', row, market);

        const updated = (await tx.ownership_transfers.findUnique({ where: { id: transferId } })) as unknown as TransferRow;
        return updated;
      }),
    );

    this.logger.log(`Transfer ${transferId} accepted (animal ${row.animal_id} re-attributed) by ${actor.userId}`);
    return { transfer: this.toView(completed), etag: this.etag(completed) };
  }

  // ── Decline (T3) ─────────────────────────────────────────────────────────────────────────────
  async decline(transferId: string, ifMatch: string | undefined, actor: AuthPrincipal): Promise<{ transfer: TransferView; etag: string }> {
    let row = await this.loadOrThrow(transferId);
    await this.assertIsRecipient(actor, row);
    assertIfMatch(ifMatch, this.etag(row));
    row = await this.expireIfDue(row);
    // A decline on an already-expired transfer is a no-op equivalent (already CANCELLED) — return it.
    if (row.status === 'CANCELLED' && row.failure_reason === 'expired') {
      return { transfer: this.toView(row), etag: this.etag(row) };
    }
    this.assertPending(row);
    return this.terminate(transferId, 'declined', actor, 'animal.transfer_declined', true, row, 'OwnershipTransfer.Declined');
  }

  // ── Cancel (T4) ──────────────────────────────────────────────────────────────────────────────
  async cancel(transferId: string, ifMatch: string | undefined, actor: AuthPrincipal): Promise<{ transfer: TransferView; etag: string }> {
    let row = await this.loadOrThrow(transferId);
    await this.assertIsInitiator(actor, row);
    assertIfMatch(ifMatch, this.etag(row));
    row = await this.expireIfDue(row);
    if (row.status === 'CANCELLED' && row.failure_reason === 'expired') {
      return { transfer: this.toView(row), etag: this.etag(row) };
    }
    this.assertPending(row);
    return this.terminate(transferId, 'cancelled_by_initiator', actor, 'animal.transfer_cancelled', false, row, 'OwnershipTransfer.Cancelled');
  }

  // ── List (principal-scoped) ──────────────────────────────────────────────────────────────────
  async list(query: ListTransfersQueryDto, actor: AuthPrincipal): Promise<Paginated<TransferView>> {
    const orgIds = await this.orgMembership.orgAdminIds(actor.userId);
    const where: Prisma.ownership_transfersWhereInput = {};
    if (query.role === 'initiated') {
      where.OR = [{ from_user_id: actor.userId }, ...(orgIds.length ? [{ from_organization_id: { in: orgIds } }] : [])];
    } else {
      // 'incoming'
      where.OR = [{ to_user_id: actor.userId }, ...(orgIds.length ? [{ to_organization_id: { in: orgIds } }] : [])];
    }
    if (query.status) where.status = query.status;
    if (query.animalId) where.animal_id = query.animalId;

    const { field, dir } = this.parseSort(query.sort);
    const [rows, total] = await Promise.all([
      this.prisma.ownership_transfers.findMany({
        where,
        orderBy: [{ [field]: dir }, { id: dir }],
        skip: query.skip,
        take: query.limit,
      }) as unknown as Promise<TransferRow[]>,
      this.prisma.ownership_transfers.count({ where }),
    ]);
    // Surface lazy expiry in the projection only (no write per row on a list read).
    const items = rows.map((r) => this.toView(this.projectExpiry(r)));
    return paginate(items, total, query.page, query.limit);
  }

  // ── Ownership history (existing endpoint, kept) ──────────────────────────────────────────────
  async ownershipHistory(
    animalId: string,
    actor: AuthPrincipal,
    page: number,
    limit: number,
  ): Promise<Paginated<{
    id: string;
    animalId: string;
    ownerId: string | null;
    organizationId: string | null;
    startDate: string;
    endDate: string | null;
    transferReason: string | null;
    createdAt: Date;
  }>> {
    const animal = await this.loadAnimalOwner(animalId);
    await this.assertCanViewAnimal(actor, animal);
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      this.prisma.animal_ownership_history.findMany({
        where: { animal_id: animalId },
        orderBy: [{ start_date: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.animal_ownership_history.count({ where: { animal_id: animalId } }),
    ]);
    const items = rows.map((r) => ({
      id: r.id,
      animalId: r.animal_id,
      ownerId: r.owner_id,
      organizationId: r.organization_id,
      startDate: this.dateStr(r.start_date) as string,
      endDate: this.dateStr(r.end_date),
      transferReason: r.transfer_reason,
      createdAt: r.created_at,
    }));
    return paginate(items, total, page, limit);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  private async terminate(
    transferId: string,
    reason: TerminalReason,
    actor: AuthPrincipal,
    auditAction: string,
    recordResponder: boolean,
    transferRow: TransferRow,
    eventType: 'OwnershipTransfer.Declined' | 'OwnershipTransfer.Cancelled',
  ): Promise<{ transfer: TransferView; etag: string }> {
    const market = await this.marketOfAnimal(transferRow.animal_id);
    const row = await this.mapWrite(() =>
      this.prisma.$transaction(async (tx) => {
        // Status-guarded conditional transition (uniform with accept): only one racer claims PENDING.
        const claim = await tx.ownership_transfers.updateMany({
          where: { id: transferId, status: 'PENDING' },
          data: {
            status: 'CANCELLED',
            failure_reason: reason,
            updated_at: new Date(),
            ...(recordResponder
              ? { responded_by_user_id: actor.userId, responded_by_principal_type: actor.principalType }
              : {}),
          },
        });
        if (claim.count !== 1) {
          throw new ConflictException({ message: 'Transfer is no longer pending', code: 'TRANSFER_NOT_PENDING' });
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: auditAction,
            entityType: 'ownership_transfer',
            entityId: transferId,
            afterData: { status: 'CANCELLED', terminalReason: reason },
          },
          tx,
        );
        // Event seam (ADR-0021 §5) — decline → notify the FROM-party; cancel → notify the TO-party.
        await this.publishTransferEvent(tx, eventType, transferRow, market);
        return (await tx.ownership_transfers.findUnique({ where: { id: transferId } })) as unknown as TransferRow;
      }),
    );
    this.logger.log(`Transfer ${transferId} → CANCELLED(${reason}) by ${actor.userId}`);
    return { transfer: this.toView(row), etag: this.etag(row) };
  }

  /** Lazy expiry (INV-11/T5): a PENDING transfer past expiresAt is transitioned to CANCELLED(expired). */
  private async expireIfDue(row: TransferRow): Promise<TransferRow> {
    if (row.status !== 'PENDING' || !row.expires_at || row.expires_at.getTime() > Date.now()) return row;
    const market = await this.marketOfAnimal(row.animal_id);
    return this.mapWrite(() =>
      this.prisma.$transaction(async (tx) => {
        // Status-guarded (uniform with accept/terminate): if a concurrent action already moved it off
        // PENDING, this expiry is a benign no-op — re-read and return the current row (no second audit).
        const claim = await tx.ownership_transfers.updateMany({
          where: { id: row.id, status: 'PENDING' },
          data: { status: 'CANCELLED', failure_reason: 'expired', updated_at: new Date() },
        });
        if (claim.count === 1) {
          await this.audit.record(
            {
              actorId: null,
              actorRole: SYSTEM_ACTOR_ROLE,
              actorPrincipalType: 'AGENT',
              action: 'animal.transfer_expired',
              entityType: 'ownership_transfer',
              entityId: row.id,
              afterData: { status: 'CANCELLED', terminalReason: 'expired' },
            },
            tx,
          );
          // Event seam (ADR-0021 §5) — system expiry (no human actor) → notify BOTH parties. Emitted
          // only on the winning claim (count===1), atomically with the state change, so a concurrent
          // no-op expiry neither double-audits nor double-emits.
          await this.publishTransferEvent(tx, 'OwnershipTransfer.Expired', row, market);
        }
        return (await tx.ownership_transfers.findUnique({ where: { id: row.id } })) as unknown as TransferRow;
      }),
    );
  }

  /** Read-only expiry projection for list reads (no per-row write). */
  private projectExpiry(row: TransferRow): TransferRow {
    if (row.status === 'PENDING' && row.expires_at && row.expires_at.getTime() <= Date.now()) {
      return { ...row, status: 'CANCELLED', failure_reason: 'expired' };
    }
    return row;
  }

  /** INV-10: only a PENDING transfer is actionable. */
  private assertPending(row: TransferRow): void {
    if (row.status !== 'PENDING') {
      if (row.status === 'CANCELLED' && row.failure_reason === 'expired') {
        throw new ConflictException({ message: 'Transfer has expired', code: 'TRANSFER_EXPIRED' });
      }
      throw new ConflictException({ message: 'Transfer is no longer pending', code: 'TRANSFER_NOT_PENDING' });
    }
  }

  private async loadOrThrow(transferId: string): Promise<TransferRow> {
    const row = (await this.prisma.ownership_transfers.findUnique({ where: { id: transferId } })) as unknown as TransferRow | null;
    if (!row) throw new NotFoundException({ message: 'Transfer not found', code: 'NOT_FOUND' });
    return row;
  }

  private async loadAnimalOwner(animalId: string): Promise<AnimalOwnerRow> {
    const animal = await this.prisma.animals.findUnique({
      where: { id: animalId },
      select: { id: true, owner_id: true, organization_id: true },
    });
    if (!animal) throw new NotFoundException({ message: 'Animal not found', code: 'NOT_FOUND' });
    return animal;
  }

  // ── authz ────────────────────────────────────────────────────────────────────────────────────

  /** INV-1: caller is the animal's current owner (owner_id==actor) or an org-admin of its owning org. */
  private async assertIsCurrentOwner(actor: AuthPrincipal, animal: AnimalOwnerRow): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (await this.orgMembership.isPartyOrOrgAdmin(actor.userId, animal.owner_id, animal.organization_id)) return;
    throw new ForbiddenException({ message: 'Only the current owner may initiate a transfer', code: 'FORBIDDEN' });
  }

  /** INV-8: caller is the named recipient (to_user_id==actor) or an org-admin of the to-org. */
  private async assertIsRecipient(actor: AuthPrincipal, row: TransferRow): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (await this.orgMembership.isPartyOrOrgAdmin(actor.userId, row.to_user_id, row.to_organization_id)) return;
    throw new ForbiddenException({ message: 'Only the named recipient may accept or decline', code: 'FORBIDDEN' });
  }

  /** INV-9: caller is the initiator (from_user_id==actor) or an org-admin of the from-org. */
  private async assertIsInitiator(actor: AuthPrincipal, row: TransferRow): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (await this.orgMembership.isPartyOrOrgAdmin(actor.userId, row.from_user_id, row.from_organization_id)) return;
    throw new ForbiddenException({ message: 'Only the initiator may cancel', code: 'FORBIDDEN' });
  }

  /** Read visibility: initiator, recipient, an org-admin of either party org, or MODERATOR/ADMIN. */
  private async assertCanView(actor: AuthPrincipal, row: TransferRow): Promise<void> {
    if (actor.role === 'MODERATOR' || actor.role === 'ADMIN') return;
    if (row.from_user_id === actor.userId || row.to_user_id === actor.userId) return;
    for (const org of [row.from_organization_id, row.to_organization_id]) {
      if (org && (await this.orgMembership.isOrgAdmin(actor.userId, org))) return;
    }
    throw new ForbiddenException({ message: 'Not a party to this transfer', code: 'FORBIDDEN' });
  }

  /** Ownership-history read visibility: current owner / owning-org admin / MODERATOR / ADMIN. */
  private async assertCanViewAnimal(actor: AuthPrincipal, animal: AnimalOwnerRow): Promise<void> {
    if (actor.role === 'MODERATOR' || actor.role === 'ADMIN') return;
    if (await this.orgMembership.isPartyOrOrgAdmin(actor.userId, animal.owner_id, animal.organization_id)) return;
    throw new ForbiddenException({ message: 'Not permitted to view this animal’s ownership history', code: 'FORBIDDEN' });
  }

  // ── error mapping / projection ───────────────────────────────────────────────────────────────

  /** Map DB integrity failures to clean RFC7807 4xx — never a 500. */
  private async mapWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      // 23505 on the partial-unique PENDING index → a second active PENDING (INV-4).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException({ message: 'An active transfer already exists for this animal', code: 'TRANSFER_ALREADY_PENDING' });
      }
      if (
        (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) &&
        /uq_owntransfer_one_pending/i.test(err.message)
      ) {
        throw new ConflictException({ message: 'An active transfer already exists for this animal', code: 'TRANSFER_ALREADY_PENDING' });
      }
      if (
        (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) &&
        /chk_owntransfer_(from|to)_party|chk_aoh_owner_party/i.test(err.message)
      ) {
        throw new UnprocessableEntityException({ message: 'Exactly one of user/organization must be set', code: 'RECIPIENT_AMBIGUOUS' });
      }
      throw err;
    }
  }

  /**
   * Per-principal, per-hour Redis-INCR rate limit (INV-C5-4), uniform with the contact-reveal
   * limiter. The first hit sets the hour TTL; a count over `limit` → 429 `RATE_LIMITED` with
   * `retryAfter` (the key TTL) — the problem filter renders it as the `Retry-After` header.
   */
  private async enforceRateLimit(key: string, limit: number): Promise<void> {
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, RATE_WINDOW_SEC);
    }
    if (count > limit) {
      const ttl = await this.redis.client.ttl(key);
      const retryAfter = ttl > 0 ? ttl : RATE_WINDOW_SEC;
      throw new HttpException(
        { message: 'Rate limit reached; retry later', code: 'RATE_LIMITED', retryAfter },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Publish an ownership-transfer lifecycle event into the outbox, in the CALLER'S transaction (atomic
   * with the state change). The payload carries both party identities (user AND org, either side) so the
   * notification consumer's registry can resolve "the other party" without a cross-aggregate join
   * (ADR-0018) — org recipients fan out via OrgMembershipService at delivery time. `market` (ADR-0002)
   * is stamped so the event stream stays market-attributable.
   */
  private publishTransferEvent(
    tx: Prisma.TransactionClient,
    eventType: string,
    row: TransferRow,
    market: EventMarket,
  ): Promise<unknown> {
    return this.outbox.publish(tx, {
      aggregateType: 'OwnershipTransfer',
      aggregateId: row.id,
      eventType,
      schemaVersion: 1,
      market,
      payload: {
        transferId: row.id,
        animalId: row.animal_id,
        fromUserId: row.from_user_id,
        fromOrganizationId: row.from_organization_id,
        toUserId: row.to_user_id,
        toOrganizationId: row.to_organization_id,
      },
    });
  }

  /** Resolve the ADR-0002 market of a transfer from its animal's species (pet|livestock|null). */
  private async marketOfAnimal(animalId: string): Promise<EventMarket> {
    const rows = await this.prisma.$queryRaw<{ market: string }[]>`
      SELECT s.market FROM animals a JOIN species s ON s.id = a.species_id WHERE a.id = ${animalId}::uuid`;
    const m = rows[0]?.market;
    return m === 'pet' || m === 'livestock' ? m : null;
  }

  private etag(row: TransferRow): string {
    return weakEtag(`transfer:${row.id}`, row.updated_at);
  }

  private dateStr(d: Date | null): string | null {
    return d ? d.toISOString().slice(0, 10) : null;
  }

  private parseSort(sort?: string): { field: 'created_at' | 'updated_at' | 'expires_at'; dir: 'asc' | 'desc' } {
    const allowed = new Set(['created_at', 'updated_at', 'expires_at']);
    if (sort) {
      const [f, d] = sort.split(':');
      if (allowed.has(f)) {
        return { field: f as 'created_at', dir: d === 'asc' ? 'asc' : 'desc' };
      }
    }
    return { field: 'created_at', dir: 'desc' };
  }

  private actor(userId: string | null, principalType: string | null): ActorView | null {
    if (!userId) return null;
    return { actorId: userId, principalType: (principalType as ActorView['principalType']) ?? 'HUMAN', actorDisplayName: null };
  }

  private toView(row: TransferRow): TransferView {
    const status = row.status as TransferView['status'];
    const terminalReason = status === 'CANCELLED' ? ((row.failure_reason as TransferView['terminalReason']) ?? null) : null;
    return {
      id: row.id,
      animalId: row.animal_id,
      fromUserId: row.from_user_id,
      fromOrganizationId: row.from_organization_id,
      toUserId: row.to_user_id,
      toOrganizationId: row.to_organization_id,
      status,
      terminalReason,
      transferReason: row.transfer_reason,
      initiatedBy: this.actor(row.initiated_by_user_id, row.initiated_by_principal_type) ?? {
        // Pre-0023 rows (none in MVP) may lack initiated_by_user_id; fall back to the from-party user.
        actorId: row.initiated_by_user_id ?? row.from_user_id ?? '',
        principalType: (row.initiated_by_principal_type as ActorView['principalType']) ?? 'HUMAN',
        actorDisplayName: null,
      },
      respondedBy: this.actor(row.responded_by_user_id, row.responded_by_principal_type),
      expiresAt: row.expires_at as Date,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
