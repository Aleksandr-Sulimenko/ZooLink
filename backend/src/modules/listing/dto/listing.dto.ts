import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { OwnerModerationResultView } from '../../moderation/dto/moderation.dto';

/**
 * Listing Domain DTOs (listings-api.yaml, Slice 1). camelCase wire bodies (API_CONVENTIONS §0); the
 * service maps to the snake_case `listings`/`listing_photos` columns. Money in integer minor units
 * (§7). LocalizedString {en, ru} per §6.
 *
 * Not writable here (L-12, server-controlled): `sellerId` (derived from the actor, L-1), `status`,
 * `moderationStatus`, `market` (derived from the animal's species, ADR-0002 / L-10). They are absent
 * from the create/update DTOs → the global ValidationPipe (`forbidNonWhitelisted`) rejects them (400).
 */

export const LISTING_TYPES = ['sale', 'breeding', 'show', 'adoption', 'stud_service', 'leasing'] as const;
export type ListingType = (typeof LISTING_TYPES)[number];

/** Markets (ADR-0002 hard split). The market filter joins via the animal's species. */
export const MARKETS = ['pet', 'livestock'] as const;
export type Market = (typeof MARKETS)[number];

/** Lifecycle states (read-only on the wire; server-set). */
export type ListingStatus = 'DRAFT' | 'PENDING_MODERATION' | 'ACTIVE' | 'EXPIRED' | 'SOLD' | 'DEACTIVATED';
export type ModerationStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CHANGES_REQUESTED';

const CURRENCY = /^[A-Z]{3}$/;

/** LocalizedString {en, ru} (API_CONVENTIONS §6). */
export class LocalizedStringDto {
  @ApiPropertyOptional({ description: 'English text' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  en?: string;

  @ApiPropertyOptional({ description: 'Russian text' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  ru?: string;
}

export class ListingCreateDto {
  @ApiProperty({ format: 'uuid', description: 'Animal being listed (actor must own it, L-2)' })
  @IsUUID()
  animalId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Owning organization (org listing)' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Branch (implies organizationId, chk_listing_ownership)' })
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @ApiPropertyOptional({ type: Object, description: 'Extensibility JSONB' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @ApiProperty({ enum: LISTING_TYPES })
  @IsIn(LISTING_TYPES)
  listingType!: ListingType;

  @ApiProperty({ type: LocalizedStringDto, description: 'Title (≥1 non-empty locale required)' })
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  titleLocalized!: LocalizedStringDto;

  @ApiPropertyOptional({ type: LocalizedStringDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  descriptionLocalized?: LocalizedStringDto;

  @ApiPropertyOptional({ nullable: true, description: 'Price in minor units (≥0; L-9)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional({ default: 'RUB', description: 'ISO-4217 currency' })
  @IsOptional()
  @IsString()
  @Matches(CURRENCY, { message: 'currency must be a 3-letter ISO-4217 code' })
  currency?: string;

  @ApiPropertyOptional({ default: 1, description: 'Quantity (≥1; L-9)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Latitude (-90..90; both-null-or-both-set with lng)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ nullable: true, description: 'Longitude (-180..180; both-null-or-both-set with lat)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

/** Mutable fields only (L-12). status/moderationStatus/sellerId/animalId/listingType are NOT here. */
export class ListingUpdateDto {
  @ApiPropertyOptional({ type: LocalizedStringDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  titleLocalized?: LocalizedStringDto;

  @ApiPropertyOptional({ type: LocalizedStringDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  descriptionLocalized?: LocalizedStringDto;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(CURRENCY, { message: 'currency must be a 3-letter ISO-4217 code' })
  currency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class ListingPhotoCreateDto {
  @ApiProperty({ format: 'uri', description: 'Photo URL' })
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  url!: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  orderIndex?: number;
}

function toBool({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** List query (listings-api.yaml listListings). snake_case query params per §12. */
export class ListingListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  animal_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  seller_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  branch_id?: string;

  @ApiPropertyOptional({ enum: LISTING_TYPES })
  @IsOptional()
  @IsIn(LISTING_TYPES)
  listing_type?: ListingType;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price_min?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  price_max?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(CURRENCY)
  currency?: string;

  // ── Slice 2: discovery (market / species / breed / geo / sort) ───────────────────────────────
  @ApiPropertyOptional({ enum: MARKETS, description: 'Market filter (ADR-0002); conditional-required (L2-2)' })
  @IsOptional()
  @IsIn(MARKETS)
  market?: Market;

  @ApiPropertyOptional({ description: 'Species id (INT lookup; AND-intersected with market)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  species_id?: number;

  @ApiPropertyOptional({ description: 'Breed id (INT lookup)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  breed_id?: number;

  @ApiPropertyOptional({ minimum: -90, maximum: 90, description: 'Search-center latitude (all-or-none geo set)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @ApiPropertyOptional({ minimum: -180, maximum: 180, description: 'Search-center longitude (all-or-none geo set)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, description: 'Search radius km (1–100; all-or-none geo set)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  radius_km?: number;

  @ApiPropertyOptional({ example: 'distance:asc', description: 'Sort <field>:<asc|desc>; whitelist created_at|price|distance' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  sort?: string;

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

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** LocalizedString {en, ru} as stored in *_localized JSONB. */
export interface LocalizedString {
  en: string;
  ru: string;
}

/** Wire shape of a Listing (listings-api.yaml Listing). */
export interface ListingView {
  id: string;
  animalId: string;
  sellerId: string;
  organizationId: string | null;
  branchId: string | null;
  metadata: Record<string, unknown>;
  listingType: ListingType;
  titleLocalized: LocalizedString;
  descriptionLocalized: LocalizedString;
  priceCents: number | null;
  currency: string | null;
  quantity: number;
  isActive: boolean;
  status: ListingStatus;
  moderationStatus: ModerationStatus;
  publishedAt: Date | null;
  soldAt: Date | null;
  transactionId: string | null;
  lat: number | null;
  lng: number | null;
  /** Distance in meters from the search center (Haversine, rounded); only on a geo search, else null (L2-14). */
  distanceM: number | null;
  /**
   * Owner-facing latest effective moderation result (Slice 4c EMB; mirrors moderation-api
   * OwnerModerationResult). Populated ONLY on GET /listings/{id} for the owner/operator (EMB-1); null
   * for a non-owner/anonymous reader and when never moderated (EMB-3). NOT embedded in the list (EMB-4).
   */
  lastModerationResult: OwnerModerationResultView | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Wire shape of a ListingPhoto. */
export interface ListingPhotoView {
  id: string;
  listingId: string;
  url: string;
  orderIndex: number;
  createdAt: Date;
}
