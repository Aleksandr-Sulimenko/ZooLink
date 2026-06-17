---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Spec: Pet vs Livestock — divergent rules (hard split)

## Outcome
[ADR-0002](../04-decisions/0002-hard-split-markets.md) mandates a hard split between the **pet** and **livestock**
markets, but the per-market specs were near-identical. This document is the **normative table of concrete
differences** a backend dev must implement; without it the split is only UI routing.

A listing's market is derived from its animal's **species** (`species.market` ∈ {`pet`, `livestock`}, an admin
reference-data attribute). All rules below are enforced per the animal's market.

## Divergent rules (normative)

| Rule | Pet marketplace | Livestock marketplace |
|---|---|---|
| **Allowed `listing_type`** | `sale`, `adoption`, `breeding`, `stud_service`, `show` | `sale`, `breeding`, `stud_service` (no `adoption`/`show`) |
| **`quantity`** | always `1` (a pet is an individual animal) | `>= 1` (a single head or a batch/lot of the same species) |
| **Price requirement** | required for `sale`; must be NULL/0 for `adoption` | required for `sale` and `stud_service` |
| **Identity attribute emphasis** | `microchip_id` (unique), vaccinations in `health_records` | `tattoo_brand_id`/ear-tag/passport (unique), herd/livestock data in `health_records` |
| **Contact-reveal rate limit** | 10 / hour / user | 5 / hour / user (anti-bulk-scraping) |
| **Moderation checklist** | pet welfare, banned-species list, photo authenticity | livestock regulations, veterinary/sanitary attributes, batch consistency |
| **Breeding eligibility** | same predicate (see `05-matching-domain.md`) over pet species | same predicate over livestock species |
| **Geo-search** | identical mechanism (`lat/lng` + Haversine) | identical |

## Cross-split invariant
A listing **must not** mix markets: the animal's species market determines the listing's market, and the allowed
`listing_type` / `quantity` / price rules above are validated accordingly at the service layer. A pet animal can
never produce a livestock-typed listing and vice-versa (ADR-0002).

## Implementation note
- Add `species.market VARCHAR(10) CHECK (market IN ('pet','livestock'))` to reference data (seed per species).
- Validate `listing_type`, `quantity`, and price rules in the listing service keyed off the animal's market.
- The DB enums (`listing_type`) stay shared; the **allowed subset** per market is a service-layer rule from this table.

## Related
- [ADR-0002](../04-decisions/0002-hard-split-markets.md), [Pet Marketplace](03-pet-marketplace-domain.md),
  [Livestock Marketplace](04-livestock-marketplace-domain.md), [Contact Exchange](16-contact-exchange.md)
- 🌐 RU mirror: [docsRU/specs/market-differences.md](../../docsRU/specs/market-differences.md)
