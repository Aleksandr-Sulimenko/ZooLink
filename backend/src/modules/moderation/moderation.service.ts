import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { AuditLogService } from '../../lib/audit/audit-log.service';
import { FeatureToggleService } from '../../lib/feature-toggle/feature-toggle.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import type { AuthPrincipal, PrincipalType } from '../../lib/auth/principal';
import {
  ACTION_TO_DECISION,
  type ActorView,
  type DecisionTemplateView,
  type ListDecisionsQueryDto,
  type ListTemplatesQueryDto,
  type LocalizedString,
  type LockState,
  type Market,
  type ModerationActionDto,
  type ModerationDecisionValue,
  type ModerationDecisionView,
  type ModerationLockView,
  type ModerationQueueItemView,
  type ModerationQueueQueryDto,
  type ModerationReasonView,
  type OwnerModerationResultView,
  type QueueGroupCounts,
  type SlaState,
} from './dto/moderation.dto';

/** Claim lock TTL (spec 12 round-5 MOD_LOCK_TTL = 15 min). */
const MOD_LOCK_TTL_MIN = 15;
/** SLA targets in seconds (ADR-0003: pet <4h, livestock <6h). Config-owned; constants in MVP. */
const SLA_TARGET_SECONDS: Record<Market, number> = { pet: 4 * 3600, livestock: 6 * 3600 };
/** Beyond BREACH_FACTOR× the target the item is ESCALATED (to ADMIN; still PENDING — M-13, no auto-decide). */
const ESCALATE_FACTOR = 2;
/** The feature gate for AGENT decisioning (off in MVP → an AGENT decision is 403). M-8. */
const AGENT_MODERATION_TOGGLE = 'agent_moderation';

interface ListingRow {
  id: string;
  animal_id: string;
  seller_id: string;
  organization_id: string | null;
  title_localized: unknown;
  status: string;
  moderation_status: string;
  moderation_enqueued_at: Date | null;
  assigned_to: string | null;
  locked_at: Date | null;
  lock_expires_at: Date | null;
}

interface DecisionRow {
  id: string;
  moderator_id: string;
  entity_type: string;
  entity_id: string;
  decision: string;
  reason: string | null;
  notes: string | null;
  actor_principal_type: string;
  actor_role: string | null;
  supersedes_decision_id: string | null;
  is_human_override: boolean;
  created_at: Date;
}

/**
 * Moderation domain (Admin Slice 4a; moderation-api.yaml, invariants M-P0..M-13). The agent-first
 * centerpiece (ADR-0006/0011): every decision snapshots the acting principal {actorId, principalType}
 * and is fully agent-ready — an AGENT principal uses the identical contract, gated by a feature toggle
 * (off in MVP; the snapshot + transparency plumbing work now).
 *
 * Reuses the proven patterns: guarded-conditional-update concurrency (claim TOCTOU, like the transfer
 * accept), in-tx audit_log + actor snapshot, runWrite-style DB-error→4xx mapping, object-level scoping.
 */
@Injectable()
export class ModerationService {
  private readonly logger = new Logger(ModerationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly toggles: FeatureToggleService,
  ) {}

