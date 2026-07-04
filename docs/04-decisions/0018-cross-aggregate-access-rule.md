# ADR-0018: Cross-aggregate access rule — route animal reads through AnimalService (reaffirm ADR-0004)

**Status**: Accepted — 2026-07-04 (form resolved: the breach is 3 sites, not 1, and is fixed in **two ordered parts** — see §Decision / §Implementation Notes; low-risk, reaffirms ADR-0004). Owner-nod folded into the Wave-D kickoff (surfaced as a confirm item, not silently assumed). Supersedes its earlier "Proposed — awaiting owner nod (2026-07-01)".
**Date**: 2026-07-01 (accepted 2026-07-04)
**Amends**: [ADR-0004](0004-animal-as-aggregate.md) — **reaffirms and operationalises its aggregate boundary; does NOT supersede it.** ADR-0004's decision stands; this ADR fixes the code that drifted from it and makes the boundary an enforceable, reviewable rule.
**Relates to**: [ADR-0014](0014-offering-supertype-polymorphic-seam.md) (this is a **prerequisite** — the polymorphic seam must sit on clean aggregate boundaries), [ADR-0009](0009-mvp-vs-target-architecture.md).

> **WHAT** — Make it a **normative architectural rule** that a module MUST NOT read or write another aggregate's tables directly; it accesses them only through that aggregate's owning service. Concretely: `ListingService` (and `ModerationService`) MUST obtain animal data and ownership checks via a **public `AnimalService` method**, not by `prisma.animals.findUnique(...)` + a duplicated ownership check.
>
> **WHY** — The audit found `listing.service.ts` reads the `animals` table directly (`loadAnimal`) and re-implements the ownership check (`assertOwnsAnimal`), bypassing `AnimalService` — a direct breach of ADR-0004's own Implementation Note #2 ("ListingService validates animal ownership **via** AnimalService"). This is bidirectional cross-aggregate coupling (listing ↔ moderation ↔ animal via raw table reads) and was named "central structural debt." The conflict-of-opinion adjudication recorded both views as true: backend ("form not there yet") and architect ("ADR-0004 breach") — the resolution is architect's call.
>
> **WHY-BETTER for the whole project** — ADR-0004 is *correct*; the code drifted. Per the doc↔code protocol, a code↔contract conflict is fixed **toward the contract**, not by rewriting a sound decision to match drifted code. Routing through `AnimalService` (a) restores the single ownership-check implementation (the audit also found `isOrgAdmin` duplicated across 4 services — same class of debt), (b) keeps animal authz logic in one place where ADR-0006/0011 agent-as-principal and future invariants apply uniformly, and (c) is a **hard prerequisite for ADR-0014**: the polymorphic Offering seam cannot be built on top of direct cross-table reads, or every new offering type inherits the coupling. This unblocks Part B while paying down Part A debt.

## Context and Problem Statement

