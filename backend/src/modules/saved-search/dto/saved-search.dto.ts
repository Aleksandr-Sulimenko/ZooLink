import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Saved-search Domain DTOs (geo-search-api.yaml v1.1.0 `/saved-searches`, spec 07 round-5, SS-1..SS-6).
 * camelCase wire bodies (API_CONVENTIONS §0); the service maps to the snake_case `saved_searches`
 * columns. Money (price_min/price_max in `filters`) is integer minor units / kopecks (§7).
 *
 * `userId` is NOT writable (server-derived from the actor, IDOR class, SS-1/SS-2) — it is absent from
 * the create DTO so the global ValidationPipe (`forbidNonWhitelisted`) rejects it (400). `status`-like
 * server fields do not exist here.
 *
 * NOTE on validation routing: `filters` is intentionally typed as a raw object on {@link SavedSearchCreateDto}
 * (NOT @ValidateNested) so the global pipe does NOT recurse into it and 400 on a bad key. Instead the
 * service validates it against {@link SavedSearchFiltersDto} (the bounded whitelist) and raises a
 * domain-level **422 INVALID_FILTERS** per SS-3. `radiusM` bounds and lat/lng/radius coherence are
 * likewise validated in the service (422 RADIUS_OUT_OF_RANGE / GEO_PARAMS_INCOMPLETE, SS-4), mirroring
 * the listing Slice-2 `parseGeo` precedent — the contract assigns specific 422 codes, not an edge 400.
 */

/** Market scope (ADR-0002 hard split). Mirrors the /geo-search `market` enum. */
export const SAVED_SEARCH_MARKETS = ['pet', 'livestock'] as const;
export type SavedSearchMarket = (typeof SAVED_SEARCH_MARKETS)[number];

/**
 * Mirrors the /geo-search listing_type enum for Phase-2 re-executability (spec 07 §157). `leasing`
 * (listings migration 0021) is intentionally NOT here until /geo-search accepts it (Phase-2 mapping).
 */
export const SAVED_SEARCH_LISTING_TYPES = ['sale', 'breeding', 'show', 'adoption', 'stud_service'] as const;
export type SavedSearchListingType = (typeof SAVED_SEARCH_LISTING_TYPES)[number];

/** Radius bounds (meters), mirrors /geo-search (1km..100km), SS-4. */
export const RADIUS_M_MIN = 1000;
export const RADIUS_M_MAX = 100000;
/** Serialized-`filters` JSON size cap (bytes), SS-3. */
export const FILTERS_MAX_BYTES = 2048;

/**
 * The bounded `saved_searches.filters` whitelist (SS-3, geo-search-api SavedSearchFilters,
 * `additionalProperties:false`). The service validates a candidate `filters` object against this class
 * with `{ whitelist: true, forbidNonWhitelisted: true }`: any key outside this set, or a type/range
 * mismatch, yields a validation error → 422 INVALID_FILTERS. Arbitrary client JSON is NEVER stored.
 */
export class SavedSearchFiltersDto {
  @ApiPropertyOptional({ maxLength: 200, description: 'Free-text query (spec 07 §156)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiPropertyOptional({ enum: SAVED_SEARCH_MARKETS, description: 'Market scope (ADR-0002); market-pins the saved search' })
  @IsOptional()
  @IsIn(SAVED_SEARCH_MARKETS)
  market?: SavedSearchMarket;

  @ApiPropertyOptional({ description: 'Species lookup id (INT, ZooLink id convention)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  species_id?: number;

  @ApiPropertyOptional({ description: 'Breed lookup id (INT)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  breed_id?: number;

  @ApiPropertyOptional({ enum: SAVED_SEARCH_LISTING_TYPES })
  @IsOptional()
  @IsIn(SAVED_SEARCH_LISTING_TYPES)
  listing_type?: SavedSearchListingType;

  @ApiPropertyOptional({ description: 'Minimum price, integer minor units (kopecks), §7' })
  @IsOptional()
  @IsInt()
  @Min(0)
  price_min?: number;

  @ApiPropertyOptional({ description: 'Maximum price, integer minor units (kopecks), §7; MUST be ≥ price_min' })
  @IsOptional()
  @IsInt()
  @Min(0)
  price_max?: number;
}

export class SavedSearchCreateDto {
  @ApiPropertyOptional({ maxLength: 100, nullable: true, description: 'Optional friendly name (no per-user uniqueness, SS-6)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ type: SavedSearchFiltersDto, description: 'Bounded whitelist (SS-3); validated in the service → 422 INVALID_FILTERS' })
  @IsObject()
  filters!: Record<string, unknown>;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, nullable: true, description: 'Search-center latitude (both-or-neither with lng, SS-4)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, nullable: true, description: 'Search-center longitude (both-or-neither with lat, SS-4)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Radius in meters; required iff a point is present; bounds [1000,100000] (SS-4, service-validated)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  radiusM?: number;
}

/** GET /saved-searches query (geo-search-api listSavedSearches). page/limit + whitelisted sort (SS-5). */
export class SavedSearchListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({
    example: 'created_at:desc',
    description: 'Sort <field>:<asc|desc>; whitelist created_at|updated_at (SS-5). Bad value → 400 INVALID_SORT (service-validated).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sort?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** Wire shape of a SavedSearch (geo-search-api SavedSearch). camelCase; `filters` returned verbatim. */
export interface SavedSearchView {
  id: string;
  userId: string;
  name: string | null;
  filters: Record<string, unknown>;
  lat: number | null;
  lng: number | null;
  radiusM: number | null;
  createdAt: Date;
  updatedAt: Date;
}