  // ── Queue ────────────────────────────────────────────────────────────────────────────────────
  async getQueue(
    query: ModerationQueueQueryDto,
    actor: AuthPrincipal,
  ): Promise<{ items: ModerationQueueItemView[]; meta: { page: number; limit: number; total: number; totalPages: number; counts: QueueGroupCounts } }> {
    // Base condition: PENDING_MODERATION, joined to species for market. lockState/slaState are derived
    // post-fetch (computed from columns), so we fetch the filtered base then refine for tab counts.
    const marketCond = query.market !== undefined ? Prisma.sql`AND s.market = ${query.market}` : Prisma.empty;
    const rows = await this.prisma.$queryRaw<(ListingRow & { market: string; species_code: string | null })[]>`
      SELECT l.id, l.animal_id, l.seller_id, l.organization_id, l.title_localized, l.status, l.moderation_status,
             l.moderation_enqueued_at, l.assigned_to, l.locked_at, l.lock_expires_at,
             s.market AS market, s.code AS species_code
      FROM listings l
      JOIN animals a ON a.id = l.animal_id
      JOIN species s ON s.id = a.species_id
      WHERE l.status = 'PENDING_MODERATION' ${marketCond}
      ORDER BY l.moderation_enqueued_at ASC NULLS LAST, l.id ASC`;

    const now = Date.now();
    let items = rows.map((r) => this.toQueueItem(r, r.market as Market, r.species_code, actor, now));

    // Derived filters (slaState / escalated / lockState) — computed, applied in memory (M-13 read-only).
    if (query.slaState !== undefined) items = items.filter((i) => i.slaState === query.slaState);
    if (query.escalated === true) items = items.filter((i) => i.slaState === 'ESCALATED');
    if (query.lockState !== undefined) items = items.filter((i) => i.lockState === query.lockState);

    // counts over the FULL filtered-by-non-tab set (before pagination).
    const counts: QueueGroupCounts = {
      byMarket: { pet: 0, livestock: 0 },
      bySlaState: { ON_TRACK: 0, BREACHED: 0, ESCALATED: 0 },
    };
    for (const i of items) {
      counts.byMarket[i.market] += 1;
      counts.bySlaState[i.slaState] += 1;
    }

    const total = items.length;
    const page = items.slice(query.skip, query.skip + query.limit);
    const paged = paginate(page, total, query.page, query.limit);
    // Contract: counts live INSIDE meta (PageMeta.counts, additive — moderation-api.yaml).
    return { items: paged.items, meta: { ...paged.meta, counts } };
  }

  async getReviewListing(id: string): Promise<{ listing: unknown; animal: unknown; photos: unknown[] }> {
    const listing = await this.prisma.listings.findUnique({ where: { id } });
    if (!listing) throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    const [animal, photos] = await Promise.all([
      this.prisma.animals.findUnique({ where: { id: listing.animal_id } }),
      this.prisma.listing_photos.findMany({ where: { listing_id: id }, orderBy: [{ order_index: 'asc' }] }),
    ]);
    return { listing, animal, photos };
  }

  // ── Claim / release (guarded single-winner, M-2/M-3) ─────────────────────────────────────────
  async claim(listingId: string, actor: AuthPrincipal): Promise<ModerationLockView> {
    const existing = await this.loadListing(listingId);
    this.assertModeratable(existing);

    const lockExpiry = new Date(Date.now() + MOD_LOCK_TTL_MIN * 60_000);
    // Guarded conditional claim (M-2): wins only when FREE, held by me, or expired. Single-winner.
    const claim = await this.prisma.listings.updateMany({
      where: {
        id: listingId,
        status: 'PENDING_MODERATION',
        OR: [{ assigned_to: null }, { assigned_to: actor.userId }, { lock_expires_at: { lt: new Date() } }],
      },
      data: { assigned_to: actor.userId, locked_at: new Date(), lock_expires_at: lockExpiry, updated_at: new Date() },
    });
    if (claim.count !== 1) {
      // Another principal holds a live lock — surface the holder (ALREADY_CLAIMED).
      const fresh = await this.loadListing(listingId);
      const holder = await this.actorOf(fresh.assigned_to);
      throw new ConflictException({
        message: 'Item already claimed by another principal',
        code: 'ALREADY_CLAIMED',
        errors: [{ assignedTo: holder, lockExpiresAt: fresh.lock_expires_at }],
      });
    }
    const row = await this.loadListing(listingId);
    this.logger.log(`Listing ${listingId} claimed by ${actor.userId}`);
    return {
      listingId,
      assignedTo: this.actorView(actor.userId, actor.principalType),
      lockedAt: row.locked_at as Date,
      lockExpiresAt: row.lock_expires_at as Date,
      lockState: 'CLAIMED_BY_ME',
    };
  }

  async release(listingId: string, actor: AuthPrincipal): Promise<void> {
    const existing = await this.loadListing(listingId);
    // Idempotent on an already-free item.
    if (existing.assigned_to === null) return;
    // Only the live-lock holder (or ADMIN) may release (M-4 family → NOT_LOCK_HOLDER).
    const live = existing.lock_expires_at !== null && existing.lock_expires_at.getTime() > Date.now();
    const isHolder = existing.assigned_to === actor.userId && live;
    if (!isHolder && actor.role !== 'ADMIN') {
      throw new ConflictException({ message: 'You do not hold the lock on this item', code: 'NOT_LOCK_HOLDER' });
    }
    // Guarded release (uniform with claim/action): scope the clear to the lock we validated, so a
    // concurrent re-claim by another principal is not clobbered. A non-ADMIN clears only their own live
    // lock; an ADMIN clears the specific holder it observed. count 0 = a concurrent change → benign
    // (release is idempotent) — no error.
    const where: Prisma.listingsWhereInput =
      actor.role === 'ADMIN'
        ? { id: listingId, assigned_to: existing.assigned_to }
        : { id: listingId, assigned_to: actor.userId, lock_expires_at: { gt: new Date() } };
    await this.prisma.listings.updateMany({
      where,
      data: { assigned_to: null, locked_at: null, lock_expires_at: null, updated_at: new Date() },
    });
    this.logger.log(`Listing ${listingId} lock released by ${actor.userId}`);
  }

