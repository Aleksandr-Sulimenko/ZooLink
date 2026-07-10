import { Prisma } from '@prisma/client';
import { NotificationWriter } from './notification-writer.service';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { OutboxService } from '../../lib/outbox/outbox.service';
import type { OutboxPublishInput } from '../../lib/outbox/outbox.types';

/**
 * Unit coverage for the shared materializer's two H4-follow-up additions:
 *  - per-recipient localized-context resolution (recipient language, ru fallback) — SS-M2 (3);
 *  - the atomic, insert-won-only analytics event emission (exactly-once, SS-M4-consistent) — SS-M2 (2).
 * The INSERT/query SQL is exercised for real in the e2e; here PG is mocked so we assert the branching.
 */
const TEMPLATE = [{ id: 'tmpl-1', body_template: 'Hi {{listing_title}} ({{listing_id}})' }];

const EVENT: OutboxPublishInput = {
  aggregateType: 'SavedSearch',
  aggregateId: 'ss-1',
  eventType: 'SavedSearch.Matched',
  schemaVersion: 1,
  market: 'pet',
  payload: { savedSearchId: 'ss-1', listingId: 'l-1' },
};

/** The rendered body is the string parameter embedded in the INSERT's Prisma.Sql values. */
function renderedContent(sql: unknown): string {
  const values = (sql as Prisma.Sql).values;
  const body = values.find((v) => typeof v === 'string' && (v.startsWith('Hi ') || v.includes('(')));
  return typeof body === 'string' ? body : '';
}

function make(opts: { language?: string | null; template?: unknown[]; affected?: number } = {}) {
  const language = opts.language === undefined ? 'ru' : opts.language;
  const $queryRaw = jest
    .fn()
    .mockResolvedValueOnce([{ preferred_language: language }]) // preferredLanguage
    .mockResolvedValueOnce(opts.template ?? TEMPLATE); // loadTemplate
  const affected = opts.affected ?? 1;
  const $executeRaw = jest.fn().mockResolvedValue(affected);
  const txExecuteRaw = jest.fn().mockResolvedValue(affected);
  const $transaction = jest.fn().mockImplementation((cb: (tx: unknown) => Promise<unknown>) => cb({ $executeRaw: txExecuteRaw }));
  const prisma = { $queryRaw, $executeRaw, $transaction } as unknown as PrismaService;
  const publish = jest.fn().mockResolvedValue(undefined);
  const outbox = { publish } as unknown as OutboxService;
  return { writer: new NotificationWriter(prisma, outbox), $executeRaw, txExecuteRaw, $transaction, publish };
}

describe('NotificationWriter', () => {
  const localized = { listing_title: { ru: 'Щенок', en: 'Puppy' } };

  it('resolves a localized ctx value to the recipient language (en)', async () => {
    const { writer, $executeRaw } = make({ language: 'en' });
    await writer.materialize('u1', 'saved_search_matched', { listing_id: 'l-1' }, 'k1', { localized });
    expect(renderedContent($executeRaw.mock.calls[0][0])).toContain('Puppy');
  });

  it('falls back to ru when the recipient language has no localized value', async () => {
    const { writer, $executeRaw } = make({ language: 'fr' }); // no 'fr' key → ru fallback
    await writer.materialize('u1', 'saved_search_matched', { listing_id: 'l-1' }, 'k1', { localized });
    expect(renderedContent($executeRaw.mock.calls[0][0])).toContain('Щенок');
  });

  it('no analytics event → single INSERT, no transaction (unchanged path); returns true on insert', async () => {
    const { writer, $executeRaw, $transaction } = make({ affected: 1 });
    const inserted = await writer.materialize('u1', 'saved_search_matched', { listing_id: 'l-1' }, 'k1');
    expect(inserted).toBe(true);
    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect($transaction).not.toHaveBeenCalled();
  });

  it('analytics event is published atomically ONLY when the INSERT wins ON CONFLICT (affected=1)', async () => {
    const { writer, publish, txExecuteRaw } = make({ affected: 1 });
    const inserted = await writer.materialize('u1', 'saved_search_matched', { listing_id: 'l-1' }, 'k1', { onInsertEvent: EVENT });
    expect(inserted).toBe(true);
    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][1]).toMatchObject({ eventType: 'SavedSearch.Matched' });
  });

  it('analytics event is NOT published on a conflict/redelivery (affected=0); returns false', async () => {
    const { writer, publish } = make({ affected: 0 });
    const inserted = await writer.materialize('u1', 'saved_search_matched', { listing_id: 'l-1' }, 'k1', { onInsertEvent: EVENT });
    expect(inserted).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('a missing template no-ops (returns false, no INSERT, no event)', async () => {
    const { writer, $executeRaw, publish } = make({ template: [] });
    const inserted = await writer.materialize('u1', 'saved_search_matched', { listing_id: 'l-1' }, 'k1', { onInsertEvent: EVENT });
    expect(inserted).toBe(false);
    expect($executeRaw).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
