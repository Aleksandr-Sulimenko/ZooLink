import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Public } from '../../lib/auth/public.decorator';
import { OptionalJwtGuard } from '../../lib/auth/optional-jwt.guard';
import { Roles } from '../../lib/auth/roles.decorator';
import { IdempotencyInterceptor } from '../../lib/http/idempotency.interceptor';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ReferenceDataService } from './reference-data.service';
import {
  CreateReferenceDataDto,
  DATASETS,
  type Dataset,
  ListReferenceDataQueryDto,
  type ReferenceDataEntry,
  UpdateReferenceDataDto,
} from './dto/reference-data.dto';
import { ParseDatasetPipe } from './parse-dataset.pipe';

/**
 * Reference Data management (admin-api.yaml, Admin Slice 1) under /v1/reference-data/{dataset}.
 * Reads are PUBLIC (rbac-matrix.md: reference data R = public); create/update/toggle are ADMIN-only
 * (@Roles('ADMIN') + global JwtAuthGuard/RolesGuard). Mutations are audit-logged; POST honours
 * Idempotency-Key; PATCH uses ETag/If-Match. Only species/breeds/cities are managed (round-9).
 */
@ApiTags('admin-reference-data')
@ApiParam({ name: 'dataset', enum: DATASETS })
@Controller({ path: 'reference-data/:dataset', version: '1' })
export class ReferenceDataController {
  constructor(private readonly service: ReferenceDataService) {}

  @Get()
  @Public()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'List active reference data entries (public; ADMIN may includeInactive)' })
  async list(
    @Param('dataset', ParseDatasetPipe) dataset: Dataset,
    @Query() query: ListReferenceDataQueryDto,
    @CurrentUser() actor: AuthPrincipal | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ items: ReferenceDataEntry[]; meta: unknown }> {
    const result = await this.service.list(dataset, query, actor, acceptLanguage);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.setHeader('Vary', 'Accept-Language');
    return result;
  }

  @Get('new')
  @Roles('ADMIN')
  @ApiOperation({ summary: '[ADMIN] Get the create-form template for a dataset' })
  form(@Param('dataset', ParseDatasetPipe) dataset: Dataset): { fields: Record<string, unknown> } {
    return this.service.form(dataset);
  }

  @Get(':id')
  @Public()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Get a reference data entry by id (public resolved name; ADMIN gets nameLocalized; +ETag)' })
  async getById(
    @Param('dataset', ParseDatasetPipe) dataset: Dataset,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthPrincipal | undefined,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReferenceDataEntry> {
    const { entry, etag } = await this.service.getById(dataset, id, actor, acceptLanguage);
    res.setHeader('ETag', etag);
    res.setHeader('Vary', 'Accept-Language');
    return entry;
  }

  @Post()
  @Roles('ADMIN')
  @UseInterceptors(IdempotencyInterceptor)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '[ADMIN] Create a reference data entry (Idempotency-Key supported)' })
  create(
    @Param('dataset', ParseDatasetPipe) dataset: Dataset,
    @Body() dto: CreateReferenceDataDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<ReferenceDataEntry> {
    return this.service.create(dataset, dto, actor);
  }

  @Patch(':id')
  @Roles('ADMIN')
  @ApiOperation({ summary: '[ADMIN] Update a reference data entry (requires If-Match)' })
  async update(
    @Param('dataset', ParseDatasetPipe) dataset: Dataset,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReferenceDataDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ReferenceDataEntry> {
    const { entry, etag } = await this.service.update(dataset, id, dto, ifMatch, actor);
    res.setHeader('ETag', etag);
    return entry;
  }

  @Patch(':id/toggle-active')
  @Roles('ADMIN')
  @ApiOperation({ summary: '[ADMIN] Activate/deactivate a reference data entry (soft delete)' })
  toggleActive(
    @Param('dataset', ParseDatasetPipe) dataset: Dataset,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<ReferenceDataEntry> {
    return this.service.toggleActive(dataset, id, actor);
  }
}
