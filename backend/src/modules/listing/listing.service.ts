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
    return { listing: this.toView(row), etag: this.etag(row) };
  }

  // ── Update (DRAFT-edit only, mutable fields) ─────────────────────────────────────────────────
  async update(
    id: string,
    dto: ListingUpdateDto,
    ifMatch: string | undefined,
    actor: AuthPrincipal,
  ): Promise<{ listing: ListingView; etag: string }> {
    const existing = await this.findRow(id);
    await this.assertCanMutate(actor, existing); // L-3
    assertIfMatch(ifMatch, this.etag(existing)); // L-13

    // Editing is a DRAFT-only operation (state machine: DRAFT→DRAFT owner edits).
    if (existing.status !== 'DRAFT') {
      throw new ConflictException({ message: 'Only a DRAFT listing can be edited', code: 'LISTING_NOT_DRAFT' });
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

    const row = await this.runWrite(() =>
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

    this.logger.log(`Listing updated ${id} by ${actor.userId}`);
    return { listing: this.toView(row), etag: this.etag(row) };
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

  // ── List (public ACTIVE; owner-scoped for non-active) ────────────────────────────────────────
  async list(query: ListingListQueryDto, actor: AuthPrincipal | undefined): Promise<Paginated<ListingView>> {
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

    // L-5: scope. Anonymous / non-operator callers see only ACTIVE listings UNLESS the row is theirs.
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
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
