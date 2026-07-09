import { Injectable, Logger } from '@nestjs/common';
import { OrgMembershipService } from '../../lib/org/org-membership.service';
import type { OutboxConsumer, OutboxEvent } from '../../lib/outbox/outbox.types';
import { NOTIFICATION_REGISTRY } from './notification.registry';
import { NotificationWriter } from './notification-writer.service';

/**
 * The FIRST real outbox consumer (ADR-0021). Registered under `OUTBOX_CONSUMERS` in the WORKER graph
 * only (never the API). For each subscribed, relayed event it materializes one durable in-app
 * `notification_logs` row (channel `IN_APP`) per recipient — ending the "silent event layer" where
 * moderation/transfer outcomes were produced and immediately marked processed with no side effect.
 *
 * Semantics:
 *  - **Allow-list, not '*':** `eventTypes` = the registry keys; the relay only hands us those events.
 *  - **Forward-only replay:** inherited from the relay (`WHERE processed_at IS NULL`). Events stamped
 *    processed before this consumer shipped are never re-notified (stale = spam, ADR-0021 §2). No code
 *    here replays history; the guardrail is "never prune outbox_events before an analytics projection".
 *  - **Transactional-always:** transactional notifications are not advertising (ФЗ-38) — we never read
 *    `notification_prefs`; the IN_APP row is written regardless of email/sms/promo prefs.
 *  - **Idempotent:** at-least-once delivery → `idempotency_key = event.id ‖ recipient ‖ template`, INSERT
 *    ON CONFLICT DO NOTHING (uq_notification_idempotency). Redelivery of the same event → exactly one row.
 */
@Injectable()
export class NotificationConsumer implements OutboxConsumer {
  private readonly logger = new Logger(NotificationConsumer.name);
  readonly eventTypes = Object.keys(NOTIFICATION_REGISTRY);

  constructor(
    private readonly orgMembership: OrgMembershipService,
    private readonly writer: NotificationWriter,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    const route = NOTIFICATION_REGISTRY[event.eventType];
    if (!route) return; // defensive: relay already filters, but never throw on an unmapped event

    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const templateName = route.templateFor(payload);
    if (!templateName) {
      this.logger.debug(`No template for ${event.eventType} (#${event.id}) payload shape — skipped`);
      return;
    }

    const recipients = await route.recipients(payload, { orgMembership: this.orgMembership });
    if (recipients.length === 0) {
      this.logger.debug(`No recipient resolved for ${event.eventType} (#${event.id}) — skipped`);
      return;
    }

    const ctx = route.context(payload);
    for (const userId of recipients) {
      // Idempotency unit for a per-event notification = event.id ‖ recipient ‖ template.
      await this.writer.materialize(userId, templateName, ctx, `${event.id}:${userId}:${templateName}`);
    }
  }
}
