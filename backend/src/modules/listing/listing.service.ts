import {
  BadRequestException,
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
import { CryptoService } from '../../lib/crypto/crypto.service';
import { OutboxService } from '../../lib/outbox/outbox.service';
import { RedisService } from '../../lib/redis/redis.service';
import { AppConfigService } from '../../config/app-config.service';
import { isAllowedMediaUrl, s3HostFromEndpoint } from '../../lib/media/media-url';
import { paginate, type Paginated } from '../../lib/pagination/page';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ModerationService } from '../moderation/moderation.service';
import { AnimalService } from '../animal/animal.service';
import { ConsentService } from '../identity/consent.service';
import {
  type ContactRevealView,
  type ListingAnalyticsView,
  type ListingCreateDto,
  type ListingListQueryDto,
  type ListingPhotoCreateDto,
  type ListingPhotoView,
  type ListingStatus,
  type ListingUpdateDto,
  type ListingView,
  type LocalizedString,
  type Market,
} from './dto/listing.dto';

/** MAX_MEDIA_ITEMS (listing_state_machine.md constants) — L-14. */
const MAX_MEDIA_ITEMS = 10;
/** MIN_LISTING_PRICE for a `sale` submit guard (listing_state_machine.md) — L-6. */
const MIN_LISTING_PRICE = 0;
/** States from which an owner soft-withdraw is allowed (L-8); terminal states reject with 409. */
const WITHDRAWABLE: ReadonlySet<ListingStatus> = new Set(['DRAFT', 'PENDING_MODERATION', 'ACTIVE']);

/**
 * Polymorphic value-event subject (ADR-0018 §Amendment D5 / ADR-0014 OfferingRef seam). Every
 * value-signal event (`Listing.Sold`, `ContactReveal.Created`) now carries `offeringType`/`offeringId`
 * so a future analytics funnel spans all offering subtypes, not just animal listings. Today the only
 * subtype is `ANIMAL_LISTING`, whose `offeringId` == the listing id. Mirrors the D2 saved-search seam
 * literal; centralise into a shared OfferingType module when the second subtype lands (D10).
 */
const OFFERING_TYPE_ANIMAL_LISTING = 'ANIMAL_LISTING' as const;

// ── Contact-reveal rate limit (spec 16 §"Rate limiting"; ADR-0002 per-market, ФЗ-152 minimisation) ──
/** Reveals per hour per viewer on the pet marketplace. */
const PET_REVEAL_LIMIT_PER_HOUR = 10;
/** Reveals per hour per viewer on the livestock marketplace (stricter — higher-value/lower-volume). */
const LIVESTOCK_REVEAL_LIMIT_PER_HOUR = 5;
/** The rolling window (seconds) for the reveal counter — a fixed hour from the first reveal. */
const CONTACT_REVEAL_WINDOW_SEC = 3600;

// ── Geo search constants (Slice 2; geo-spec 07-geo-search-service.md §137–153) ─────────────────
const EARTH_RADIUS_M = 6_371_000;
const M_PER_DEG_LAT = 111_320; // meters per degree latitude
const RADIUS_KM_MIN = 1;
const RADIUS_KM_MAX = 100;
const BOUNDARY_TOLERANCE_M = 100; // ±100 m so "exactly at radius" is included (§141, L2-7)
/** Whitelisted sort fields (L2-11). `distance` requires geo coords (L2-12). */
const SORT_FIELDS = new Set(['created_at', 'price', 'distance']);

// ── D1 views-capture (GAP-TRACE-006 / AUDIT3 data-analyst) ───────────────────────────────────────
/** Dedup window (seconds) per (viewer, listing) — a repeat detail-view inside 30 min does not re-count. */
const VIEW_DEDUP_WINDOW_SEC = 1800;

/** A raw `listings` row, narrowed to the columns this slice reads/maps. */
interface ListingRow {
  id: string;
  animal_id: string;
  seller_id: string;
  organization_id: string | null;
  branch_id: string | null;
  metadata: unknown;
  listing_type: string;
  title_localized: unknown;
  description_localized: unknown;
  price_cents: bigint | null;
  currency: string | null;
  quantity: number | null;
  view_count: bigint;
  /** D3 (ADR-0018 §Amendment): derived market cache (species.market via animal). Not exposed in the view. */
  market: string;
  status: string;
  moderation_status: string;
  published_at: Date | null;
  sold_at: Date | null;
  transaction_id: string | null;
  lat: number | null;
  lng: number | null;
  is_active: boolean;
  expires_at: Date | null;
  created_at: Date;
  updated_at: Date;
  /** Only present on a geo-search raw row (computed Haversine meters); undefined on the Prisma path. */
  distance_m?: number | null;
}

/** A validated geo-search center + radius in meters (Slice 2). */
interface GeoSearch {
  lat: number;
  lng: number;
  radiusM: number;
}

/** A whitelisted, parsed sort (L2-11). */
interface ParsedSort {
  field: 'created_at' | 'price' | 'distance';
  dir: 'asc' | 'desc';
}

/**
 * Listing aggregate CRUD + owner-side lifecycle to PENDING_MODERATION (listings-api.yaml Slice 1;
 * invariants L-P0..L-15 in listing_state_machine.md). Reuses the platform foundation (RFC7807,
 * pagination, ETag/If-Match, agent-as-principal in-tx audit) and the Animal/Transfer patterns
 * (listScope owner-scoping, mapWrite DB-error→4xx, org-admin via organization_users).
 *
 * The seller is ALWAYS the authenticated actor (L-1); status/moderationStatus/market are never
 * client-set (L-10/L-12). No Slice-1 path sets ACTIVE (L-P0) — that is a moderator action
 * (Admin Slice 4) gated by trg_listing_active_requires_approval.
 */
@Injectable()
export class ListingService {
  private readonly logger = new Logger(ListingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogService,
    private readonly moderation: ModerationService,
    private readonly orgMembership: OrgMembershipService,
    private readonly animals: AnimalService, // ADR-0018: cross-aggregate animal access via AnimalService
    private readonly crypto: CryptoService, // ADR-0019: decrypt contact_phone at reveal
    private readonly outbox: OutboxService, // transactional event emission (ContactReveal.Created / Listing.Sold)
    private readonly redis: RedisService, // per-market contact-reveal rate limit
    private readonly config: AppConfigService, // S3/MinIO host allowlist for media URLs (AUDIT3)
    private readonly consent: ConsentService, // ADR-0020: gate contact distribution on CONTACT_DISTRIBUTION consent
  ) {}

  /**
   * Photo URLs must point at OUR object storage (S3/MinIO), never a seller-controlled remote origin
   * (AUDIT3 security.md — moderation-swap + latent SSRF). Env-driven allowlist = the S3_ENDPOINT host.
   * Rejecting here (422) is defence-in-depth on top of the DTO's structural @IsUrl.
   */
  private assertOwnMediaHost(url: string): void {
    const allowed = [s3HostFromEndpoint(this.config.get('S3_ENDPOINT'))];
    if (!isAllowedMediaUrl(url, allowed)) {
      throw new UnprocessableEntityException({
        message: 'Photo URL must reference our own media storage',
        code: 'VALIDATION_ERROR',
      });
    }
  }

