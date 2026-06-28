import {
  BadRequestException,
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
import { paginate, type Paginated } from '../../lib/pagination/page';
import { weakEtag, assertIfMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ModerationService } from '../moderation/moderation.service';
import {
  type ListingCreateDto,
  type ListingListQueryDto,
  type ListingPhotoCreateDto,
  type ListingPhotoView,
  type ListingStatus,
  type ListingUpdateDto,
  type ListingView,
  type LocalizedString,
} from './dto/listing.dto';

/** MAX_MEDIA_ITEMS (listing_state_machine.md constants) — L-14. */
const MAX_MEDIA_ITEMS = 10;
/** MIN_LISTING_PRICE for a `sale` submit guard (listing_state_machine.md) — L-6. */
const MIN_LISTING_PRICE = 0;
/** States from which an owner soft-withdraw is allowed (L-8); terminal states reject with 409. */
const WITHDRAWABLE: ReadonlySet<ListingStatus> = new Set(['DRAFT', 'PENDING_MODERATION', 'ACTIVE']);

// ── Geo search constants (Slice 2; geo-spec 07-geo-search-service.md §137–153) ─────────────────
const EARTH_RADIUS_M = 6_371_000;
const M_PER_DEG_LAT = 111_320; // meters per degree latitude
const RADIUS_KM_MIN = 1;
const RADIUS_KM_MAX = 100;
const BOUNDARY_TOLERANCE_M = 100; // ±100 m so "exactly at radius" is included (§141, L2-7)
/** Whitelisted sort fields (L2-11). `distance` requires geo coords (L2-12). */
const SORT_FIELDS = new Set(['created_at', 'price', 'distance']);

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

interface AnimalOwnerRow {
  id: string;
  owner_id: string | null;
  organization_id: string | null;
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
  ) {}

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

    const animal = await this.loadAnimal(dto.animalId);
    // L-2: actor must own the animal (or be org-admin of its owning org).
    await this.assertOwnsAnimal(actor, animal);

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
  async getById(id: string, actor: AuthPrincipal | undefined): Promise<{ listing: ListingView; etag: string }> {
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
    return { listing: view, etag: this.etag(row) };
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
   * ESLint-guarded, L2-15). The market filter (L2-1) is a MANDATORY AND-composed join clause
   * `l.animal_id → a.species_id → s.market`, so it can only narrow, never widen across markets.
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

    // L2-1: market — mandatory AND-composed species-join clause (narrow-only, never widen).
    if (query.market !== undefined) conds.push(Prisma.sql`s.market = ${query.market}`);
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

    // The exact-distance filter (L2-7, ±100 m tolerance) wraps the bbox-prefiltered set.
    const fromSql = Prisma.sql`
      FROM listings l
      JOIN animals a ON a.id = l.animal_id
      JOIN species s ON s.id = a.species_id
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
      const orgIds = await this.orgAdminIds(actor.userId);
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
      const orgIds = await this.orgAdminIds(actor.userId);
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

  private async loadAnimal(animalId: string): Promise<AnimalOwnerRow> {
    const animal = await this.prisma.animals.findUnique({
      where: { id: animalId },
      select: { id: true, owner_id: true, organization_id: true },
    });
    if (!animal) throw new NotFoundException({ message: 'Animal not found', code: 'NOT_FOUND' });
    return animal;
  }

  /** L-2: the actor owns the animal (owner_id==actor) or is org-admin of its owning org. */
  private async assertOwnsAnimal(actor: AuthPrincipal, animal: AnimalOwnerRow): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (animal.owner_id && animal.owner_id === actor.userId) return;
    if (animal.organization_id && (await this.isOrgAdmin(actor.userId, animal.organization_id))) return;
    throw new ForbiddenException({ message: 'You do not own this animal', code: 'FORBIDDEN' });
  }

  /** L-3: mutate only by the listing's seller or an org-admin of its org. ADMIN = operator scope. */
  private async assertCanMutate(actor: AuthPrincipal, row: ListingRow): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (row.seller_id === actor.userId) return;
    if (row.organization_id && (await this.isOrgAdmin(actor.userId, row.organization_id))) return;
    throw new ForbiddenException({ message: 'Operation not permitted', code: 'FORBIDDEN' });
  }

  /** Can the caller see a non-ACTIVE listing (L-5)? owner/seller, org-admin, MODERATOR, or ADMIN. */
  private async canSeeNonActive(actor: AuthPrincipal | undefined, row: ListingRow): Promise<boolean> {
    if (!actor) return false;
    if (actor.role === 'ADMIN' || actor.role === 'MODERATOR') return true;
    if (row.seller_id === actor.userId) return true;
    if (row.organization_id && (await this.isOrgAdmin(actor.userId, row.organization_id))) return true;
    return false;
  }

  private async assertOrgAdmin(actor: AuthPrincipal, organizationId: string): Promise<void> {
    if (actor.role === 'ADMIN') return;
    if (!(await this.isOrgAdmin(actor.userId, organizationId))) {
      throw new ForbiddenException({ message: 'You must be an admin of the organization', code: 'FORBIDDEN' });
    }
  }

  private async isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
    const m = await this.prisma.organization_users.findFirst({
      where: { user_id: userId, organization_id: organizationId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { id: true },
    });
    return m !== null;
  }

  private async orgAdminIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.organization_users.findMany({
      where: { user_id: userId, role_in_org: 'OWNER', status: 'ACTIVE' },
      select: { organization_id: true },
    });
    return rows.map((r) => r.organization_id);
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
