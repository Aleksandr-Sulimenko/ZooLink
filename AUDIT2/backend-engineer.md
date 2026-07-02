# ZooLink HYPER Audit — Phase 2 · backend-engineer (code correctness + robustness under forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Mode:** Research & Hardening (audit only; no code modified).
**Method:** read the actual controllers/services/DTOs + `database_schema.sql` + ADR-0014–0019 / ECOSYSTEM_ADR_PLAN,
walked the correctness/robustness/forward-compat surfaces, verified the aa3ae3b contact-exchange work end-to-end.

Finding format: `[severity][criterion][backend] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ correctness · robustness · abuse · integrity · forward-compat · maintainability.

> **Verification baseline (what I actually confirmed in code):** TOCTOU single-winner is correctly implemented across
> every lifecycle write (guarded `updateMany` with `count===1` as the first in-tx write, loser rolls back before any
> audit/outbox row). Idempotency has a real in-flight lock (`SET NX` reservation → 409 `IDEMPOTENCY_KEY_IN_PROGRESS`).
> Value events are emitted in-tx with `schemaVersion` + `market`. The moderation queue is fully SQL-paginated. The
> IDOR posture (404-no-leak, own-scope AND-intersect) holds. These are genuinely solid — findings below are the gaps.

---

## 1. BLOCKER — active-user #1 confirmed & pinned: contact-reveal yields empty channels for every real user

**Confirmed. The READ side (aa3ae3b) is wired; the WRITE side does not exist anywhere.** `contact_phone` and
`contact_telegram` have **no writer on any user-reachable path**:

- **Reveal reads them** — `backend/src/modules/listing/listing.service.ts:459-476`: selects `contact_phone`,
  `contact_telegram`, `contact_prefs`; `show_phone` → `crypto.decrypt(seller.contact_phone)`; `show_telegram` →
  `contact_telegram`. Correct logic, but the source columns are always null/default.
- **Registration never sets them** — `backend/src/modules/identity/identity.service.ts:90-104` (`registerPhone` create)
  and `:207-224` (`oauthLogin` create) write `full_name/email/city_id/avatar_url/role/...` — **no `contact_phone`/
  `contact_telegram`**. `verifyPhone` (`:161-164`) has the verified E.164 in hand but does **not** persist it into
  `contact_phone`.
- **`/me` PATCH cannot set them** — `UpdateProfileDto` (`backend/src/modules/identity/dto/identity.dto.ts:102-131`) exposes
  only `fullName/cityId/email/avatarUrl/preferredLanguage`; and `ProfileService.updateMe`
  (`backend/src/modules/identity/profile.service.ts:44-53`) whitelists exactly those five — **no contact fields, no
  channel-visibility**. `forbidNonWhitelisted` means even a hand-crafted body is dropped.
- **Only writers null them** — erase/retention.

**Correction to active-user's root-cause wording (important for the fix):** `contact_prefs` is **NOT unset** —
`database_schema.sql:971-972` gives it `NOT NULL DEFAULT '{"show_phone": true, "show_telegram": false}'`. So at reveal
`prefs.show_phone === true` by default; the code reaches `crypto.decrypt(null)` and gets nothing → `channels = {}`.
The true gap is: (a) `contact_phone`/`contact_telegram` have no writer, and (b) `contact_prefs` has no editor. Both must
be closed or the channel is permanently empty.

`[BLOCKER][correctness][backend] backend/src/modules/identity/profile.service.ts:44 → updateMe whitelists only fullName/cityId/email/avatarUrl/preferredLanguage; UpdateProfileDto (identity.dto.ts:102) has no contact_phone/contact_telegram/contact_prefs; registration (identity.service.ts:90) never sets them → contact-reveal (listing.service.ts:459) always returns channels:{} → add contactPhone/contactTelegram/showPhone/showTelegram to UpdateProfileDto + updateMe (encrypt phone via crypto.encrypt on write, mirror the email pattern at profile.service.ts:47-50); optionally populate contact_phone from the verified E.164 in verifyPhone (identity.service.ts:161). Contract: amend spec 01 + listings/identity OpenAPI first (doc-first).`

`[MINOR][robustness][backend] backend/src/modules/listing/listing.service.ts:457 → enforceRevealRateLimit INCRs and consumes quota BEFORE the seller/channels are resolved, and the reveal row + ContactReveal.Created are written even when channels resolves empty → today every reveal burns quota AND inserts a meaningless reveal row that inflates analytics.contactReveals → after the BLOCKER fix, consider skipping the quota-consume + reveal-row write when the seller has no enabled/populated channel (return 422 CONTACT_UNAVAILABLE), so the counter and analytics reflect real reveals.`

---

## 2. Abuse gaps (Phase-1) confirmed in code

`[MAJOR][abuse][backend] backend/src/modules/listing/listing.service.ts:130 → create() has NO per-user/per-period listing-creation quota (only L-14 MAX_MEDIA_ITEMS=10 photos/listing and the DB uq_active_listing_per_type one-active-per-(animal,type)); grep confirms "quota" appears only in the contact-reveal comment → a single user creates N animals → N listings → floods a breed/city with near-dupes → add a per-user active-listing cap + a creation rate-limit (reuse @nestjs/throttler+Redis already in the stack, or a Redis INCR mirror of enforceRevealRateLimit); route the threshold to security/product. Pairs with the account-age gate below.`

`[MAJOR][abuse][backend] backend/src/modules/listing/listing.service.ts:511 → the reveal rate-limit key is `contact-reveal:${market}:${viewerId}` — per (market, viewer) only. No per-seller, per-listing, or account-age dimension → a fresh throwaway account resets the entire quota (Sybil); once contacts populate (BLOCKER fix), an enumerator scrapes every seller contact across many cheap accounts → add a per-seller and/or per-listing reveal cap (second Redis counter keyed on seller_id/listing_id) + a minimum-account-age gate before reveal is permitted; route to security. (Moot only until the BLOCKER is fixed — fix both together.)`

---

## 3. Robustness sweep

**OK (verified correct — do not "fix"):**
- **TOCTOU single-winner** — `submit` (`listing.service.ts:368`), `withdraw` (`:407`), `markSold` (`:552`),
  `editActiveAndReenqueue` (`:302`), moderation `claim` (`moderation.service.ts:228`) and `action`
  (`:352`) all use a status/holder-guarded `updateMany` as the **first** in-tx write, check `count===1`, and throw
  (rolling back) **before** the audit/decision/outbox rows. Loser writes nothing. Correct, uniform, exemplary.
- **Idempotency in-flight lock** — `backend/src/lib/http/idempotency.interceptor.ts:71-108`: `SET NX` reservation,
  concurrent replay → 409 `IDEMPOTENCY_KEY_IN_PROGRESS` + Retry-After, completed replay → stored response verbatim.
  Applied to create/submit/reveal/mark-sold/add-photo. Correct.
- **Transaction integrity** — reveal row + `ContactReveal.Created` in one tx (`listing.service.ts:479-492`);
  moderation flip + decision append + audit + `Moderation.Decided`(+`Listing.Activated`) in one tx (`:352-447`);
  markSold flip + audit + `Listing.Sold` in one tx (`:551-584`). Atomic.
- **Event-seam completeness** — `Moderation.Decided`, `Listing.Activated`, `Listing.Sold`, `ContactReveal.Created`
  all carry `schemaVersion: 1` + `market` + `occurredAt`, emitted in-tx via the outbox. Complete for the built flows.

**Findings:**

`[MAJOR][forward-compat][backend] backend/src/modules/listing/listing.service.ts:626-631 & backend/src/modules/moderation/moderation.service.ts:577-582 (marketOf) + moderation.service.ts:188-192 (queueBaseCte) → ADR-0004/0018 says route cross-aggregate animal access through AnimalService, yet market derivation and the moderation queue read the `animals`+`species` tables directly via $queryRaw JOINs, bypassing AnimalService → the create() path correctly uses animals.getOwnedAnimalForActor (:146), so the rule is applied inconsistently; when the animal aggregate's ownership/soft-delete/market rules evolve, these raw joins silently drift → extract a single AnimalService.marketOf(animalId) (or a read-model) and call it from both services; delete the duplicated private marketOf. Reaffirms ADR-0018; low-risk bounded refactor.`

