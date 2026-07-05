-- Migration: 20260705_0033_listings_market_cache
-- Wave D / D3 — derived `market` cache column on listings (ADR-0018 §Amendment 2026-07-04, rule 6/7).
--
-- WHAT
--   Add `listings.market VARCHAR(9)` + named `CHECK (market IN ('pet','livestock'))`
--   (chk_listings_market). It caches the listing's DERIVED market — the value of `species.market`
--   reached via animal→species. Backfill every existing listing once from that join, then set the
--   column NOT NULL. Add a `(market, status)` index for the future queue/discovery read paths (D8).
--   No table added or removed (36 tables unchanged).
--
--   This is a DERIVATION CACHE, NOT the assigned `market_scope` tag (ADR-0015 rule 7 — "no animal
--   listing carries market_scope"). Every animal listing has a species, and every species has a
--   market, so the value is always derivable and is merely cached here for O(1) list-path reads.
--
-- WHY
--   ADR-0018 §Amendment (AUDIT3): the moderation-queue base CTE and both `marketOf` copies read the
--   market via a raw `listings ⋈ animals ⋈ species` join. The queue CTE is a PAGINATED list query that
--   does NOT decompose into per-row `AnimalService` calls without an N+1, so the list-path breach is
--   fixed by a DATA SEAM (this cache column), not by per-row service calls. This slice (D3) lands the
--   column + populates it; D8 later repoints the readers at the column and drops the joins (green only
--   when the grep-gate `FROM +animals|JOIN +species` returns zero hits in listing+moderation modules).
--
-- WHY-BETTER-for-the-whole-project
--   - NOT NULL (after backfill), not nullable: animal_id is a mandatory FK, species_id is mandatory,
--     and species.market is NOT NULL — so a listing's market is ALWAYS derivable. NOT NULL turns
--     "every listing has a resolved market" into a DB guarantee and lets D8's queue/discovery read the
--     column with no NULL branch. Backfill runs BEFORE SET NOT NULL in this same migration.
--   - VARCHAR(9) fits 'livestock' (9 chars) and 'pet' (3); the named CHECK mirrors species.market's
--     domain so a stray value is rejected (23514), never silently cached.
--   - It stays "derived from species" (ADR-0004/0015) — merely cached, kept consistent in-tx at listing
--     create (listing.service) and recomputed on the rare admin species-market correction
--     (reference-data → ListingService.recomputeMarketForSpecies). This is the cheap standalone slice of,
--     and forward-compatible with, ADR-0014's eventual discovery read-model; the full materialised
--     projection is NOT built now.
--   - The `(market, status)` composite index serves both market-scoped discovery (market + status='ACTIVE')
--     and future queue faceting by market; market alone is too low-cardinality to index usefully.
--
-- Idempotent: `ADD COLUMN IF NOT EXISTS` + WHERE-market-IS-NULL backfill (0 rows on re-run) +
-- DROP-then-ADD the named CHECK in a DO block + `SET NOT NULL` (no-op once set) + `CREATE INDEX IF NOT
-- EXISTS`. Safe to run twice (proven on live PG — двойной прогон).
-- Negative tests (invariants):
--   (1) UPDATE/INSERT with market = 'bogus' is rejected by chk_listings_market (23514).
--   (2) After backfill, `ALTER COLUMN market SET NOT NULL` holds — an INSERT omitting market is rejected.
--   (3) Backfill correctness: a pre-existing listing whose species is 'livestock' gets market='livestock'.

-- 1) Add the column (nullable first, so the backfill can populate it).
ALTER TABLE listings ADD COLUMN IF NOT EXISTS market VARCHAR(9);

-- 2) Named domain CHECK (idempotent DROP-then-ADD).
DO $$
BEGIN
  ALTER TABLE listings DROP CONSTRAINT IF EXISTS chk_listings_market;
  ALTER TABLE listings ADD CONSTRAINT chk_listings_market CHECK (market IN ('pet', 'livestock'));
END $$;

-- 3) One-time backfill from the animal's species.market (the existing derivation). WHERE market IS NULL
--    makes it a no-op on re-run and on rows already populated by the create-path.
UPDATE listings l
SET market = s.market
FROM animals a
JOIN species s ON s.id = a.species_id
WHERE a.id = l.animal_id
  AND l.market IS NULL;

-- 4) Now every listing has a market → enforce NOT NULL (idempotent: no-op if already set).
ALTER TABLE listings ALTER COLUMN market SET NOT NULL;

-- 5) Composite index for D8 queue/discovery reads (market + status).
CREATE INDEX IF NOT EXISTS idx_listings_market_status ON listings(market, status);
