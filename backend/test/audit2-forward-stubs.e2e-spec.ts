/**
 * AUDIT2 — Phase-3 FORWARD test stubs (laid AHEAD of the unbuilt ecosystem surfaces, per the owner's
 * "нет теста → не done, tests ahead for the unbuilt"). These are `it.todo` placeholders so the
 * ecosystem seams have a target and cannot regress silently when they land. No stack is driven.
 * Anchors: future-features.md (OfferingRef seam :210, find-nearby :194, reviews :174/:177),
 * ADR-0014/0015 (polymorphic Offering + market_scope), 0027 goods_marketplace toggle.
 */
describe('AUDIT2 forward stubs — unbuilt ecosystem surfaces (it.todo)', () => {
  // ── Polymorphic Offering (ADR-0014/0015) — undo the animal-bound coupling (listing.service.ts:146) ──
  it.todo('Offering: POST an Offering with NO animalId → 201 (species-less; market from market_scope, not marketOf)');
  it.todo('Offering: market_scope ∈ {pet,livestock,both} drives discovery/moderation instead of species');

  // ── find-nearby provider directory (future-features.md:194) — reuse Haversine fixture ──
  it.todo('find-nearby: returns species-less providers within radius, sorted by distanceM ascending');

  // ── Reviews / reputation / verification (future-features.md:174,177; ADR-E) ──
  it.todo('reviews: a buyer can review only AFTER a completed transaction');
  it.todo('reviews: exactly one review per (reviewer, subject); reputation aggregates');
  it.todo('verification: provider-verification badge gate (regulated categories: vet/livestock)');

  // ── Favorites (favorites-api.yaml, no controller) — OfferingRef{type,id} shape reserved now ──
  it.todo('favorites: favorite/unfavorite is idempotent; list is own-scoped; OfferingRef{type,id}');

  // ── Booking (ServiceOffering/consultation) ──
  it.todo('booking: book a service slot; double-book → 409; cancel state machine');

  // ── goods_marketplace toggle (migration 0027) — default OFF must not flip unnoticed ──
  it.todo('goods toggle: goods listings gated OFF by default; explicit flip-on path exercised');

  // ── Progressive / multi-role acquisition (active-user #3; ADR-0016 roles[]) ──
  it.todo('progressive-role: a USER self-requests BREEDER/FARMER via a self-service claim seam (not ADMIN-only)');

  // ── View-capture funnel (analytics.views hard-0 today, listing.dto.ts:420) ──
  it.todo('view-capture: instrument a view → analytics.views ≥ 1 (locks the day-1 funnel)');
});
