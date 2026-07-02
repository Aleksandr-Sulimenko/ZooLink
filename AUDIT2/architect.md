# ZooLink HYPER Audit — Phase 2 · architect (forward-compat / anti-rewrite lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** read the ecosystem vision
(`future-features.md §145-227`), the six companion ADRs + their amend-chain sources (0002/0004/0006/0011/0012),
the ADR plan memo, then **verified every claimed form-now seam against real schema + migrations + code** —
because the mission question is precisely "reserved in schema/contract, or only in prose?". Grounded in the
Phase-1 `active-user.md` needs. I did not modify any product code or doc; this file is my sole output.

Finding format: `[severity][criterion][architect] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ forward-compat · consistency · SPOF · coverage.

> **Verified reality baseline (schema/migration/code inspected 2026-07-02):**
> - `favorites` = `listing_id UUID NOT NULL REFERENCES listings(id)`, `UNIQUE(user_id, listing_id)`
>   (`database_schema.sql:349-355`) — **listing-only FK, NOT polymorphic; and DORMANT** (no controller/service
>   references anything under `backend/src` — `find`/`grep -l favorite` = empty).
> - `saved_searches` = `filters JSONB` + `lat/lng/radius_m` (`database_schema.sql:360-373`) — **no `offering_type`;
>   and LIVE** (`saved-search.controller.ts` exists → rows are being written now).
> - `moderation_decisions` = `entity_type CHECK IN ('LISTING','ANIMAL')` + `entity_id` "polymorphic ref … not a
>   hard FK by design" (`database_schema.sql:390-391`) — **already type+id shaped; enum closed to the animal domain.**
> - `users.role` = single `VARCHAR CHECK IN (…7 values…)` (`database_schema.sql:115`) — **single-valued; no
>   `roles[]`/`user_roles` join.**
> - **NONE of `offering_type`, `offering_id`, `market_scope`, `monetization_type`, `geo_anchor`, `provider_kind`,
>   `provider_ref`, verification-tier exist anywhere in `database_schema.sql`, `migrations/`, or `backend/src/`**
>   (`grep -rniE` = empty across all three). They live **only in ADR prose.**
> - **ADR-0018 is HALF-implemented in code**: ownership path routed through `AnimalService.getOwnedAnimalForActor`
>   (`listing.service.ts:123,146`; private `loadAnimal`/`assertOwnsAnimal` gone) — **BUT** market-derivation still
>   does a raw cross-aggregate join (`marketOf` → `SELECT s.market FROM animals a JOIN species s …`,
>   `listing.service.ts:627-628`). ADR-0018 Status is still "Proposed."
> - **Built & good:** `goods_marketplace` toggle seeded (`migrations/…0027…`); ADR-0019 PII crypto seam
>   (`email_bidx` blind-index + AES ciphertext on `email`/`contact_phone`, `migrations/…0028…`).

---

## 🔶 FORWARD-COMPAT VERDICT (per seam: SAFE / RESERVE-NOW / REWRITE-RISK)

| Seam / ADR | Verdict | Evidence | Cheapest form-now action |
|---|---|---|---|
| **ADR-0014 polymorphic Offering** (favorites/saved_searches/moderation/read-model + `offering_type`) | **RESERVE-NOW** | Shape decided in prose only; `favorites` listing-only FK (`:352`) but **dormant** (zero rows/controller) → free to change; `saved_searches` (`:360`) LIVE but stores a *query facet* → additive column; `moderation_decisions` already type+id (`:390`). No wrong-shape data written at volume yet. | One migration: add `(offering_type,offering_id)` to `favorites`+`saved_searches` (default `ANIMAL_LISTING`); additive-extend `moderation_decisions.entity_type` CHECK; create the discovery **read-model** table shell (`offering_type,offering_id,market_scope,geo_anchor,monetization_type,status,provider_ref`). Cheap **iff done before favorites ships**. |
| **ADR-0015 `market_scope`** | **RESERVE-NOW** | ADR is *sound* (amends, not supersedes 0002 — clean). But market is **species-join-derived everywhere in code** (`marketOf:627`) and in dictionaries (`UNIQUE(market,code)`); no assignable `market_scope` column exists. Refinable **by design**, **not reserved** in schema. | Add `market_scope ∈ {pet,livestock,both}` as a column on the read-model (same migration as 0014). Do **not** let the `marketOf` raw-join become the read-model's market source. |
| **ADR-0016 provider model** (`provider_kind`, XOR-backing CHECK, T0–T3 verification) | **RESERVE-NOW** (low urgency) | No provider table/column/CHECK anywhere; only prose. But **no offering references a provider yet** and the org domain already exists → retrofit is clean *when built*. The ADR's shape-in-prose is adequate **because no data exists** — the risk is only if it's forgotten at build. | None required until the services side is built; the seam is genuinely deferrable. Keep the XOR-CHECK + append-only verification requirement pinned in the ADR (it is). |
| **ADR-0018 cross-aggregate rule** (prerequisite for 0014) | **REWRITE-RISK** | Ownership fixed; **`marketOf` still raw-reads `animals`+`species`** (`:627-628`) — a live breach of ADR-0018 rule 1, on the exact market-derivation path ADR-0015's read-model must consume. The seam ADR-0014 is built to sit on is **not clean yet**; the coupling would propagate into the projector. | Route market via `AnimalService` (e.g. `getMarket(animalId)` / include `market` in the summary) **before** the discovery projector is written; add reviewer-qa "no cross-aggregate raw table read" gate (probe P1 below). |
| **ADR-0019 PII-at-rest form** | **SAFE** | Irreversible piece **built**: `email_bidx` HMAC blind-index + AES ciphertext on `email`/`contact_phone` (`migrations/…0028…`); recovery repoint present. This was the retrofit-expensive item — it is done. | none (verify contact_phone read-path repoint at build; `требует ручной проверки` on the TS backfill companion). |
| **Multi-role / progressive onboarding** (vision §F; underpins 0016 comfort BR) | **RESERVE-NOW** | `users.role` single-valued (`:115`); no `roles[]`/`user_roles`. active-user #3 flagged self-service role-claim absent. Going multi-role later = add a join table (keep `role` as primary) — cheap, but unreserved. | Reserve a `user_roles(user_id, role)` join (or `roles[]`) + a self-claim seam pattern in an ADR before role-gated features multiply. |

**One-line net:** the ADR *reasoning* is sound and the amend-chain is clean; the risk is that **the ADR-0014/0015/0016 form-now seams are declared but physically absent from schema — cheap now, expensive after favorites/discovery data exists — and the one hard prerequisite (ADR-0018) is only half-built.**

---

## 🔴 Structural / chain-integrity findings

- `[MAJOR][consistency][architect] docs/04-decisions/0014-offering-supertype-polymorphic-seam.md:3 → ADR-0014 is **Accepted** and names ADR-0018 a "**prerequisite**" (Decision rule 8), but ADR-0018 is still **Status: Proposed — awaiting owner nod** (0018:3). A dependent decision was accepted before its declared hard prerequisite → chain-integrity inversion; anyone building 0014 has no accepted floor to stand on. → Flip ADR-0018 to Accepted (owner nod) **before** any 0014 migration, or downgrade 0014 to "Accepted-pending-0018"; keep the prerequisite and the status monotonic.`
- `[MAJOR][forward-compat][architect] backend/src/modules/listing/listing.service.ts:627 → marketOf() runs raw `SELECT s.market FROM animals a JOIN species s ON s.id=a.species_id` — a cross-aggregate raw read that **violates ADR-0018 rule 1** on the market-derivation path (ownership path was correctly routed at :146). ADR-0014's read-model must carry `market_scope` (ADR-0015) sourced from this exact derivation → building the projector on this raw join propagates the coupling ADR-0018 exists to kill. → expose `AnimalService.getMarket(animalId)` (or return `market` from the owned-animal summary) and repoint marketOf; add the reviewer-qa gate (probe P1).`
- `[MAJOR][consistency][architect] docs/04-decisions/ECOSYSTEM_ADR_PLAN.md:4 → the memo header + table rows (`:12` ADR-0016, `:15` ADR-0019) list **0016 and 0019 as "Proposed"**, but the actual ADR files are **Accepted** (0016:3 "Accepted — security+legal sign-off"; 0019:3 "Accepted — owner ratified OD-1/OD-2"). The memo says "doc-keeper recorded the statuses" yet the memo itself is stale → source-of-truth drift in the very doc owners read to see ADR state. → reconcile the plan table to the ADR files (0016/0019 Accepted; 0017/0018 still Proposed); or add a "statuses authoritative in the ADR files, this table is a snapshot dated X" caveat.`
- `[MINOR][consistency][architect] docs/04-decisions/0016-provider-model.md:3 vs ECOSYSTEM_ADR_PLAN.md:12 → same drift class: ADR-0016 carries residual OD-3/4/5 as *product* confirmations while the plan still frames it as awaiting the *verification matrix* (which §3 now supplies). → align the memo's "awaiting-condition" text with 0016's actual residuals.`

