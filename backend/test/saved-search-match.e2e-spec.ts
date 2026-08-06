/**
 * Slice H4 — saved-search → notify (the first demand-side return loop, AUDIT4). End-to-end against the
 * real stack (PG). Proves the worker-side `SavedSearchMatchConsumer`: a `Listing.Activated` event is
 * matched against users' saved searches and materializes one durable IN_APP `saved_search_matched`
 * notification per matching (saved_search, listing) pair. Covers the slice invariants:
 *   H4-1  a market-anchored matching search → exactly one IN_APP row for the search owner
 *   H4-2  ADR-0002: a cross-market search (by market pin OR by species) NEVER matches
 *   H4-3  dedup: redelivering Listing.Activated yields exactly one row per (search, listing) pair
 *   H4-4  self-exclusion: the seller is never alerted about their own listing
 *   H4-5  price bounds; a priceless listing never matches a price-bounded search
 *   H4-6  a market-agnostic search (no market/species/breed anchor) is NOT matched (documented subset)
 *   H4-7  geo radius match / no-match (anchored by a market pin)
 *   H4-8  `q` free-text is ignored (search still matches on its other filters)
 *   H4-9  breed_id equality
 *   H4-10 a listing no longer ACTIVE at relay time is not alerted on
 *   H4-11 language: an en-preferred owner gets the en-rendered body
 *   H4-12 relay path: a produced Listing.Activated event flows through relay.tick() to a notification
 * e2e hits HOST pg (localhost). The relay does not auto-poll under NODE_ENV=test; we drive it directly.
 */
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
loadEnv({ path: join(__dirname, '..', '.env'), quiet: true });

import { Test } from '@nestjs/testing';
import type { INestApplicationContext } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { WorkerModule } from '../src/worker.module';
import { PrismaService } from '../src/lib/db/prisma.service';
import { OutboxService } from '../src/lib/outbox/outbox.service';
import { OutboxRelay } from '../src/lib/outbox/outbox.relay';
import { SavedSearchMatchConsumer } from '../src/modules/notification/saved-search-match.consumer';
import type { OutboxEvent } from '../src/lib/outbox/outbox.types';

