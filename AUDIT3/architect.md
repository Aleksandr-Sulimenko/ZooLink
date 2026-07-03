# ZooLink HYPER² Audit — Round 3 · architect (forward-compat / anti-rewrite lens)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) ·
**Method:** independent fresh-eyes pass first (did **not** re-read round-1/AUDIT2 until my own findings
were fixed), verifying every claimed form-now seam against live schema + migrations + code
(`grep`/`sed` on `database_schema.sql`, `migrations/`, `backend/src`), then diffed against
`AUDIT2/architect.md`. I modified no product code or doc; this file is my sole output.

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ forward-compat · consistency · SPOF · coverage.

> **Verified reality baseline (inspected 2026-07-02, HEAD 4533e78):**
> - **The raw `animals ⋈ species` cross-aggregate join exists in THREE sites, not one:**
>   `listing.service.ts:627-628` (`marketOf`), `moderation.service.ts:577-578` (`marketOf`, **verbatim duplicate**),
>   and `moderation.service.ts:189-191` (queue base CTE `FROM listings l JOIN animals a JOIN species s`).
>   AUDIT2 named only the first.
> - `favorites` = `listing_id UUID NOT NULL REFERENCES listings(id)`, `UNIQUE(user_id,listing_id)`
>   (`database_schema.sql:349-355`) — listing-only FK; **still dormant** (`find backend/src -iname '*favorite*'` = empty).
> - BUT `favorites-api.yaml:58` already commits the public contract field `listingId` — the contract is *not* dormant.
> - `saved_searches` (`:360-373`) — LIVE (controller exists), `filters JSONB`+lat/lng, no `offering_type`.
> - `moderation_decisions.entity_type CHECK IN ('LISTING','ANIMAL')` + `entity_id` (`:390-391`) — already (type,id)-shaped,
>   but the enum vocabulary (`LISTING`) diverges from ADR-0014's `offering_type` vocabulary (`ANIMAL_LISTING`).
> - `users.role` single `VARCHAR CHECK IN (…7…)` (`:115`) — single-valued; no `roles[]`/`user_roles`.
> - `role_in_org` now **consistent 4-canon** at every site (`:84, :98, :789, :1053`) — the round-1 duplication is gone.
> - **grep = 0** across schema+migrations+backend for: `offering_type`, `offering_id`, `market_scope`,
>   `monetization_type`, `geo_anchor`, `provider_kind`, `provider_ref`. Only in ADR prose.
> - Value-events **built** (`Listing.Sold`, `ContactReveal.Created` emitted in-tx, `listing.service.ts:480,577`);
>   `views` still has no capture source (`listing.service.ts:596`, GAP-TRACE-006).
> - ADR-0019 PII crypto seam **built** (migration 0028: `email_bidx` + AES on `email`/`contact_phone`).

---

## 🔶 FORWARD-COMPAT VERDICT — changes from round-2 only

Round-2 verdicts stand for ADR-0014 (RESERVE-NOW), ADR-0015 (RESERVE-NOW), ADR-0016 (RESERVE-NOW),
ADR-0019 (SAFE), multi-role (RESERVE-NOW). **Changed / deepened this round:**

| Seam / ADR | R2 verdict | R3 verdict | What changed |
|---|---|---|---|
| **ADR-0018 cross-aggregate rule** | REWRITE-RISK (1 site, "bounded refactor") | **REWRITE-RISK — scope 3× + partly circular** | The breach is in **3 sites**, one of which is a **list-query CTE** (`moderation.service.ts:189-191`) that **cannot decompose into per-row `AnimalService` calls** without N+1. The clean fix for the queue/discovery *list* paths **is ADR-0014's `market_scope` read-model** — so "0018 is a prerequisite for 0014" is **partly circular**: the single-row ownership part of 0018 gates 0014, but the list-join part of 0018 is only cleanly fixable *via* 0014's read-model. The ADRs do not acknowledge this. |
| **ADR-0014 polymorphic Offering** | RESERVE-NOW | **RESERVE-NOW — but the ADR is self-contradictory on timing** | New: ADR-0014 **Decision rule 2** says the seam "ships **now** (form-now seam)"; its **Implementation Notes** header says the migration is "for backend/alpha-analyst **when the side is built — not now**." grep=0 is therefore *ambiguous by the ADR's own text* — cannot tell if the absent seam is a violation or as-designed. Contract layer (`favorites-api.yaml:58 listingId`) makes the retrofit a **breaking API change**, not merely a DB migration — strengthening "reserve before favorites ships." |

