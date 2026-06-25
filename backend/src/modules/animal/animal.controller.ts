import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { AnimalService } from './animal.service';
import {
  AnimalCreateDto,
  AnimalListQueryDto,
  AnimalUpdateDto,
  type AnimalView,
} from './dto/animal.dto';

/**
 * Animal aggregate CRUD (animals-api.yaml, Slice 1) under /v1/animals. Bearer auth required for every
 * route (global JwtAuthGuard); the matrix grants all authenticated roles (@Roles) — object-level
 * ownership is enforced at the service layer. POST honours Idempotency-Key (24h); GET emits a weak
 * ETag; PATCH requires If-Match (428/412). Deactivate/reactivate are guard-based state transitions (409).
 *
 * Not in this slice: GET /animals/{id}/ownership-history and hard DELETE — ownership transfer is a later
 * slice; removal is driven through deactivate (the contract's own DELETE summary says "soft delete").
 */
@ApiTags('animals')
@Roles('USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN')
@Controller({ path: 'animals', version: '1' })
export class AnimalController {
  constructor(private readonly service: AnimalService) {}

  @Post()
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Create an animal (Idempotency-Key honoured, 24h)' })
  create(@Body() dto: AnimalCreateDto, @CurrentUser() actor: AuthPrincipal): Promise<AnimalView> {
    return this.service.create(dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'List animals with filters (page/limit, max 100); owner/role-scoped' })
  list(
    @Query() query: AnimalListQueryDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<{ items: AnimalView[]; meta: unknown }> {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an animal by id (emits the ETag for the matching PATCH)' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnimalView> {
    const { animal, etag } = await this.service.getById(id, actor);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');
    return animal;
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update mutable fields (requires If-Match; 412/428 on concurrency)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnimalUpdateDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AnimalView> {
    const { animal, etag } = await this.service.update(id, dto, ifMatch, actor);
    res.setHeader('ETag', etag);
    return animal;
  }

  @Patch(':id/deactivate')
  @ApiOperation({ summary: 'Deactivate an animal (soft delete); 409 if already deactivated' })
  deactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<AnimalView> {
    return this.service.deactivate(id, actor);
  }

  @Patch(':id/reactivate')
  @ApiOperation({ summary: 'Reactivate an animal; 409 if already active' })
  reactivate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<AnimalView> {
    return this.service.reactivate(id, actor);
  }
}
