import { Global, Module } from '@nestjs/common';
import { OrgMembershipModule } from '../../lib/org/org-membership.module';
import { OUTBOX_CONSUMERS } from '../../lib/outbox/outbox.types';
import { NotificationConsumer } from './notification.consumer';
import { NotificationWriter } from './notification-writer.service';
import { SavedSearchMatchConsumer } from './saved-search-match.consumer';

/**
 * Notification domain — WORKER-ONLY (ADR-0021). It contributes the first real outbox consumer under
 * the `OUTBOX_CONSUMERS` token, so the relay (OutboxRelayModule) dispatches relayed events to it. The
 * API graph never imports this module (the API only *writes* outbox rows).
 *
 * `@Global` + `exports: [OUTBOX_CONSUMERS]` is deliberate: `OutboxRelay` lives in the generic
 * `lib/outbox` and must stay ignorant of any domain module (no lib→module import). Exporting the token
 * globally lets the relay `@Optional()`-inject the consumer array without OutboxRelayModule importing
 * NotificationModule — the dependency arrow points module→lib only. The array is the merged consumer
 * list the relay dispatches over: `NotificationConsumer` (registry-driven transactional events) +
 * `SavedSearchMatchConsumer` (Slice H4 — Listing.Activated → saved-search demand-side alerts). Both
 * write via the shared `NotificationWriter`. The token stays single so the relay sees one merged list.
 */
@Global()
@Module({
  imports: [OrgMembershipModule],
  providers: [
    NotificationWriter,
    NotificationConsumer,
    SavedSearchMatchConsumer,
    {
      provide: OUTBOX_CONSUMERS,
      useFactory: (notif: NotificationConsumer, savedSearch: SavedSearchMatchConsumer) => [notif, savedSearch],
      inject: [NotificationConsumer, SavedSearchMatchConsumer],
    },
  ],
  exports: [OUTBOX_CONSUMERS],
})
export class NotificationModule {}
