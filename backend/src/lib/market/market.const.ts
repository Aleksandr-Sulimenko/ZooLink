/**
 * The two markets (ADR-0002 hard split: pet vs livestock). Single source of truth — Wave F dedup
 * (was 3-4 verbatim copies across listing/moderation/reference-data/saved-search DTOs). Compatible
 * with the `listings.market` cache (D3) and the OfferingRef seam. `null` (market-agnostic) is a
 * separate concern handled at the event/outbox layer (`EventMarket`).
 */
export const MARKETS = ['pet', 'livestock'] as const;
export type Market = (typeof MARKETS)[number];
