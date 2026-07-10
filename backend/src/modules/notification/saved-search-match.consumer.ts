import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../lib/db/prisma.service';
import type { EventMarket, OutboxConsumer, OutboxEvent } from '../../lib/outbox/outbox.types';
import { NotificationWriter } from './notification-writer.service';

/** The template rendered for a saved-search match (seeded EMAIL source, migration 0037; IN_APP channel). */
const SAVED_SEARCH_MATCHED_TEMPLATE = 'saved_search_matched';

/** Cap the fan-out per activated listing so one event can never materialize an unbounded set of rows. */
const MAX_MATCHES_PER_LISTING = 500;

/** The listing fields the matcher compares saved searches against (loaded once per event). */
interface ListingMatchRow {
  id: string;
  seller_id: string;
  market: string;
  listing_type: string;
  price_cents: bigint | null;
  lat: number | null;
  lng: number | null;
  status: string;
  title_localized: unknown;
  description_localized: unknown;
  species_id: number | null;
  breed_id: number | null;
}

/** A saved search whose owner should be alerted about this listing. */
interface MatchRow {
  id: string;
  user_id: string;
}

/**
 * Slice H4 — the FIRST demand-side return loop (AUDIT4). A worker-side outbox consumer that turns the
 * already-emitted `Listing.Activated` event (moderation APPROVE → ACTIVE, emitted in-tx) into
 * saved-search alerts: for a newly-active listing it finds every saved search the listing satisfies and
 * materializes one IN_APP `notification_logs` row per matching (saved_search, listing) pair.
 *
 * WHY consume `Listing.Activated` (not match in the moderation tx, not a polling tick):
 *  - **Decoupled** — moderation stays ignorant of saved-search; a matching failure only fails THIS
 *    consumer's delivery (relay retries the event), it can NEVER roll back a valid approval. The outbox
 *    seam is exactly the module boundary the pattern exists to protect.
 *  - **Exactly-once per pair without a schema marker** — the notification `idempotency_key` is the
 *    deterministic per-pair value `saved_search_matched:<savedSearchId>:<listingId>`, so at-least-once
 *    redelivery of `Listing.Activated` re-runs the same idempotent INSERTs and yields exactly one row
 *    per pair. No `saved_search_notified_at` column / poll loop (which the tick alternative would need).
 *  - **Event-driven, no latency floor** — fires as soon as the relay ships the activation event.
 *
 * ADR-0002 (hard market split) is enforced structurally: a saved search matches ONLY when it is
 * market-anchored to the listing's market (see {@link matchSql}) — a market-agnostic search never
 * crosses markets. Match subset & rationale are documented on {@link matchSql}.
 *
 * Idempotent under redelivery and safe under concurrency (the writer's ON CONFLICT DO NOTHING).
 */
@Injectable()
export class SavedSearchMatchConsumer implements OutboxConsumer {
  private readonly logger = new Logger(SavedSearchMatchConsumer.name);
  readonly eventTypes = ['Listing.Activated'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: NotificationWriter,
  ) {}

  async handle(event: OutboxEvent): Promise<void> {
    if (event.eventType !== 'Listing.Activated') return; // defensive: relay already filters
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const listingId = typeof payload.listingId === 'string' ? payload.listingId : null;
    if (!listingId) {
      this.logger.debug(`Listing.Activated (#${event.id}) had no listingId — skipped`);
      return;
    }

    const listing = await this.loadListing(listingId);
    if (!listing) {
      // The listing was deleted between activation and relay — nothing to alert on.
      this.logger.debug(`Listing ${listingId} no longer exists — no saved-search alerts`);
      return;
    }
    if (listing.status !== 'ACTIVE') {
      // Flipped out of ACTIVE (e.g. moderation reversed / sold) before we processed the event — the
      // alert would be stale; do not notify. (Rare; the relay poll is near-real-time.)
      this.logger.debug(`Listing ${listingId} is ${listing.status}, not ACTIVE — no saved-search alerts`);
      return;
    }

    const matches = await this.findMatches(listing);
    if (matches.length === 0) return;
    if (matches.length === MAX_MATCHES_PER_LISTING) {
      // The fan-out cap was hit — some matching saved searches may have been truncated and NOT alerted.
      // WARN (not debug) so silent truncation is visible in ops (a signal to raise the cap / paginate).
      this.logger.warn(
        `Listing ${listing.id} hit the ${MAX_MATCHES_PER_LISTING} saved-search match cap — some matches may be truncated (not alerted)`,
      );
    }

    // The alert body interpolates `{{listing_id}}` (flat) and `{{listing_title}}` (per-recipient
    // localized — resolved to the recipient's language with ru fallback by NotificationWriter;
    // spec 07 H4-follow-ups note, item (3)).
    const ctx = { listing_id: listing.id };
    const localized = { listing_title: this.localizedTitle(listing.title_localized) };
    const market = this.toEventMarket(listing.market);
    // Batch match time, shared by the whole fan-out; may micro-differ from each event's envelope
    // occurredAt (publish time) — intentional, both are spec'd.
    const matchedAt = new Date().toISOString();

    for (const m of matches) {
      // Per-pair dedup unit — deterministic, so `Listing.Activated` redelivery collapses to one row.
      // The analytics `SavedSearch.Matched` event is published ATOMICALLY in the same tx and ONLY when
      // this INSERT wins ON CONFLICT (SS-M4-consistent exactly-once — redelivery inserts 0 rows → no
      // event). It has NO consumer today; it feeds the future match→view→contact funnel (data-analyst).
      await this.writer.materialize(
        m.user_id,
        SAVED_SEARCH_MATCHED_TEMPLATE,
        ctx,
        `${SAVED_SEARCH_MATCHED_TEMPLATE}:${m.id}:${listing.id}`,
        {
          localized,
          onInsertEvent: {
            aggregateType: 'SavedSearch',
            aggregateId: m.id,
            eventType: 'SavedSearch.Matched',
            schemaVersion: 1,
            market,
            payload: {
              savedSearchId: m.id,
              listingId: listing.id,
              subjectUserId: m.user_id,
              market,
              matchedAt,
            },
          },
        },
      );
    }
    this.logger.log(`Listing ${listing.id} matched ${matches.length} saved search(es) — alerts materialized`);
  }

