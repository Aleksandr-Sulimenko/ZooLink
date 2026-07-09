import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../lib/db/prisma.service';
import { renderTemplate } from './notification.registry';

interface TemplateRow {
  id: string;
  body_template: string;
}

/**
 * Shared notification materializer (ADR-0021). Extracted so every worker-side outbox consumer writes a
 * durable IN_APP `notification_logs` row the SAME way — one template lookup + render + idempotent INSERT.
 * Used by {@link NotificationConsumer} (registry-driven transactional events) and by
 * {@link SavedSearchMatchConsumer} (Listing.Activated → saved-search alerts). Keeping the write in one
 * place means the *channel ≠ source*, language-selection, and ON-CONFLICT-dedup rules can never drift
 * between consumers.
 *
 * Idempotency is at-least-once-safe: the caller supplies the `idempotencyKey` (its own natural dedup
 * unit — event‖recipient‖template for per-event notifications, or savedSearch‖listing for per-pair
 * alerts) and redelivery collapses to exactly one row via the partial unique index.
 */
@Injectable()
export class NotificationWriter {
  private readonly logger = new Logger(NotificationWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Materialize one IN_APP notification for `userId` from the EMAIL source template `templateName`,
   * rendered with `ctx`, deduped on `idempotencyKey`. A missing template is logged and no-ops (it must
   * never wedge the relay into retry→dead-letter — every registered template is seeded).
   */
  async materialize(
    userId: string,
    templateName: string,
    ctx: Record<string, string>,
    idempotencyKey: string,
  ): Promise<void> {
    const language = await this.preferredLanguage(userId);
    const template = await this.loadTemplate(templateName, language);
    if (!template) {
      this.logger.warn(`Notification template '${templateName}' (${language}) not found — no row written`);
      return;
    }

    const content = renderTemplate(template.body_template, ctx);

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