  // ── Action — the heart (ONE transaction; M-1/M-P0/M-4..10) ───────────────────────────────────
  async action(dto: ModerationActionDto, actor: AuthPrincipal): Promise<ModerationDecisionView> {
    // M-8: an AGENT principal may only decide when the gate is on (off in MVP → 403). The snapshot +
    // transparency plumbing below works regardless, so an AGENT activates with only the toggle flip.
    if (actor.principalType === 'AGENT' && !(await this.toggles.isEnabled(AGENT_MODERATION_TOGGLE))) {
      throw new ForbiddenException({ message: 'AGENT moderation is not enabled', code: 'FORBIDDEN' });
    }

    const listing = await this.loadListing(dto.listingId);

    // M-4/M-5: a live lock held by the caller is required.
    const live = listing.lock_expires_at !== null && listing.lock_expires_at.getTime() > Date.now();
    if (listing.assigned_to === null || !live) {
      throw new ConflictException({ message: 'Item is not under an active claim', code: 'ITEM_NOT_CLAIMED' });
    }
    if (listing.assigned_to !== actor.userId && actor.role !== 'ADMIN') {
      throw new ConflictException({ message: 'You do not hold the lock on this item', code: 'NOT_LOCK_HOLDER' });
    }

    const decision = ACTION_TO_DECISION[dto.action];

    // M-9: reason mandatory + FK for REJECT / REQUEST_CHANGES.
    if (dto.action !== 'APPROVE') {
      if (!dto.reason) {
        throw new UnprocessableEntityException({ message: 'A reason is required for REJECT/REQUEST_CHANGES', code: 'VALIDATION_ERROR' });
      }
      const reason = await this.prisma.moderation_reasons.findUnique({ where: { code: dto.reason } });
      if (!reason || !reason.is_active) {
        throw new UnprocessableEntityException({ message: 'Unknown moderation reason code', code: 'VALIDATION_ERROR' });
      }
    }

    // M-10: templateCode optional, must resolve to a decision_templates row.
    let resolvedNotes = dto.notes ?? null;
    if (dto.templateCode) {
      const template = await this.prisma.decision_templates.findFirst({ where: { code: dto.templateCode, is_active: true } });
      if (!template) {
        throw new UnprocessableEntityException({ message: 'Unknown decision template code', code: 'VALIDATION_ERROR' });
      }
      const body = this.loc(template.body_localized);
      const templateText = body?.en || body?.ru || '';
      // Free-text notes extend/override the template body.
      resolvedNotes = dto.notes ? `${templateText}\n${dto.notes}`.trim() : templateText || null;
    }

    // M-7: human-override validation (HUMAN-only, same-entity, biconditional set at write).
    let isOverride = false;
    if (dto.supersedesDecisionId) {
      if (actor.principalType === 'AGENT') {
        throw new ForbiddenException({ message: 'Override is a HUMAN-only act', code: 'FORBIDDEN' });
      }
      const superseded = await this.prisma.moderation_decisions.findUnique({ where: { id: dto.supersedesDecisionId } });
      if (!superseded || superseded.entity_type !== 'LISTING' || superseded.entity_id !== dto.listingId) {
        throw new UnprocessableEntityException({ message: 'supersedesDecisionId must reference a decision on the same listing', code: 'VALIDATION_ERROR' });
      }
      isOverride = true;
    }

    // The flip target (M-P0: APPROVE is the only path to ACTIVE; trigger is the backstop).
    const transition = this.transitionFor(dto.action);

    const created = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        // 1. TOCTOU guard (same pattern as transfer/listing): the lock/holder check above ran OUTSIDE
        //    this tx, so the caller's lock could expire mid-action and another principal claim+act in
        //    the window. Claim the lifecycle flip FIRST with a status/holder/expiry-guarded updateMany
        //    — only the live lock-holder of a still-PENDING item wins (count===1). The loser rolls back
        //    BEFORE the decision append + audit write, so it writes nothing (no orphan decision/audit).
        const flip = await tx.listings.updateMany({
          where: {
            id: dto.listingId,
            status: 'PENDING_MODERATION',
            assigned_to: actor.userId,
            lock_expires_at: { gt: new Date() },
          },
          data: {
            status: transition.status,
            moderation_status: transition.moderationStatus,
            published_at: transition.status === 'ACTIVE' ? new Date() : null,
            is_active: transition.status !== 'DEACTIVATED',
            assigned_to: null,
            locked_at: null,
            lock_expires_at: null,
            updated_at: new Date(),
          },
        });
        if (flip.count !== 1) {
          // Re-read to surface the precise reason (lost the lock vs no live lock vs no longer pending).
          const fresh = await tx.listings.findUnique({
            where: { id: dto.listingId },
            select: { status: true, assigned_to: true, lock_expires_at: true },
          });
          const live = fresh?.lock_expires_at != null && fresh.lock_expires_at.getTime() > Date.now();
          if (fresh && fresh.assigned_to !== null && live && fresh.assigned_to !== actor.userId) {
            throw new ConflictException({ message: 'You do not hold the lock on this item', code: 'NOT_LOCK_HOLDER' });
          }
          throw new ConflictException({ message: 'Item is not under an active claim', code: 'ITEM_NOT_CLAIMED' });
        }

        // 2. Append the immutable decision (actor + principal_type snapshot, ADR-0011 §1). The P0
        //    trigger already fired on the flip above (ACTIVE backstop); reaching here means it passed.
        const row = await tx.moderation_decisions.create({
          data: {
            moderator_id: actor.userId,
            entity_type: 'LISTING',
            entity_id: dto.listingId,
            decision,
            reason: dto.action === 'APPROVE' ? null : dto.reason,
            notes: resolvedNotes,
            actor_principal_type: actor.principalType,
            actor_role: actor.role,
            supersedes_decision_id: dto.supersedesDecisionId ?? null,
            is_human_override: isOverride,
          },
        });

        // 3. Audit row, same tx (M-1 atomic).
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: `moderation.${decision.toLowerCase()}`,
            entityType: 'listing',
            entityId: dto.listingId,
            afterData: { decision, status: transition.status, isHumanOverride: isOverride },
          },
          tx,
        );
        return row;
      }),
    );

    this.logger.log(`Listing ${dto.listingId} ${decision} by ${actor.userId} (${actor.principalType})`);
    return this.toDecisionView(created);
  }

  // ── Decisions list (append-only) ─────────────────────────────────────────────────────────────
  async listDecisions(query: ListDecisionsQueryDto): Promise<Paginated<ModerationDecisionView>> {
    const where: Prisma.moderation_decisionsWhereInput = {};
    if (query.entity_type !== undefined) where.entity_type = query.entity_type;
    if (query.entity_id !== undefined) where.entity_id = query.entity_id;
    const [rows, total] = await Promise.all([
      this.prisma.moderation_decisions.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }) as unknown as Promise<DecisionRow[]>,
      this.prisma.moderation_decisions.count({ where }),
    ]);
    return paginate(rows.map((r) => this.toDecisionView(r)), total, query.page, query.limit);
  }

  // ── Reasons / templates (seeded dictionaries) ────────────────────────────────────────────────
  async listReasons(): Promise<ModerationReasonView[]> {
    const rows = await this.prisma.moderation_reasons.findMany({ where: { is_active: true }, orderBy: { code: 'asc' } });
    return rows.map((r) => ({
      code: r.code,
      descriptionLocalized: this.loc(r.description_localized),
      appliesTo: r.applies_to as 'LISTING' | 'ANIMAL' | 'ANY',
      isActive: r.is_active,
    }));
  }

  async listTemplates(query: ListTemplatesQueryDto): Promise<DecisionTemplateView[]> {
    const where: Prisma.decision_templatesWhereInput = { is_active: true };
    if (query.appliesToDecision !== undefined) where.applies_to_decision = query.appliesToDecision;
    if (query.market !== undefined) where.market = query.market;
    const rows = await this.prisma.decision_templates.findMany({ where, orderBy: [{ sort_order: 'asc' }, { code: 'asc' }] });
    return rows.map((r) => ({
      code: r.code,
      bodyLocalized: this.loc(r.body_localized),
      appliesToDecision: r.applies_to_decision as 'REJECTED' | 'CHANGES_REQUESTED' | 'ANY',
      market: (r.market as Market) ?? null,
      relatedReasonCode: r.related_reason_code,
      sortOrder: r.sort_order,
      isActive: r.is_active,
    }));
  }

  // ── Owner-facing result (object-level scoped; agent-transparency M-12) ───────────────────────
  async getOwnerResult(listingId: string, actor: AuthPrincipal): Promise<OwnerModerationResultView | null> {
    const listing = await this.prisma.listings.findUnique({
      where: { id: listingId },
      select: { id: true, seller_id: true, organization_id: true },
    });
    if (!listing) throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });

    // M-12: owner (seller or org-admin) OR MODERATOR/ADMIN. Non-owner USER → 403 (no detail leak).
    const isOperator = actor.role === 'MODERATOR' || actor.role === 'ADMIN';
    const isOwner = listing.seller_id === actor.userId || (listing.organization_id ? await this.isOrgAdmin(actor.userId, listing.organization_id) : false);
    if (!isOperator && !isOwner) {
      throw new ForbiddenException({ message: 'Not permitted to view this listing’s moderation result', code: 'FORBIDDEN' });
    }

    return this.latestEffectiveResult(listingId);
  }

  /**
   * The latest EFFECTIVE moderation result projection for a listing (Owner-decision #5), WITHOUT any
   * authz — the caller is responsible for the object-scope check. `getOwnerResult` adds the M-12 guard;
   * the Slice-4c listing embed (`GET /listings/{id}.lastModerationResult`) calls this only once it has
   * already confirmed the reader is the owner/operator (EMB-1). Single-sourced so the two stay in sync.
   * null = the listing has no effective decision yet (EMB-3).
   */
  async latestEffectiveResult(listingId: string): Promise<OwnerModerationResultView | null> {
    // Latest EFFECTIVE decision (most recent row; an override is itself the newest row → it wins).
    const latest = await this.prisma.moderation_decisions.findFirst({
      where: { entity_type: 'LISTING', entity_id: listingId },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    if (!latest) return null;

    const decidedBy = await this.actorOf(latest.moderator_id);
    let reason: LocalizedString | null = null;
    if (latest.reason) {
      const r = await this.prisma.moderation_reasons.findUnique({ where: { code: latest.reason } });
      reason = r ? this.loc(r.description_localized) : null;
    }
    return {
      listingId,
      decision: latest.decision as ModerationDecisionValue,
      reason,
      notes: latest.notes,
      decidedBy: decidedBy ?? this.actorView(latest.moderator_id, latest.actor_principal_type as PrincipalType),
      decidedByAgent: latest.actor_principal_type === 'AGENT',
      isHumanOverride: latest.is_human_override,
      supersedesDecisionId: latest.supersedes_decision_id,
      decidedAt: latest.created_at,
    };
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  private transitionFor(action: ModerationActionDto['action']): { status: string; moderationStatus: string } {
    switch (action) {
      case 'APPROVE':
        return { status: 'ACTIVE', moderationStatus: 'APPROVED' };
      case 'REJECT':
        return { status: 'DEACTIVATED', moderationStatus: 'REJECTED' };
      case 'REQUEST_CHANGES':
        return { status: 'DRAFT', moderationStatus: 'CHANGES_REQUESTED' };
    }
  }

  private async loadListing(id: string): Promise<ListingRow> {
    const row = (await this.prisma.listings.findUnique({
      where: { id },
      select: {
        id: true, animal_id: true, seller_id: true, organization_id: true, title_localized: true,
        status: true, moderation_status: true, moderation_enqueued_at: true,
        assigned_to: true, locked_at: true, lock_expires_at: true,
      },
    })) as unknown as ListingRow | null;
    if (!row) throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    return row;
  }

  private assertModeratable(row: ListingRow): void {
    if (row.status !== 'PENDING_MODERATION') {
      throw new ConflictException({ message: 'Listing is not awaiting moderation', code: 'INVALID_STATE' });
    }
  }

  private toQueueItem(row: ListingRow, market: Market, speciesCode: string | null, actor: AuthPrincipal, now: number): ModerationQueueItemView {
    const submittedAt = row.moderation_enqueued_at ?? row.locked_at ?? new Date(now);
    const waitingSeconds = Math.max(0, Math.floor((now - submittedAt.getTime()) / 1000));
    return {
      listingId: row.id,
      titleLocalized: (row.title_localized as LocalizedString) ?? { en: '', ru: '' },
      market,
      species: speciesCode,
      submittedAt,
      waitingSeconds,
      slaState: this.slaState(market, waitingSeconds),
      lockState: this.lockState(row, actor, now),
      assignedTo: row.assigned_to ? this.actorView(row.assigned_to, 'HUMAN') : null,
      lockedAt: row.locked_at,
      lockExpiresAt: row.lock_expires_at,
    };
  }

  /** Derived SLA state (M-13, read-only — no auto-decide). */
  private slaState(market: Market, waitingSeconds: number): SlaState {
    const target = SLA_TARGET_SECONDS[market];
    if (waitingSeconds >= target * ESCALATE_FACTOR) return 'ESCALATED';
    if (waitingSeconds >= target) return 'BREACHED';
    return 'ON_TRACK';
  }

  /** Derived lock state relative to the caller. */
  private lockState(row: ListingRow, actor: AuthPrincipal, now: number): LockState {
    if (row.assigned_to === null) return 'FREE';
    const live = row.lock_expires_at !== null && row.lock_expires_at.getTime() > now;
    if (!live) return 'LOCK_EXPIRED';
    return row.assigned_to === actor.userId ? 'CLAIMED_BY_ME' : 'CLAIMED_BY_OTHER';
  }

  private async isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
    const m = await this.prisma.organization_users.findFirst({
      where: { user_id: userId, organization_id: organizationId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    return m !== null;
  }

  /** Resolve a user's CURRENT principal_type for an Actor badge (best-effort; null if no id). */
  private async actorOf(userId: string | null): Promise<ActorView | null> {
    if (!userId) return null;
    const u = await this.prisma.users.findUnique({ where: { id: userId }, select: { principal_type: true, full_name: true } });
    return {
      actorId: userId,
      principalType: (u?.principal_type as PrincipalType) ?? 'HUMAN',
      actorDisplayName: u?.full_name ?? null,
    };
  }

  private actorView(userId: string, principalType: PrincipalType): ActorView {
    return { actorId: userId, principalType, actorDisplayName: null };
  }

  /** Coerce a Prisma JSON value into a LocalizedString (the *_localized columns are {en,ru} objects). */
  private loc(value: unknown): LocalizedString {
    const v = value as { en?: string; ru?: string } | null;
    return { en: v?.en ?? '', ru: v?.ru ?? '' };
  }

  private toDecisionView(row: DecisionRow): ModerationDecisionView {
    return {
      id: row.id,
      // The decision's actor badge uses the AS-OF-ACTION principal_type snapshot (not joined-now, ADR-0011 §1).
      actor: this.actorView(row.moderator_id, row.actor_principal_type as PrincipalType),
      actorRole: row.actor_role,
      entityType: row.entity_type as 'LISTING' | 'ANIMAL',
      entityId: row.entity_id,
      decision: row.decision as ModerationDecisionValue,
      reason: row.reason,
      notes: row.notes,
      supersedesDecisionId: row.supersedes_decision_id,
      isHumanOverride: row.is_human_override,
      createdAt: row.created_at,
    };
  }

  /** Map DB integrity failures to clean RFC7807 4xx — never a 500 (M-P0 trigger, FK, append-only). */
  private async runWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientUnknownRequestError || err instanceof Prisma.PrismaClientKnownRequestError) {
        const msg = err.message;
        if (/cannot be ACTIVE unless moderation_status/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'A listing cannot be ACTIVE unless APPROVED', code: 'VALIDATION_ERROR' });
        }
        if (/chk_moddec_override/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'Override fields are inconsistent (isHumanOverride ⟺ supersedesDecisionId)', code: 'VALIDATION_ERROR' });
        }
        if (/append-only/i.test(msg)) {
          throw new ConflictException({ message: 'Moderation decisions are append-only', code: 'CONFLICT' });
        }
        if (/foreign key|23503/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'A referenced reason/template/decision does not exist', code: 'VALIDATION_ERROR' });
        }
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new UnprocessableEntityException({ message: 'A referenced reason/template/decision does not exist', code: 'VALIDATION_ERROR' });
      }
      throw err;
    }
  }
}