`[SHOULD-FIX][integrity][backend] backend/src/lib/outbox/outbox.relay.ts:117 → an event with no registered consumer is marked processed_at=now() ("marked processed") → the moderation.action comment (moderation.service.ts:418-421) claims these events are "the deliberate START of analytics history capture"; but a consumer registered LATER cannot replay a row already stamped processed_at, so the history-capture guarantee is weaker than documented (rows persist but are terminal, not replayable) → decide the no-consumer policy explicitly (park unprocessed vs a dedicated analytics sink consumer that always consumes) and align the code comment with reality; escalate to architect (matches the "architect follow-up" already noted at :421). Doc-vs-code drift on a "nothing dropped" claim.`

`[MINOR][performance][backend] backend/src/modules/moderation/moderation.service.ts:126-152 → getQueue re-executes the full base CTE (listings⋈animals⋈species over all PENDING_MODERATION) FOUR times per request (page, total, byMarket count, bySlaState count) → correct and non-materialising (the OOM fix holds), but 4× the join at scale → acceptable for MVP volume; note for scale — a single windowed query (COUNT(*) OVER()) or a short-TTL cached count would cut it. Not a blocker.`

`[INFO][correctness][backend] backend/src/modules/moderation/moderation.service.ts:602 → toQueueItem hardcodes assignedTo principalType 'HUMAN' (this.actorView(row.assigned_to, 'HUMAN')) instead of the assignee's real principal_type → cosmetic today (queue assignees are human moderators), but under agent-as-principal (ADR-0006, agent_moderation toggle) an AGENT claimant would be mislabelled HUMAN in the queue view → resolve the real principal_type (as actorOf already does) when the toggle is enabled.`

