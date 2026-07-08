import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Notification read DTOs (notification-api.yaml `listMyNotifications`, Slice H3 / P2-5). camelCase
 * wire bodies (API_CONVENTIONS §0); the service maps from the snake_case `notification_logs` columns.
 * There is no create/update DTO — IN_APP rows are written by the worker consumer, never by a client.
 */

/** GET /me/notifications query — page/limit only. Newest-first over the caller's own IN_APP rows. */
export class NotificationListQueryDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

/**
 * Wire shape of a caller-facing in-app notification (notification-api Notification). The own-scope
 * read projection of a `notification_logs` row: internal columns (userId, recipient, templateId,
 * provider fields) are deliberately omitted — the owner is always the authenticated caller.
 */
export interface NotificationView {
  id: string;
  /** Always IN_APP for this endpoint (the delivery channel). */
  type: string;
  /** Rendered body; nullable (may be cleared on ФЗ-152 erase). */
  content: string | null;
  status: string;
  createdAt: Date;
}
