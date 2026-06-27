import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Public } from '../../lib/auth/public.decorator';
import { OptionalJwtGuard } from '../../lib/auth/optional-jwt.guard';
import { Roles } from '../../lib/auth/roles.decorator';
import { IdempotencyInterceptor } from '../../lib/http/idempotency.interceptor';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ListingService } from './listing.service';
import {
  ListingCreateDto,
  ListingListQueryDto,
  ListingPhotoCreateDto,
  type ListingPhotoView,
  ListingUpdateDto,
  type ListingView,
} from './dto/listing.dto';

/** Roles permitted to WRITE a listing (listings-api.yaml x-required-roles; MODERATOR dropped — L-3). */
const WRITE_ROLES = ['USER', 'BREEDER', 'FARMER', 'ADMIN'] as const;

/**
 * Listing aggregate CRUD + owner-side lifecycle (listings-api.yaml Slice 1) under /v1/listings.
 * Reads (list/get/photos) are PUBLIC (security opt-out) — ACTIVE listings are world-visible; a
 * non-active listing is owner/operator-only and otherwise 404 (L-5). Writes require a bearer token
 * and one of the write roles (MODERATOR excluded — R-only on listings); object-level ownership is
 * enforced at the service layer. POST/submit/photo honour Idempotency-Key; PATCH/submit use If-Match.
 */
@ApiTags('listings')
@Controller({ path: 'listings', version: '1' })
export class ListingController {
  constructor(private readonly service: ListingService) {}

  @Get()
  @Public()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'List listings (public ACTIVE; owner-scoped for non-active states)' })
  async list(
    @Query() query: ListingListQueryDto,
    @CurrentUser() actor: AuthPrincipal | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ items: ListingView[]; meta: unknown }> {
    res.setHeader('Cache-Control', 'public, max-age=30');
    return this.service.list(query, actor);
  }

  @Post()
  @Roles(...WRITE_ROLES)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create a listing (→ DRAFT; Idempotency-Key required)' })
  async create(
    @Body() dto: ListingCreateDto,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ListingView> {
    const { listing, etag } = await this.service.create(dto, actor);
    res.setHeader('ETag', etag);
    res.status(201);
    return listing;
  }

  @Get(':id')
  @Public()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Get a listing (public if ACTIVE; owner/operator otherwise; emits ETag)' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ListingView> {
    const { listing, etag } = await this.service.getById(id, actor);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', listing.status === 'ACTIVE' ? 'public, max-age=30' : 'private, no-store');
    return listing;
  }

  @Patch(':id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Update a DRAFT listing (mutable fields; requires If-Match)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ListingUpdateDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ListingView> {
    const { listing, etag } = await this.service.update(id, dto, ifMatch, actor);
    res.setHeader('ETag', etag);
    return listing;
  }

  @Delete(':id')
  @Roles(...WRITE_ROLES)
  @ApiOperation({ summary: 'Withdraw a listing (soft → DEACTIVATED; 409 if terminal)' })
  withdraw(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthPrincipal): Promise<ListingView> {
    return this.service.withdraw(id, actor);
  }

  @Post(':id/submit')
  @Roles(...WRITE_ROLES)
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Submit a DRAFT for moderation (→ PENDING_MODERATION; If-Match required)' })
  async submit(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ListingView> {
    const { listing, etag } = await this.service.submit(id, ifMatch, actor);
    res.setHeader('ETag', etag);
    return listing;
  }

  @Get(':id/photos')
  @Public()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'List a listing’s photos (public if ACTIVE; owner/operator otherwise)' })
  listPhotos(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal | undefined,
  ): Promise<ListingPhotoView[]> {
    return this.service.listPhotos(id, actor);
  }

  @Post(':id/photos')
  @Roles(...WRITE_ROLES)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Add a photo (MAX 10/listing; Idempotency-Key)' })
  async addPhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ListingPhotoCreateDto,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ListingPhotoView> {
    const photo = await this.service.addPhoto(id, dto, actor);
    res.status(201);
    return photo;
  }

  @Delete(':id/photos/:photoId')
  @Roles(...WRITE_ROLES)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a photo (seller/org-admin only)' })
  removePhoto(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<void> {
    return this.service.removePhoto(id, photoId, actor);
  }
}
