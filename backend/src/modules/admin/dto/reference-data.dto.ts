import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmptyObject,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

/**
 * The managed lookup datasets (admin-api.yaml). species/breeds/cities are the A2 core (round-9);
 * health_certifications/genetic_markers are the A3 breeding dictionaries (GAP-TRACE-002) — added to the
 * SAME registry with no shape change (the A2 extensibility proof). Code is the URL path segment `{dataset}`.
 * Only these controlled lookups are CRUD-able reference data (rbac-matrix.md); pet soft-tags
 * (temperament_tags/health_flags) are free text/JSONB and are intentionally NOT datasets.
 */
export const DATASETS = [
  'species',
  'breeds',
  'cities',
  'health_certifications',
  'genetic_markers',
] as const;
export type Dataset = (typeof DATASETS)[number];

const MARKETS = ['pet', 'livestock'] as const;
const CODE = /^[a-z0-9_]+$/;

/**
 * LocalizedString {en, ru} (API_CONVENTIONS §6). Backed by the name_localized JSONB column
 * (migration 0018). Both locales are editable by an admin; at least one must be non-empty.
 */
export class LocalizedStringDto {
  @ApiProperty({ maxLength: 100, description: 'English display name' })
  @IsString()
  @MaxLength(100)
  en!: string;

  @ApiProperty({ maxLength: 100, description: 'Russian display name' })
  @IsString()
  @MaxLength(100)
  ru!: string;
}

/** List query for GET /reference-data/{dataset} (public read; includeInactive is ADMIN-only at service layer). */
export class ListReferenceDataQueryDto {
  @ApiPropertyOptional({ default: false, description: 'Include inactive entries (ADMIN only)' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive: boolean = false;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit: number = 20;

  @ApiPropertyOptional({ maxLength: 100, description: 'Filter by name (ru/en) or code (ILIKE)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** Create body for POST /reference-data/{dataset}. Field applicability is enforced per-dataset at the service. */
export class CreateReferenceDataDto {
  @ApiPropertyOptional({ maxLength: 50, description: 'Unique code (required for species/breeds; rejected for cities)' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(CODE, { message: 'code must be lowercase alphanumeric/underscore' })
  code?: string;

  @ApiPropertyOptional({ minimum: 1, description: 'Parent species id (required for breeds; rejected otherwise)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  speciesId?: number;

  @ApiProperty({ type: LocalizedStringDto, description: 'Display name (LocalizedString {en, ru})' })
  @IsObject()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  nameLocalized!: LocalizedStringDto;

  @ApiPropertyOptional({ enum: MARKETS, description: 'Market (species only; default pet)' })
  @IsOptional()
  @IsIn(MARKETS)
  market?: (typeof MARKETS)[number];

  @ApiPropertyOptional({ default: 0, description: 'Display ordering within the dataset (ascending)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Partial update for PATCH /reference-data/{dataset}/{id}. code/speciesId are immutable (identity). */
export class UpdateReferenceDataDto {
  @ApiPropertyOptional({ type: LocalizedStringDto, description: 'Display name (LocalizedString {en, ru})' })
  @IsOptional()
  @IsObject()
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  nameLocalized?: LocalizedStringDto;

  @ApiPropertyOptional({ enum: MARKETS, description: 'Market (species only)' })
  @IsOptional()
  @IsIn(MARKETS)
  market?: (typeof MARKETS)[number];

  @ApiPropertyOptional({ description: 'Display ordering within the dataset (ascending)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** LocalizedString {en, ru} as stored in name_localized JSONB. */
export interface LocalizedString {
  en: string;
  ru: string;
}

/**
 * Wire shape of a reference-data entry (admin-api.yaml ReferenceDataEntry, A2). Per API_CONVENTIONS §6
 * the read context decides which name field is populated: ADMIN reads carry the full `nameLocalized`
 * (both locales); PUBLIC reads carry the resolved `name` string (Accept-Language, en fallback).
 */
export interface ReferenceDataEntry {
  id: number;
  code: string | null;
  speciesId: number | null;
  /** Resolved name for public reads (Accept-Language, en fallback); null on admin reads. */
  name: string | null;
  /** Both locales for admin/editor reads; null on public reads. */
  nameLocalized: LocalizedString | null;
  sortOrder: number;
  market: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