## 🟠 Coupling / SPOF (structural blockers to the ecosystem)

- `[CRITICAL][forward-compat][architect] backend/src/modules/listing/listing.service.ts:146,244 (schema listings.animal_id NOT NULL) → every offering is an **animal listing**: `animal_id UUID NOT NULL REFERENCES animals` (schema:244) + create requires an owned animal (:146). This is the listing↔animal coupling ADR-0014 must escape via per-subtype tables. It is **not itself a blocker to the seam** (ADR-0014's Option-2 keeps `listings` as the ANIMAL_LISTING subtype untouched) — the real prerequisite is clean *reads* (ADR-0018), not decoupling `listings`. → correct the active-user framing: the coupling to remove is the **raw cross-aggregate read** (marketOf), not the animal_id FK; `listings` stays as-is under the seam.`
- `[MAJOR][SPOF][architect] database_schema.sql:349-357 → `favorites` is the polymorphic seam's cheapest reservation window: it is **dormant** (no controller). The moment a favorites controller ships against the listing-only FK, the reservation stops being free (rows exist with no offering_type). → land the `(offering_type,offering_id)` reservation **in the same slice that builds favorites**, never after.`
- `[MAJOR][forward-compat][architect] database_schema.sql:115 (users.role single value) + admin-user.controller role-change ADMIN-only → single-role model is a structural SPOF for the progressive/multi-role comfort BR (ADR-0016 driver 2; vision §C/§F). No `roles[]` reserved. → reserve the multi-role join + self-claim seam now (RESERVE-NOW verdict above).`
- `[INFO][forward-compat][architect] database_schema.sql:264-268,326-335 → geo is `lat/lng` on `listings` only; ADR-0014 wants a first-class `geo_anchor` on the offering/read-model with room for a service-area. PostGIS is a gated DB-image swap (schema:327 DO-block already conditional) — good, that part is genuinely deferrable. → include `geo_anchor` in the read-model shell when reserved.`
- `[INFO][consistency][architect] moderation_decisions.entity_type CHECK IN ('LISTING','ANIMAL') (schema:390) → the moderation subject is already (type,id)-shaped (ADR-0014 rule 2 "moderation subject becomes polymorphic" is **90% pre-satisfied**); only the closed enum needs an additive extension for SERVICE_OFFERING etc. → cheapest of all the 0014 reservations; extend the CHECK additively when the side is built.`

