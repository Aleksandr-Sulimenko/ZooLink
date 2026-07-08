import { Controller, Get, Headers, HttpStatus, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../lib/auth/current-user.decorator';
import { Roles } from '../../lib/auth/roles.decorator';
import { matchesIfNoneMatch } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { NotificationReadService } from './notification-read.service';
import { NotificationListQueryDto, type NotificationView } from './dto/notification.dto';
import type { Paginated } from '../../lib/pagination/page';

/**
 * Roles permitted to read their own IN_APP inbox (notification-api x-required-roles). VETERINARIAN &
 * GROOMER are "USER + extra" (rbac-matrix.md) so they inherit the basic USER capability — the same
 * inheritance the favorites/saved-search domains already apply. Reading one's own notifications is a
 * strict subset of USER-basic actions.
 */
const NOTIFICATION_ROLES = ['USER', 'BREEDER', 'FARMER', 'VETERINARIAN', 'GROOMER', 'MODERATOR', 'ADMIN'] as const;

/**
 * IN_APP notification inbox under /v1/me/notifications (notification-api.yaml `listMyNotifications`,
 * Slice H3 / P2-5). Authenticated (global JwtAuthGuard). Own-scope only — the caller is the owner,
 * never client-supplied (IDOR closed structurally). Emits a weak ETag (supports If-None-Match → 304)
 * and `Cache-Control: private, no-store` (personal, mutates as events land).
 *
 * This is the API-side READ counterpart of the worker-only NotificationModule (which WRITES IN_APP
 * rows via the outbox consumer). The two are deliberately separate modules: the consumer never enters
 * the API graph, and this read never enters the worker graph.
 */
@ApiTags('notification')
@Controller({ path: 'me/notifications', version: '1' })
export class NotificationController {
  constructor(private readonly service: NotificationReadService) {}

  @Get()
  @Roles(...NOTIFICATION_ROLES)
  @ApiOperation({ summary: "List the caller's own IN_APP notifications (own-scope; {items, meta: PageMeta}; +ETag)" })
  async list(
    @Query() query: NotificationListQueryDto,
    @CurrentUser() actor: AuthPrincipal,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<Paginated<NotificationView> | undefined> {
    const { page, etag } = await this.service.list(query, actor);
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'private, no-store');
    if (matchesIfNoneMatch(ifNoneMatch, etag)) {
      res.status(HttpStatus.NOT_MODIFIED);
      return undefined;
    }
    return page;
  }
}
