import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ListingService } from '../listing/listing.service';
import { FavoriteListQueryDto, type FavoriteView } from './dto/favorite.dto';

/**
 * OfferingRef seam (ADR-0014 §Amendment 2026-07-04 rule 11, migration 0032). A favorite references one
 * offering: `offering_type` is the discriminator (only ANIMAL_LISTING today, DB CHECK-guarded) and
 * `offering_id` is the TRUTHFUL polymorphic pointer (NOT NULL — the D2 forcing function; today ==
 * listing_id). Written as a constant here so the shape exists from day one; behaviour is listing-only.
 */
const OFFERING_TYPE_ANIMAL_LISTING = 'ANIMAL_LISTING' as const;

/** A raw `favorites` row narrowed to the columns this domain reads/maps. */
interface FavoriteRow {
  id: string;
  user_id: string;
  listing_id: string;
  offering_type: string;
  offering_id: string;
  created_at: Date;
}

/**
 * Favorites lifecycle — add / list / remove (favorites-api.yaml v1.0.0). Plain owner-scoped CRUD on the
 * `favorites` table (Prisma; ADR-0007 keeps the logic in the service). A favorite is a user's own,
 * low-sensitivity personal collection — modelled exactly like the sibling saved-search domain:
 *
 *  - IDOR is closed structurally: the owner is ALWAYS the authenticated actor (`actor.userId`, never
 *    client-supplied). The list `WHERE user_id = :actorId` is absolute — no MODERATOR/ADMIN widening
 *    (a favorite list is private preference data, not a moderation surface).
 *  - Add is idempotent by the DB UNIQUE(user_id, listing_id) (`uq_favorite_user_listing`): a repeat add
 *    of the same listing returns the existing row (201), never a duplicate (P2002 → return-existing).
 *  - Remove is keyed by the (public) listing id, so it is a guarded `deleteMany WHERE listing_id AND
 *    user_id` whose outcome is discarded → **204 always** (favorites-api: "Removed (or was absent)").
 *    This is idempotent AND leak-free in one: whether the favorite was missing, or belongs to another
 *    user, we delete 0 rows and answer an identical 204 — a caller can never probe existence/ownership.
 *  - Before an add, the target listing must be VISIBLE to the actor (ListingService.assertVisibleToActor):
 *    public when ACTIVE, else owner/operator-only — so a user cannot favorite (and thereby probe the
 *    existence of) another user's DRAFT. A missing/invisible listing → indistinguishable 404 (no-leak).
 *
 * No audit row is written for add/remove: a favorite is the user's own low-sensitivity, own-scoped
 * preference data (no cross-user / moderation / security dimension; ФЗ-152 data-minimization argues
 * against logging it) — identical to the saved-search precedent.
 */
@Injectable()
export class FavoriteService {
  private readonly logger = new Logger(FavoriteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingService, // reuse the single read-visibility definition (D10/D11)
  ) {}

  // ── Add (idempotent → 201) ────────────────────────────────────────────────────────────────────
  async add(listingId: string, actor: AuthPrincipal): Promise<FavoriteView> {
    // Visibility gate: an ACTIVE listing is public; a non-ACTIVE one is owner/operator-only. Missing OR
    // invisible → indistinguishable 404 (no-leak) — favoriting can never probe another user's DRAFT.
    await this.listings.assertVisibleToActor(listingId, actor);

    const data: Prisma.favoritesUncheckedCreateInput = {
      user_id: actor.userId, // server-derived owner (IDOR class); a body userId is rejected by the global pipe
      listing_id: listingId,
      // OfferingRef seam (0032): today offering_id == listing_id (truthful pointer; offering_id is NOT NULL).
      offering_type: OFFERING_TYPE_ANIMAL_LISTING,
      offering_id: listingId,
    };

    try {
      const created: FavoriteRow = await this.prisma.favorites.create({ data });
      this.logger.log(`Favorite added ${created.id} (listing ${listingId}) by ${actor.userId}`);
      return this.toView(created);
    } catch (err) {
      // Idempotent add: a repeat of the same (user, listing) hits UNIQUE uq_favorite_user_listing → return
      // the existing row as a 201 (favorites-api: "Added (or already present)"), never a duplicate.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing: FavoriteRow | null = await this.prisma.favorites.findFirst({
          where: { user_id: actor.userId, listing_id: listingId },
        });
        if (existing) return this.toView(existing);
      }
      throw err;
    }
  }

  // ── List (own-scope, paginated) ───────────────────────────────────────────────────────────────
  async list(query: FavoriteListQueryDto, actor: AuthPrincipal): Promise<Paginated<FavoriteView>> {
    // Own-scope is absolute — `user_id = actor` for EVERY role (no MODERATOR/ADMIN widening).
    const where: Prisma.favoritesWhereInput = { user_id: actor.userId };
    const [rows, total] = await Promise.all([
      this.prisma.favorites.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }], // stable, deterministic tie-break
        skip: query.skip,
        take: query.limit,
      }) as unknown as Promise<FavoriteRow[]>,
      this.prisma.favorites.count({ where }),
    ]);

    return paginate(rows.map((r) => this.toView(r)), total, query.page, query.limit);
  }

  // ── Remove (idempotent → 204, leak-free) ──────────────────────────────────────────────────────
  async remove(listingId: string, actor: AuthPrincipal): Promise<void> {
    // Guarded by (listing_id AND user_id). A never-favorited OR another user's favorite deletes 0 rows;
    // the count is intentionally discarded → an identical 204 in every case (favorites-api: no 404). This
    // is both idempotent (DELETE) and leak-free (a caller cannot distinguish missing from not-owned).
    await this.prisma.favorites.deleteMany({ where: { listing_id: listingId, user_id: actor.userId } });
    this.logger.log(`Favorite removed (listing ${listingId}) by ${actor.userId}`);
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────────
  private toView(row: FavoriteRow): FavoriteView {
    return {
      id: row.id,
      offeringType: row.offering_type,
      offeringId: row.offering_id,
      // Deprecated alias == offeringId while offeringType == ANIMAL_LISTING (the only type today).
      listingId: row.listing_id,
      createdAt: row.created_at,
    };
  }
}
