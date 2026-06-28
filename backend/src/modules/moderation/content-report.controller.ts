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
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import { IdempotencyInterceptor } from '../../lib/http/idempotency.interceptor';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ContentReportService } from './content-report.service';
import {
  ContentReportCreateDto,
  type ContentReportView,
  ListContentReportsQueryDto,
  ResolveContentReportDto,
} from './dto/content-report.dto';

/** Filing a report is a spam vector — throttle it (10 / 15 min per principal). */
const REPORT_THROTTLE = { default: { limit: 10, ttl: 900_000 } };

/**
 * Content reports (moderation-api.yaml `/content-reports`, Slice 4b). File = any authenticated user;
 * read = role-scoped (a USER sees only their own, CR-5); resolve = MODERATOR|ADMIN only (CR-6). POST
 * is throttled (report-spam) + Idempotency-Key; PATCH uses If-Match (CR-10).
 */
@ApiTags('content-reports')
@Controller({ path: 'content-reports', version: '1' })
export class ContentReportController {
  constructor(private readonly service: ContentReportService) {}

  @Post()
  @Roles('USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN')
  @Throttle(REPORT_THROTTLE)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'File a content report (reporter derived from the actor; throttled; → OPEN)' })
  async create(
    @Body() dto: ContentReportCreateDto,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ContentReportView> {
    const report = await this.service.create(dto, actor);
    res.status(201);
    return report;
  }

  @Get()
  @Roles('USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN')
  @ApiOperation({ summary: 'List content reports (USER: own only; MOD/ADMIN: all). PageMeta' })
  list(
    @Query() query: ListContentReportsQueryDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<{ items: ContentReportView[]; meta: unknown }> {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @Roles('USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN')
  @ApiOperation({ summary: 'Get one report (reporter-owner or MOD/ADMIN; non-owner → 404; emits ETag)' })
  async getById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ContentReportView> {
    const { report, etag } = await this.service.getById(id, actor);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');
    return report;
  }

  @Patch(':id')
  @Roles('MODERATOR', 'ADMIN')
  @ApiOperation({ summary: 'Resolve a report (MOD/ADMIN only; requires If-Match; 409 if terminal)' })
  async resolve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveContentReportDto,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ContentReportView> {
    const { report, etag } = await this.service.resolve(id, dto, ifMatch, actor);
    res.setHeader('ETag', etag);
    return report;
  }
}