  /**
   * Load the listing's match fields. `species_id`/`breed_id` come from the animal via a Prisma nested
   * relation select (relation traversal — the ADR-0018 D8/D8b-sanctioned way to read animal columns; NOT
   * a raw cross-aggregate animals⋈species SQL join, so this file stays inside the market-join grep-gate).
   * `market` is read from the `listings.market` cache directly (D3).
   */
  private async loadListing(listingId: string): Promise<ListingMatchRow | null> {
    const row = await this.prisma.listings.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        seller_id: true,
        market: true,
        listing_type: true,
        price_cents: true,
        lat: true,
        lng: true,
        status: true,
        title_localized: true,
        description_localized: true,
        animals: { select: { species_id: true, breed_id: true } },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      seller_id: row.seller_id,
      market: row.market,
      listing_type: row.listing_type,
      price_cents: row.price_cents,
      lat: row.lat,
      lng: row.lng,
      status: row.status,
      title_localized: row.title_localized,
      description_localized: row.description_localized,
      species_id: row.animals?.species_id ?? null,
      breed_id: row.animals?.breed_id ?? null,
    };
  }

  /**
   * Reverse-query: the saved searches this listing satisfies. Parameterized `$queryRaw` over
   * `saved_searches` only (bound params, ESLint-guarded; no cross-aggregate join). See {@link matchSql}
   * for the exact predicate and the documented match subset.
   */
  private async findMatches(listing: ListingMatchRow): Promise<MatchRow[]> {
    return this.prisma.$queryRaw<MatchRow[]>`
      SELECT s.id, s.user_id
      FROM saved_searches s
      WHERE ${this.matchSql(listing)}
      ORDER BY s.created_at ASC
      LIMIT ${MAX_MATCHES_PER_LISTING}`;
  }

  /**
   * The match predicate. A saved search matches iff ALL of its present filters are satisfied by the
   * listing AND it is market-anchored to the listing's market (ADR-0002).
   *
   * **Cross-market safety (ADR-0002):** the search must be *anchored* to the listing's market — it
   * pins `market` (== the listing's market) OR pins `species_id`/`breed_id` (a species/breed lives in
   * exactly one market, and the equality checks below force it to equal the listing's, so it can only
   * ever anchor within the same market). A search with neither a market pin nor a species/breed pin is
   * market-agnostic and is **deliberately NOT matched** — matching it would risk notifying across the
   * pet/livestock split. This is the documented match subset.
   *
   * **Match subset (documented, honest):**
   *  - `market`      — if set, MUST equal the listing's market.
   *  - `species_id`  — if set, MUST equal the listing's animal's species_id.
   *  - `breed_id`    — if set, MUST equal the listing's animal's breed_id (a listing with a NULL breed
   *                    never matches a breed-pinned search).
   *  - `listing_type`— if set, MUST equal the listing's listing_type.
   *  - `price_min` / `price_max` — if set, the listing MUST have a price and be within the bound (a
   *                    priceless listing, e.g. breeding, never matches a price-bounded search).
   *  - geo (`radius_m` + `lat`/`lng` columns) — if set, the listing MUST have coords and lie within the
   *                    radius (exact Haversine, bound params only).
   *  - `q` (free text) — **case-insensitive SUBSTRING** match (SS-M2): if a non-blank `q` is set, the
   *                    listing's concatenated both-locale title+description (`searchableText`, a single
   *                    bound param) MUST contain it (`strpos(lower(text), lower(q)) > 0`). A blank /
   *                    whitespace-only `q` is a no-op (the search still matches on its OTHER filters).
   *                    Substring only — no stemming/ranking/typo-tolerance (a stemmed FTS is a Phase-2
   *                    ADR upgrade behind this seam); the listing text is already loaded, so no DDL /
   *                    index is needed and the file stays inside the market-join grep-gate.
   *
   * The seller is never alerted about their own listing (`s.user_id <> seller_id`).
   */
  private matchSql(listing: ListingMatchRow): Prisma.Sql {
    const market = listing.market;
    const speciesId = listing.species_id;
    const breedId = listing.breed_id;
    const listingType = listing.listing_type;
    const price = listing.price_cents; // bigint | null
    const lat = listing.lat;
    const lng = listing.lng;
    const searchText = this.searchableText(listing); // both-locale title+description (a bound param)

    return Prisma.sql`
      s.offering_type = 'ANIMAL_LISTING'
      AND s.user_id <> ${listing.seller_id}::uuid
      -- Market anchor (ADR-0002): the search must be tied to THIS market via a market/species/breed pin.
      AND (
        (s.filters ? 'market' AND s.filters->>'market' = ${market})
        OR (s.filters ? 'species_id')
        OR (s.filters ? 'breed_id')
      )
      -- A market pin, if present, MUST equal the listing's market (no cross-market leak).
      AND (NOT (s.filters ? 'market') OR s.filters->>'market' = ${market})
      -- species_id / breed_id equality (same species/breed ⇒ same market).
      AND (NOT (s.filters ? 'species_id') OR (s.filters->>'species_id')::int = ${speciesId})
      AND (NOT (s.filters ? 'breed_id') OR (s.filters->>'breed_id')::int = ${breedId})
      -- listing_type equality.
      AND (NOT (s.filters ? 'listing_type') OR s.filters->>'listing_type' = ${listingType})
      -- q free-text — case-insensitive SUBSTRING over the listing's both-locale title+description
      -- (bound param). A blank/whitespace-only q is a no-op filter; a non-blank q must substring-hit.
      AND (
        NOT (s.filters ? 'q')
        OR btrim(s.filters->>'q') = ''
        OR strpos(lower(${searchText}), lower(btrim(s.filters->>'q'))) > 0
      )
      -- price bounds — a priceless listing never satisfies a price-bounded search.
      AND (NOT (s.filters ? 'price_min') OR (${price}::bigint IS NOT NULL AND ${price}::bigint >= (s.filters->>'price_min')::bigint))
      AND (NOT (s.filters ? 'price_max') OR (${price}::bigint IS NOT NULL AND ${price}::bigint <= (s.filters->>'price_max')::bigint))
      -- geo radius — exact Haversine; a coordless listing never matches a geo search.
      AND (
        s.radius_m IS NULL OR (
          ${lat}::double precision IS NOT NULL AND ${lng}::double precision IS NOT NULL
          AND (
            2 * 6371000 * asin(sqrt(
              power(sin(radians(s.lat - ${lat}::double precision) / 2), 2) +
              cos(radians(${lat}::double precision)) * cos(radians(s.lat)) *
              power(sin(radians(s.lng - ${lng}::double precision) / 2), 2)
            ))
          ) <= s.radius_m
        )
      )`;
  }

  /**
   * The listing title as a per-locale map `{ ru, en }` for the alert body. NotificationWriter resolves
   * it to the recipient's own language (ru fallback) — spec 07 H4-follow-ups note, item (3).
   * Missing locales collapse to ''.
   */
  private localizedTitle(localized: unknown): Record<string, string> {
    return { ru: this.locale(localized, 'ru'), en: this.locale(localized, 'en') };
  }

  /**
   * The listing's searchable text for the `q` substring match (SS-M2): title + description of BOTH
   * locales, newline-joined so a multi-word `q` can never substring-match across two different
   * fields. Built in-memory from the already-loaded listing row (no DDL, no index).
   */
  private searchableText(listing: ListingMatchRow): string {
    return [
      this.locale(listing.title_localized, 'ru'),
      this.locale(listing.title_localized, 'en'),
      this.locale(listing.description_localized, 'ru'),
      this.locale(listing.description_localized, 'en'),
    ].join('\n');
  }

  /** One locale value from a localized JSONB object, or '' when absent/malformed. */
  private locale(localized: unknown, lang: 'ru' | 'en'): string {
    if (localized && typeof localized === 'object') {
      const v = (localized as Record<string, unknown>)[lang];
      if (typeof v === 'string') return v;
    }
    return '';
  }

  /** Narrow the cached listing market string to the outbox envelope's EventMarket union. */
  private toEventMarket(market: string): EventMarket {
    return market === 'pet' || market === 'livestock' ? market : null;
  }
}
