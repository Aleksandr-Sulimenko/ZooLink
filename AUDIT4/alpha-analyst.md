# ZooLink HYPER³ Round-3 (Phase 2) — alpha-analyst (SDD contract / state-machine / NFR drift under the fix-program)

**Date:** 2026-07-08 · **Branch:** `backend` · **HEAD:** `0fcc182`
**Method:** re-derived my five axes (contract-first integrity, state-machine completeness, error coverage, NFR spec, open questions) against the fix-program's six new flows (ADR-0014/0018/0020/0021/0022 + C5 claim-code), traced each ADR→spec→contract→built module, then diffed vs `AUDIT3/alpha-analyst.md` + `AUDIT2/alpha-analyst.md`. Reading/reasoning only; no src/docs modified; nothing run.

Finding format: `[severity][criterion][axis][status] file:line → problem → fix`.
Axis ∈ same | new | trash | strat. Status ∈ NEW | CONFIRMED | REFUTED | SEV-CHG | FIXED-VERIFIED. Strategic carry `[NS|PERSP]`.

---

## Spec-drift table — the six fix-program flows

| Fix-program flow | Spec complete & matches code? | Gap | What to specify |
|---|---|---|---|
| **Claim-code transfer (C5)** | **YES — FIXED-VERIFIED** | none | `ownership_transfer_state_machine.md §C5` (INV-C5-1..7, error codes, 6 probes) + `transfers-api.yaml` are exhaustive; code (`claim-code.service.ts`) matches. Exemplary SDD. |
| **OfferingRef (ADR-0014 D2)** | **YES — FIXED-VERIFIED** | none | `favorites-api.yaml`+`geo-search-api.yaml` carry `offeringType`/`offeringId` (closed enum `ANIMAL_LISTING`); matches migration 0032 + code. |
| **Derived-market cache (ADR-0018)** | **YES (internal)** | no public contract surface (by design) | Cache column + repo-wide grep-gate (D8/D8b); no client-visible contract. OK. |
| **Consents (ADR-0020)** | **PARTIAL** | no state machine, no domain-spec section, version-staleness undefined | §F4, §F5 below |
| **Notification consumer (ADR-0021)** | **NO** | 3-way ADR↔catalog↔code divergence; IN_APP not in contract enum; write-only (no read path); state machine omits IN_APP | §F1, §F2, §F3 below |
| **user_roles (ADR-0022)** | **PARTIAL** | dormant junction; multi-role authz absent from rbac-matrix/contract; activation = breaking authz-read | §F9 below |

---

## NEW findings

### F1 — Notification event-coverage: three canonical sources disagree (the green suite masks it)
`[MAJOR][conformance][new][NEW]` `0021-…notification-path.md:134-140` (ADR §5) ↔ `docs/specs/event-catalog.md:75-87` (§3) ↔ `backend/src/modules/notification/notification.registry.ts:53-105` →
Three sources give three different event→notification sets:
- **ADR-0021 §5 (Accepted)** — MVP materialize = `Moderation.Decided` + transfer lifecycle + `Listing.{Expired,Sold,Activated}` + `ContentReport.Actioned`.
- **event-catalog §3** — only `OwnershipTransfer.*` are channel `in-app`; `Moderation.Decided`/`Listing.Expired`/`ContentReport.Actioned` are assigned channel **email**; and its note (line 67) asserts "the registry is an allow-list of `OwnershipTransfer.*`".
- **Built registry** — `Moderation.Decided` **+** `OwnershipTransfer.*` only.

So (a) the catalog's own description of the registry is stale (code also routes `Moderation.Decided`); (b) the code writes `Moderation.Decided` as `IN_APP` while the catalog assigns it to `email`; (c) `Listing.{Expired,Sold,Activated}` + `ContentReport.Actioned` — the ADR's own "end the silence" targets — are **still silent** (unbuilt in the registry). Tests pass because they assert only the built subset.
→ **Fix:** reconcile to ONE canonical coverage set. Either supersede ADR-0021 §5's coverage to `Moderation.Decided`+`OwnershipTransfer.*` (with the channel each maps to) **or** build the missing routes; correct the stale event-catalog §3 note; make channel (`IN_APP` vs `email`) consistent per event across catalog and code. Route → architect (amend ADR-0021) + doc-keeper (EN↔RU) + backend.