## 🟢 Confirmed-sound (no rewrite forced)

- Amend-chain headers are **clean and consistent**: 0011 *Amends* 0006 (0011:5), 0015 *Amends* 0002 (0015:6), 0019 *Amends* 0012 (0019:5), 0018 *reaffirms/amends* 0004 (0018:5) — all say "does NOT supersede," all point at the correct target, all sources still `Accepted`. No supersede/amend contradiction found. **The 0011-amends-0006 / 0015-amends-0002 / 0019-amends-0012 chain the mission asked about is intact.**
- ADR-0015 is genuinely refinable (Option-3 keeps derived-market for animals, assigned `market_scope` for the rest, one normalising read-model column) — the design does **not** hard-bake species-join for species-less offerings; it is only the *current code* that derives-from-species, and that is expected pre-build.
- ADR-0019 crypto seam **built** (migration 0028) — the one irreversible-if-deferred piece is done → SAFE.
- ADR-0006/0011 actor-snapshot is reserved in schema at every actor site (`principal_type`/`actor_principal_type` on users:118, moderation_decisions:397, ownership_transfers:535, audit_log:1162) → polymorphic moderation will carry the actor snapshot for free (ADR-0014 rule 7 pre-satisfied).

---

## Architecture verification probes (for Phase-3 to PROVE the seams hold)

> Each is a concrete, runnable check. `RED` = must currently FAIL/flag (a gap to close); `GREEN` = must currently PASS (a guarantee to keep from regressing). Paths absolute where a runner needs them.

