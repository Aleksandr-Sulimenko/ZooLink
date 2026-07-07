import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Favorites Domain DTOs (favorites-api.yaml v1.0.0). camelCase wire bodies (API_CONVENTIONS §0);
 * the service maps to the snake_case `favorites` columns.
 *
 * There is NO create DTO: a favorite is fully identified by the path `listingId` + the authenticated
 * actor (server-derived owner, IDOR class — never client-supplied). The POST body is empty.
 */

/** GET /favorites query — page/limit only (favorites-api listFavorites). Default sort is created_at:desc. */
export class FavoriteListQueryDto {
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

/**
 * Wire shape of a Favorite (favorites-api Favorite). camelCase.
 *
 * OfferingRef seam (ADR-0014 §Amendment 2026-07-04 rule 11, migration 0032): the polymorphic pair
 * `offeringType`/`offeringId` ships from day one; `listingId` is RETAINED as a DEPRECATED read-only
 * alias == offeringId whenever offeringType == ANIMAL_LISTING (backward-compatible, non-breaking v1).
 */
export interface FavoriteView {
  id: string;
  /** Offering category (ADR-0014). Only ANIMAL_LISTING today; widened additively per subtype. */
  offeringType: string;
  /** Polymorphic pointer to the favorited offering. For ANIMAL_LISTING it equals listingId. */
  offeringId: string;
  /** DEPRECATED alias of offeringId, present only for ANIMAL_LISTING (backward compatibility). */
  listingId: string;
  createdAt: Date;
}