### F2 — `notification_state_machine.md` does not cover the IN_APP channel that was built
`[MAJOR][state-machine][new][NEW]` `docs/specs/statemachines/notification_state_machine.md:4,30,40` →
The state machine models only the EMAIL/SMS provider-webhook lifecycle (`QUEUED→SENT→DELIVERED/BOUNCED/FAILED`). The built IN_APP path (migration 0030 + `notification.consumer.ts:82`) inserts a row **directly at `status='SENT'`**, no provider, no `QUEUED`, no `DELIVERED/BOUNCED`, and **ignores `notification_prefs`** (transactional-always, ADR-0021 §3). Yet line 4 says "one outbound **EMAIL/SMS**" and the initial-transition guard (line 40) is "Recipient opted-in (`notification_prefs`) && template active" — which **directly contradicts** the built IN_APP behavior (IN_APP is written regardless of prefs). The state machine is silent on the sub-machine that actually ships.
→ **Fix:** add an IN_APP lane: `[*] → SENT` (materialised in-tx, idempotent on `idempotency_key`), **terminal at SENT** (no delivery-receipt lifecycle), **no `notification_prefs` guard** (note transactional-always independence). Route → doc-keeper + architect.

### F3 — IN_APP notifications are write-only: no read contract + enum drift ("silence" only half-ended)
`[MAJOR][contract-first][new][CONFIRMED→SEV-CHG]` `notification-api.yaml` (no `@Controller` backs it; `:26` type enum `[EMAIL,SMS]`) →
`notification.consumer.ts` materialises `notification_logs.type='IN_APP'` rows, and ADR-0021 §3 calls that row "the MVP **'you were told'**". But: (a) no controller backs `notification-api.yaml` at all (still fully dead — AUDIT3 §0 baseline holds); (b) there is **no** endpoint for a user to read their own in-app inbox; (c) the contract's channel enum is `[EMAIL,SMS]` — `IN_APP` is absent. Net: the built IN_APP rows are **unreadable by any client** — the row exists but the user still cannot see the outcome. The primary ADR-0021 goal ("end the silence") is only half-delivered. AUDIT3 rated notification-api merely a dead contract; it is now **behaviour-bearing-but-unreadable**, a sharper defect.
→ **Fix:** spec + build `GET /me/notifications` (own-scope, own-leak-safe) surfacing IN_APP rows, and add `IN_APP` to the type enum — **or** honestly document in ADR-0021 that IN_APP-read is deferred (then the "you were told" claim is not yet true; surface it, don't imply it). Route → architect + backend + doc-keeper.

### F4 — Consent lifecycle (ADR-0020) has no state machine and no domain-spec section
`[MAJOR][state-machine][new][NEW]` `docs/specs/statemachines/` (no `consent_state_machine.md`); `docs/specs/01-identity-domain.md:92` (consent mentioned only as a generic ФЗ-152 line) →
The built consent flow (grant → withdraw → re-grant as append-only superseding rows; current = latest; reveal-gate `currentlyGranted && show_*`; default-deny) is normative **only** in ADR-0020 + the `listings-api.yaml` reveal snippet + code. There is no state machine and no identity/contact-exchange domain-spec section describing the consent entity's lifecycle, guards, or the two-layer gate. Every other lifecycle entity (transfer, listing, notification, content-report, user, digital-asset, payment) has a `statemachines/*.md`; consent — a **legal-proof** artifact (ст.9/ст.10.1) — does not.
→ **Fix:** add `consent_state_machine.md` (states `NO_CONSENT → GRANTED → WITHDRAWN → GRANTED …`, superseding transitions, the append-only immutability guard, the reveal-gate as a Gherkin decision-table: consent×`show_*` → REVEALED/NO_CHANNELS), and a consent section in `01-identity-domain.md`/`16-contact-exchange.md`. Route → alpha-analyst (write) + legal (review) + doc-keeper.

### F5 — Consent `policy_version` staleness is undefined (contract silent) `[NS]`
`[MAJOR][trash][new][NEW]` `backend/src/modules/identity/consent.service.ts:17,62-70` + `0020-…consent-record-model.md:153` →
`currentlyGranted` returns `latest.granted` **ignoring `policy_version`**; `CONSENT_POLICY_VERSION='1.0'` is a hardcoded constant. ADR-0020 leaves silent whether bumping the consent text (→ `2.0`) **invalidates** prior consent granted against `1.0`. Under ст.9, materially changed consent text arguably requires re-consent — but the code treats a `1.0` grant as fully current against `2.0`, and nothing re-prompts. The contract gives an AI operator (ADR-0006 — who may record/withdraw consent) **no deterministic rule** for whether to re-solicit on a version change. This is exactly the adversarial/boundary gap the trash lens targets: undefined behaviour on a version fork.
→ **Fix:** specify the re-consent semantics explicitly — either "a `policy_version` older than the current material version is **not** current (re-prompt)" or "version-agnostic until an explicit withdrawal" — and encode the choice in `currentlyGranted` + a Gherkin rule. Route → legal + alpha-analyst + architect. `[NS]` machine-actionability blocker.

### F8 — `16-contact-exchange.md` silent on the ADR-0020 consent precondition
`[MINOR][consistency][new][NEW]` `docs/specs/16-contact-exchange.md` (no `consent`/`NO_CHANNELS`/`distribution` hits) →
The reveal consent-gate (`REVEALED`/`NO_CHANNELS`, default-deny, the empty-reveal no-charge fix) is normative in `listings-api.yaml:1030-1037` + ADR-0020 + code (`listing.service.ts:553-568`) but the **contact-exchange domain spec itself** carries none of it. A reader of the domain spec would not know a reveal can return `NO_CHANNELS` on missing consent.
→ **Fix:** add the consent-gate + `NO_CHANNELS` semantics to `16-contact-exchange.md`. Route → doc-keeper.

### F9 — Multi-role (ADR-0022) authz semantics absent from rbac-matrix / any contract `[PERSP]`
`[INFO][forward-compat][new][NEW]` `docs/specs/security/rbac-matrix.md` (single-role) ↔ migration 0034 (`user_roles` junction, dormant) →
The junction is written sync-on-write (admin `setRole`) but **grants nothing** (`users.role` is sole authz). The rbac-matrix and every `x-required-roles` present the world as single-role. When the first role-gated offering slice makes authz read the junction, it is a **breaking change to every authz-read**, unspecced today. Machine-actionability: an AI operator cannot reason about a user's effective roles from the current contract.
→ **Fix:** add a "multi-role reserved-dormant" note to rbac-matrix and spec the self-claim/activation contract (JIT claim, ADR-0016 tier-gate) **before** the first role-gated offering — cheaper now than under a live authz surface. `[PERSP]`

### F10 — Notification consumer silently no-ops on a missing template (forward-only, never replayed)
`[INFO][trash][new][NEW]` `backend/src/modules/notification/notification.consumer.ts:69-73` →
If a `NOTIFICATION_REGISTRY` `templateName` (e.g. `listing_approved`) has no seeded row, the consumer logs a warning and **writes nothing**, and the event is still stamped `processed` under the forward-only relay — **never replayed**. So a mis-seed makes moderation/transfer outcomes silently un-notified, masked by the graceful no-op. Template-seed existence for the moderation IN_APP set (`listing_approved`/`_rejected`/`_changes_requested`; migration 0010/0030) **requires manual verification** (not found under `backend/prisma/`; seeds may live in the root `migrations/` SQL).
→ **Fix:** add a startup/CI assertion that every `NOTIFICATION_REGISTRY` `templateName` resolves to a seeded template (fail-fast, not silent no-op). Route → backend + reviewer-qa.

---

## Diff vs AUDIT3 / AUDIT2

### FIXED-VERIFIED
- **AUDIT3 §4 (CRITICAL, contact-reveal population dead-end)** — `[CRITICAL][needs][FIXED-VERIFIED]` `auth-api.yaml:808-864` + `identity/dto` now expose `contactPhone`/`contactTelegram`/`showPhone`/`showTelegram` on `PATCH /me` with consent semantics; the reveal path has a real population source. Closed.
- **AUDIT3 §2 (MAJOR, admin-api duplicate `/moderation/*`)** — `[MAJOR][consistency][FIXED-VERIFIED]` `admin-api.yaml:306,373,396,423` now `deprecated:true` + "SUPERSEDED — do not implement" pointers to moderation-api. Duplicate-path ambiguity closed.
- **AUDIT3 §4/§5 favorites role gate** — `[MINOR][consistency][FIXED-VERIFIED]` `favorites-api.yaml:24,45,53` add VETERINARIAN & GROOMER (D11). Favorites side closed.
- **AUDIT3 §3 (MAJOR, consent seam absent)** — `[MAJOR][forward-compat][FIXED-VERIFIED]` `consents` table (migration 0029) + `ConsentService` built (ADR-0020). The *model* is closed; the *lifecycle spec* is not (→ F4/F5).

### CONFIRMED (still open)
- **AUDIT3 §1 GAP-BA-001 (livestock `price_or_terms`)** — `[MAJOR][drift][same][CONFIRMED]` `listings-api.yaml:679,881,927` still carry only `priceCents`+`currency`; no `priceTerms`/`price_terms`. The livestock BR's required "negotiable / 8000 per straw / package" pricing remains unrepresentable → half the platform cannot express its required pricing model. Not fixed. → add `priceTerms:string(150)` or supersede the BR. Route → architect (ADR) + alpha-analyst.
- **AUDIT3 §5 notification-preferences role gate** — `[MINOR][consistency][same][CONFIRMED]` `notification-api.yaml` `/me/notification-preferences` GET/PUT `x-required-roles = [USER,BREEDER,FARMER,MODERATOR,ADMIN]` still **omit VETERINARIAN & GROOMER** (favorites was fixed D11; this file was not). rbac-matrix grants prefs to all USER sub-roles. Latent (contract dead) but a real defect. → add VET, GROOMER.

---

## Contract-test probes (round-3 additions)
- **A15 — event-coverage single-source.** Assert the set `keys(NOTIFICATION_REGISTRY)` == the `IN_APP` rows of event-catalog §3 == ADR-0021 §5 coverage. **Fails today** (F1).
- **A16 — channel-enum completeness.** Assert every `notification_logs.type` CHECK value (`EMAIL,SMS,IN_APP`) appears in the `notification-api.yaml` type enum. **Fails** (F3: enum `[EMAIL,SMS]`).
- **A17 — every registry template is seeded.** For each `NOTIFICATION_REGISTRY` `templateName`, assert a seeded `notification_templates` row exists. Encodes F10.
- **B9 — consent version fork.** Grant `CONTACT_DISTRIBUTION` at `policy_version=1.0`; bump current to `2.0`; assert the specified behaviour (re-prompt vs still-current) — **undefined today** (F5).
- **B10 — IN_APP readability.** After a `Moderation.Decided`/transfer event materialises an IN_APP row, assert the recipient can retrieve it via a documented endpoint. **Fails** (F3, no read path).
- **B6 (carried) — livestock terms unrepresentable.** POST `/listings {priceTerms:"8000 per straw"}` → predicted 400 (GAP-BA-001 still open).

*Scope:* independent ADR→spec→contract→code traces for all six fix-program flows complete. Template-seed existence (F10) and the exact EN↔RU mirror of the new consent/notification prose are **requires manual verification**. This file is my sole output.