**P1 — No cross-aggregate raw table read (ADR-0018 gate).** `RED today.`
`grep -rnE "FROM +animals|JOIN +species|prisma\.animals\.|prisma\.species\." backend/src/modules/listing backend/src/modules/moderation` MUST return **only** call sites inside `AnimalService`; any hit in `listing.service.ts`/`moderation.service.ts` is a violation. Currently flags `listing.service.ts:627-628` (marketOf). Wire as a reviewer-qa/CI guard; goes GREEN once marketOf is routed through AnimalService.

**P2 — Amend-chain integrity (ADR conformance).** `GREEN expected.`
For each pair (0011→0006, 0015→0002, 0019→0012, 0018→0004): assert the child file contains `**Amends**: [ADR-000X]` **and** `does NOT supersede`/`reaffirms`, and the parent file's `**Status**` is still `Accepted`. Fails if any parent was silently superseded or a child points at the wrong number.

**P3 — Prerequisite-before-dependent (status monotonicity).** `RED today.`
Assert: if ADR-0014 (`Accepted`) names ADR-0018 a "prerequisite", then ADR-0018 `Status` ∈ {Accepted}. Currently 0018 is `Proposed` → flags the chain inversion. Same check for ADR-0016→0014 and ADR-0015↔0014 joint-ratify.

**P4 — Plan/ADR status parity.** `RED today.`
Parse `ECOSYSTEM_ADR_PLAN.md` status column vs each ADR file's `**Status**` line; assert equal per ADR. Currently flags 0016 (plan=Proposed, file=Accepted) and 0019 (plan=Proposed, file=Accepted).

**P5 — Reserved-seam schema shape (form-now assertions).** `RED today (documents the reservations to make).`
Against a migrated DB (or `database_schema.sql`): assert presence of `favorites.offering_type`, `favorites.offering_id`, `saved_searches.offering_type`, a discovery read-model table carrying `{offering_type, offering_id, market_scope, geo_anchor, monetization_type, status, provider_ref}`, and `moderation_decisions.entity_type` accepting `SERVICE_OFFERING`. Each MISSING assertion = a form-now seam still only-in-prose (all currently missing). Flip to GREEN as the reservation migration lands. Also assert `offering_type` default/only-value = `ANIMAL_LISTING` (ADR-0014 rule 2 "until subtypes exist").

**P6 — Provider XOR-backing CHECK (ADR-0016 DoD gate).** `RED until services side.`
When a `providers` table exists, assert a DB CHECK `(organization_id IS NOT NULL) XOR (user_id IS NOT NULL)` and an append-only trigger on the verification record (mirror `trg_moderation_decisions_immutable`, schema:415-425). Absence = the "trust is structural" claim is unenforced.

**P7 — market_scope enforced in discovery (ADR-0015 invariant).** `RED until read-model built.`
Gherkin-style: seed a `market_scope=livestock`-only offering; query discovery with `market=pet`; assert it is NOT returned; query `market=livestock` and a `both`-scoped offering, assert both returned. Proves separation is a central testable invariant, not an emergent join. Today: only animal listings exist and market is species-derived — the negative test has no species-less row to run against (documents the gap).

**P8 — Single ownership-check implementation (ADR-0018 rule 3).** `partially GREEN.`
`grep -rnE "isOrgAdmin" backend/src` MUST resolve to one shared definition; assert no private `assertOwnsAnimal`/`loadAnimal` in `listing.service.ts` (currently GREEN — confirmed removed) and no duplicated org-admin check across services (verify `isOrgAdmin` consolidation — `требует ручной проверки`).

**P9 — Actor-snapshot at every actor site (ADR-0011 / ADR-0014 rule 7).** `GREEN expected.`
Assert `principal_type`/`actor_principal_type` column present on `users`, `moderation_decisions`, `ownership_transfers`, `audit_log`. Guarantees polymorphic moderation inherits the actor snapshot when it extends. Currently passes (schema:118,397,535,1162).

**P10 — PII irreversible seam present (ADR-0019).** `GREEN expected.`
Assert `users.email_bidx` exists, `email`/`contact_phone` are `TEXT` (ciphertext width), and no code path does `WHERE email = <plaintext>` in recovery (`grep -rnE "email *= " backend/src/modules/auth`). Guards the one retrofit-expensive piece from regressing.

---

*Scope note:* I inspected schema + migrations + listing/animal/moderation code + the six ADRs and their sources.
Frontend, the TS crypto-backfill companion, and the `isOrgAdmin` consolidation count are `требует ручной проверки`
(delegated verification). No product code or docs were modified; per delegate rules I wrote only this file — no commit.