**Net:** ADR *reasoning* still sound, amend-chain still clean. The two sharpened risks are (1) ADR-0018's
refactor is **understated and entangled with 0014**, and (2) ADR-0014 **contradicts itself on when the
form-now seam lands**, leaving the grep=0 gap un-adjudicated.

---

## 🔴 Structural / chain-integrity

- `[CRITICAL][forward-compat][NEW] backend/src/modules/moderation/moderation.service.ts:189-191 → the moderation QUEUE base CTE raw-joins `FROM listings l JOIN animals a JOIN species s` — a THIRD ADR-0018 breach on the work-list path, and the one that does NOT decompose into per-row AnimalService calls (it is a paginated list query). ADR-0018's Implementation Notes ("extract the method, one extra in-process hop") understate this: routing a list-query join through the service = N+1 or nothing. The only clean fix is ADR-0014's discovery read-model carrying market_scope → 0018-as-prerequisite-for-0014 is partly circular for list paths. → Sequence explicitly: the read-model (0014 rule 2) is what removes the queue/discovery joins; single-row ownership (already done) is the part of 0018 that truly precedes 0014. State this ordering in ADR-0018 §Implementation Notes and ADR-0014 rule 8.`
- `[MAJOR][forward-compat][NEW] backend/src/modules/moderation/moderation.service.ts:577-578 → `marketOf` is a verbatim duplicate of `listing.service.ts:627-628` (same raw `animals JOIN species`). This is exactly the duplicated-authz/derivation defect class ADR-0018 rule 3 targets ("logic is not duplicated"). AUDIT2 flagged only the listing copy. → When routing market via AnimalService (`getMarket(animalId)` / include `market` in the summary), repoint BOTH copies; add the reviewer-qa/CI grep gate over `listing` AND `moderation` modules (AUDIT2 P1 already greps both — the finding text just missed the 2nd hit).`
- `[MAJOR][forward-compat][CONFIRMED] backend/src/modules/listing/listing.service.ts:627-628 → `marketOf` raw cross-aggregate read violates ADR-0018 rule 1 on the market-derivation path (ownership path correctly routed). Confirms AUDIT2. → route via AnimalService before the discovery projector is written.`
- `[MAJOR][consistency][CONFIRMED] docs/04-decisions/0014-…:3 (Accepted) names ADR-0018 a "prerequisite" (rule 8) while docs/04-decisions/0018-…:3 is still "Proposed — awaiting owner nod" → a dependent decision accepted before its declared hard prerequisite (chain inversion). Confirms AUDIT2. → flip 0018 to Accepted (owner nod; it is low-risk, reaffirms 0004) OR mark 0014 "Accepted-pending-0018"; keep status monotonic.`
- `[MAJOR][consistency][CONFIRMED] docs/04-decisions/ECOSYSTEM_ADR_PLAN.md:12,15 list 0016 & 0019 as "Proposed"; the ADR files (0016:3, 0019:3) are "Accepted". The memo header even claims "doc-keeper recorded the statuses" — so the memo is self-refuting. Confirms AUDIT2. → reconcile the plan table to the files (0016/0019 Accepted; 0017/0018 Proposed), or stamp the table "snapshot dated 2026-07-01; ADR files authoritative."`
- `[MINOR][consistency][NEW] docs/04-decisions/0014-…:89 (rule 2 "ships now") vs :116 (Implementation Notes "when the side is built — not now") → ADR-0014 contradicts itself on WHEN the form-now seam migration lands. This is why grep=0 is un-adjudicable (bug vs as-designed). → add one normative line: "the favorites/saved_searches/moderation/read-model reservation migration lands in the slice that first ships favorites or the discovery read-model, whichever is first; subtype tables come later." Resolves the ambiguity without pulling Phase-2 behaviour in.`

## 🟠 Coupling / SPOF

