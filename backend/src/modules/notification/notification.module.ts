import { Global, Module } from '@nestjs/common';
import { OrgMembershipModule } from '../../lib/org/org-membership.module';
import { OUTBOX_CONSUMERS } from '../../lib/outbox/outbox.types';
import { NotificationConsumer } from './notification.consumer';

/**
 * Notification domain — WORKER-ONLY (ADR-0021). It contributes the first real outbox consumer under
 * the `OUTBOX_CONSUMERS` token, so the relay (OutboxRelayModule) dispatches relayed events to it. The
 * API graph never imports this module (the API only *writes* outbox rows).
 *
 * `@Global` + `exports: [OUTBOX_CONSUMERS]` is deliberate: `OutboxRelay` lives in the generic
 * `lib/outbox` and must stay ignorant of any domain module (no lib→module import). Exporting the token
 * globally lets the relay `@Optional()`-inject the consumer array without OutboxRelayModule importing
 * NotificationModule — the dependency arrow points module→lib only. (A second consumer, when it lands,
 * folds into this same array provider; the token stays single so the relay sees one merged list.)
 */
@Global()
@Module({
  imports: [OrgMembershipModule],
  providers: [
    NotificationConsumer,
    {
      provide: OUTBOX_CONSUMERS,
      useFactory: (consumer: NotificationConsumer) => [consumer],
      inject: [NotificationConsumer],
    },
  ],
  exports: [OUTBOX_CONSUMERS],
})
export class NotificationModule {}
