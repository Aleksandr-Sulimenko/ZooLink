import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/**
 * The three managed lookup datasets (admin-api.yaml round-9 reconciliation). Only species/breeds/
 * cities are CRUD-able reference data (rbac-matrix.md). Code is the URL path segment `{dataset}`.
 */
export const DATASETS = ['species', 'breeds', 'cities'] as const;
export type Dataset = (typeof DATASETS)[number];

const MARKETS = ['pet', 'livestock'] as const;
const CODE = /^[a-z0-9_]+$/;

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

  @ApiProperty({ maxLength: 100, description: 'Russian display name' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_ru!: string;

  @ApiProperty({ maxLength: 100, description: 'English display name' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_en!: string;

  @ApiPropertyOptional({ enum: MARKETS, description: 'Market (species only; default pet)' })
  @IsOptional()
  @IsIn(MARKETS)
  market?: (typeof MARKETS)[number];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Partial update for PATCH /reference-data/{dataset}/{id}. code/speciesId are immutable (identity). */
export class UpdateReferenceDataDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_ru?: string;

  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name_en?: string;

  @ApiPropertyOptional({ enum: MARKETS, description: 'Market (species only)' })
  @IsOptional()
  @IsIn(MARKETS)
  market?: (typeof MARKETS)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Wire shape of a reference-data entry (admin-api.yaml ReferenceDataEntry, round-9). */
export interface ReferenceDataEntry {
  id: number;
  code: string | null;
  speciesId: number | null;
  name_ru: string;
  name_en: string;
  market: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}
