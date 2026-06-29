import {
  Body,
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
import { SavedSearchService } from './saved-search.service';
import {
  SavedSearchCreateDto,
  SavedSearchListQueryDto,
  type SavedSearchView,
} from './dto/saved-search.dto';

/**
 * Roles permitted to use saved searches (geo-search-api x-required-roles; rbac-matrix.md:78 = own/own/own).
 * VETERINARIAN & GROOMER are "USER + extra capabilities" (rbac-matrix.md:30,56) so they inherit the USER
 * saved-search capability — the contract omitting them was a drift (corrected in parallel).
 */
const SAVED_SEARCH_ROLES = ['USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN'] as const;

/**
 * Saved searches (geo-search-api.yaml `/saved-searches`, spec 07 round-5 SS-1..SS-6) under /v1/saved-searches.
 * All endpoints require a bearer token (no public opt-out). The owner is the authenticated actor and is
 * never client-supplied; reads are own-scope only (no operator widening, SS-1); DELETE of a non-existent
 * OR non-owned id is an indistinguishable 404 (no-leak, SS-2). POST honours Idempotency-Key (the ONLY
 * dedup, SS-6) — no DB uniqueness, no ETag/If-Match on any endpoint (none in the contract).
 */
@ApiTags('saved-searches')
@Controller({ path: 'saved-searches', version: '1' })
export class SavedSearchController {
  constructor(private readonly service: SavedSearchService) {}

  @Get()
  @Roles(...SAVED_SEARCH_ROLES)
  @ApiOperation({ summary: "List the caller's own saved searches (own-scope; {items, meta: PageMeta})" })
  list(
    @Query() query: SavedSearchListQueryDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<{ items: SavedSearchView[]; meta: unknown }> {
    return this.service.list(query, actor);
  }

  @Post()
  @Roles(...SAVED_SEARCH_ROLES)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Save a search (owner = actor; Idempotency-Key dedup; → 201)' })
  async create(
    @Body() dto: SavedSearchCreateDto,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SavedSearchView> {
    const saved = await this.service.create(dto, actor);
    res.status(201);
    return saved;
  }

  @Delete(':id')
  @Roles(...SAVED_SEARCH_ROLES)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a saved search (own-scope; non-existent/non-owned → 404 no-leak; → 204)' })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthPrincipal): Promise<void> {
    return this.service.delete(id, actor);
  }
}
