import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import { IdempotencyInterceptor } from '../../lib/http/idempotency.interceptor';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { FavoriteService } from './favorite.service';
import { FavoriteListQueryDto, type FavoriteView } from './dto/favorite.dto';

/**
 * Roles permitted to use favorites (favorites-api x-required-roles). VETERINARIAN & GROOMER are
 * "USER + extra capabilities" (rbac-matrix.md:30,56) so they inherit the basic USER favorites
 * capability — the contract omitting them was a drift, corrected in parallel (same fix the sibling
 * saved-search domain already applied). Favoriting is a strict subset of USER-basic actions.
 */
const FAVORITE_ROLES = ['USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN'] as const;

/**
 * Favorites (favorites-api.yaml v1.0.0) — the caller's own saved-listing collection. All endpoints
 * require a bearer token (no public opt-out). The owner is the authenticated actor and is never
 * client-supplied; reads are own-scope only (no operator widening); add is idempotent (DB UNIQUE, +
 * optional Idempotency-Key replay); remove is idempotent → 204 always (keyed by the public listing id,
 * so a user-scoped delete is both leak-free and absent-safe).
 *
 * Two routes per the contract: `GET /v1/favorites` (the list) and `POST|DELETE
 * /v1/listings/{id}/favorite` (toggle a single listing, keyed by listing id).
 */
@ApiTags('favorites')
@Controller({ version: '1' })
export class FavoriteController {
  constructor(private readonly service: FavoriteService) {}

  @Get('favorites')
  @Roles(...FAVORITE_ROLES)
  @ApiOperation({ summary: "List the caller's own favorites (own-scope; {items, meta: PageMeta})" })
  list(
    @Query() query: FavoriteListQueryDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<{ items: FavoriteView[]; meta: unknown }> {
    return this.service.list(query, actor);
  }

  @Post('listings/:id/favorite')
  @Roles(...FAVORITE_ROLES)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Add a listing to favorites (idempotent; missing/invisible listing → 404 no-leak; → 201)' })
  async add(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<FavoriteView> {
    const favorite = await this.service.add(id, actor);
    res.status(201);
    return favorite;
  }

  @Delete('listings/:id/favorite')
  @Roles(...FAVORITE_ROLES)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a listing from favorites (idempotent; absent/not-owned → identical 204; → 204)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthPrincipal): Promise<void> {
    return this.service.remove(id, actor);
  }
}
