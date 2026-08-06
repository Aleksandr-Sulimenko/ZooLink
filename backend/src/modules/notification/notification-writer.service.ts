import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import { OutboxService } from '../../lib/outbox/outbox.service';
import type { OutboxPublishInput } from '../../lib/outbox/outbox.types';
import { renderTemplate } from './notification.registry';

interface TemplateRow {
  id: string;
  body_template: string;
}

/**
 * Optional extras for {@link NotificationWriter.materialize}. Both are additive — a caller that passes
 * neither gets the original single-INSERT behaviour.
 */
export interface MaterializeOptions {
  /**
   * Per-recipient localized context values. Each entry is `key → { <lang>: value }`; the value for the
   * recipient's own delivery language (with **ru fallback**) is merged into the render context. Lets a
   * caller pass e.g. a localized listing title as `{ listing_title: { ru, en } }` and have the writer —
   * which already resolves the recipient's language — interpolate the right one. (Spec 07 H4-follow-ups
   * note, item (3).)
   */
  localized?: Record<string, Record<string, string>>;
  /**
   * An outbox event to publish **atomically with, and only when, the notification row is newly inserted**
   * (the `ON CONFLICT DO NOTHING` insert-won branch). Redelivery re-runs the idempotent INSERT (0 rows
   * affected) → no event, so the event is emitted **exactly once** per idempotency key. Used by
   * {@link SavedSearchMatchConsumer} to emit the analytics `SavedSearch.Matched` (spec 07
   * H4-follow-ups note, item (2)).
   */
  onInsertEvent?: OutboxPublishInput;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * Materialize one IN_APP notification for `userId` from the EMAIL source template `templateName`,
   * rendered with `ctx` (+ any `opts.localized` values resolved for the recipient's language), deduped
   * on `idempotencyKey`. A missing template is logged and no-ops (it must never wedge the relay into
   * retry→dead-letter — every registered template is seeded).
   *
   * @returns `true` iff a NEW row was inserted (the INSERT won the `ON CONFLICT` race); `false` on a
   *          duplicate (redelivery) or when the template was missing. When `opts.onInsertEvent` is set,
   *          the event is published in the same transaction only on a `true` insert.
   */
  async materialize(
    userId: string,
    templateName: string,
    ctx: Record<string, string>,
    idempotencyKey: string,
    opts?: MaterializeOptions,
  ): Promise<boolean> {
    const language = await this.preferredLanguage(userId);
    const template = await this.loadTemplate(templateName, language);
    if (!template) {
      this.logger.warn(`Notification template '${templateName}' (${language}) not found — no row written`);
      return false;
    }

    // Merge per-recipient localized values (recipient language, ru fallback) over the flat ctx.
    const merged = { ...ctx, ...this.resolveLocalized(opts?.localized, language) };
    const content = renderTemplate(template.body_template, merged);

    // Parameterized INSERT … ON CONFLICT DO NOTHING against the PARTIAL unique index — the predicate
    // (idempotency_key IS NOT NULL) MUST be restated so Postgres selects that arbiter index.
    const insertSql = Prisma.sql`
      INSERT INTO notification_logs (user_id, type, template_id, recipient, content, status, idempotency_key)
      VALUES (${userId}::uuid, 'IN_APP', ${template.id}::uuid, ${userId}, ${content}, 'SENT', ${idempotencyKey})
      ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`;

    // No analytics event → single statement, no transaction (unchanged behaviour for NotificationConsumer).
    if (!opts?.onInsertEvent) {
      const affected = await this.prisma.$executeRaw(insertSql);
      return affected === 1;
    }

    // Analytics event → atomic: publish the event in the SAME tx, and ONLY when the INSERT won ON CONFLICT
    // (affected === 1). Redelivery → 0 rows → no event → exactly-once emission consistent with the row.
    return this.prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRaw(insertSql);
      if (affected !== 1) return false;
      await this.outbox.publish(tx, opts.onInsertEvent!);
      return true;
    });
  }

  /**
   * Resolve each localized entry to the recipient's language value, falling back to ru, then to ANY
   * populated locale, then ''. Uses `||` (not `??`) deliberately: an EMPTY-STRING locale must fall
   * through, not win. The producer (SavedSearchMatchConsumer.localizedTitle) emits BOTH keys with ''
   * for a missing locale — so an en-only listing arrives as `{ ru: '', en: 'Puppy' }`; with `??` a
   * ru-preferring recipient would render a BLANK title. Falling through to `en` renders 'Puppy'.
   * (AUDIT5 Б2 / F1e — notification content quality; the fallback policy lives HERE, the one place
   * that already owns recipient-language resolution.)
   */
  private resolveLocalized(
    localized: Record<string, Record<string, string>> | undefined,
    language: string,
  ): Record<string, string> {
    if (!localized) return {};
    const out: Record<string, string> = {};
    for (const [key, byLang] of Object.entries(localized)) {
      out[key] = byLang[language] || byLang.ru || Object.values(byLang).find((v) => v) || '';
    }
    return out;
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