---

## 4. Forward-compat (main lens — ServiceOffering/ProductOffering absorption)

**Extends cleanly (OK):**
- **Money-as-minor-units** — `price_cents BIGINT` (`database_schema.sql:252`), `amount_minor BIGINT` on payment/txn
  tables (`:449,467`), all NEVER-FLOAT with `>= 0` CHECKs; DTO `priceCents:int`. Consistent; a `monetization_type`
  column (ADR-0014) drops in without touching the money representation. Good.
- **Actor-as-principal** — `users.principal_type` + snapshot columns on `audit_log`, `moderation_decisions`,
  `ownership_transfers` (`:397,543,1162`); `moderation.action` already gates AGENT on the `agent_moderation` toggle and
  snapshots `actor_principal_type/actor_role` at write. The seam is real and used. A future AGENT provider/moderator
  activates by flipping the toggle, not by a rewrite. Good.

**Forward-compat risks:**

`[MAJOR][forward-compat][backend] backend/src/modules/listing/listing.service.ts:146,626 → listing is hard-bound to an animal (getOwnedAnimalForActor is mandatory in create; market is DERIVED from the animal's species via marketOf everywhere) → ADR-0015 `market_scope ∈ {pet,livestock,both}` for species-less offerings is Accepted but has NO column and NO code (marketOf only knows the species→market path) → ServiceOffering/ProductOffering (species-less) cannot be represented or discovered today → this is the exact anti-pattern ADR-0014/0015 must undo. Per ADR-0014 the subtype tables are built when their side ships (so no rewrite of listings), BUT the shared READ paths — contact-reveal, moderation queue, saved-search, analytics — all hardcode `listings`⋈`animals`⋈`species`; generalising discovery+moderation to the polymorphic (offering_type, offering_id) supertype is a moderate rewrite of those read paths → when Offering work starts, land `market_scope` + the offering key first and refactor the shared read/moderation paths behind an Offering read-model before adding a subtype. Escalate sequencing to architect.`

`[MINOR][maintainability][backend] marketOf is duplicated verbatim in listing.service.ts:626 and moderation.service.ts:577, both hardcoding the pet/livestock literals → when market_scope (ADR-0015) lands there are two+ places to change and they can diverge → single-source it (see §3 AnimalService.marketOf finding); this DRY fix also de-risks the ADR-0015 rollout.`

`[INFO][forward-compat][backend] backend/src/modules/identity/dto/identity.dto.ts:15 → the ROLES enum is a single-role model (SetRoleDto is one role, ADMIN-only per active-user #3); ADR-0016 Provider (provider_kind ∈ ORG/INDIVIDUAL/AGENT) and progressive roles[] will need a many-roles seam → not a code bug today; reserve the roles[] shape when ADR-0016 is authored (awaiting security+legal verification matrix). Confirms active-user forward-compat flag #2.`

---

## Backend test probes

> Concrete negative/robustness tests for Phase-3 (`reviewer-qa`/backend to run against the `backend` build, dev-token or
> phone-OTP). Each states surface → setup → assert. Grouped by control.

