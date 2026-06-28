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
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { ModerationService } from './moderation.service';
import {
  ListDecisionsQueryDto,
  ListTemplatesQueryDto,
  ModerationActionDto,
  type ModerationDecisionView,
  type ModerationLockView,
  ModerationQueueQueryDto,
  type ModerationReasonView,
  type DecisionTemplateView,
} from './dto/moderation.dto';

/**
 * Moderation operator surface (moderation-api.yaml, Slice 4a) under /v1/moderation. All endpoints are
 * MODERATOR|ADMIN only (M-11) — an AGENT principal holding the MODERATOR role uses the identical
 * contract (ADR-0006). The owner-facing result lives on the listings path (separate controller).
 */
@ApiTags('moderation')
@Roles('MODERATOR', 'ADMIN')
@Controller({ path: 'moderation', version: '1' })
export class ModerationController {
  constructor(private readonly service: ModerationService) {}

  @Get('queue')
  @ApiOperation({ summary: 'List PENDING_MODERATION items (FIFO; market/SLA/lock filters; meta.counts)' })
  getQueue(
    @Query() query: ModerationQueueQueryDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<{ items: unknown[]; meta: unknown }> {
    return this.service.getQueue(query, actor);
  }

  @Get('listing/:id')
  @ApiOperation({ summary: 'Get a listing with linked animal + photos for review' })
  getReviewListing(@Param('id', ParseUUIDPipe) id: string): Promise<unknown> {
    return this.service.getReviewListing(id);
  }

  @Post('queue/:listingId/claim')
  @HttpCode(200)
  @ApiOperation({ summary: 'Claim (exclusively lock) a queue item (409 ALREADY_CLAIMED; re-claim idempotent)' })
  claim(
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<ModerationLockView> {
    return this.service.claim(listingId, actor);
  }

  @Delete('queue/:listingId/claim')
  @HttpCode(204)
  @ApiOperation({ summary: 'Release a claim you hold (409 NOT_LOCK_HOLDER; idempotent if free)' })
  release(
    @Param('listingId', ParseUUIDPipe) listingId: string,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<void> {
    return this.service.release(listingId, actor);
  }

  @Post('action')
  @HttpCode(200)
  @ApiOperation({ summary: 'Submit a moderation decision (one tx: decision + transition + audit; needs a live lock)' })
  action(@Body() dto: ModerationActionDto, @CurrentUser() actor: AuthPrincipal): Promise<ModerationDecisionView> {
    return this.service.action(dto, actor);
  }

  @Get('decisions')
  @ApiOperation({ summary: 'List moderation decisions (append-only ledger; PageMeta)' })
  listDecisions(@Query() query: ListDecisionsQueryDto): Promise<{ items: ModerationDecisionView[]; meta: unknown }> {
    return this.service.listDecisions(query);
  }

  @Get('reasons')
  @ApiOperation({ summary: 'List active moderation reason codes' })
  listReasons(): Promise<ModerationReasonView[]> {
    return this.service.listReasons();
  }

  @Get('decision-templates')
  @ApiOperation({ summary: 'List active canned decision-note templates (controlled dictionary)' })
  listTemplates(@Query() query: ListTemplatesQueryDto): Promise<DecisionTemplateView[]> {
    return this.service.listTemplates(query);
  }
}

/**
 * Owner-facing moderation result (agent-transparency, Owner-decision #5) under /v1/listings. Object-level
 * scoped: the listing owner OR MODERATOR/ADMIN (M-12). 204 when there is no decision yet.
 */
@ApiTags('moderation')
@Roles('USER', 'BREEDER', 'FARMER', 'MODERATOR', 'ADMIN')
@Controller({ path: 'listings', version: '1' })
export class OwnerModerationResultController {
  constructor(private readonly service: ModerationService) {}

  @Get(':id/moderation-result')
  @ApiOperation({ summary: 'Owner-facing latest effective moderation result (principalType/agent-transparency)' })
  async getOwnerResult(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const result = await this.service.getOwnerResult(id, actor);
    res.setHeader('Cache-Control', 'private, no-store');
    if (result === null) {
      res.status(204);
      return undefined;
    }
    return result;
  }
}
