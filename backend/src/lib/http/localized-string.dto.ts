import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * LocalizedString {en, ru} (API_CONVENTIONS §6). Backed by `*_localized` JSONB columns. Both locales
 * optional, max 255 — Wave F dedup of the byte-identical animal + listing copies.
 *
 * NOTE: the admin reference-data DTO deliberately keeps its OWN stricter LocalizedStringDto (both
 * locales REQUIRED, max 100) — that is a different contract, not a duplicate, so it is not merged here.
 */
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
