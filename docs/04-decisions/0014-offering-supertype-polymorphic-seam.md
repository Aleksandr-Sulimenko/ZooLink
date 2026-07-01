# ADR-0014: Offering supertype — polymorphic discovery + moderation seam (anti-god-table)

**Status**: Accepted
**Date**: 2026-07-01
**Ratified by owner**: 2026-07-01 (Q1 — accepted jointly with [ADR-0015](0015-market-scope-refines-0002.md))
**Relates to**: [ADR-0015](0015-market-scope-refines-0002.md) (accepted jointly — see Q1), [ADR-0002](0002-hard-split-markets.md), [ADR-0004](0004-animal-as-aggregate.md), [ADR-0018](0018-cross-aggregate-access-rule.md) (prerequisite), [ADR-0006](0006-ai-agents-operate-platform.md)/[ADR-0011](0011-agent-principal-actor-model.md) (actor snapshot on polymorphic moderation), [ADR-0016](0016-provider-model.md).
**Source vision**: `docsRU/01-discovery/future-features.md` §B (Ecosystem Expansion). MVP-entry only via a formal Change Request.

> **WHAT** — Introduce a *logical* **Offering** supertype, identified by a polymorphic reference `(offering_type, offering_id)`, that the cross-cutting **discovery / moderation / favorites / saved-search** capabilities consume **once, polymorphically**, for every kind of offering. Concrete subtype aggregates — `AnimalListing` (exists today as `listings`), `ServiceOffering`, `ProductOffering`, `ConsultationOffering` — are each materialised **only when their side is built**. No god-table, no EAV.
>
> **WHY** — The owner's apex comfort BR ("everything a pet needs, nearby, for its whole life, in one search / one profile / one messenger") requires that *find-nearby*, *moderation*, *favorites* and *saved-search* span animals **and** services **and** goods **and** consultations. Re-implementing those four cross-cutting capabilities per new offering type would (a) drift four ways, (b) break the single "find nearby" promise, (c) blow up cost-of-change. The polymorphic seam is the **structural carrier** of that BR.
>
> **WHY-BETTER for the whole project** — Lays the cheap-now / expensive-to-retrofit seam (the Part-B audit found it *declared but absent* — backend + architect + frontend + janitor converged) without pulling any Phase-2 behaviour into MVP. It honours ADR-0002 (market separation is *enforced* by the seam via `market_scope`, ADR-0015), ADR-0004 (Animal stays its own aggregate; the seam references it, never absorbs it), ADR-0006/0011 (polymorphic moderation rows still carry the actor snapshot), ФЗ-152 (object-level authz + 404-no-leak are mandatory on every new subtype), and the modular-monolith decision (ADR-0009 — the seam is an in-process read-model + reference, not a new service).

## Context and Problem Statement

Today the system has exactly one user-facing aggregate that can be discovered and moderated: the **animal `listing`** (ADR-0004). The Ecosystem Expansion vision adds three more *kinds* of thing a user discovers and (some of which) get moderated:

- **ServiceOffering** — a provider with no animal-subject and no sale lifecycle (grooming, walking, vet, boarding, training). Explicitly **not** another `listing_type` (the vision is emphatic on this — a service has no animal and no SOLD terminal).
- **ProductOffering** — a seller of (non-Rx) goods; consumables drive re-order / subscription.
- **ConsultationOffering** — a subtype of service whose provider may be `principal_type=AGENT` (ADR-0006).

Each of these must be **findable nearby**, **favoritable**, **saved-search-able**, and (where it carries trust/safety risk) **moderated** — exactly the capabilities that exist today, hard-wired to the single `listings` table. The Part-B audit recorded a hard structural blocker: *"polymorphic seam cannot sit on the current listing↔animal coupling; form-now seams declared but absent from schema/contracts."*

We must decide **how the cross-cutting capabilities reference an arbitrary offering** without (a) collapsing four bounded contexts into one table, (b) creating an EAV attribute-bag, or (c) re-implementing discovery/moderation/favorites N times.

## Decision Drivers

