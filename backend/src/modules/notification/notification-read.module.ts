import { Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationReadService } from './notification-read.service';

/**
 * API-side IN_APP notification READ module (Slice H3 / P2-5) — registered in AppModule (the HTTP
 * graph). It exposes `GET /v1/me/notifications` so a user can read the IN_APP rows the worker
 * consumer materialised (ADR-0021). Deliberately distinct from the worker-only NotificationModule
 * (which contributes the OUTBOX_CONSUMERS write path): the read never pulls the consumer into the API
 * graph, and vice-versa. Depends only on the @Global DbModule (PrismaService) — no extra imports.
 */
@Module({
  controllers: [NotificationController],
  providers: [NotificationReadService],
})
export class NotificationReadModule {}
