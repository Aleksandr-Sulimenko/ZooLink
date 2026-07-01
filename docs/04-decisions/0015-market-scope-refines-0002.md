# ADR-0015: `market_scope` — refine the ADR-0002 hard split for species-less offerings

**Status**: Accepted
**Date**: 2026-07-01
**Ratified by owner**: 2026-07-01 (Q1 — accepted jointly with [ADR-0014](0014-offering-supertype-polymorphic-seam.md))
**Amends**: [ADR-0002](0002-hard-split-markets.md) — **clarifies and refines its scope; does NOT supersede or rewrite it.** ADR-0002 stays Accepted and authoritative for animal listings.
**Relates to**: [ADR-0014](0014-offering-supertype-polymorphic-seam.md) (accepted jointly — see Q1), [ADR-0016](0016-provider-model.md).
**Source vision**: `docsRU/01-discovery/future-features.md` §B (4th bullet).

> **WHAT** — Clarify that ADR-0002's **hard pet/livestock split applies to *animal listings*** (where the market is *derived* from the species-join). **Services, goods and consultations have no species** and therefore carry an explicit logical tag **`market_scope ∈ {pet, livestock, both}`** instead of being slotted into a derived market. Discovery MUST enforce `market_scope` so the two markets never blur — but `market_scope` is **a logical tag on the offering, not a third physical market split.**
>
> **WHY** — The Part-B audit found a hard logic collision: today *market is derived by joining to `species.market`*. Services/goods/consultations have no species → that derivation has nothing to join on, and ADR-0002 as literally written has no answer for them. A vet, a groomer, or a bag of food can legitimately serve **both** markets; forcing them into one derived market would either drop supply or fragment it. The collision blocks all Offering code (ADR-0014) until resolved.
>
> **WHY-BETTER for the whole project** — Keeps ADR-0002's validated rationale **intact** for the thing it was written about (animal listings: distinct UX, validation, moderation, regulatory paths) while giving species-less offerings a clean, *enforceable* market dimension. It avoids a costly third physical split (which would fragment cross-market supply and break the comfort BR's "one search"), and it makes market separation a **central, testable discovery invariant** rather than an emergent property of a join — strengthening, not loosening, ADR-0002. Respects ФЗ/regulatory separation (livestock B2B track stays distinguishable via `market_scope=livestock`).

## Context and Problem Statement

ADR-0002 hard-separates **pet** and **livestock**. In the implemented system this separation is realised by `species.market` (`pet|livestock`): an animal listing's market is **derived** by joining `listing → animal → species → market`. Reference dictionaries (breeds, health-certs, genetic-markers, decision-templates) likewise carry `market` and are `UNIQUE(market, code)`.

The Ecosystem Expansion adds offerings with **no animal subject** (ServiceOffering, ProductOffering, ConsultationOffering — ADR-0014). For these, the species-join that *defines* market does not exist. Two failure modes if ADR-0002 is applied naively:
- **Force a derived market** → impossible (nothing to derive from) or arbitrary (pick one) → drops the other market's demand.
- **Add a third physical market** (`services`) → fragments a vet who serves both pets and livestock into two listings, breaks one-search, and contradicts the vision's "cross-market verticals via a logical tag, not a physical third split."

The Part-B 8-criteria verdict made resolving this a **prerequisite** for any Offering code: *"logic sound IFF market-model collision resolved by ADR-B first (market derived from species-join; services/goods have no species)."*

## Decision Drivers

1. **ADR-0002's rationale is correct for animal listings** — distinct UX/validation/moderation/regulatory paths per market are real; do not weaken it.
2. **Species-less offerings need a market dimension that is assigned, not derived.**
3. **Cross-market supply must not fragment** — a both-markets provider is one offering, scoped `both`.
4. **Separation must stay enforceable** — a tag nobody checks is no separation; discovery MUST filter on it.
5. **Anti-rewrite (§5)** — `market_scope` on the offering/discovery seam is form-now (ADR-0014); retrofitting a market dimension onto offerings written without one is a rewrite.
6. **Livestock B2B is a separate track** (growth/ADR-0002) — `market_scope=livestock` keeps it isolable.

## Considered Options

### Option 1: Extend the hard split to a third physical market for services/goods
Add `services`/`goods` as peer top-level markets alongside pet and livestock.

Pros:
- Symmetric with the existing two-market model; familiar.

Cons:
- A vet/groomer/food seller serving both pet and livestock must be split into ≥2 offerings → fragmented supply, double maintenance.
- Breaks the comfort BR ("one search") — the user now picks a market *and* a vertical.
- Over-models: services aren't a *market segment*, they're a cross-cutting vertical.

### Option 2: Drop ADR-0002's hard split; unify everything under one `market_scope` tag
Replace the derived split with a single tag on every offering including animal listings.

