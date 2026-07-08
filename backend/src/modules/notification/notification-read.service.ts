import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import { paginate, type Paginated } from '../../lib/pagination/page';
import { weakEtag } from '../../lib/http/etag.util';
import type { AuthPrincipal } from '../../lib/auth/principal';
import { NotificationListQueryDto, type NotificationView } from './dto/notification.dto';

/** Only the IN_APP channel is user-readable here; EMAIL/SMS logs are an admin/ops surface. */
const IN_APP = 'IN_APP' as const;

/** A raw `notification_logs` row narrowed to the columns this read projects. */
interface NotificationRow {
  id: string;
  type: string;
  content: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

/**
 * IN_APP notification read (notification-api.yaml `listMyNotifications`, Slice H3 / P2-5). The read
 * side of the ADR-0021 IN_APP channel: it surfaces the durable `notification_logs` rows the worker
 * consumer materialised, so moderation/transfer outcomes are finally user-visible ("you were told").
 *
 * IDOR is closed structurally: the owner is ALWAYS the authenticated actor (`actor.userId`, never
 * client-supplied) and the `WHERE user_id = :actorId AND type = 'IN_APP'` filter is absolute — no
 * MODERATOR/ADMIN widening (a personal inbox is not a moderation surface; EMAIL/SMS delivery logs
 * remain the separate admin `/notifications/logs` endpoint). Read-only: no write path exists here.
 */
@Injectable()
export class NotificationReadService {
  constructor(private readonly prisma: PrismaService) {}

  /** List the caller's own IN_APP notifications, newest-first, with a weak inbox ETag. */
  async list(
    query: NotificationListQueryDto,
    actor: AuthPrincipal,
  ): Promise<{ page: Paginated<NotificationView>; etag: string }> {
    const where = { user_id: actor.userId, type: IN_APP };
    const [rows, total] = await Promise.all([
      this.prisma.notification_logs.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: query.skip,
        take: query.limit,
        select: { id: true, type: true, content: true, status: true, created_at: true, updated_at: true },
      }) as unknown as Promise<NotificationRow[]>,
      this.prisma.notification_logs.count({ where }),
    ]);

    return {
      page: paginate(rows.map((r) => this.toView(r)), total, query.page, query.limit),
      etag: this.inboxEtag(actor.userId, total, rows),
    };
  }

  private toView(row: NotificationRow): NotificationView {
    return {
      id: row.id,
      type: row.type,
      content: row.content,
      status: row.status,
      createdAt: row.created_at,
    };
  }

  /**
   * Weak validator over the caller's inbox state: it rotates when the row count changes or a newer row
   * lands (latest updated_at moves). Cheap and own-scope; supports If-None-Match → 304 for a static inbox.
   */
  private inboxEtag(userId: string, total: number, rows: NotificationRow[]): string {
    const latest = rows.reduce<Date>(
      (acc, r) => (r.updated_at > acc ? r.updated_at : acc),
      new Date(0),
    );
    return weakEtag(`notifications:${userId}:${total}`, latest);
  }
}
