import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import { OrgMembershipService } from '../../lib/org/org-membership.service';
import type { OutboxConsumer, OutboxEvent } from '../../lib/outbox/outbox.types';
import { NOTIFICATION_REGISTRY, renderTemplate } from './notification.registry';

interface TemplateRow {
  id: string;
  body_template: string;
}

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
    private readonly prisma: PrismaService,
    private readonly orgMembership: OrgMembershipService,
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
      await this.materialize(event.id, userId, templateName, ctx);
    }
  }

  private async materialize(
    eventId: string,
    userId: string,
    templateName: string,
    ctx: Record<string, string>,
  ): Promise<void> {
    const language = await this.preferredLanguage(userId);
    const template = await this.loadTemplate(templateName, language);
    if (!template) {
      // A missing template must not wedge the relay (would retry→dead-letter). Log and no-op: the event
      // is still marked processed. Templates for every registered event are seeded (migration 0010/0030).
      this.logger.warn(`Notification template '${templateName}' (${language}) not found — no row written`);
      return;
    }

    const content = renderTemplate(template.body_template, ctx);
    const idempotencyKey = `${eventId}:${userId}:${templateName}`;

    // Parameterized INSERT … ON CONFLICT DO NOTHING against the PARTIAL unique index — the predicate
    // (idempotency_key IS NOT NULL) MUST be restated so Postgres selects that arbiter index.
    await this.prisma.$executeRaw`
      INSERT INTO notification_logs (user_id, type, template_id, recipient, content, status, idempotency_key)
      VALUES (${userId}::uuid, 'IN_APP', ${template.id}::uuid, ${userId}, ${content}, 'SENT', ${idempotencyKey})
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`;
  }

  /** The recipient's own delivery language (users.preferred_language, default 'ru'). */
  private async preferredLanguage(userId: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ preferred_language: string | null }[]>`
      SELECT preferred_language FROM users WHERE id = ${userId}::uuid`;
    return rows[0]?.preferred_language ?? 'ru';
  }

  /** The EMAIL source template (channel≠source); fall back to 'ru', then any active row for the name. */
  private async loadTemplate(name: string, language: string): Promise<TemplateRow | null> {
    const rows = await this.prisma.$queryRaw<TemplateRow[]>`
      SELECT id, body_template FROM notification_templates
      WHERE name = ${name} AND type = 'EMAIL' AND is_active = TRUE
      ORDER BY (language = ${language}) DESC, (language = 'ru') DESC
      LIMIT 1`;
    return rows[0] ?? null;
  }
}