1. **Apex comfort BR** — one search / one profile across all offering kinds (highest weight).
2. **Anti-god-table / anti-EAV** — per-subtype invariants and per-context ubiquitous language must survive; a single wide nullable table or a key-value bag destroys both (DDD).
3. **Cost-of-change / anti-rewrite (§5)** — the *reference shape* in cross-cutting tables is irreversible-if-deferred (favorites/saved-search rows written against a non-polymorphic FK can't be retrofitted truthfully); the *subtype tables* are cheap to add later.
4. **ADR-0002 market separation must be enforced, not blurred** (see ADR-0015 `market_scope`).
5. **ADR-0004 aggregate integrity** — the seam references the Animal aggregate; it must not re-absorb it, and (per ADR-0018) must not sit on direct cross-table reads.
6. **Object-level authz + 404-no-leak on every subtype** — IDOR is the codebase's #1 recurring risk; the seam must not become an enumeration oracle.
7. **Agent-as-principal** — moderation of any offering still snapshots the acting principal (ADR-0011).
8. **Modular monolith (ADR-0009)** — no new service; the seam is an in-process reference + denormalised read-model.

## Considered Options

### Option 1: Single polymorphic `offerings` god-table (all types in one table, type-specific nullable columns / JSONB attribute-bag)
One `offerings` row per thing, with `type` plus a wide set of nullable columns (or a JSONB `attributes`) covering animal/service/product/consultation fields.

Pros:
- Trivial single-table discovery query; one FK target for favorites/saved-search/moderation.
- No polymorphic-reference bookkeeping.

Cons:
- **EAV / god-table anti-pattern.** Per-subtype invariants (e.g. "intact animal for breeding", "service has opening-hours", "product has stock") become un-checkable at the DB layer; validation degenerates to app-side conditionals — the exact failure ADR-0002 rejected for the unified-marketplace option.
- Collapses four bounded contexts into one table → ubiquitous language and moderation focus blur; ADR-0002 separation undermined.
- Wide-sparse table: poor index density, every consumer reads columns it doesn't need.
- Schema churn on every new offering kind touches the shared hot table.

### Option 2: Per-subtype aggregate tables + a thin polymorphic discovery/moderation *seam* (Chosen)
Each offering kind is its **own** aggregate table with its **own** invariants (`listings` exists; `service_offerings`, `product_offerings`, `consultation_offerings` added only when built). The cross-cutting capabilities reference an offering by a **polymorphic key `(offering_type, offering_id)`** carried in:
- `favorites` and `saved_searches` (replace/extend today's listing-only reference),
- the **moderation queue / decision** rows (polymorphic subject + ADR-0011 actor snapshot),
- a **denormalised discovery read-model** (a projection table fed by each subtype's outbox events) carrying the fields find-nearby actually needs: `offering_type`, `offering_id`, `market_scope` (ADR-0015), `geo_anchor`, `title`, `price`/`monetization_type`, `status`, `provider_ref` (ADR-0016), `updated_at`.

Referential integrity across the polymorphic key is **not** a DB FK (Postgres can't FK a polymorphic column); it is enforced (a) in-app at write, and (b) by the read-model being event-sourced from each subtype (a deleted/soft-deleted subtype emits a tombstone that prunes the projection). Object-level authz + 404-no-leak are re-asserted on **each** subtype endpoint.

Pros:
- Each bounded context keeps its own table, invariants, and ubiquitous language (DDD; reinforces ADR-0002).
- Discovery / moderation / favorites / saved-search are built **once**, polymorphically — the comfort BR's carrier.
- New offering kind = add one subtype table + one projector; the shared seam is untouched.
- Read-model is purpose-built and index-dense for find-nearby; write-side stays normalised.
- `market_scope` is a first-class column on the read-model → discovery can **enforce** separation in one place (ADR-0015).

Cons:
- Polymorphic reference has no DB FK → integrity is an app + event-sourcing responsibility (mitigated: outbox already exists; tombstone-on-delete is a defined invariant).
- A read-model is eventual-consistency by nature (mitigated: acceptable for discovery; authoritative reads still hit the subtype).
- More moving parts than a single table (the deliberate cost of not collapsing contexts).

### Option 3: No supertype — each new offering kind re-implements discovery/moderation/favorites independently
Ship ServiceOffering with its own find-nearby, its own favorites, its own moderation, etc.

Pros:
- Each vertical fully autonomous; no shared abstraction to design up-front.

Cons:
- Re-implements the apex BR's carrier **4×** → guaranteed drift, 4× maintenance, no unified "find nearby / one search".
- Favorites/saved-search fragment per type → user can't have one saved search spanning "groomer + food near me".
- Directly contradicts the vision's §B "build search and moderation **once**, polymorphically".

## Decision

Adopt **Option 2**. ZooLink models a **logical Offering supertype** realised as a **polymorphic reference `(offering_type, offering_id)`** consumed by the four cross-cutting capabilities, over **per-subtype aggregate tables**. Normative rules:

1. **No god-table, no EAV.** There is no physical `offerings` table holding cross-type attributes. Each subtype (`listings` today; `service_offerings`, `product_offerings`, `consultation_offerings` later) is its own normalised aggregate with its own invariants. Subtype tables are created **only when that side is implemented** (form-now applies to the *seam*, not to unbuilt subtypes).
2. **Polymorphic reference shape ships now (form-now seam).** `favorites` and `saved_searches` carry `(offering_type, offering_id)` rather than a listing-only FK; the moderation subject becomes polymorphic; a discovery **read-model** table is defined carrying `offering_type, offering_id, market_scope, geo_anchor, monetization_type, status` + display fields. *(Backend owns the concrete migration; this ADR fixes the shape. Until subtypes exist, `offering_type` is constrained to `ANIMAL_LISTING`.)*
3. **`offering_type` is a closed, additive enum.** `ANIMAL_LISTING` (now) → `SERVICE_OFFERING`, `PRODUCT_OFFERING`, `CONSULTATION_OFFERING` (each added with its side). Additive only — never repurposed.
4. **`market_scope` is enforced by discovery** (ADR-0015) — the read-model carries it; the discovery query MUST filter by it; markets never blur.
5. **`geo_anchor` is first-class** — a point now, with room reserved for a service-area later. Find-nearby keys on it. (PostGIS is a later DB-image swap, gated.)
6. **Object-level authorization + 404-no-leak on every subtype** — non-negotiable (security; IDOR #1 risk). The read-model never exposes a row whose subtype the actor may not see.
7. **Polymorphic moderation carries the ADR-0011 actor snapshot** — a moderation decision on any offering records `actor_principal_type` / override form exactly as today.
8. **The seam must NOT sit on the current listing↔animal direct-read coupling.** ADR-0018 (route cross-aggregate reads through the owning service) is a **prerequisite** — the polymorphic seam is built on clean aggregate boundaries, not on the Part-A coupling debt.
9. **`monetization_type`** (`lead-gen | subscription | take-rate | none`) is a form-now field on the offering side so the business model can flip without a refactor (finance vision §monetization).
10. **Read-model is a projection, never the system of record.** Authoritative reads/writes hit the subtype aggregate; the read-model is rebuildable from subtype state + outbox.

## Consequences

### Positive
- Discovery, moderation, favorites, saved-search are designed once and serve every present and future offering kind — the comfort BR has a real structural home.
- Bounded contexts and ADR-0002 separation are preserved (each subtype is its own table; `market_scope` enforced centrally).
- Adding a vertical is "one subtype table + one projector," not a re-platforming.
- Cheap-now seam closes the Part-B blocker without pulling Phase-2 behaviour into MVP.

### Negative
- Polymorphic reference forfeits a DB-level FK → integrity is an app + event-sourcing duty (tombstone invariant + outbox already present).
- A discovery read-model adds eventual consistency and a projector to operate (devops/observability).

### Neutral
- MVP behaviour unchanged: only `ANIMAL_LISTING` exists; the seam is dormant until a subtype is built.
- PostGIS remains a later, gated DB-image swap; `geo_anchor` is a plain point until then.

## Implementation Notes (for backend / alpha-analyst when the side is built — not now)
- Form-now migration (separate task, backend): polymorphic `(offering_type, offering_id)` on `favorites` + `saved_searches`; polymorphic moderation subject; discovery read-model table + `offering_type` enum (`ANIMAL_LISTING` only); `monetization_type` + `geo_anchor` columns on the offering side. Each behind the rule "form now, behaviour gated."
- alpha-analyst writes the polymorphic discovery + moderation **contract** (object-level authz, 404-no-leak, `market_scope` filter, read-model envelope) before any subtype code.
- Per-subtype invariants live in the subtype spec, never in the seam.

## Related Decisions
- **ADR-0015** — `market_scope` refines ADR-0002 (ratify jointly; the seam enforces it).
- **ADR-0018** — cross-aggregate access rule (prerequisite: clean boundaries before the seam).
- **ADR-0004** — Animal aggregate (referenced, not absorbed, by the seam).
- **ADR-0006 / ADR-0011** — agent-as-principal & actor snapshot on polymorphic moderation.
- **ADR-0016** — provider model (the read-model's `provider_ref`).
- **ADR-D (later)** — Booking/Scheduling; **ADR-E (later)** — Reviews/Reputation over provider+offering.

## References
- `docsRU/01-discovery/future-features.md` §B "Архитектурный хребет"; §F "Формой сейчас".
- `docs/specs/07-geo-search-service.md` (find-nearby foundation).
- `docs/specs/12-moderation-domain.md` (moderation queue → polymorphic subject).
- `AUDIT_2026-06-30.md` Part B (8-criteria verdict; form-now seams declared-but-absent).
- Evans, *Domain-Driven Design* — aggregates & transactional boundaries.