  // ── Create (→ DRAFT) ─────────────────────────────────────────────────────────────────────────
  async create(dto: ListingCreateDto, actor: AuthPrincipal): Promise<{ listing: ListingView; etag: string }> {
    // L-4: chk_listing_ownership pre-validate — branchId implies organizationId.
    if (dto.branchId && !dto.organizationId) {
      throw new UnprocessableEntityException({ message: 'branchId requires organizationId', code: 'VALIDATION_ERROR' });
    }
    // L-9: lat/lng both-null or both-set.
    this.assertLatLng(dto.lat, dto.lng);

    const title = this.normalizeLocalized(dto.titleLocalized);
    if (!title.en && !title.ru) {
      throw new UnprocessableEntityException({ message: 'titleLocalized must have at least one non-empty locale', code: 'VALIDATION_ERROR' });
    }

    // L-2 / ADR-0018: obtain the animal + assert ownership through AnimalService — no direct
    // cross-aggregate read of the `animals` table. Parity: 404 if it doesn't exist, 403 if the
    // actor isn't its owner / an org-admin of its owning org. The summary also carries the DERIVED
    // market (species.market), which we cache on the row below (D3).
    const animalSummary = await this.animals.getOwnedAnimalForActor(actor, dto.animalId);

    // L-2/L-4: an organizational listing's org must be one the actor org-admins.
    if (dto.organizationId) {
      await this.assertOrgAdmin(actor, dto.organizationId);
    }

    const data: Prisma.listingsUncheckedCreateInput = {
      animal_id: dto.animalId,
      seller_id: actor.userId, // L-1: server-derived seller (body sellerId ignored / not accepted)
      organization_id: dto.organizationId ?? null,
      branch_id: dto.branchId ?? null,
      metadata: (dto.metadata ?? {}) as Prisma.InputJsonValue,
      listing_type: dto.listingType, // L-11: leasing accepted, no special behaviour
      title_localized: title as unknown as Prisma.InputJsonValue,
      description_localized: this.normalizeLocalized(dto.descriptionLocalized) as unknown as Prisma.InputJsonValue,
      price_cents: dto.priceCents ?? null,
      currency: dto.currency ?? 'RUB',
      quantity: dto.quantity ?? 1,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      // D3 (ADR-0018 §Amendment): cache the DERIVED market (species.market via the animal) in-tx at
      // create, so the future queue/discovery list-path (D8) reads it with zero cross-aggregate joins.
      // Derivation, not the assigned market_scope tag (ADR-0015 rule 7); species.market is NOT NULL so
      // it is always resolvable. Write-only here — no read path switches to this column until D8.
      market: animalSummary.market,
      is_active: dto.isActive ?? true,
      expires_at: dto.expiresAt ? new Date(dto.expiresAt) : null,
      status: 'DRAFT', // L-12/L-P0: always DRAFT on create; never client-set, never ACTIVE
      moderation_status: 'PENDING',
    };

    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const created = (await tx.listings.create({ data })) as unknown as ListingRow;
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'listing.created',
            entityType: 'listing',
            entityId: created.id,
            afterData: { animalId: dto.animalId, listingType: dto.listingType, status: 'DRAFT' },
          },
          tx,
        );
        return created;
      }),
    );

    this.logger.log(`Listing created ${row.id} (DRAFT) by ${actor.userId}`);
    return { listing: this.toView(row), etag: this.etag(row) };
  }

  // ── Read one (public if ACTIVE, else owner/operator) ─────────────────────────────────────────
  async getById(
    id: string,
    actor: AuthPrincipal | undefined,
    viewerIp?: string | null,
  ): Promise<{ listing: ListingView; etag: string }> {
    const row = await this.findRow(id);
    // L-5: a non-active listing is visible only to its owner / operator; otherwise 404 (no leak).
    if (row.status !== 'ACTIVE' && !(await this.canSeeNonActive(actor, row))) {
      throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    }
    const view = this.toView(row);
    // EMB-1: the moderation-result embed is owner/operator-only (same scope as canSeeNonActive: seller,
    // org-admin, MODERATOR, ADMIN); null for a non-owner/anonymous reader (no leak) and when never
    // moderated (EMB-3). Single-get only — the list path leaves it null (EMB-4).
    if (await this.canSeeNonActive(actor, row)) {
      view.lastModerationResult = await this.moderation.latestEffectiveResult(id);
    }
    // D1 views-capture: best-effort, deduped increment of the funnel-top counter. Awaited but fully
    // error-swallowed (never gates the read). `view.viewCount` reflects the pre-increment value (this
    // reader is not counted in their own returned number) — the increment lands for the next reader.
    await this.captureView(row, actor, viewerIp ?? null);
    return { listing: view, etag: this.etag(row) };
  }

  /**
   * D1 views-capture (GAP-TRACE-006 · AUDIT3 data-analyst — the ONE analytics signal whose history
   * cannot be backfilled). Best-effort increment of `listings.view_count` on a public detail read.
   *
   * Policy:
   *  - Only an **ACTIVE** listing is counted. Non-ACTIVE listings are visible solely to their
   *    owner/operator, so counting them would be self-view noise, not buyer demand.
   *  - The **seller's own view is excluded** (a demand signal, not owner activity — mirrors the
   *    self-reveal exclusion). Org-admins/operators are distinct actors and are counted (kept cheap:
   *    no extra membership query on the hot read path).
   *  - **Dedup** per (viewer, listing) in Redis via `SET NX EX` (30-min window): the viewer key is the
   *    authed userId, or the client IP for anonymous readers, so an F5 refresh does not inflate the
   *    count. No stable identity (no auth AND no IP) → skip rather than over-count.
   *  - **Never throws.** A Redis/DB hiccup must not fail the read — funnel-top capture is additive, not
   *    critical. The increment is the DB-atomic `SET view_count = view_count + 1` (Prisma `increment`).
   */
  private async captureView(row: ListingRow, actor: AuthPrincipal | undefined, viewerIp: string | null): Promise<void> {
    if (row.status !== 'ACTIVE') return;
    if (actor && actor.userId === row.seller_id) return;
    const viewerKey = actor ? `u:${actor.userId}` : viewerIp ? `ip:${viewerIp}` : null;
    if (!viewerKey) return;
    try {
      const dedupKey = `listing-view:${row.id}:${viewerKey}`;
      const fresh = await this.redis.client.set(dedupKey, '1', 'EX', VIEW_DEDUP_WINDOW_SEC, 'NX');
      if (fresh === null) return; // already counted within the window
      await this.prisma.listings.update({ where: { id: row.id }, data: { view_count: { increment: 1 } } });
    } catch (err) {
      this.logger.warn(`view capture failed for listing ${row.id}: ${(err as Error).message}`);
    }
  }

  // ── Update — DRAFT edit (stays DRAFT) OR ACTIVE material edit (re-enqueues, M-14) ─────────────
  async update(
    id: string,
    dto: ListingUpdateDto,
    ifMatch: string | undefined,
    actor: AuthPrincipal,
  ): Promise<{ listing: ListingView; etag: string }> {
    const existing = await this.findRow(id);
    await this.assertCanMutate(actor, existing); // L-3 / M14-4 (owner / org-admin; MODERATOR is R-only)
    assertIfMatch(ifMatch, this.etag(existing)); // L-13

    // M14-7 source-state gate: only DRAFT and ACTIVE are owner-editable. PENDING_MODERATION / EXPIRED /
    // SOLD / DEACTIVATED → 409 LISTING_NOT_EDITABLE. (animal_id is not in the DTO → M14-8 immutability.)
    if (existing.status !== 'DRAFT' && existing.status !== 'ACTIVE') {
      throw new ConflictException({ message: `A ${existing.status} listing cannot be edited`, code: 'LISTING_NOT_EDITABLE' });
    }

    const nextLat = dto.lat !== undefined ? dto.lat : existing.lat;
    const nextLng = dto.lng !== undefined ? dto.lng : existing.lng;
    this.assertLatLng(nextLat ?? undefined, nextLng ?? undefined); // L-9

    const data: Prisma.listingsUncheckedUpdateInput = {};
    if (dto.titleLocalized !== undefined) {
      const title = this.normalizeLocalized(dto.titleLocalized);
      if (!title.en && !title.ru) {
        throw new UnprocessableEntityException({ message: 'titleLocalized must have at least one non-empty locale', code: 'VALIDATION_ERROR' });
      }
      data.title_localized = title as unknown as Prisma.InputJsonValue;
    }
    if (dto.descriptionLocalized !== undefined) {
      data.description_localized = this.normalizeLocalized(dto.descriptionLocalized) as unknown as Prisma.InputJsonValue;
    }
    if (dto.priceCents !== undefined) data.price_cents = dto.priceCents;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.lat !== undefined) data.lat = dto.lat;
    if (dto.lng !== undefined) data.lng = dto.lng;
    if (dto.isActive !== undefined) data.is_active = dto.isActive;
    if (dto.expiresAt !== undefined) data.expires_at = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.metadata !== undefined) data.metadata = dto.metadata as Prisma.InputJsonValue;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException({ message: 'No updatable fields provided', code: 'VALIDATION_ERROR' });
    }
    data.updated_at = new Date();

    // M-14: an edit to an ACTIVE listing is material (MVP: every editable-content PATCH is material —
    // DRIFT-M14b) → re-enqueue for re-review. A DRAFT edit stays DRAFT (M14-6, Slice-1 behaviour).
    const row =
      existing.status === 'ACTIVE'
        ? await this.editActiveAndReenqueue(id, data, actor)
        : await this.editDraft(id, data, actor);

    this.logger.log(`Listing updated ${id} by ${actor.userId} (was ${existing.status})`);
    return { listing: this.toView(row), etag: this.etag(row) };
  }

  /** DRAFT edit (M14-6): a plain in-place update, stays DRAFT, no re-enqueue (Slice-1 behaviour). */
  private async editDraft(id: string, data: Prisma.listingsUncheckedUpdateInput, actor: AuthPrincipal): Promise<ListingRow> {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const updated = (await tx.listings.update({ where: { id }, data })) as unknown as ListingRow;
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'listing.updated',
            entityType: 'listing',
            entityId: id,
            afterData: { fields: Object.keys(data) },
          },
          tx,
        );
        return updated;
      }),
    );
  }

  /**
   * M-14 ACTIVE material edit → re-enqueue. The field update + the ACTIVE→PENDING_MODERATION transition
   * + the lock clear + the escalated_at reset + the audit row are ONE transaction; the listing flip is a
   * **status-guarded conditional updateMany** (TOCTOU single-winner, M14-3) so a concurrent edit/withdraw
   * has exactly one winner — the loser sees count 0, rolls back before the audit write, and 409s. The
   * listing LEAVES ACTIVE (status→PENDING_MODERATION, moderation_status→PENDING): M-P0 holds (it is never
   * ACTIVE with moderation_status≠APPROVED); the P0 trigger is the backstop for a bug.
   */
  private async editActiveAndReenqueue(id: string, data: Prisma.listingsUncheckedUpdateInput, actor: AuthPrincipal): Promise<ListingRow> {
    return this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const claim = await tx.listings.updateMany({
          where: { id, status: 'ACTIVE' },
          data: {
            ...data,
            status: 'PENDING_MODERATION', // M14-1: leaves ACTIVE (M-P0 holds)
            moderation_status: 'PENDING',
            moderation_enqueued_at: new Date(), // restart the SLA clock
            is_active: false, // not publicly visible while re-reviewing
            assigned_to: null, // M14-5: release any stale moderator lock
            locked_at: null,
            lock_expires_at: null,
            escalated_at: null, // M14-5 / SLA-4: allow the 4c job to re-escalate
          },
        });
        if (claim.count !== 1) {
          // Lost the race (a concurrent edit/withdraw already moved it off ACTIVE) — roll back, write nothing.
          throw new ConflictException({ message: 'Listing is no longer editable (it left ACTIVE)', code: 'LISTING_NOT_EDITABLE' });
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'listing.re_moderation_requested',
            entityType: 'listing',
            entityId: id,
            beforeData: { status: 'ACTIVE' },
            afterData: { status: 'PENDING_MODERATION', fields: Object.keys(data) },
          },
          tx,
        );
        return (await tx.listings.findUnique({ where: { id } })) as unknown as ListingRow;
      }),
    );
  }

  // ── Submit (DRAFT → PENDING_MODERATION) ──────────────────────────────────────────────────────
  async submit(id: string, ifMatch: string | undefined, actor: AuthPrincipal): Promise<{ listing: ListingView; etag: string }> {
    const existing = await this.findRow(id);
    await this.assertCanMutate(actor, existing); // L-3
    assertIfMatch(ifMatch, this.etag(existing)); // L-13

    // L-7: only a DRAFT may be submitted.
    if (existing.status !== 'DRAFT') {
      throw new ConflictException({ message: 'Only a DRAFT listing can be submitted for moderation', code: 'LISTING_NOT_DRAFT' });
    }

    // L-6: submit guard — title valid AND ≥1 photo AND (sale ⇒ price ≥ MIN_LISTING_PRICE).
    const title = existing.title_localized as LocalizedString | null;
    if (!title || (!title.en && !title.ru)) {
      throw new UnprocessableEntityException({ message: 'A title is required before submitting', code: 'VALIDATION_ERROR' });
    }
    const photoCount = await this.prisma.listing_photos.count({ where: { listing_id: id } });
    if (photoCount < 1) {
      throw new UnprocessableEntityException({ message: 'At least one photo is required before submitting', code: 'VALIDATION_ERROR' });
    }
    if (existing.listing_type === 'sale') {
      const price = existing.price_cents;
      if (price === null || price < BigInt(MIN_LISTING_PRICE)) {
        throw new UnprocessableEntityException({ message: `A sale listing needs a price ≥ ${MIN_LISTING_PRICE}`, code: 'VALIDATION_ERROR' });
      }
    }

    // Status-guarded conditional transition (TOCTOU single-winner, mirrors the transfer slice).
    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const claim = await tx.listings.updateMany({
          where: { id, status: 'DRAFT' },
          data: { status: 'PENDING_MODERATION', moderation_status: 'PENDING', updated_at: new Date() },
        });
        if (claim.count !== 1) {
          throw new ConflictException({ message: 'Only a DRAFT listing can be submitted for moderation', code: 'LISTING_NOT_DRAFT' });
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'listing.submitted',
            entityType: 'listing',
            entityId: id,
            beforeData: { status: 'DRAFT' },
            afterData: { status: 'PENDING_MODERATION' },
          },
          tx,
        );
        return (await tx.listings.findUnique({ where: { id } })) as unknown as ListingRow;
      }),
    );

    this.logger.log(`Listing submitted ${id} (PENDING_MODERATION) by ${actor.userId}`);
    return { listing: this.toView(row), etag: this.etag(row) };
  }

  // ── Withdraw (soft → DEACTIVATED) ────────────────────────────────────────────────────────────
  async withdraw(id: string, actor: AuthPrincipal): Promise<ListingView> {
    const existing = await this.findRow(id);
    await this.assertCanMutate(actor, existing); // L-3
    // L-8: terminal/non-withdrawable states reject with 409.
    if (!WITHDRAWABLE.has(existing.status as ListingStatus)) {
      throw new ConflictException({ message: `A ${existing.status} listing cannot be withdrawn`, code: 'INVALID_STATE' });
    }

    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const claim = await tx.listings.updateMany({
          where: { id, status: { in: ['DRAFT', 'PENDING_MODERATION', 'ACTIVE'] } },
          data: { status: 'DEACTIVATED', is_active: false, updated_at: new Date() },
        });
        if (claim.count !== 1) {
          throw new ConflictException({ message: `A listing in this state cannot be withdrawn`, code: 'INVALID_STATE' });
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'listing.withdrawn',
            entityType: 'listing',
            entityId: id,
            beforeData: { status: existing.status },
            afterData: { status: 'DEACTIVATED' },
          },
          tx,
        );
        return (await tx.listings.findUnique({ where: { id } })) as unknown as ListingRow;
      }),
    );

    this.logger.log(`Listing withdrawn ${id} (DEACTIVATED) by ${actor.userId}`);
    return this.toView(row);
  }

  // ── Contact reveal (MVP, no chat — ADR-0005 / spec 16 / ADR-0020) ────────────────────────────
  /**
   * Reveal the seller's enabled contact channels for an ACTIVE listing (spec 16). Gating: listing
   * ACTIVE (else 404, no existence leak); caller ≠ seller (self-reveal → 422).
   *
   * ADR-0020 — distribution is a TWO-layer gate: a channel is revealed iff (a) the seller's current
   * `CONTACT_DISTRIBUTION` consent is granted (ст.10.1 lawful basis) AND (b) that channel's
   * `contact_prefs.show_*` is on (which channel). We compute the resolvable channels FIRST; if none
   * (no consent, or all channels off) we return a `NO_CHANNELS` result WITHOUT burning quota, writing a
   * `contact_reveals` row, or emitting a lead event (billing-unit fix — never charge for an empty reveal).
   *
   * Dedup: a repeat reveal of the same (viewer, listing) returns the EXISTING row's channels without
   * consuming quota or re-writing a lead (a buyer re-viewing a contact they already unlocked is free).
   * Only a first, resolvable reveal enforces the per-market Redis rate limit (pet 10/h, livestock 5/h),
   * writes the row, and emits `ContactReveal.Created` — all in one transaction (outbox atomicity).
   * `contact_phone` is decrypted here (ADR-0019). Email is never returned.
   */
  async revealContact(id: string, actor: AuthPrincipal): Promise<ContactRevealView> {
    const listing = await this.findRow(id);
    // Only an ACTIVE listing exposes contact. A non-ACTIVE listing → 404 (IDOR-safe, mirrors L-5).
    if (listing.status !== 'ACTIVE') {
      throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    }
    // Self-reveal is a business no-op (you already hold your own contact) — not an authz leak.
    if (listing.seller_id === actor.userId) {
      throw new UnprocessableEntityException({ message: 'You cannot reveal your own contact', code: 'SELF_REVEAL' });
    }

    const seller = await this.prisma.users.findUnique({
      where: { id: listing.seller_id },
      select: { full_name: true, contact_phone: true, contact_telegram: true, contact_prefs: true },
    });
    if (!seller) {
      // The FK guarantees a seller; defensive (treat as not-found, no leak).
      throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    }

    // ADR-0020 gate: lawful basis (consent) AND per-channel visibility — compute channels FIRST.
    const distributionAllowed = await this.consent.currentlyGranted(listing.seller_id, 'CONTACT_DISTRIBUTION');
    const prefs = (seller.contact_prefs ?? {}) as { show_phone?: boolean; show_telegram?: boolean };
    const channels: { phone?: string; telegram?: string } = {};
    if (distributionAllowed && prefs.show_phone) {
      const phone = this.crypto.decrypt(seller.contact_phone); // ADR-0019: decrypt at reveal only
      if (phone) channels.phone = phone;
    }
    if (distributionAllowed && prefs.show_telegram && seller.contact_telegram) {
      channels.telegram = seller.contact_telegram;
    }

    const sellerName = seller.full_name ?? null;
    // No resolvable channel → default-deny. Nothing is charged/written/emitted (ADR-0020 billing-unit fix).
    if (Object.keys(channels).length === 0) {
      this.logger.log(`Contact reveal for listing ${id} to ${actor.userId}: no channels (consent=${distributionAllowed})`);
      return { listingId: id, sellerId: listing.seller_id, sellerName, channels: {}, revealedAt: null, status: 'NO_CHANNELS' };
    }

    // Dedup: a buyer re-revealing the SAME listing gets the existing row — no quota, no new row, no event.
    const existing = await this.prisma.contact_reveals.findFirst({
      where: { listing_id: id, viewer_id: actor.userId },
      select: { created_at: true },
    });
    if (existing) {
      return { listingId: id, sellerId: listing.seller_id, sellerName, channels, revealedAt: existing.created_at, status: 'REVEALED' };
    }

    // D8 (ADR-0018 Part-2): read the market from the derived `listings.market` cache (NOT NULL, D3),
    // not a live animals⋈species join — the market-derivation cycle is broken, one cross-aggregate site.
    const market = listing.market as Market;
    // Rate-limit gate — only a first, resolvable reveal consumes quota (empty/dedup paths never reach here).
    await this.enforceRevealRateLimit(actor.userId, market);

    const revealedAt = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.contact_reveals.create({
          data: { listing_id: id, viewer_id: actor.userId, seller_id: listing.seller_id, created_at: revealedAt },
        });
        await this.outbox.publish(tx, {
          aggregateType: 'Listing',
          aggregateId: id,
          eventType: 'ContactReveal.Created',
          // v2 (D5): +offeringType/+offeringId polymorphic subject. Additive; the NotificationConsumer
          // does not subscribe to this eventType (registry allow-list), so the bump breaks no consumer.
          schemaVersion: 2,
          market,
          occurredAt: revealedAt,
          payload: {
            listingId: id,
            viewerId: actor.userId,
            sellerId: listing.seller_id,
            offeringType: OFFERING_TYPE_ANIMAL_LISTING,
            offeringId: id,
          },
        });
      });
    } catch (err) {
      // A concurrent double-reveal races on uq_contact_reveals_viewer_listing (ADR-0020 DB backstop) →
      // treat as dedup: return the winner's channels rather than surfacing a 500.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const won = await this.prisma.contact_reveals.findFirst({
          where: { listing_id: id, viewer_id: actor.userId },
          select: { created_at: true },
        });
        return { listingId: id, sellerId: listing.seller_id, sellerName, channels, revealedAt: won?.created_at ?? revealedAt, status: 'REVEALED' };
      }
      throw err;
    }

    this.logger.log(`Contact revealed for listing ${id} to ${actor.userId} (${market ?? 'unknown'} market)`);
    return { listingId: id, sellerId: listing.seller_id, sellerName, channels, revealedAt, status: 'REVEALED' };
  }

  /**
   * Per-market, per-viewer, per-hour reveal rate limit (spec 16). Redis INCR is the gate: the first
   * hit sets the hour TTL, and count > limit rejects with 429 + Retry-After (from the key's TTL). The
   * window is fixed (an hour from the first reveal), not sliding.
   */
  private async enforceRevealRateLimit(viewerId: string, market: Market | null): Promise<void> {
    const limit = market === 'livestock' ? LIVESTOCK_REVEAL_LIMIT_PER_HOUR : PET_REVEAL_LIMIT_PER_HOUR;
    const key = `contact-reveal:${market ?? 'pet'}:${viewerId}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) {
      await this.redis.client.expire(key, CONTACT_REVEAL_WINDOW_SEC);
    }
    if (count > limit) {
      const ttl = await this.redis.client.ttl(key);
      const retryAfter = ttl > 0 ? ttl : CONTACT_REVEAL_WINDOW_SEC;
      throw new HttpException(
        {
          message: `Contact reveal limit reached (${limit}/hour for the ${market ?? 'pet'} marketplace)`,
          code: 'RATE_LIMITED',
          retryAfter,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  // ── Mark sold (owner action, MVP — ACTIVE → SOLD; listing_state_machine) ──────────────────────
  /**
   * Owner marks an ACTIVE listing sold (state machine ACTIVE→SOLD, MVP). Sets `sold_at`, removes it
   * from public search (`is_active=false`), emits `Listing.Sold`. **Does NOT auto-initiate ownership
   * transfer** (ADR-0013 — transfer is a separate explicit flow; auto-transfer-on-SOLD is Фаза 2).
   * Object-level rule: seller/org-admin/ADMIN (MODERATOR excluded). The ACTIVE→SOLD flip is a guarded
   * conditional updateMany (TOCTOU single-winner) so a concurrent withdraw/edit/mark-sold has exactly
   * one winner — a repeat on an already-SOLD/terminal listing loses the race → 409 LISTING_NOT_ACTIVE.
   */
  async markSold(id: string, ifMatch: string | undefined, actor: AuthPrincipal): Promise<{ listing: ListingView; etag: string }> {
    const existing = await this.findRow(id);
    await this.assertCanMutate(actor, existing); // L-3 (owner / org-admin / ADMIN)
    assertIfMatch(ifMatch, this.etag(existing));

    if (existing.status !== 'ACTIVE') {
      throw new ConflictException({ message: 'Only an ACTIVE listing can be marked sold', code: 'LISTING_NOT_ACTIVE' });
    }

    const market = existing.market as Market; // D8: from the `listings.market` cache, not a join.
    const soldAt = new Date();
    const row = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const claim = await tx.listings.updateMany({
          where: { id, status: 'ACTIVE' },
          data: { status: 'SOLD', sold_at: soldAt, is_active: false, updated_at: soldAt },
        });
        if (claim.count !== 1) {
          // Lost the race (already left ACTIVE) — roll back, write nothing.
          throw new ConflictException({ message: 'Only an ACTIVE listing can be marked sold', code: 'LISTING_NOT_ACTIVE' });
        }
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'listing.marked_sold',
            entityType: 'listing',
            entityId: id,
            beforeData: { status: 'ACTIVE' },
            afterData: { status: 'SOLD', soldAt: soldAt.toISOString() },
          },
          tx,
        );
        // ADR-0013: SOLD does NOT initiate ownership transfer — no transfer side effect here.
        await this.outbox.publish(tx, {
          aggregateType: 'Listing',
          aggregateId: id,
          eventType: 'Listing.Sold',
          // v2 (D5): +offeringType/+offeringId polymorphic subject. Additive; no consumer subscribes
          // to Listing.Sold (registry allow-list), so the bump breaks no consumer.
          schemaVersion: 2,
          market,
          occurredAt: soldAt,
          payload: {
            listingId: id,
            sellerId: existing.seller_id,
            offeringType: OFFERING_TYPE_ANIMAL_LISTING,
            offeringId: id,
          },
        });
        return (await tx.listings.findUnique({ where: { id } })) as unknown as ListingRow;
      }),
    );

    this.logger.log(`Listing ${id} marked SOLD by ${actor.userId}`);
    return { listing: this.toView(row), etag: this.etag(row) };
  }

  // ── Analytics (seller-owned — listings-api ListingAnalytics) ─────────────────────────────────
  /**
   * Seller-facing per-listing analytics. Owner-scoped: seller, org-admin, MODERATOR, or ADMIN
   * (canSeeNonActive's exact set); anyone else → 404 (no-leak, even for a public ACTIVE listing —
   * analytics are private, and the contract permits 404). `contactReveals` is sourced from the
   * `contact_reveals` table; `views` is sourced from `listings.view_count` (D1; was hard-0 GAP-TRACE-006).
   */
  async getAnalytics(id: string, actor: AuthPrincipal): Promise<{ analytics: ListingAnalyticsView; etag: string }> {
    const row = await this.findRow(id);
    if (!(await this.canSeeNonActive(actor, row))) {
      throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    }
    const [contactReveals, latest] = await Promise.all([
      this.prisma.contact_reveals.count({ where: { listing_id: id } }),
      this.prisma.contact_reveals.findFirst({
        where: { listing_id: id },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      }),
    ]);
    const lastActivityAt = latest?.created_at ?? null;
    const analytics: ListingAnalyticsView = {
      listingId: id,
      // D1 (GAP-TRACE-006 resolved): the real, deduped detail-view counter (listings.view_count). Was
      // hard-0 before Wave D; contactReveals below is likewise a real, sourced count (contact_reveals).
      views: Number(row.view_count),
      contactReveals,
      lastActivityAt,
    };
    const etag = weakEtag(`analytics:${id}`, lastActivityAt ?? row.updated_at);
    return { analytics, etag };
  }

  /**
   * D3 (ADR-0018 §Amendment) — recompute the derived `market` cache for every listing whose animal
   * belongs to `speciesId`, after an admin corrects that species' market (reference-data). Keeps the
   * cache consistent with its species source. The animal ids come from AnimalService (the owning
   * aggregate); the write touches only the `listings` table — so no raw cross-aggregate market join
   * lives in this module and the D8 grep-gate stays green. `market: { not }` makes the write a no-op when the
   * value is already correct (and the updated_at trigger only fires on actual row changes). Returns the
   * count of rows re-pointed.
   */
  async recomputeMarketForSpecies(speciesId: number, newMarket: Market): Promise<number> {
    const animalIds = await this.animals.animalIdsForSpecies(speciesId);
    if (animalIds.length === 0) return 0;
    const result = await this.prisma.listings.updateMany({
      where: { animal_id: { in: animalIds }, market: { not: newMarket } },
      data: { market: newMarket },
    });
    if (result.count > 0) {
      this.logger.log(`Recomputed market cache to '${newMarket}' for ${result.count} listing(s) of species ${speciesId}`);
    }
    return result.count;
  }

  // D8 (ADR-0018 Part-2): the private `marketOf(animalId)` animals⋈species probe is gone — callers now
  // read the derived `listings.market` cache (D3) directly off the already-loaded row. No round-trip, no join.

  // ── List & search (Slice 1 filters + Slice 2 market/geo/species/breed/sort) ──────────────────
  async list(query: ListingListQueryDto, actor: AuthPrincipal | undefined): Promise<Paginated<ListingView>> {
    const geo = this.parseGeo(query); // L2-3/L2-4/L2-5: validates the all-or-none geo set
    const sort = this.parseSort(query.sort, geo !== null); // L2-11/L2-12: whitelist + distance-needs-coords
    this.assertMarketRequired(query, actor, geo); // L2-2

    // The discovery path (market/species/breed join, geo, or distance sort) uses parameterized raw SQL
    // (ADR-0007). The plain Slice-1 filter/owner-scope path stays on Prisma. Both AND-compose listScope.
    const needsDiscovery =
      query.market !== undefined ||
      query.species_id !== undefined ||
      query.breed_id !== undefined ||
      geo !== null ||
      sort.field === 'distance';

    if (!needsDiscovery) {
      return this.listSimple(query, actor);
    }
    return this.listDiscovery(query, actor, geo, sort);
  }

  /** Slice-1 path: pure `listings` filters + the Prisma listScope. */
  private async listSimple(query: ListingListQueryDto, actor: AuthPrincipal | undefined): Promise<Paginated<ListingView>> {
    const where = this.baseWhere(query);
    const scope = await this.listScope(actor);
    const finalWhere: Prisma.listingsWhereInput = scope ? { AND: [where, scope] } : where;
    const [rows, total] = await Promise.all([
      this.prisma.listings.findMany({
        where: finalWhere,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.limit,
      }) as unknown as Promise<ListingRow[]>,
      this.prisma.listings.count({ where: finalWhere }),
    ]);
    return paginate(rows.map((r) => this.toView(r)), total, query.page, query.limit);
  }

  /**
   * Slice-2 discovery path. Parameterized `$queryRaw` (Prisma.sql fragments — bound params only,
   * ESLint-guarded, L2-15). The market filter (L2-1) is a MANDATORY AND-composed clause on the derived
   * `listings.market` cache (D8/ADR-0018 Part-2 — no `species` join), so it can only narrow, never widen.
   * Geo applies the bbox prefilter (L2-8) + exact Haversine (L2-7) with NULL coords excluded (L2-9).
   */
  private async listDiscovery(
    query: ListingListQueryDto,
    actor: AuthPrincipal | undefined,
    geo: GeoSearch | null,
    sort: ParsedSort,
  ): Promise<Paginated<ListingView>> {
    const conds: Prisma.Sql[] = [];

    // Plain `listings` column filters.
    if (query.animal_id !== undefined) conds.push(Prisma.sql`l.animal_id = ${query.animal_id}::uuid`);
    if (query.seller_id !== undefined) conds.push(Prisma.sql`l.seller_id = ${query.seller_id}::uuid`);
    if (query.organization_id !== undefined) conds.push(Prisma.sql`l.organization_id = ${query.organization_id}::uuid`);
    if (query.branch_id !== undefined) conds.push(Prisma.sql`l.branch_id = ${query.branch_id}::uuid`);
    if (query.listing_type !== undefined) conds.push(Prisma.sql`l.listing_type = ${query.listing_type}`);
    if (query.is_active !== undefined) conds.push(Prisma.sql`l.is_active = ${query.is_active}`);
    if (query.currency !== undefined) conds.push(Prisma.sql`l.currency = ${query.currency}`);
    if (query.price_min !== undefined) conds.push(Prisma.sql`l.price_cents >= ${query.price_min}`);
    if (query.price_max !== undefined) conds.push(Prisma.sql`l.price_cents <= ${query.price_max}`);

    // L2-1: market — mandatory AND-composed clause, now on the derived `listings.market` cache (D8/
    // ADR-0018 Part-2), not `species.market` via a join. Still narrow-only (never widens): the cache is
    // NOT NULL and equals species.market, so cross-market leakage remains impossible.
    if (query.market !== undefined) conds.push(Prisma.sql`l.market = ${query.market}`);
    if (query.species_id !== undefined) conds.push(Prisma.sql`a.species_id = ${query.species_id}`);
    if (query.breed_id !== undefined) conds.push(Prisma.sql`a.breed_id = ${query.breed_id}`);

    // L-5/L2-6: visibility scope, AND-composed (ACTIVE-only for anon; can only narrow).
    const scope = await this.listScopeSql(actor);
    if (scope) conds.push(scope);

    // Geo: bbox prefilter (L2-8) + NULL-coords excluded (L2-9). Exact Haversine added below as a HAVING-like filter.
    let distanceSelect = Prisma.sql`NULL::double precision AS distance_m`;
    if (geo) {
      conds.push(Prisma.sql`l.lat IS NOT NULL AND l.lng IS NOT NULL`);
      conds.push(this.bboxSql(geo)); // bounding-box prefilter (uses idx_listings_latlng)
    }

    if (geo) {
      // Exact Haversine distance (meters), bound params only.
      distanceSelect = Prisma.sql`(
        2 * ${EARTH_RADIUS_M} * asin(sqrt(
          power(sin(radians(l.lat - ${geo.lat}) / 2), 2) +
          cos(radians(${geo.lat})) * cos(radians(l.lat)) *
          power(sin(radians(l.lng - ${geo.lng}) / 2), 2)
        ))
      ) AS distance_m`;
    }

    const whereSql = conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;

    // D8 (ADR-0018 Part-2): the `species` join is gone (market now reads `l.market`). The `animals`
    // join survives ONLY to filter species_id/breed_id (animal columns, not market) and is added just
    // when one of those filters is present — so a pure market/geo search touches only `listings`.
    const needsAnimalJoin = query.species_id !== undefined || query.breed_id !== undefined;
    const animalJoin = needsAnimalJoin ? Prisma.sql`JOIN animals a ON a.id = l.animal_id` : Prisma.empty;
    // The exact-distance filter (L2-7, ±100 m tolerance) wraps the bbox-prefiltered set.
    const fromSql = Prisma.sql`
      FROM listings l
      ${animalJoin}
      ${whereSql}`;
    const havingSql = geo
      ? Prisma.sql`WHERE sub.distance_m <= ${geo.radiusM + BOUNDARY_TOLERANCE_M}`
      : Prisma.empty;

    const orderSql = this.orderBySql(sort);

    const rows = await this.prisma.$queryRaw<ListingRow[]>`
      SELECT * FROM (
        SELECT l.*, ${distanceSelect}
        ${fromSql}
      ) sub
      ${havingSql}
      ${orderSql}
      LIMIT ${query.limit} OFFSET ${query.skip}`;

    const countRows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count FROM (
        SELECT l.id, ${distanceSelect}
        ${fromSql}
      ) sub
      ${havingSql}`;
    const total = Number(countRows[0]?.count ?? 0n);

    return paginate(rows.map((r) => this.toView(r)), total, query.page, query.limit);
  }

  private baseWhere(query: ListingListQueryDto): Prisma.listingsWhereInput {
    const where: Prisma.listingsWhereInput = {};
    if (query.animal_id !== undefined) where.animal_id = query.animal_id;
    if (query.seller_id !== undefined) where.seller_id = query.seller_id;
    if (query.organization_id !== undefined) where.organization_id = query.organization_id;
    if (query.branch_id !== undefined) where.branch_id = query.branch_id;
    if (query.listing_type !== undefined) where.listing_type = query.listing_type;
    if (query.is_active !== undefined) where.is_active = query.is_active;
    if (query.currency !== undefined) where.currency = query.currency;
    const price: Prisma.BigIntNullableFilter = {};
    if (query.price_min !== undefined) price.gte = BigInt(query.price_min);
    if (query.price_max !== undefined) price.lte = BigInt(query.price_max);
    if (price.gte !== undefined || price.lte !== undefined) where.price_cents = price;
    return where;
  }

  /**
   * L2-2: `market` is required on the public/discovery path — an anonymous read OR any geo request —
   * else 422 MARKET_REQUIRED. It is optional for an authenticated read (results already constrained by
   * the owner scope). ADMIN/MODERATOR operate cross-market and are exempt.
   */
  private assertMarketRequired(query: ListingListQueryDto, actor: AuthPrincipal | undefined, geo: GeoSearch | null): void {
    if (query.market !== undefined) return;
    if (actor && (actor.role === 'ADMIN' || actor.role === 'MODERATOR')) return;
    const isPublic = !actor;
    if (isPublic || geo !== null) {
      throw new UnprocessableEntityException({ message: 'A market filter is required for this search', code: 'MARKET_REQUIRED' });
    }
  }

  /** Validate + normalize the all-or-none geo set (L2-3/L2-4/L2-5). null = no geo. */
  private parseGeo(query: ListingListQueryDto): GeoSearch | null {
    const present = [query.lat, query.lng, query.radius_km].filter((v) => v !== undefined).length;
    if (present === 0) return null;
    if (present !== 3) {
      throw new UnprocessableEntityException({ message: 'lat, lng and radius_km must all be provided together', code: 'GEO_PARAMS_INCOMPLETE' });
    }
    const { lat, lng, radius_km } = query as { lat: number; lng: number; radius_km: number };
    if (radius_km < RADIUS_KM_MIN || radius_km > RADIUS_KM_MAX) {
      throw new UnprocessableEntityException({ message: `radius_km must be between ${RADIUS_KM_MIN} and ${RADIUS_KM_MAX}`, code: 'RADIUS_OUT_OF_RANGE' });
    }
    // lat/lng range is enforced by the DTO @Min/@Max; re-assert defensively (L2-5).
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new UnprocessableEntityException({ message: 'lat/lng out of range', code: 'VALIDATION_ERROR' });
    }
    return { lat, lng, radiusM: radius_km * 1000 };
  }

  /** Parse + whitelist the sort (L2-11/L2-12). `distance` requires geo coords. Default per geo presence (L2-13). */
  private parseSort(sort: string | undefined, hasGeo: boolean): ParsedSort {
    if (!sort) {
      return hasGeo ? { field: 'distance', dir: 'asc' } : { field: 'created_at', dir: 'desc' };
    }
    const [field, dirRaw] = sort.split(':');
    if (!SORT_FIELDS.has(field) || (dirRaw !== undefined && dirRaw !== 'asc' && dirRaw !== 'desc')) {
      throw new BadRequestException({ message: 'sort must be <created_at|price|distance>:<asc|desc>', code: 'VALIDATION_ERROR' });
    }
    if (field === 'distance' && !hasGeo) {
      throw new BadRequestException({ message: 'sort=distance requires lat/lng/radius_km', code: 'VALIDATION_ERROR' });
    }
    return { field: field as ParsedSort['field'], dir: dirRaw === 'asc' ? 'asc' : dirRaw === 'desc' ? 'desc' : field === 'distance' ? 'asc' : 'desc' };
  }

  /** Deterministic ORDER BY with stable tie-break (L2-13). Column whitelist (no interpolation). */
  private orderBySql(sort: ParsedSort): Prisma.Sql {
    const dir = sort.dir === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    if (sort.field === 'distance') {
      return Prisma.sql`ORDER BY sub.distance_m ${dir}, sub.created_at DESC, sub.id ASC`;
    }
    if (sort.field === 'price') {
      return Prisma.sql`ORDER BY sub.price_cents ${dir} NULLS LAST, sub.created_at DESC, sub.id ASC`;
    }
    return Prisma.sql`ORDER BY sub.created_at ${dir}, sub.id ASC`;
  }

  /** Bounding-box prefilter (geo-spec §139, L2-8) — loss-less; antimeridian split (§148, L2-10). */
  private bboxSql(geo: GeoSearch): Prisma.Sql {
    const dLat = geo.radiusM / M_PER_DEG_LAT;
    const cosLat = Math.cos((geo.lat * Math.PI) / 180);
    // Near-pole clamp (cos→0): cap Δlng at 180° to avoid blow-up (§150).
    const dLng = Math.abs(cosLat) < 1e-9 ? 180 : Math.min(180, geo.radiusM / (M_PER_DEG_LAT * Math.abs(cosLat)));
    const latMin = geo.lat - dLat;
    const latMax = geo.lat + dLat;
    let lngMin = geo.lng - dLng;
    let lngMax = geo.lng + dLng;
    const latClause = Prisma.sql`l.lat BETWEEN ${latMin} AND ${latMax}`;
    // Antimeridian (L2-10): if the lng window wraps past ±180, split into (lng ≥ min) OR (lng ≤ max).
    if (lngMin < -180 || lngMax > 180) {
      lngMin = ((lngMin + 180) % 360 + 360) % 360 - 180;
      lngMax = ((lngMax + 180) % 360 + 360) % 360 - 180;
      return Prisma.sql`(${latClause} AND (l.lng >= ${lngMin} OR l.lng <= ${lngMax}))`;
    }
    return Prisma.sql`(${latClause} AND l.lng BETWEEN ${lngMin} AND ${lngMax})`;
  }

  /** The owner/visibility scope as a SQL fragment (mirrors {@link listScope}). null = unrestricted. */
  private async listScopeSql(actor: AuthPrincipal | undefined): Promise<Prisma.Sql | null> {
    if (actor && (actor.role === 'ADMIN' || actor.role === 'MODERATOR')) return null;
    const ors: Prisma.Sql[] = [Prisma.sql`l.status = 'ACTIVE'`];
    if (actor) {
      ors.push(Prisma.sql`l.seller_id = ${actor.userId}::uuid`);
      const orgIds = await this.orgMembership.orgAdminIds(actor.userId);
      if (orgIds.length) {
        ors.push(Prisma.sql`l.organization_id IN (${Prisma.join(orgIds.map((o) => Prisma.sql`${o}::uuid`))})`);
      }
    }
    return Prisma.sql`(${Prisma.join(ors, ' OR ')})`;
  }

  /**
   * The read-scope clause (L-5). null = unrestricted (ADMIN, or MODERATOR R-any operator scope).
   * Otherwise: ACTIVE listings are public, PLUS the caller's own listings (seller, or org the caller
   * org-admins) in any state. An anonymous caller (no actor) sees ACTIVE only.
   */
  private async listScope(actor: AuthPrincipal | undefined): Promise<Prisma.listingsWhereInput | null> {
    if (actor && (actor.role === 'ADMIN' || actor.role === 'MODERATOR')) return null;
    const ors: Prisma.listingsWhereInput[] = [{ status: 'ACTIVE' }];
    if (actor) {
      ors.push({ seller_id: actor.userId });
      const orgIds = await this.orgMembership.orgAdminIds(actor.userId);
      if (orgIds.length) ors.push({ organization_id: { in: orgIds } });
    }
    return { OR: ors };
  }

  // ── Photos ───────────────────────────────────────────────────────────────────────────────────
  async listPhotos(id: string, actor: AuthPrincipal | undefined): Promise<ListingPhotoView[]> {
    const row = await this.findRow(id);
    if (row.status !== 'ACTIVE' && !(await this.canSeeNonActive(actor, row))) {
      throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    }
    const photos = await this.prisma.listing_photos.findMany({
      where: { listing_id: id },
      orderBy: [{ order_index: 'asc' }, { created_at: 'asc' }],
    });
    return photos.map((p) => this.toPhotoView(p));
  }

  async addPhoto(id: string, dto: ListingPhotoCreateDto, actor: AuthPrincipal): Promise<ListingPhotoView> {
    const existing = await this.findRow(id);
    await this.assertCanMutate(actor, existing); // L-3
    this.assertOwnMediaHost(dto.url); // AUDIT3: own-S3 host allowlist (moderation-swap + SSRF defence)
    // L-14: MAX_MEDIA_ITEMS cap, service-layer.
    const count = await this.prisma.listing_photos.count({ where: { listing_id: id } });
    if (count >= MAX_MEDIA_ITEMS) {
      throw new UnprocessableEntityException({ message: `A listing may have at most ${MAX_MEDIA_ITEMS} photos`, code: 'VALIDATION_ERROR' });
    }
    const photo = await this.runWrite(() =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.listing_photos.create({
          data: { listing_id: id, url: dto.url, order_index: dto.orderIndex ?? 0 },
        });
        await this.audit.record(
          {
            actorId: actor.userId,
            actorRole: actor.role,
            actorPrincipalType: actor.principalType,
            action: 'listing.photo_added',
            entityType: 'listing',
            entityId: id,
            afterData: { photoId: created.id },
          },
          tx,
        );
        return created;
      }),
    );
    this.logger.log(`Photo ${photo.id} added to listing ${id} by ${actor.userId}`);
    return this.toPhotoView(photo);
  }

  async removePhoto(id: string, photoId: string, actor: AuthPrincipal): Promise<void> {
    const existing = await this.findRow(id);
    await this.assertCanMutate(actor, existing); // L-3
    const photo = await this.prisma.listing_photos.findUnique({ where: { id: photoId } });
    if (!photo || photo.listing_id !== id) {
      throw new NotFoundException({ message: 'Photo not found', code: 'NOT_FOUND' });
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.listing_photos.delete({ where: { id: photoId } });
      await this.audit.record(
        {
          actorId: actor.userId,
          actorRole: actor.role,
          actorPrincipalType: actor.principalType,
          action: 'listing.photo_removed',
          entityType: 'listing',
          entityId: id,
          beforeData: { photoId },
        },
        tx,
      );
    });
    this.logger.log(`Photo ${photoId} removed from listing ${id} by ${actor.userId}`);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  private async findRow(id: string): Promise<ListingRow> {
    const row = (await this.prisma.listings.findUnique({ where: { id } })) as unknown as ListingRow | null;
    if (!row) throw new NotFoundException({ message: 'Listing not found', code: 'NOT_FOUND' });
    return row;
  }

  /** L-3: mutate only by the listing's seller or an org-admin of its org. ADMIN = operator scope. */
  private async assertCanMutate(actor: AuthPrincipal, row: ListingRow): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (await this.orgMembership.isPartyOrOrgAdmin(actor.userId, row.seller_id, row.organization_id)) return;
    throw new ForbiddenException({ message: 'Operation not permitted', code: 'FORBIDDEN' });
  }

  /** Can the caller see a non-ACTIVE listing (L-5)? owner/seller, org-admin, MODERATOR, or ADMIN. */
  private async canSeeNonActive(actor: AuthPrincipal | undefined, row: ListingRow): Promise<boolean> {
    if (!actor) return false;
    if (actor.role === 'ADMIN' || actor.role === 'MODERATOR') return true;
    return this.orgMembership.isPartyOrOrgAdmin(actor.userId, row.seller_id, row.organization_id);
  }

  private async assertOrgAdmin(actor: AuthPrincipal, organizationId: string): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (!(await this.orgMembership.isOrgAdmin(actor.userId, organizationId))) {
      throw new ForbiddenException({ message: 'You must be an admin of the organization', code: 'FORBIDDEN' });
    }
  }

  private assertLatLng(lat?: number, lng?: number): void {
    const hasLat = lat != null;
    const hasLng = lng != null;
    if (hasLat !== hasLng) {
      throw new UnprocessableEntityException({ message: 'lat and lng must be both set or both null', code: 'VALIDATION_ERROR' });
    }
  }

  /**
   * Map DB integrity failures to clean RFC7807 4xx — never a 500. The service guards above catch the
   * common cases; this is the safety net for the CHECK constraints and the P0 trigger (L-P0/L-4/L-9).
   */
  private async runWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientUnknownRequestError ||
        err instanceof Prisma.PrismaClientKnownRequestError
      ) {
        const msg = err.message;
        // L-P0: the ACTIVE-requires-APPROVED trigger.
        if (/cannot be ACTIVE unless moderation_status/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'A listing cannot be ACTIVE until approved by a moderator', code: 'VALIDATION_ERROR' });
        }
        if (/chk_listing_ownership/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'Invalid personal/organizational ownership combination', code: 'VALIDATION_ERROR' });
        }
        if (/chk_listings_latlng/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'lat/lng must be both-null or both-set within range', code: 'VALIDATION_ERROR' });
        }
        if (/chk_listings_price_nonneg|chk_listings_quantity_pos|chk_listings_currency_iso/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'Invalid price/quantity/currency value', code: 'VALIDATION_ERROR' });
        }
        if (/foreign key|23503/i.test(msg)) {
          throw new UnprocessableEntityException({ message: 'A referenced animal/organization/branch does not exist', code: 'INVALID_REFERENCE' });
        }
      }
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new UnprocessableEntityException({ message: 'A referenced animal/organization/branch does not exist', code: 'INVALID_REFERENCE' });
      }
      throw err;
    }
  }

  private etag(row: ListingRow): string {
    return weakEtag(`listing:${row.id}`, row.updated_at);
  }

  private normalizeLocalized(value?: { en?: string; ru?: string }): LocalizedString {
    return { en: value?.en ?? '', ru: value?.ru ?? '' };
  }

  private toPhotoView(p: { id: string; listing_id: string; url: string; order_index: number; created_at: Date }): ListingPhotoView {
    return { id: p.id, listingId: p.listing_id, url: p.url, orderIndex: p.order_index, createdAt: p.created_at };
  }

  private toView(row: ListingRow): ListingView {
    return {
      id: row.id,
      animalId: row.animal_id,
      sellerId: row.seller_id,
      organizationId: row.organization_id,
      branchId: row.branch_id,
      metadata: (row.metadata as Record<string, unknown>) ?? {},
      listingType: row.listing_type as ListingView['listingType'],
      titleLocalized: (row.title_localized as LocalizedString) ?? { en: '', ru: '' },
      descriptionLocalized: (row.description_localized as LocalizedString) ?? { en: '', ru: '' },
      priceCents: row.price_cents === null ? null : Number(row.price_cents),
      currency: row.currency,
      quantity: row.quantity ?? 1,
      isActive: row.is_active,
      // D1: funnel-top view counter (defensive ?? 0 — the column is NOT NULL DEFAULT 0, migration 0031).
      viewCount: Number(row.view_count ?? 0n),
      status: row.status as ListingStatus,
      moderationStatus: row.moderation_status as ListingView['moderationStatus'],
      publishedAt: row.published_at,
      soldAt: row.sold_at,
      transactionId: row.transaction_id,
      lat: row.lat,
      lng: row.lng,
      // L2-14: distanceM only on a geo search (raw row carries distance_m); rounded meters, else null.
      distanceM: row.distance_m === undefined || row.distance_m === null ? null : Math.round(row.distance_m),
      // EMB-4: null by default — only the single-get (getById, owner/operator) populates this; the
      // list path never embeds it (no per-row N+1 moderation lookup).
      lastModerationResult: null,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
