import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import type { AuthPrincipal } from '../../lib/auth/principal';
import {
  FILTERS_MAX_BYTES,
  RADIUS_M_MAX,
  RADIUS_M_MIN,
  SavedSearchFiltersDto,
  type SavedSearchCreateDto,
  type SavedSearchListQueryDto,
  type SavedSearchView,
} from './dto/saved-search.dto';

/** Whitelisted sort fields (SS-5). Default deterministic sort is `created_at:desc`. */
const SORT_FIELDS = new Set(['created_at', 'updated_at']);

interface ParsedSort {
  field: 'created_at' | 'updated_at';
  dir: 'asc' | 'desc';
}

/** A raw `saved_searches` row narrowed to the columns this domain reads/maps. */
interface SavedSearchRow {
  id: string;
  user_id: string;
  name: string | null;
  filters: unknown;
  lat: number | null;
  lng: number | null;
  radius_m: number | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Saved-search lifecycle — save / list / delete (geo-search-api.yaml `/saved-searches`; spec 07
 * round-5 invariants SS-1..SS-6). Plain owner-scoped CRUD on `saved_searches` (Prisma; ADR-0007 keeps
 * the logic in the service). Reuses the platform pagination util; POST idempotency is the controller's
 * IdempotencyInterceptor (SS-6) — there is NO DB uniqueness here, two saves with different keys are
 * allowed by design.
 *
 * IDOR is closed structurally: the owner is ALWAYS the authenticated actor (`actor.userId`, never
 * client-supplied), the list `WHERE user_id = :actorId` is absolute (no operator widening, SS-1), and
 * the delete is a guarded `deleteMany WHERE id AND user_id` whose 0-row outcome is an indistinguishable
 * 404 for both "missing" and "not owned" (no existence leak, SS-2).
 *
 * No audit row is written for create/delete: a saved search is the user's own low-sensitivity,
 * own-scoped preference data (no cross-user / moderation / security dimension, and ФЗ-152
 * data-minimization argues against logging it) — consistent with the "don't over-add" guidance and the
 * absence of a sibling audited-personal-collection precedent.
 */
@Injectable()
export class SavedSearchService {
  private readonly logger = new Logger(SavedSearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Create ───────────────────────────────────────────────────────────────────────────────────
  async create(dto: SavedSearchCreateDto, actor: AuthPrincipal): Promise<SavedSearchView> {
    const filters = this.validateFilters(dto.filters); // SS-3
    this.validateLocation(dto.lat, dto.lng, dto.radiusM); // SS-4

    const data: Prisma.saved_searchesUncheckedCreateInput = {
      user_id: actor.userId, // SS-1/SS-2: server-derived owner; a body userId is rejected by the global pipe
      name: dto.name ?? null,
      filters: filters as Prisma.InputJsonValue,
      lat: dto.lat ?? null,
      lng: dto.lng ?? null,
      radius_m: dto.radiusM ?? null,
    };

    const row = await this.runWrite(() => this.prisma.saved_searches.create({ data })) as unknown as SavedSearchRow;
    this.logger.log(`Saved search created ${row.id} by ${actor.userId}`);
    return this.toView(row);
  }

  // ── List (own-scope, paginated) ──────────────────────────────────────────────────────────────
  async list(query: SavedSearchListQueryDto, actor: AuthPrincipal): Promise<Paginated<SavedSearchView>> {
    const sort = this.parseSort(query.sort); // SS-5: whitelist or 400 INVALID_SORT

    // SS-1: own-scope is absolute — `user_id = actor` for EVERY role (no MODERATOR/ADMIN widening).
    const where: Prisma.saved_searchesWhereInput = { user_id: actor.userId };
    const [rows, total] = await Promise.all([
      this.prisma.saved_searches.findMany({
        where,
        orderBy: [{ [sort.field]: sort.dir }, { id: 'desc' }], // stable tie-break
        skip: query.skip,
        take: query.limit,
      }) as unknown as Promise<SavedSearchRow[]>,
      this.prisma.saved_searches.count({ where }),
    ]);

    return paginate(rows.map((r) => this.toView(r)), total, query.page, query.limit);
  }

  // ── Delete (404-no-leak) ─────────────────────────────────────────────────────────────────────
  async delete(id: string, actor: AuthPrincipal): Promise<void> {
    // SS-2: guarded by (id AND user_id). A non-existent OR non-owned id deletes 0 rows → 404, byte-for-byte
    // identical in both cases. NEVER 403 (403 vs 404 would leak which ids exist → IDOR/enumeration).
    const res = await this.prisma.saved_searches.deleteMany({ where: { id, user_id: actor.userId } });
    if (res.count === 0) {
      throw new NotFoundException({ message: 'Saved search not found', code: 'SAVED_SEARCH_NOT_FOUND' });
    }
    this.logger.log(`Saved search deleted ${id} by ${actor.userId}`);
  }

  // ── internals ────────────────────────────────────────────────────────────────────────────────

  /**
   * SS-3: validate `filters` against the bounded whitelist. Order: shape → size cap → per-key
   * whitelist+types (class-validator on {@link SavedSearchFiltersDto} with forbidNonWhitelisted) →
   * price coherence. Any violation → 422 INVALID_FILTERS. Returns the object verbatim (it can only
   * contain whitelisted keys once it passes, so arbitrary JSON is never persisted).
   */
  private validateFilters(raw: unknown): Record<string, unknown> {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw this.invalidFilters('filters must be an object');
    }
    const filters = raw as Record<string, unknown>;

    // Size cap (SS-3) — checked before persist, on the serialized JSON.
    if (Buffer.byteLength(JSON.stringify(filters), 'utf8') > FILTERS_MAX_BYTES) {
      throw this.invalidFilters(`filters exceed the ${FILTERS_MAX_BYTES}-byte size cap`);
    }

    // Whitelist + per-key types (additionalProperties:false). `forbidNonWhitelisted` flags any key
    // without a decorator on SavedSearchFiltersDto → unknown keys are rejected; arbitrary JSON never stored.
    const instance = plainToInstance(SavedSearchFiltersDto, filters);
    const errors = validateSync(instance, {
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
    });
    if (errors.length > 0) {
      throw this.invalidFilters('filters contain an unknown key or an invalid value', errors);
    }

    // price_max ≥ price_min when both set (SS-3).
    const min = filters.price_min;
    const max = filters.price_max;
    if (typeof min === 'number' && typeof max === 'number' && max < min) {
      throw this.invalidFilters('price_max must be ≥ price_min');
    }

    return filters;
  }