describe('H4 — saved-search → notify (e2e)', () => {
  let ctx: INestApplicationContext;
  let prisma: PrismaService;
  let outbox: OutboxService;
  let relay: OutboxRelay;
  let consumer: SavedSearchMatchConsumer;

  const userIds: string[] = [];
  const animalIds: string[] = [];
  const listingIds: string[] = [];
  const savedSearchIds: string[] = [];
  const eventIds: string[] = [];

  let seller: string;
  let spPet: number;
  let spLivestock: number;
  let brPet: number;
  let brPetOther: number;
  let brLivestock: number;
  const suffix = randomUUID().slice(0, 8);

  // Moscow-ish center for geo tests.
  const LAT = 55.75;
  const LNG = 37.61;

  const mkUser = async (data: Record<string, unknown> = {}): Promise<string> => {
    const u = await prisma.users.create({
      data: { full_name: 'H4', role: 'USER', principal_type: 'HUMAN', status: 'ACTIVE', is_active: true, ...data },
    });
    userIds.push(u.id);
    return u.id;
  };

  const mkAnimal = async (speciesId: number, breedId: number): Promise<string> => {
    const a = await prisma.animals.create({
      data: {
        owner_id: seller,
        species_id: speciesId,
        breed_id: breedId,
        nickname_localized: { en: 'H4', ru: 'Н4' },
        sex: 'Male',
        date_of_birth: new Date('2021-01-01T00:00:00Z'),
      },
    });
    animalIds.push(a.id);
    return a.id;
  };

  const mkListing = async (
    animalId: string,
    market: string,
    over: Record<string, unknown> = {},
  ): Promise<string> => {
    const l = await prisma.listings.create({
      data: {
        animal_id: animalId,
        seller_id: seller,
        market,
        listing_type: 'sale',
        title_localized: { en: 'Puppy', ru: 'Щенок' },
        price_cents: 5000n,
        status: 'ACTIVE',
        moderation_status: 'APPROVED',
        is_active: true,
        ...over,
      },
    });
    listingIds.push(l.id);
    return l.id;
  };

  const mkSearch = async (
    userId: string,
    filters: Prisma.InputJsonObject,
    geo?: { lat: number; lng: number; radius_m: number },
  ): Promise<string> => {
    const s = await prisma.saved_searches.create({
      data: {
        user_id: userId,
        filters,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        radius_m: geo?.radius_m ?? null,
        offering_type: 'ANIMAL_LISTING',
        offering_id: null,
      },
    });
    savedSearchIds.push(s.id);
    return s.id;
  };

  /** An OutboxEvent for driving consumer.handle() directly. */
  const activated = (listingId: string, sellerId: string, market = 'pet'): OutboxEvent => ({
    id: randomUUID(),
    aggregateType: 'Listing',
    aggregateId: listingId,
    eventType: 'Listing.Activated',
    payload: { schemaVersion: 1, occurredAt: new Date().toISOString(), market, listingId, sellerId },
    attempts: 1,
  });

  // The saved_search_matched EMAIL source templates (ru + en) the IN_APP alert rows carry.
  let matchedTemplateIds: string[] = [];

  const key = (searchId: string, listingId: string) => `saved_search_matched:${searchId}:${listingId}`;
  const rowFor = (searchId: string, listingId: string) =>
    prisma.notification_logs.findFirst({ where: { idempotency_key: key(searchId, listingId) } });
  const countFor = (searchId: string, listingId: string) =>
    prisma.notification_logs.count({ where: { idempotency_key: key(searchId, listingId) } });
  // T5 (reviewer-qa axis 13): `countFor` filters by the CANONICAL idempotency_key, and idempotency_key
  // carries a UNIQUE index → the count is structurally ∈ {0,1}. It can prove PRESENCE/ABSENCE but is
  // BLIND to a duplicate written under a DIFFERENT key (a real dedup-break). The dedup proof must count
  // a value that CAN reach ≥2: all saved_search_matched rows for the (fresh) owner (by template, either
  // language — the row's template_id is the recipient-language source template).
  const matchedRowsForUser = (userId: string) =>
    prisma.notification_logs.count({ where: { user_id: userId, template_id: { in: matchedTemplateIds } } });

  beforeAll(async () => {
    ctx = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    await ctx.init();
    prisma = ctx.get(PrismaService);
    outbox = ctx.get(OutboxService);
    relay = ctx.get(OutboxRelay);
    consumer = ctx.get(SavedSearchMatchConsumer);

    seller = await mkUser();
    // T5: ids of the EMAIL source templates (ru+en) the IN_APP alert rows carry (seeded by migration 0037).
    matchedTemplateIds = (
      await prisma.notification_templates.findMany({ where: { name: 'saved_search_matched', type: 'EMAIL' }, select: { id: true } })
    ).map((t) => t.id);

    const sPet = await prisma.species.create({ data: { code: `h4_sp_pet_${suffix}`, name_localized: { en: 'P', ru: 'П' }, market: 'pet' } });
    const sLiv = await prisma.species.create({ data: { code: `h4_sp_liv_${suffix}`, name_localized: { en: 'L', ru: 'Л' }, market: 'livestock' } });
    spPet = sPet.id;
    spLivestock = sLiv.id;
    const bPet = await prisma.breeds.create({ data: { code: `h4_br_pet_${suffix}`, species_id: spPet, name_localized: { en: 'B', ru: 'Б' } } });
    const bPetOther = await prisma.breeds.create({ data: { code: `h4_br_pet2_${suffix}`, species_id: spPet, name_localized: { en: 'B2', ru: 'Б2' } } });
    const bLiv = await prisma.breeds.create({ data: { code: `h4_br_liv_${suffix}`, species_id: spLivestock, name_localized: { en: 'BL', ru: 'БЛ' } } });
    brPet = bPet.id;
    brPetOther = bPetOther.id;
    brLivestock = bLiv.id;
  });

  afterAll(async () => {
    await prisma.notification_logs.deleteMany({ where: { user_id: { in: userIds } } }).catch(() => undefined);
    await prisma.outbox_events.deleteMany({ where: { id: { in: eventIds } } }).catch(() => undefined);
    // H4-follow-up: the consumer now emits a SavedSearch.Matched analytics event per inserted pair.
    await prisma.outbox_events.deleteMany({ where: { event_type: 'SavedSearch.Matched', aggregate_id: { in: savedSearchIds } } }).catch(() => undefined);
    await prisma.saved_searches.deleteMany({ where: { id: { in: savedSearchIds } } }).catch(() => undefined);
    await prisma.listings.deleteMany({ where: { id: { in: listingIds } } }).catch(() => undefined);
    for (const id of animalIds) await prisma.animals.delete({ where: { id } }).catch(() => undefined);
    await prisma.breeds.deleteMany({ where: { id: { in: [brPet, brPetOther, brLivestock] } } }).catch(() => undefined);
    await prisma.species.deleteMany({ where: { id: { in: [spPet, spLivestock] } } }).catch(() => undefined);
    for (const id of userIds) await prisma.users.delete({ where: { id } }).catch(() => undefined);
    await ctx.close();
  });

  // ── H4-1: market-anchored match → exactly one IN_APP row ────────────────────────────────────────
  it('H4-1: a matching market+species saved search yields one IN_APP row for the owner', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', species_id: spPet });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));

    const notif = await rowFor(s, listing);
    expect(notif).not.toBeNull();
    expect(notif!.type).toBe('IN_APP');
    expect(notif!.user_id).toBe(u);
    expect(notif!.status).toBe('SENT');
    expect((notif!.content ?? '').length).toBeGreaterThan(0);
    expect(notif!.content).toContain('Щенок'); // ru-first title interpolated
  });

  // ── H4-2: ADR-0002 cross-market never matches ───────────────────────────────────────────────────
  it('H4-2a: a livestock-pinned search does NOT match a pet listing', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'livestock' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  it('H4-2b: a livestock-species search does NOT match a pet listing (species pins market)', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { species_id: spLivestock });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── H4-3: dedup on redelivery ───────────────────────────────────────────────────────────────────
  it('H4-3: redelivering Listing.Activated yields exactly one row per (search, listing) pair', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    const ev = activated(listing, seller);
    await consumer.handle(ev);
    await consumer.handle(ev); // at-least-once redelivery (same event.id)
    await consumer.handle(activated(listing, seller)); // even a DIFFERENT event id → still per-pair
    // Dedup proof by a value that CAN be ≥2 (matchedRowsForUser), NOT by the unique idempotency_key.
    // A dedup-break that writes the canonical key once then a random key on redelivery would leave
    // countFor==1 (blind) but matchedRowsForUser==3 → this assertion is the one that REDs the mutant.
    expect(await matchedRowsForUser(u)).toBe(1);
    expect(await countFor(s, listing)).toBe(1); // canonical row present (presence check, retained)
  });

  // ── H4-4: self-exclusion ────────────────────────────────────────────────────────────────────────
  it('H4-4: the seller is not alerted about their own listing', async () => {
    const s = await mkSearch(seller, { market: 'pet' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── H4-5: price bounds ──────────────────────────────────────────────────────────────────────────
  it('H4-5a: price_max below the listing price → no match; at/above → match', async () => {
    const uLow = await mkUser();
    const uHigh = await mkUser();
    const sLow = await mkSearch(uLow, { market: 'pet', price_max: 4000 });
    const sHigh = await mkSearch(uHigh, { market: 'pet', price_max: 6000 });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet', { price_cents: 5000n });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(sLow, listing)).toBe(0);
    expect(await countFor(sHigh, listing)).toBe(1);
  });

  it('H4-5b: a priceless listing never matches a price-bounded search', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', price_max: 100000 });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet', { listing_type: 'breeding', price_cents: null });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── H4-6: market-agnostic search is not matched (documented subset) ──────────────────────────────
  it('H4-6: a search with no market/species/breed anchor is NOT matched (ADR-0002 safety)', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { listing_type: 'sale', price_max: 100000 }); // no market anchor
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── H4-7: geo radius ────────────────────────────────────────────────────────────────────────────
  it('H4-7: a near geo search matches, a far one does not', async () => {
    const uNear = await mkUser();
    const uFar = await mkUser();
    // Near: same point, 5km radius. Far: ~1.1° north (~120km) with 10km radius.
    const sNear = await mkSearch(uNear, { market: 'pet' }, { lat: LAT, lng: LNG, radius_m: 5000 });
    const sFar = await mkSearch(uFar, { market: 'pet' }, { lat: LAT + 1.1, lng: LNG, radius_m: 10000 });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet', { lat: LAT, lng: LNG });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(sNear, listing)).toBe(1);
    expect(await countFor(sFar, listing)).toBe(0);
  });

  it('H4-7b: a geo search does not match a listing with no coordinates', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet' }, { lat: LAT, lng: LNG, radius_m: 5000 });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet', { lat: null, lng: null });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── H4-8: q substring FTS (SS-M2 — now EVALUATED as a case-insensitive substring) ─────────────────
  it('H4-8a: a q substring that hits the ru title matches (case-insensitive)', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', q: 'щЕН' }); // 'Щенок' contains 'щен' (case-insensitive)
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet'); // title { ru: 'Щенок', en: 'Puppy' }

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(1);
  });

  it('H4-8b: a q substring that hits the en title matches (both locales are searched)', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', q: 'upp' }); // 'Puppy' contains 'upp'
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(1);
  });

  it('H4-8c: a q with no substring hit does NOT match (even when other filters hold)', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', q: 'zzz-nonexistent-term' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  it('H4-8d: a blank/whitespace q is a no-op filter — the search still matches on its other filters', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', q: '   ' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(1);
  });

  // ── H4-9: breed_id equality ─────────────────────────────────────────────────────────────────────
  it('H4-9: breed_id must equal the listing breed', async () => {
    const uMatch = await mkUser();
    const uMiss = await mkUser();
    const sMatch = await mkSearch(uMatch, { species_id: spPet, breed_id: brPet });
    const sMiss = await mkSearch(uMiss, { species_id: spPet, breed_id: brPetOther });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(sMatch, listing)).toBe(1);
    expect(await countFor(sMiss, listing)).toBe(0);
  });

  // ── H4-10: not-ACTIVE at relay time → no alert ──────────────────────────────────────────────────
  it('H4-10: a listing no longer ACTIVE is not alerted on', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet', { status: 'SOLD' });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── H4-11: language ─────────────────────────────────────────────────────────────────────────────
  it('H4-11: an en-preferred owner gets the en-rendered body', async () => {
    const u = await mkUser({ preferred_language: 'en' });
    const s = await mkSearch(u, { market: 'pet' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    const notif = await rowFor(s, listing);
    expect(notif).not.toBeNull();
    expect(notif!.content).toContain('matches your saved search');
  });

  // ── m2 / SS-M6: transactional-always — promo:false owner STILL gets the IN_APP alert ────────────
  it('H4-13 (SS-M6 behavioural): a search owner with notification_prefs.promo=false still gets the alert', async () => {
    const u = await mkUser({ notification_prefs: { email: false, sms: false, promo: false } });
    const s = await mkSearch(u, { market: 'pet' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(1); // user-requested service notification is not gated by promo
  });

  // ── m3 / SS-M7: deleted-listing branch of the staleness guard (loadListing → null) ──────────────
  it('H4-14 (SS-M7 deleted): a listing DELETED before relay yields no alert and does not throw', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');
    const ev = activated(listing, seller);
    // Simulate the listing being removed between activation and relay processing.
    await prisma.listings.delete({ where: { id: listing } });
    listingIds.splice(listingIds.indexOf(listing), 1); // already gone — drop from afterAll cleanup

    await expect(consumer.handle(ev)).resolves.toBeUndefined(); // no throw (loadListing → null → skip)
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── m4a: listing_type mismatch pin → no match (even when market-anchored) ────────────────────────
  it('H4-15: a search pinning a different listing_type does not match', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', listing_type: 'breeding' });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet', { listing_type: 'sale' });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(0);
  });

  // ── m4b: price_min bound — listing priced below min → no match; at/above → match ─────────────────
  it('H4-16: price_min excludes a cheaper listing and admits an at/above one', async () => {
    const uBelow = await mkUser();
    const uAtAbove = await mkUser();
    const sBelow = await mkSearch(uBelow, { market: 'pet', price_min: 6000 });
    const sAtAbove = await mkSearch(uAtAbove, { market: 'pet', price_min: 5000 });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet', { price_cents: 5000n });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(sBelow, listing)).toBe(0); // 5000 < 6000
    expect(await countFor(sAtAbove, listing)).toBe(1); // 5000 >= 5000
  });

  // ── H4-17: SavedSearch.Matched analytics event — emitted once per pair, exactly-once on redelivery ─
  it('H4-17: a matched pair emits exactly one SavedSearch.Matched event, atomic and exactly-once', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', species_id: spPet });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    const evCount = () =>
      prisma.outbox_events.count({
        where: { event_type: 'SavedSearch.Matched', aggregate_id: s, payload: { path: ['listingId'], equals: listing } },
      });

    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(1);
    expect(await evCount()).toBe(1); // event published in the insert-won tx

    // Redelivery: the alert INSERT no-ops (0 rows) → NO second event (exactly-once, SS-M4-consistent).
    await consumer.handle(activated(listing, seller));
    expect(await countFor(s, listing)).toBe(1);
    expect(await evCount()).toBe(1);

    const ev = await prisma.outbox_events.findFirst({
      where: { event_type: 'SavedSearch.Matched', aggregate_id: s, payload: { path: ['listingId'], equals: listing } },
    });
    expect(ev!.aggregate_type).toBe('SavedSearch');
    const p = ev!.payload as Record<string, unknown>;
    expect(p.savedSearchId).toBe(s);
    expect(p.subjectUserId).toBe(u);
    expect(p.market).toBe('pet');
    expect(typeof p.matchedAt).toBe('string');
  });

  // ── H4-12: relay path (produced event → relay.tick() → notification) ────────────────────────────
  it('H4-12: a produced Listing.Activated flows through the relay to a saved-search notification', async () => {
    const u = await mkUser();
    const s = await mkSearch(u, { market: 'pet', species_id: spPet });
    const animal = await mkAnimal(spPet, brPet);
    const listing = await mkListing(animal, 'pet');

    const ev = (await prisma.$transaction((tx) =>
      outbox.publish(tx, {
        aggregateType: 'Listing',
        aggregateId: listing,
        eventType: 'Listing.Activated',
        schemaVersion: 1,
        market: 'pet',
        payload: { listingId: listing, sellerId: seller },
      }),
    )) as { id: string };
    eventIds.push(ev.id);

    for (let i = 0; i < 25; i++) {
      await relay.tick();
      const row = await prisma.outbox_events.findUnique({ where: { id: ev.id } });
      if (row?.processed_at) break;
    }
    expect(await countFor(s, listing)).toBe(1);
    const processed = await prisma.outbox_events.findUnique({ where: { id: ev.id } });
    expect(processed!.processed_at).not.toBeNull();
  });
});
