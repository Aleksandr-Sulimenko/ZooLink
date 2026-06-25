import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Animal Domain DTOs (animals-api.yaml). camelCase wire bodies (API_CONVENTIONS §0); the service
 * maps to the snake_case `animals` columns. LocalizedString {en, ru} per §6. JSONB array fields
 * (healthRecords/reproductiveData) carry a light structural shape here and a stricter per-item shape
 * check at the service layer (spec 02-animal-domain.md §round-4, lines 102–106).
 *
 * Immutable-field rule (spec lines 109–110, rbac-matrix.md): speciesId/breedId/sex/dateOfBirth are
 * NOT in {@link AnimalUpdateDto}; the global ValidationPipe (`forbidNonWhitelisted`) rejects them on
 * PATCH with 400 — correcting them is an audit-logged admin procedure, not self-service.
 *
 * Out of scope for this slice (DB defaults apply, not exposed/validated): pedigree_id,
 * health_test_results, show_titles, is_visible_in_breeding_search, reproductive_status.
 */

export const ANIMAL_SEXES = ['Male', 'Female'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

/** LocalizedString {en, ru} (API_CONVENTIONS §6). Backed by *_localized JSONB columns. */
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

/** One health-record item (spec line 103: {type, date, note, vet?}). Shape-checked at the service. */
export class HealthRecordDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  type!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  vet?: string;
}

/** One reproductive-data item (spec line 104: {event, date, details?}). Shape-checked at the service. */
export class ReproductiveDataDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  event!: string;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  date!: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  details?: Record<string, unknown>;
}

export class AnimalCreateDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Owner user id (XOR organizationId)' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Owner organization id (XOR ownerId)' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiProperty({ description: 'Species id (INT lookup)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  speciesId!: number;

  @ApiPropertyOptional({ nullable: true, description: 'Breed id (INT lookup; XOR breedTextLocalized)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  breedId?: number;

  @ApiPropertyOptional({ type: LocalizedStringDto, description: 'Custom breed text (XOR breedId)' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  breedTextLocalized?: LocalizedStringDto;

  @ApiProperty({ type: LocalizedStringDto, description: 'Display name (≥1 non-empty locale required)' })
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  nicknameLocalized!: LocalizedStringDto;

  @ApiProperty({ enum: ANIMAL_SEXES })
  @IsIn(ANIMAL_SEXES)
  sex!: AnimalSex;

  @ApiProperty({ format: 'date' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 100, description: 'Color/coat (mutable, D1)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  colorCoat?: string;

  @ApiPropertyOptional({ type: LocalizedStringDto, description: 'Free-text description' })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  descriptionLocalized?: LocalizedStringDto;

  @ApiPropertyOptional({ nullable: true, maxLength: 50, description: 'Microchip id (ISO-11784/85, 15 digits)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  microchipId?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 50, description: 'Tattoo/brand id (livestock)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tattooBrandId?: string;

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString()
  ownedSince?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Mother (pedigree); trigger-validated' })
  @IsOptional()
  @IsUUID()
  motherId?: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true, description: 'Father (pedigree); trigger-validated' })
  @IsOptional()
  @IsUUID()
  fatherId?: string;

  @ApiPropertyOptional({ type: [HealthRecordDto], description: 'Health records (array)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HealthRecordDto)
  healthRecords?: HealthRecordDto[];

  @ApiPropertyOptional({ type: [ReproductiveDataDto], description: 'Reproductive data (array)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReproductiveDataDto)
  reproductiveData?: ReproductiveDataDto[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/**
 * Mutable fields only (spec lines 109–110). speciesId/breedId/sex/dateOfBirth/ownerId/organizationId
 * are intentionally absent → 400 (forbidNonWhitelisted) if a client sends them.
 */
export class AnimalUpdateDto {
  @ApiPropertyOptional({ type: LocalizedStringDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  nicknameLocalized?: LocalizedStringDto;

  @ApiPropertyOptional({ type: LocalizedStringDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => LocalizedStringDto)
  descriptionLocalized?: LocalizedStringDto;

  @ApiPropertyOptional({ nullable: true, maxLength: 100, description: 'Color/coat (mutable, D1)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  colorCoat?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  microchipId?: string;

  @ApiPropertyOptional({ nullable: true, maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  tattooBrandId?: string;

  @ApiPropertyOptional({ type: [HealthRecordDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => HealthRecordDto)
  healthRecords?: HealthRecordDto[];

  @ApiPropertyOptional({ type: [ReproductiveDataDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReproductiveDataDto)
  reproductiveData?: ReproductiveDataDto[];

  @ApiPropertyOptional({ format: 'date', nullable: true })
  @IsOptional()
  @IsDateString()
  ownedSince?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Parse a string query value 'true'/'false' into a real boolean (Boolean('false') === true is unsafe). */
function toBool({ value }: { value: unknown }): unknown {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

/** List filters (animals-api.yaml listAnimals). Query params are snake_case per the contract. */
export class AnimalListQueryDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  owner_id?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  species_id?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  breed_id?: number;

  @ApiPropertyOptional({ enum: ANIMAL_SEXES })
  @IsOptional()
  @IsIn(ANIMAL_SEXES)
  sex?: AnimalSex;

  @ApiPropertyOptional({ description: 'Nickname partial match (case-insensitive, ru/en)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  nickname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBool)
  @IsBoolean()
  is_active?: boolean;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  date_of_birth_min?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  date_of_birth_max?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  owned_since_min?: string;

  @ApiPropertyOptional({ format: 'date' })
  @IsOptional()
  @IsDateString()
  owned_since_max?: string;

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
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/** LocalizedString {en, ru} as stored in the *_localized JSONB columns. */
export interface LocalizedString {
  en: string;
  ru: string;
}

/** Wire shape of an Animal (animals-api.yaml Animal). Dates are emitted as ISO strings by the serializer. */
export interface AnimalView {
  id: string;
  ownerId: string | null;
  organizationId: string | null;
  speciesId: number;
  breedId: number | null;
  breedTextLocalized: LocalizedString | null;
  nicknameLocalized: LocalizedString;
  sex: AnimalSex;
  dateOfBirth: string;
  colorCoat: string | null;
  descriptionLocalized: LocalizedString;
  microchipId: string | null;
  tattooBrandId: string | null;
  isActive: boolean;
  ownedSince: string | null;
  motherId: string | null;
  fatherId: string | null;
  healthRecords: unknown[];
  reproductiveData: unknown[];
  createdAt: Date;
  updatedAt: Date;
  deactivatedAt: Date | null;
}