Pros:
- Uniform model across all offering kinds.

Cons:
- Throws away ADR-0002's validated UX/validation/moderation/regulatory separation for animal listings (its strongest, well-reasoned part).
- Livestock vs pet *animal* differences are real and species-grounded — a manual tag where a reliable derivation exists invites data-entry drift.
- Large, unnecessary supersession of an Accepted decision.

### Option 3: Keep ADR-0002 derived split for animal listings; add `market_scope` tag for species-less offerings; discovery enforces it (Chosen)
Animal listings: market stays **derived** from `species.market` (ADR-0002 unchanged). Services/goods/consultations: carry an explicit `market_scope ∈ {pet, livestock, both}`. The ADR-0014 discovery read-model carries `market_scope` for **every** row (derived value for animal listings, assigned value for the rest), and discovery **filters on it**. An **amendment** to ADR-0002, not a supersession.

Pros:
- ADR-0002 stays intact and authoritative where it applies; no rewrite of a sound decision.
- Species-less offerings get an assignable, enforceable market dimension.
- `both`-scope keeps cross-market providers as one offering — supply not fragmented.
- Separation becomes a **single central discovery invariant** (testable) rather than an emergent join property.

Cons:
- Two mechanisms coexist (derived for animals, assigned for the rest) — must be documented so nobody "derives" a service's market or "tags" an animal's.
- An assigned tag can be mis-set → needs validation (and, for regulated categories, ties to provider verification — ADR-0016).

## Decision

Adopt **Option 3**. Normative rules:

1. **ADR-0002 is unchanged for animal listings.** Their market is **derived** from `species.market`; the hard split (UX, validation, moderation queues, search facets, regulatory paths) stands exactly as ADR-0002 specifies.
2. **Species-less offerings carry `market_scope ∈ {pet, livestock, both}`** as an explicit logical tag on the offering aggregate and on the ADR-0014 discovery read-model. `market_scope` is **not** a third physical market and **not** stored on `species`.
3. **Discovery MUST enforce `market_scope`.** Every find-nearby / search query filters by the requested market context; a `pet` context returns `pet` and `both` offerings, a `livestock` context returns `livestock` and `both`, never the opposite-exclusive set. This is a single, testable invariant in the discovery layer.
4. **The discovery read-model normalises both mechanisms into one `market_scope` column** — derived value for `ANIMAL_LISTING` rows, assigned value for the rest — so discovery filters uniformly without caring how the value was produced.
5. **`market_scope=both` is the cross-market case** — one offering, surfaced in both market contexts; never duplicated per market.
6. **Regulated cross-market offerings** (e.g. a livestock vet) keep `market_scope` consistent with their verification (ADR-0016) — a provider not verified for a regulated market cannot publish a regulated offering scoped to it (legal: intermediary immunity).
7. **No animal listing ever carries `market_scope`; no service/good/consultation ever derives market from species.** The two mechanisms do not cross.

## Consequences

### Positive
- The Part-B market-collision blocker is resolved; Offering code (ADR-0014) is unblocked.
- ADR-0002 keeps its full force for animal listings — no regression, no rewrite.
- Market separation becomes an explicit, enforced discovery invariant (better than an emergent join).
- Cross-market providers are first-class (`both`) — supply preserved, comfort BR honoured.

### Negative
- Two market-assignment mechanisms coexist; doc/spec must make the boundary unmistakable.
- Assigned `market_scope` needs validation and (for regulated categories) verification coupling.

### Neutral
- MVP unaffected: only animal listings exist; `market_scope` lives dormant on the seam (ADR-0014) until a species-less subtype is built.
- Reference dictionaries keep `UNIQUE(market, code)` — unchanged.

## Implementation Notes (when a species-less subtype is built — not now)
- `market_scope` column on the offering side + on the ADR-0014 discovery read-model (backend; form-now per ADR-0014).
- alpha-analyst encodes the discovery `market_scope` filter as a normative rule + Gherkin negatives (pet context must never return livestock-exclusive, and vice-versa).
- Validation rule: `market_scope` required on every species-less offering; `both` allowed; cross-checked against ADR-0016 verification for regulated categories.

## Related Decisions
- **ADR-0002** — hard split (this ADR amends its *scope*, leaves its decision intact).
- **ADR-0014** — Offering seam (carries & enforces `market_scope`).
- **ADR-0016** — provider model (verification gates regulated `market_scope`).

## References
- `docsRU/01-discovery/future-features.md` §B 4th bullet.
- `database_schema.sql` — `species.market`, `UNIQUE(market, code)` dictionaries.
- `AUDIT_2026-06-30.md` Part B (8-criteria: market collision = ADR-B prerequisite).