- `[MAJOR][SPOF][CONFIRMED] database_schema.sql:349-357 + favorites-api.yaml:58 → favorites is still dormant in code (reservation window OPEN) BUT the API contract already commits `listingId`. So the retrofit cost is now two-layered: a cheap DB migration AND a breaking contract change once a favorites controller ships against `listingId`. → land `(offering_type,offering_id)` in the SAME slice that first builds the favorites controller; shape the contract as `offeringType`/`offeringId` from day one (default ANIMAL_LISTING) so no v1 break is needed later.`
- `[MAJOR][forward-compat][CONFIRMED] database_schema.sql:115 → `users.role` single-valued; no `roles[]`/`user_roles`. Multi-role is implied by the ecosystem comfort BR (one user = owner + groomer + seller) and ADR-0016. Retrofit = add a `user_roles(user_id,role)` junction (keep `role` as primary) — cheap but unreserved. Confirms AUDIT2. → reserve the junction + self-claim seam in an ADR before role-gated offering features multiply.`
- `[MINOR][forward-compat][NEW] backend/src/events value-vocabulary → the just-built value-events are named `Listing.Sold` / `ContactReveal.Created` — hard-wired to "listing," not the ADR-0014 Offering vocabulary. When SERVICE/PRODUCT offerings emit sale/contact events, either these names fork per-type (drift) or need a polymorphic subject. → when the read-model/seam is reserved, define event subjects as `(offering_type, offering_id)` too, so the analytics funnel (data-analyst North-star) spans offerings, not just listings. `views` still has no capture source (GAP-TRACE-006) — the funnel remains partly blind.`
- `[INFO][consistency][NEW] database_schema.sql:390 moderation_decisions.entity_type IN ('LISTING','ANIMAL') vs ADR-0014 offering_type ('ANIMAL_LISTING',…) → two polymorphic vocabularies for the same concept. The decisions LEDGER is ~90% pre-satisfied, but the moderation QUEUE (moderation.service.ts:183-193) is a 100% listings-scan — polymorphic moderation needs BOTH the additive enum AND a re-shaped queue. → when the side is built, reconcile the two vocabularies (map or unify) and make the queue source polymorphic, not just the enum.`

## 🟢 Confirmed-sound

- `[INFO][consistency][REFUTED vs round-1] database_schema.sql:84,98,789,1053 → the round-1 `role_in_org` duplication/contradiction (memory: schema :79/:722 vs :986) is GONE — all four sites now agree on the 4-value canon (OWNER/ADMIN/STAFF/VET) via migration 0016 hygiene + named `chk_org_user_role`. No longer a finding; memory updated.`
- `[INFO][consistency][CONFIRMED] amend-chain intact: 0011 Amends 0006, 0015 Amends 0002, 0019 Amends 0012, 0018 reaffirms 0004 — all "does NOT supersede," correct targets, parents still Accepted. Matches AUDIT2.`
- `[INFO][forward-compat][CONFIRMED] ADR-0019 crypto seam built (migration 0028) — the one irreversible-if-deferred piece is done → SAFE.`
- `[INFO][forward-compat][CONFIRMED] actor-snapshot reserved at every actor site (users, moderation_decisions:397, ownership_transfers, audit_log) → ADR-0014 rule 7 (polymorphic moderation carries actor snapshot) pre-satisfied.`

---

## Verification probes (delta from AUDIT2 P1–P10)

AUDIT2's P1–P10 stand. Sharpen two, add one:

- **P1′ (was P1) — extend the raw-read gate to catch all 3 sites.** `grep -rnE "FROM +animals|JOIN +species|JOIN +animals" backend/src/modules/listing backend/src/modules/moderation` MUST return **zero** hits outside AnimalService. Today flags `listing.service.ts:627`, `moderation.service.ts:577`, **and `moderation.service.ts:189-191`** (the queue CTE AUDIT2's narrative missed). GREEN only when market/species come from the read-model or a service accessor.
- **P3′ (was P3) — also assert the 0014↔0018 ordering note exists.** Beyond "0018 Accepted before 0014," assert ADR-0018 §Implementation Notes documents that list/queue joins are fixed via the 0014 read-model, not per-row service calls (guards against a naive refactor that N+1s the queue).
- **P11 — ADR-0014 timing self-consistency (NEW).** Assert ADR-0014 does not simultaneously say the form-now seam "ships now" (rule 2) and "not now" (Impl Notes). Fails today → adjudicate the timing in one normative line.

*Scope note:* inspected schema + migrations + listing/animal/moderation code + the six ecosystem ADRs + the memo.
Frontend, the TS crypto-backfill companion, and the `isOrgAdmin` consolidation count remain `требует ручной проверки`.
No product code or docs modified; per delegate rules I wrote only this file — no commit.
