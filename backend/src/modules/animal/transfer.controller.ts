import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
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
import { PageQueryDto } from '../../lib/pagination/page-query.dto';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { TransferService } from './transfer.service';
import {
  ListTransfersQueryDto,
  TRANSFER_ROLES,
  TransferInitiateDto,
  type TransferView,
} from './dto/transfer.dto';

const ALL_ROLES = ['USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN'] as const;

/**
 * Ownership-transfer endpoints (transfers-api.yaml, Animal Slice 2 / ADR-0013). Initiate lives under
 * /v1/animals/{id}/transfers; the action/read/list routes under /v1/transfers. Bearer auth on every
 * route (global JwtAuthGuard); @Roles grants all authenticated roles — object-level authz (current
 * owner / named recipient / initiator) is enforced at the service layer (INV-1/8/9). Initiate honours
 * Idempotency-Key; accept/decline/cancel require If-Match (412/428).
 */
@ApiTags('animal-transfers')
@Roles(...ALL_ROLES)
@Controller({ version: '1' })
export class TransferController {
  constructor(private readonly service: TransferService) {}

  @Post('animals/:id/transfers')
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Initiate an ownership transfer (Idempotency-Key required, 24h)' })
  async initiate(
    @Param('id', ParseUUIDPipe) animalId: string,
    @Body() dto: TransferInitiateDto,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferView> {
    const { transfer, etag } = await this.service.initiate(animalId, dto, actor);
    res.setHeader('ETag', etag);
    res.setHeader('Location', `/api/v1/transfers/${transfer.id}`);
    res.status(201);
    return transfer;
  }

  @Get('transfers')
  @ApiOperation({ summary: 'List the caller’s transfers (role=initiated|incoming; PageMeta)' })
  list(
    @Query() query: ListTransfersQueryDto,
    @CurrentUser() actor: AuthPrincipal,
  ): Promise<{ items: TransferView[]; meta: unknown }> {
    if (!query.role || !(TRANSFER_ROLES as readonly string[]).includes(query.role)) {
      throw new BadRequestException({ message: 'role must be one of initiated|incoming', code: 'VALIDATION_ERROR' });
    }
    return this.service.list(query, actor);
  }

  @Get('transfers/:transferId')
  @ApiOperation({ summary: 'Get one transfer (emits the ETag for accept/decline/cancel)' })
  async getById(
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferView> {
    const { transfer, etag } = await this.service.getById(transferId, actor);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');
    return transfer;
  }

  @Post('transfers/:transferId/accept')
  @HttpCode(200)
  @UseInterceptors(IdempotencyInterceptor)
  @ApiOperation({ summary: 'Accept a transfer → re-attribute the animal (requires If-Match)' })
  async accept(
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferView> {
    const { transfer, etag } = await this.service.accept(transferId, ifMatch, actor);
    res.setHeader('ETag', etag);
    return transfer;
  }

  @Post('transfers/:transferId/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline a transfer (recipient; requires If-Match)' })
  async decline(
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferView> {
    const { transfer, etag } = await this.service.decline(transferId, ifMatch, actor);
    res.setHeader('ETag', etag);
    return transfer;
  }

  @Post('transfers/:transferId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel a still-PENDING transfer (initiator; requires If-Match)' })
  async cancel(
    @Param('transferId', ParseUUIDPipe) transferId: string,
    @Headers('if-match') ifMatch: string | undefined,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<TransferView> {
    const { transfer, etag } = await this.service.cancel(transferId, ifMatch, actor);
    res.setHeader('ETag', etag);
    return transfer;
  }

  @Get('animals/:id/ownership-history')
  @ApiOperation({ summary: 'Get the settled ownership-history trail for an animal (PageMeta)' })
  async ownershipHistory(
    @Param('id', ParseUUIDPipe) animalId: string,
    @Query() query: PageQueryDto,
    @CurrentUser() actor: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ items: unknown[]; meta: unknown }> {
    res.setHeader('Cache-Control', 'private, no-store');
    return this.service.ownershipHistory(animalId, actor, query.page, query.limit);
  }
}