ADR-0004 made **Animal the aggregate root**; Listing references it and "validates animal ownership **via** AnimalService" (ADR-0004 Implementation Note #2). The implementation diverged:
- `backend/src/modules/listing/listing.service.ts` has a private `loadAnimal(animalId)` doing `prisma.animals.findUnique(...)` directly, and a private `assertOwnsAnimal(actor, animal)` re-implementing the owner/org-admin check.
- `AnimalService` owns the authoritative ownership logic (CASL-keyed on `owner_id`, org-admin via `isOrgAdmin`) but does **not** expose a clean cross-module "load animal summary + assert ownership" method for `ListingService`/`ModerationService` to call.

Result: ownership logic is duplicated, the aggregate boundary is porous, and the listing↔moderation↔animal triangle reads each other's tables directly. The audit ranked this MAJOR structural debt and a **prerequisite for the ADR-0014 polymorphic seam** (Part B verdict: "polymorphic seam cannot sit on the current listing↔animal coupling").

Two ways to resolve (the audit conflict #2 left the choice to architect):
- **(a)** Supersede ADR-0004 and *bless* direct cross-table reads as a conscious deviation.
- **(b)** Reaffirm ADR-0004 and *route* all animal access through `AnimalService`.

## Decision Drivers

1. **ADR-0004 is sound** — Animal-as-aggregate matches domain reality and is not in question; only the code drifted.
2. **Doc↔code protocol** — fix the code toward the contract, don't rewrite the contract to match drift.
3. **Single source of ownership truth** — duplicated authz (here, and `isOrgAdmin` ×4) is a defect class, not a pattern to bless.
4. **ADR-0014 prerequisite** — the polymorphic seam needs clean aggregate boundaries; coupling would propagate to every offering type.
5. **Agent-as-principal uniformity** (ADR-0006/0011) — animal authz must apply agent/human rules in one place.
6. **Modular monolith (ADR-0009)** — in-process service calls are cheap; there is no performance reason to bypass the service.

## Considered Options

### Option (a): Supersede ADR-0004 — bless direct cross-table reads as a conscious deviation
Replace ADR-0004 with a decision that permits modules to read sibling aggregates' tables directly for read-mostly paths.

Pros:
- Matches the code as-written today (no refactor).
- Marginally fewer service hops on the hot read path.

Cons:
- Rewrites a **correct** decision to match drifted code — inverts the doc↔code protocol.
- Blesses duplicated ownership logic → authz drift risk (the exact `isOrgAdmin`-×4 / `assertOwnsAnimal` duplication the audit flagged); a future invariant change must be made in N places.
- Propagates coupling into ADR-0014: every offering type would read animal/provider tables directly → the polymorphic seam inherits the debt.
- Erodes the aggregate boundary that ADR-0006/0011 agent-authz relies on being centralised.

### Option (b): Reaffirm ADR-0004 — route animal access through a public AnimalService method (Chosen)
Keep ADR-0004. Add a public `AnimalService` method (e.g. `getOwnedAnimalForActor(actor, animalId)` returning the minimal summary + performing the owner/org-admin/agent check, with 404-no-leak) that `ListingService` and `ModerationService` call instead of reading `animals` directly. Remove `listing.service.ts`'s private `loadAnimal`/`assertOwnsAnimal`. Consolidate the duplicated `isOrgAdmin` into the shared org-membership service.

Pros:
- Restores ADR-0004's intended boundary; one ownership-check implementation.
- Agent/human authz, 404-no-leak, and future animal invariants apply uniformly in one place.
- Satisfies the ADR-0014 prerequisite — the seam sits on clean boundaries.
- Pays down the duplicated-authz debt class.

Cons:
- A bounded refactor now (backend) — extract the method, repoint call sites, keep tests green.
- One extra in-process service hop on the listing-create/ownership path (negligible in a monolith).

## Decision

Adopt **Option (b)**. ADR-0004 stands. Normative rules:

1. **No module reads or writes another aggregate's tables directly.** Cross-aggregate access goes through the owning aggregate's **public service method**.
2. **`AnimalService` exposes a public ownership-aware accessor** — returns the minimal animal summary required by the caller AND performs the owner / org-admin / agent-principal check with **404-no-leak** (no existence oracle). `ListingService` and `ModerationService` use it; their private `loadAnimal` / `assertOwnsAnimal` are removed.
3. **Ownership/authz logic is not duplicated.** `isOrgAdmin` (currently duplicated across ~4 services) is consolidated into the shared org-membership service; animal-ownership lives only in `AnimalService`.
4. **This is a prerequisite for ADR-0014.** The polymorphic Offering seam MUST be built on these clean boundaries; reviewer-qa enforces "no cross-aggregate raw table reads" as a review gate.
5. **MVP behaviour is unchanged** — same checks, same results; only the *location* of the logic changes. No contract/schema change on the single-row path.

### Amendment 2026-07-04 — the breach is 3 sites, and the fix is two ordered parts (resolves the AUDIT3 circularity)

**WHAT** — AUDIT3 verified the raw `animals ⋈ species` cross-aggregate join lives in **three** sites, not one: `listing.service.ts:627-628` (`marketOf`), `moderation.service.ts:577-578` (`marketOf`, **verbatim duplicate**), and the moderation-**queue base CTE** `moderation.service.ts:189-191` (`FROM listings l JOIN animals a JOIN species s`). The queue CTE is a **paginated list query** and does **not** decompose into per-row `AnimalService` calls without an N+1. So this ADR is fixed in **two ordered parts**:

- **Part 1 — single-row (the true ADR-0014 prerequisite).** The two `marketOf` copies and every single-row ownership read route through a public `AnimalService` accessor (rule 2). Pure code refactor, **no schema change**, **no dependency on ADR-0014**. This is the part that genuinely *precedes* 0014 (clean boundaries before the seam).
- **Part 2 — list-path (fixed via a data seam, NOT per-row calls).** The queue/discovery **list joins** are removed by reading a **denormalised derived-`market` cache column on `listings`** (a cache of `species.market`, computed in-tx at listing write, backfilled once, recomputed on the rare admin species-correction). The queue CTE and both `marketOf` copies then read `listings.market` with **zero** cross-aggregate joins.

**WHY-BETTER / circularity resolved** — AUDIT3 noted "0018 is a prerequisite for 0014" is *partly circular*, because the clean fix for the list joins is 0014's discovery read-model. It is **not** circular once split: Part 1 needs nothing from 0014; Part 2 needs only a **minimal derived-`market` cache column**, which is a cheap standalone slice of — and forward-compatible with — 0014's eventual read-model. We do **not** build the full materialised discovery projection now (that is Phase-2-heavy: a projector, eventual consistency, ops burden); the cache column subsumes into the read-model later. The cache carries the **derived** `market` (`pet|livestock`), **not** the assigned `market_scope` tag — so ADR-0015 rule 7 ("no animal listing carries `market_scope`") is honoured: this is a derivation *cache*, not the assigned dimension.

6. **A denormalised derived-`market` cache column on `listings` is the sanctioned form** for removing the list-path joins. It is still "derived from species" per ADR-0004/0015 — merely cached, kept consistent in-tx. It is NOT the assigned `market_scope` tag (which lives only on species-less offerings, ADR-0015).
7. **Ordering is normative:** Part 1 (AnimalService accessor) and the `market` cache column both land **before** the `marketOf`/queue refactor; the refactor is GREEN only when a `grep -rnE "FROM +animals|JOIN +species|JOIN +animals"` over `listing` **and** `moderation` modules returns zero hits outside `AnimalService`.

## Consequences

### Positive
- ADR-0004's aggregate boundary is real and enforced, not aspirational.
- Single ownership-check implementation → agent/human authz and future invariants change in one place.
- ADR-0014 unblocked on clean boundaries; coupling not propagated to new offering types.
- A defect class (duplicated authz) is paid down.

### Negative
- A bounded backend refactor (extract + repoint + keep ~600 tests green); reviewer-qa verifies behaviour parity.
- One extra in-process hop (negligible in the monolith).

### Neutral
- No API/schema change; purely internal structure + a review gate.
- ADR-0004 text unchanged; this ADR operationalises its Implementation Note #2.

## Implementation Notes (backend — Wave D, sequenced)
**Part 1 — single-row (Wave-D slice D4, CODE-ONLY, no migration):**
- Add `AnimalService.getOwnedAnimalForActor(actor, animalId)` (or equivalent) — minimal summary + owner/org-admin/agent check + 404-no-leak.
- Remove `listing.service.ts` `loadAnimal` / `assertOwnsAnimal`; repoint the single-row `marketOf` in **both** `listing.service.ts:627` **and** `moderation.service.ts:577` (the verbatim duplicate).
- Consolidate `isOrgAdmin`/`orgAdminIds` into the shared org-membership service (single definition).

**Part 2 — list-path (needs the `market` cache column first, Wave-D slice D3 migration, then D8 CODE-ONLY):**
- Migration (D3): `listings.market VARCHAR(9) CHECK (market IN ('pet','livestock'))`, computed in-tx from the animal's `species.market` at listing create/update, idempotent backfill from the existing join, recompute hook on the admin species-correction path.
- Refactor (D8): the moderation-queue base CTE (`moderation.service.ts:189-191`) and both `marketOf` copies read `listings.market` — **drop** the `animals ⋈ species` joins.
- **Do NOT** route the list-query join through per-row `AnimalService` calls (N+1). The list path is fixed by the data seam, the single-row path by the service accessor.

**Both parts:** keep existing behaviour identical (parity tests); reviewer-qa adds the "no cross-aggregate raw table read" grep gate over `listing` **and** `moderation` modules (all 3 sites). The full ADR-0014 materialised discovery read-model is **not** built here; the `market` cache column subsumes into it when the first species-less subtype ships.

## Related Decisions
- **ADR-0004** — Animal as aggregate (reaffirmed & operationalised).
- **ADR-0014** — Offering seam (this ADR is its prerequisite).
- **ADR-0006 / ADR-0011** — agent-as-principal (centralised animal authz applies them uniformly).

## References
- ADR-0004 Implementation Note #2 ("ListingService validates animal ownership via AnimalService").
- `backend/src/modules/listing/listing.service.ts` `loadAnimal`/`assertOwnsAnimal` (current breach).
- `AUDIT_2026-06-30.md` Part A MAJOR (ADR-0004 breach) + Conflicts #2.
- `agent-os/instructions/doc-code-protocol.md` (fix toward the contract).