  /**
   * SS-4: location coherence — this app-level check is the AUTHORITATIVE both-or-neither guard.
   * The DB has no CHECK on `radius_m`, and `chk_saved_searches_latlng` is only a partial backstop:
   * by SQL three-valued logic a lat-only row (lng NULL) evaluates the CHECK to NULL → treated as
   * pass, so the DB does NOT reject the one-present/one-null case. Hence: lat & lng must be
   * both-present or both-absent; `radius_m` is required when a point is present and MUST be absent
   * when no point; when present it is within [1000,100000] — all enforced here.
   */
  private validateLocation(lat?: number | null, lng?: number | null, radiusM?: number | null): void {
    const hasLat = lat != null;
    const hasLng = lng != null;
    const hasPoint = hasLat && hasLng;
    const hasRadius = radiusM != null;

    // Coherence (one of lat/lng missing, or radius/point mismatch) → GEO_PARAMS_INCOMPLETE.
    if (hasLat !== hasLng) {
      throw this.geoIncomplete('lat and lng must be provided together');
    }
    if (hasPoint && !hasRadius) {
      throw this.geoIncomplete('radiusM is required when a point (lat/lng) is provided');
    }
    if (!hasPoint && hasRadius) {
      throw this.geoIncomplete('radiusM requires a point (lat/lng)');
    }
    // Bound (only meaningful when a coherent radius is present) → RADIUS_OUT_OF_RANGE.
    if (typeof radiusM === 'number' && (radiusM < RADIUS_M_MIN || radiusM > RADIUS_M_MAX)) {
      throw new UnprocessableEntityException({
        message: `radiusM must be between ${RADIUS_M_MIN} and ${RADIUS_M_MAX} meters`,
        code: 'RADIUS_OUT_OF_RANGE',
      });
    }
  }

  /** Parse + whitelist the sort (SS-5). Unknown field/direction → 400 INVALID_SORT. */
  private parseSort(sort: string | undefined): ParsedSort {
    if (!sort) return { field: 'created_at', dir: 'desc' };
    const [field, dir] = sort.split(':');
    if (!SORT_FIELDS.has(field) || (dir !== 'asc' && dir !== 'desc')) {
      throw new BadRequestException({
        message: 'sort must be <created_at|updated_at>:<asc|desc>',
        code: 'INVALID_SORT',
      });
    }
    return { field: field as ParsedSort['field'], dir };
  }

  private invalidFilters(message: string, errors?: unknown[]): UnprocessableEntityException {
    return new UnprocessableEntityException({
      message,
      code: 'INVALID_FILTERS',
      ...(errors && errors.length ? { errors } : {}),
    });
  }

  private geoIncomplete(message: string): UnprocessableEntityException {
    return new UnprocessableEntityException({ message, code: 'GEO_PARAMS_INCOMPLETE' });
  }

  /** Map DB integrity failures (e.g. chk_saved_searches_latlng) to a clean 422 — never a 500. */
  private async runWrite<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError ||
        err instanceof Prisma.PrismaClientUnknownRequestError
      ) {
        if (/chk_saved_searches_latlng/i.test(err.message)) {
          throw this.geoIncomplete('lat/lng must be both-null or both-within-range');
        }
      }
      throw err;
    }
  }

  private toView(row: SavedSearchRow): SavedSearchView {
    return {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      filters: (row.filters as Record<string, unknown>) ?? {},
      lat: row.lat,
      lng: row.lng,
      radiusM: row.radius_m,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
