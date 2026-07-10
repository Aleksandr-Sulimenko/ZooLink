import { SavedSearchMatchConsumer } from './saved-search-match.consumer';
import type { PrismaService } from '../../lib/db/prisma.service';
import type { NotificationWriter } from './notification-writer.service';
import type { OutboxEvent } from '../../lib/outbox/outbox.types';

/**
 * Unit coverage for the consumer WIRING (not the SQL predicate — that is exercised against real PG in
 * the e2e). Asserts the H4-follow-up additions land in the materialize() call: per-recipient localized
 * title, the flat listing_id ctx, and the `SavedSearch.Matched` analytics event shape + market narrowing;
 * plus the staleness guards (non-ACTIVE / deleted listing → no alert, no throw).
 */
const LISTING = {
  id: 'l-1',
  seller_id: 'seller-1',
  market: 'pet',
  listing_type: 'sale',
  price_cents: 5000n,
  lat: null,
  lng: null,
  status: 'ACTIVE',
  title_localized: { ru: 'Щенок', en: 'Puppy' },
  description_localized: { ru: 'описание', en: 'desc' },
  animals: { species_id: 7, breed_id: 3 },
};

const activated = (over: Record<string, unknown> = {}): OutboxEvent => ({
  id: 'ev-1',
  aggregateType: 'Listing',
  aggregateId: 'l-1',
  eventType: 'Listing.Activated',
  payload: { listingId: 'l-1', sellerId: 'seller-1', ...over },
  attempts: 1,
});

function make(opts: { listing?: Record<string, unknown> | null; matches?: { id: string; user_id: string }[] } = {}) {
  const findUnique = jest.fn().mockResolvedValue(opts.listing === undefined ? LISTING : opts.listing);
  const $queryRaw = jest.fn().mockResolvedValue(opts.matches ?? []);
  const prisma = { listings: { findUnique }, $queryRaw } as unknown as PrismaService;
  const materialize = jest.fn().mockResolvedValue(true);
  const writer = { materialize } as unknown as NotificationWriter;
  return { consumer: new SavedSearchMatchConsumer(prisma, writer), materialize, findUnique };
}

describe('SavedSearchMatchConsumer (wiring)', () => {
  it('passes the localized title, flat listing_id ctx, per-pair key, and the SavedSearch.Matched event', async () => {
    const { consumer, materialize } = make({ matches: [{ id: 'ss-1', user_id: 'u-1' }] });
    await consumer.handle(activated());

    expect(materialize).toHaveBeenCalledTimes(1);
    const [userId, template, ctx, key, opts] = materialize.mock.calls[0];
    expect(userId).toBe('u-1');
    expect(template).toBe('saved_search_matched');
    expect(ctx).toEqual({ listing_id: 'l-1' });
    expect(key).toBe('saved_search_matched:ss-1:l-1');
    expect(opts.localized).toEqual({ listing_title: { ru: 'Щенок', en: 'Puppy' } });
    expect(opts.onInsertEvent).toMatchObject({
      aggregateType: 'SavedSearch',
      aggregateId: 'ss-1',
      eventType: 'SavedSearch.Matched',
      schemaVersion: 1,
      market: 'pet',
      payload: { savedSearchId: 'ss-1', listingId: 'l-1', subjectUserId: 'u-1', market: 'pet' },
    });
    expect(typeof opts.onInsertEvent.payload.matchedAt).toBe('string');
  });

  it('narrows an unknown market to null on the event envelope', async () => {
    const { consumer, materialize } = make({
      listing: { ...LISTING, market: 'weird' },
      matches: [{ id: 'ss-1', user_id: 'u-1' }],
    });
    await consumer.handle(activated({ market: 'weird' }));
    expect(materialize.mock.calls[0][4].onInsertEvent.market).toBeNull();
  });

  it('does not alert on a listing that is no longer ACTIVE (staleness guard)', async () => {
    const { consumer, materialize } = make({ listing: { ...LISTING, status: 'SOLD' } });
    await expect(consumer.handle(activated())).resolves.toBeUndefined();
    expect(materialize).not.toHaveBeenCalled();
  });

  it('does not throw and does not alert when the listing was deleted (loadListing → null)', async () => {
    const { consumer, materialize } = make({ listing: null });
    await expect(consumer.handle(activated())).resolves.toBeUndefined();
    expect(materialize).not.toHaveBeenCalled();
  });

  it('skips an event with no listingId', async () => {
    const { consumer, materialize, findUnique } = make();
    await consumer.handle(activated({ listingId: undefined }));
    expect(findUnique).not.toHaveBeenCalled();
    expect(materialize).not.toHaveBeenCalled();
  });
});