**A. Contact-exchange (BLOCKER repro + fix-gate)**
1. **Empty-channel repro.** Seller A registers+verifies (phone), creates animal + `sale` listing + photo, submits;
   moderator APPROVEs → ACTIVE. Buyer B `POST /v1/listings/{id}/contact-reveal`. **Assert (current):** `200` with
   `channels === {}`. **Assert (post-fix):** at least one channel present.
2. **No writer today.** `PATCH /v1/me` (valid If-Match) with `{contactPhone:"+7...", showPhone:true}`. **Assert
   (current):** field silently dropped (`forbidNonWhitelisted`), `/me` still has no contact → proves root cause.
   **Post-fix:** persisted (encrypted) and revealed to a buyer.
3. **Prefs gate.** Post-fix: seller sets `showPhone:false, showTelegram:true`; reveal returns telegram only, never phone,
   never email.

**B. AuthZ / IDOR (regression guard — must stay green)**
4. User B `GET /v1/listings/{A-DRAFT-id}`, `/analytics`, `POST .../contact-reveal` on a non-ACTIVE listing →
   **404 no-leak** (not 403). Self-reveal on own ACTIVE listing → **422 SELF_REVEAL**.
5. VETERINARIAN/GROOMER `POST /v1/listings` → **403** (excluded from WRITE_ROLES) — documents the provider dead-end.
6. Non-owner USER `GET /v1/moderation/.../result` on someone else's listing → **403** (M-12).

**C. TOCTOU single-winner (losers)**
7. Two concurrent `POST /v1/listings/{id}/submit` on the same DRAFT (same-ish time) → exactly **one 200, one 409
   LISTING_NOT_DRAFT**; assert only one audit row + no orphan.
8. Concurrent moderator `action` APPROVE by two principals both holding a (racing) claim → exactly one
   `moderation_decisions` row created, loser **409 NOT_LOCK_HOLDER/ITEM_NOT_CLAIMED**; listing ends ACTIVE once.
9. Concurrent `markSold` + `withdraw` on one ACTIVE listing → one wins, the other **409**; final status deterministic.
10. APPROVE a second listing of the same (animal, listing_type) that already has an ACTIVE one → **409
    ACTIVE_LISTING_EXISTS** (uq_active_listing_per_type mapped, not 500).

**D. Idempotency replays**
11. `POST /v1/listings` twice with the **same** `Idempotency-Key` + same body → same 201 body, **one** DB row.
12. Two **concurrent** requests, same key → one runs, the other **409 IDEMPOTENCY_KEY_IN_PROGRESS** + Retry-After.
13. Same key, **different** body → **422 idempotency conflict** (request-hash mismatch).

**E. Quota / flood abuse**
14. One user creates 50 animals then 50 listings in a loop → **all 201 today** (demonstrates the missing quota; assert
    desired: a 429/cap after threshold once implemented).
15. Reveal rate-limit: buyer B reveals up to the pet cap (10/h) → 11th → **429 + Retry-After**; livestock cap 5/h.

**F. Contact-reveal Sybil / cap bypass**
16. Buyer B exhausts the reveal cap → register buyer C, reveal the **same** listing → **succeeds today** (Sybil reset).
    Assert desired (post-fix): a per-seller/per-listing cap and/or account-age gate blocks the enumeration.

**G. Event-seam / integrity**
17. After APPROVE, assert one `outbox_events` row each for `Moderation.Decided` and `Listing.Activated`, both with
    `schema_version=1` + correct `market`, in the same tx as the decision.
18. Force the reveal tx to fail after INCR (fault-injection) → assert no `contact_reveals` row and no
    `ContactReveal.Created` (atomicity), and document that the Redis counter is NOT rolled back (accepted).

**H. Cross-aggregate / forward-compat**
19. `POST /v1/listings` without `animalId` → **400/422** (animal-bound coupling) — proves species-less offerings need
    ADR-0014/0015 before they can exist.
20. Delete/soft-delete an animal that has an ACTIVE listing, then hit the moderation queue / marketOf → confirm the
    direct `animals`⋈`species` raw joins behave identically to AnimalService's rules (drift probe for the ADR-0018 gap).

---

*Scope note:* I audited backend contracts + code only; frontend wiring and live-PG migration idempotency runs are
`требует ручной проверки` for Phase-3. I modified no code, docs, or schema — this file is my sole output.
