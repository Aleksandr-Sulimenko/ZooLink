# ZooLink HYPER³ Audit — Round 3 (Phase 2) · backend-engineer (code lens: concurrency / perf-scale / resilience)

**Date:** 2026-07-08 · **Branch:** `backend` @ `0fcc182` · **Mode:** Research & Hardening (read/reason only; no src/docs/schema/tests touched, no test suite run).
**Method:** independent walk of the guarded-write / tx-boundary / outbox / Redis paths, THEN diffed against `AUDIT3/backend-engineer.md` + `AUDIT2/backend-engineer.md`. Waves A–G changed the module set: `favorite/` and `notification/` now exist, the contact writer exists — so several AUDIT3 dead-feature BLOCKERs are **FIXED-VERIFIED** below. Headline lenses (new) = concurrency/race-storms, perf/N+1/write-on-read, resilience/partial-failure.

Format: `[severity][criterion][axis][state] file:line → problem → fix`. Severity ∈ BLOCKER/MAJOR/SHOULD-FIX/MINOR/INFO. State ∈ NEW/CONFIRMED/REFUTED/SEV-CHG/FIXED-VERIFIED. Strategic tags `[NS]`/`[PERSP]`.

---

## A. Reconciliation with AUDIT3/AUDIT2 (what the waves changed)

- **FIXED-VERIFIED — contact-reveal empty-channels BLOCKER** (AUDIT2 §1 / AUDIT3 §1). `profile.service.ts:61-70` now writes `contact_phone` (crypto.encrypt), `contact_telegram`, and `contact_prefs` via `updateMe`, and records `CONTACT_DISTRIBUTION` consent **in the same tx** (`:85`). `UpdateProfileDto` has `contactPhone`(E.164)/`contactTelegram`/`showPhone`/`showTelegram`. `revealContact` now double-gates on consent AND prefs. The writer exists; the BLOCKER is closed.
- **FIXED-VERIFIED — favorites dead-feature** (AUDIT3 §2). `modules/favorite/*` shipped: owner-scoped CRUD, idempotent add (P2002→return-existing), leak-free 204 remove, visibility gate reuses `assertVisibleToActor`. Correct.
- **FIXED-VERIFIED — notification dead-pipeline / zero-consumer outbox** (AUDIT3 §2/§3). `NotificationConsumer` is registered under `OUTBOX_CONSUMERS` (`notification.module.ts:22`), idempotent INSERT…ON CONFLICT(idempotency_key). The relay is no longer inert for registered events. **SEV-CHG (residual):** events NOT in the registry (`Listing.Activated`, `Listing.Sold`, `ContactReveal.Created`, `Moderation.Escalated`) still hit the `matched.length===0 → mark processed_at` path (`outbox.relay.ts:116`) with no analytics sink → they remain terminal/non-replayable. AUDIT3's "history capture is false" is now **partially** true (notification events real; analytics events still dropped). See D2.
- **FIXED-VERIFIED — `marketOf` raw-join duplication** (AUDIT2 §3 / AUDIT3 §4). D8 removed the private `marketOf`; `revealContact` reads the derived `listings.market` cache (`:583`). BUT see B7 — `transfer.service.ts:669 marketOfAnimal` still does a live `animals⋈species` raw join (a **surviving** cross-aggregate probe not covered by the D8 grep-gate).
- **CONFIRMED — TOCTOU single-winner** across submit/withdraw/markSold/edit-reenqueue/moderation claim+action AND the new transfer accept/decline/cancel/expire (`transfer.service.ts:261,448,491`): status-guarded `updateMany` with `count===1` as the **first** in-tx write, loser rolls back before any audit/history/outbox row. Uniform and correct. Do NOT "fix".
- **CONFIRMED — idempotency in-flight lock, event-envelope completeness, IDOR 404-no-leak.** Unchanged, still solid.
- **CONFIRMED — moderation `getQueue` 4× base-CTE per request** (AUDIT2/3) — still MVP-acceptable; see C4.
- **CONFIRMED — `toQueueItem` hardcodes `assignedTo` principalType 'HUMAN'** (`moderation.service.ts`) — mislabels an AGENT claimant under the toggle. INFO, unchanged.

---

## B. Concurrency / race-storms (new headline)

`[MAJOR][correctness+resilience][new][NEW] transfer.service.ts:161 (consume) vs :179/:200 → claim-code is consumed (atomic Redis GETDEL, single-winner — good) BEFORE the transfer is created, but MULTIPLE failure paths run AFTER the consume: the SELF_TRANSFER check (:183) and the tx INSERT which can fail on uq_owntransfer_one_pending → P2002 → TRANSFER_ALREADY_PENDING (:599). On any of these the single-use code is already DELETED from Redis and is never restored → the recipient's code is silently burned though no transfer exists; they must re-mint. → Move claimCodes.consume INTO the tx (or gate on the one-pending precondition + self-transfer check BEFORE consuming, or re-`SET` the code on a mapped failure). Test: initiate with a valid claimCode against an animal that already has a PENDING transfer → assert 409 AND the code is still redeemable (today: 409 + code gone).`

`[SHOULD-FIX][resilience][new][NEW] outbox.relay.ts:82-84 → claim() does SET attempts = attempts + 1 at CLAIM time (not on failure). A worker crash / lease expiry (60s) between claim and a completed dispatch makes the row re-claim and re-increment attempts with NO real delivery error. Under worker churn a healthy event can reach MAX_ATTEMPTS=8 and be DEAD-LETTERED (backoff.ts:5) though it never actually failed → silent loss of a notification/analytics event. → Separate "claimed" from "failed": increment attempts only in onFailure, or track a delivery_attempts counter distinct from the lease. Test: claim a batch, kill the worker before dispatch completes, restart ×8 → assert the event is NOT dead-lettered (today it is).`

`[SHOULD-FIX][resilience][new][NEW] outbox.relay.ts:80-93,112 → the visibility lease is next_attempt_at = NOW()+60s but processed_at is set only after ALL matched consumers finish. A consumer whose fan-out exceeds 60s (large org, slow PG) lets a second worker/tick re-claim and DOUBLE-DISPATCH the same event. Safe TODAY (NotificationConsumer is idempotent via ON CONFLICT), but the FIRST non-idempotent or side-effecting-outside-PG consumer double-fires. [PERSP] → bound consumer work per event, or make LEASE_SECONDS >> worst-case fan-out, and require every consumer to be idempotent by contract (documented, tested).`

`[MINOR][integrity][new][NEW] listing.service.ts:554 (currentlyGranted, outside tx) vs :589 (tx writes contact_reveals + event) → the ФЗ-152 lawful-basis check and the auditable reveal row are NOT in one consistent snapshot. A seller who withdraws CONTACT_DISTRIBUTION between the check and the row-write still gets a reveal row + emitted lead recorded against withdrawn consent. Window is small and the decrypted channel was already read (inherent read race), but the persisted PROOF row should match the consent it cites. → re-read currentlyGranted inside the tx (pass tx — ConsentService.currentlyGranted already accepts one) before the insert; abort to NO_CHANNELS if withdrawn. Test: interleave a withdrawal between check and commit → assert no contact_reveals row is written. → security (privacy).`

`[MINOR][abuse][new][CONFIRMED] listing.service.ts:573 (dedup check) → :585 (enforceRevealRateLimit INCR) → tx → two concurrent FIRST reveals of the same (viewer,listing) both pass the dedup findFirst (no row yet), both INCR (each consumes a quota unit), one wins the INSERT, the loser hits P2002 → returns dedup channels (:614). The loser burned a quota unit for a reveal that produced no row. Capped/self-inflicted (a viewer racing themselves) but confirms the Redis counter is never compensated on a non-winning path (AUDIT2 test 18). → accept, or move the INCR inside the tx and DECR on P2002. Low priority.`

`[MINOR][integrity][new][NEW] listing.service.ts:779 recomputeMarketForSpecies is NOT transactional with the species-market UPDATE that triggers it, and a listing CREATE for that species concurrent with the recompute reads the pre-flip animal/species market (getOwnedAnimalForActor) → the new listing is written with the STALE market and the recompute (already scanning the old id-set) misses it → listings.market permanently diverges from species.market until the next manual correction. Rare (admin action) but a genuine lost-update. → wrap species-update + recompute in one tx, and/or add a periodic reconcile; note the D3 cache deliberately traded this for cycle-breaking. Test: flip species market concurrently with a listing create for that species → assert final listings.market == species.market.`

`[INFO][maintainability][new][NEW] transfer.service.ts:669 marketOfAnimal → a live animals⋈species $queryRaw survives here (transfer needs the market for its event and has no cached column). Not covered by the D8 grep-gate; it is the one remaining cross-aggregate market probe. Low risk (read-only, event-labelling), but fold into a single AnimalService.marketOf(animalId) read-model when D2/offering work lands so all market derivation is one source.`

---

## C. Performance / N+1 / write-on-read (new headline)

`[SHOULD-FIX][performance][new][NEW] listing.service.ts:288 captureView → every unique-viewer detail GET on an ACTIVE listing issues UPDATE listings SET view_count = view_count + 1 WHERE id = :id. Redis SET NX (30-min) caps it to once-per-viewer-per-window, but a VIRAL listing still takes one single-row UPDATE per distinct viewer → row-level write LOCK serializes those writers on that one hot row (+ WAL + HOT-update churn), degrading the public read path exactly when traffic peaks. [PERSP] cheaper to fix now than post-scale. → move the counter to Redis INCR flushed to PG periodically (or an insert-only listing_views append table aggregated by a worker) so the hot read never contends on the listings row. Test: N concurrent GETs (distinct viewers) on one listing → measure lock_waits on the listings row.`

`[SHOULD-FIX][performance][new][PERSP] notification.consumer.ts:67-68 → materialize() runs preferredLanguage() + loadTemplate() as TWO separate queries PER RECIPIENT, inside the per-recipient loop (:56). For an org fan-out (OwnershipTransfer.Expired → both parties, each possibly an org with many admins) that is N×(2 SELECT + 1 INSERT). loadTemplate is identical for all recipients sharing a language → cache per (name, language) within handle(); batch preferredLanguage with one WHERE id IN (…). MVP-tolerable, but the throughput ceiling of the ONLY event sink. Test: an Expired event to two orgs of K admins → assert query count is O(1)+O(recipients-insert), not O(3·recipients).`

`[MINOR][performance][same][CONFIRMED] animal.service.ts:405 animalIdsForSpecies → findMany selecting ALL animal ids of a species, materialized into a JS array, then listing.service.ts:783 uses it as animal_id IN (…). For a large species ("dog"/"cat") this is a huge id list → a giant IN clause. Already self-documented as a Phase-2 nit (:403). [PERSP] convert recompute to a set-based UPDATE … FROM (SELECT id FROM animals WHERE species_id=…) join before any species grows large.`

`[MINOR][performance][same][CONFIRMED] moderation.service.ts getQueue re-runs the base CTE 4× (page/total/byMarket/bySlaState). Still correct + non-materializing; a single COUNT(*) OVER() window or a short-TTL cached aggregate would quarter the join at scale. MVP-acceptable.`

---

## D. Resilience / partial-failure (new headline)

`[MINOR][integrity][new][NEW] listing.service.ts:286-288 captureView → SET NX succeeds (dedup key claimed) THEN prisma.listings.update throws (PG hiccup). The catch swallows it (correct — never gate the read), but the dedup key now blocks re-counting for the full 30-min window → that view is LOST, not merely deferred. Best-effort counter so severity is low, but under PG pressure the undercount is systematic (fails exactly when load is high). → set the dedup key only AFTER a successful increment (accept a tiny double-count risk instead of a systematic undercount), or use a Redis-side counter (see C1) that has no PG dependency on the read path.`

`[SHOULD-FIX][integrity][new][SEV-CHG] outbox.relay.ts:116-118 → events with no registered consumer (Listing.Activated/Sold, ContactReveal.Created, Moderation.Escalated) are still stamped processed_at with no side effect and become non-replayable. AUDIT3 rated the WHOLE pipeline inert; that is now downgraded (notification events are consumed) but NOT resolved for analytics events — the "nothing dropped / history captured" guarantee is still false for the analytics stream. → register a durable always-consume analytics-sink (parks/persists every event) OR switch the no-consumer policy to leave processed_at NULL / a parked_at so a future sink replays. Escalate policy choice to architect. Guardrail "never prune outbox before an analytics projection" only holds if such a projection is actually planned.`

`[INFO][resilience][new][NEW] Redis-death blast radius (mapped, not a bug): a Redis outage → contact-reveal/transfer/claim-mint rate-limit INCR throws → 500 (fails CLOSED, acceptable); claim-code consume throws → initiate 500 (code NOT consumed, safe); view dedup throws → caught, read still serves. Idempotency-key reservation depends on Redis → unsafe POSTs 500 on Redis-down (fail-closed, correct). PG-death mid-tx → all guarded writes roll back atomically (no half-states). Net: fail-closed posture is sound; the only silent-loss vectors are B2 (attempts churn) and D1 (view undercount).`

`[INFO][maintainability][new][PERSP] notification.module.ts:22-26 → OUTBOX_CONSUMERS is a single-array useFactory (NOT a multi:true provider). A second consumer from another module would OVERRIDE, not append; the module comment acknowledges every future consumer must fold into THIS factory — coupling the notification module to all consumers. Fine for one consumer; when the D2 analytics sink lands, switch to a multi-provider token or a registrar so consumers self-register. [NS] an agent-operated ops layer that adds/removes sinks wants a registration seam, not an edit to one factory.`

---

## E. Trash / adversarial (fuzz) lens

`[MINOR][correctness][trash][NEW] listing.dto.ts:87-89,150-152 priceCents has @IsInt @Min(0) but NO @Max. @IsInt (Number.isInteger) accepts non-safe integers (e.g. 1e21), and price_cents is BIGINT (max ~9.2e18). A body {priceCents: 1e21} passes validation → numeric overflow at PG (22003) → unmapped 500 instead of a clean 422. Values above 2^53 also lose integer precision in JSON.parse before reaching Prisma. → add @Max(<a sane ceiling, e.g. 10^12 kopecks>) to both create and update DTOs. Test: POST/PATCH listing with priceCents=1e21 → assert 422 (today: 500).`

`[INFO][correctness][trash][CONFIRMED] geo bounds are guarded (@Min/@Max ±90/±180 on lat/lng), claim-code normalize() rejects out-of-alphabet chars to a uniform miss, favorites/reveal reject client-supplied userId via the global pipe. TTLs (claim 900s, reveal window, view dedup) are server-constants, not client-controlled. No further boundary-number exposure found beyond priceCents.`

---

## F. Strategic ([NS] agent-as-principal / [PERSP] pay-now debt)

- `[NS]` The transfer/consent/moderation actor seams (`actor_principal_type HUMAN|AGENT`, `SYSTEM_ACTOR_ROLE`+AGENT on lazy expiry) are genuinely programmatic — an agent-operator can drive accept/decline/expire and consent-on-behalf via the service layer with no UI coupling. **Gap:** the outbox-consumer registration (E4 above) and any future agent-driven sink are NOT self-registering; an agent adding an ops sink must edit a factory. Flag for the agent-run roadmap.
- `[PERSP]` Cheapest-now debts, ranked: (1) view_count hot-row → Redis-counter (C1) before any traffic scale; (2) outbox attempts-vs-failure separation (B2) before the worker is horizontally scaled/churned; (3) analytics-sink / no-consumer policy (D2) before outbox rows are pruned; (4) claim-code consume-in-tx (B1) — pure correctness, do now. All are order-of-magnitude cheaper pre-Phase-2 than as a data-repair after launch.

---

## G. Tests to prove each concurrency/resilience finding (Phase 3 implements — do NOT run now)

| # | Finding | Test (surface → setup → assert) |
|---|---|---|
| T1 | B1 claim-code burn | Animal with an existing PENDING transfer; initiate with a valid claimCode → **409 TRANSFER_ALREADY_PENDING** AND the code is still redeemable on a fresh clean animal (today: burned). |
| T2 | B2 attempts churn | Claim a batch, kill worker pre-dispatch, restart ×8 → assert event NOT dead-lettered, delivered once. |
| T3 | B3 double-dispatch | Consumer sleeps > LEASE_SECONDS → assert a second tick does not create a duplicate row (relies on ON CONFLICT). |
| T4 | B4 consent-reveal race | Interleave a CONTACT_DISTRIBUTION withdrawal between the check and commit → assert no contact_reveals row / NO_CHANNELS. |
| T5 | B6 market-cache race | Flip species.market concurrently with a listing create for that species → assert final listings.market == species.market. |
| T6 | C1 view hot-row | N concurrent distinct-viewer GETs on one ACTIVE listing → measure listings-row lock waits; assert acceptable ceiling. |
| T7 | D1 view undercount | Force prisma.update to throw after SET NX → assert (post-fix) the view is retried next request, not lost 30 min. |
| T8 | E1 priceCents overflow | POST/PATCH priceCents=1e21 → **422**, not 500. |
| T9 | D2 analytics drop | Emit Listing.Sold (no consumer) → assert current processed_at set + no sink; post-fix: parked/persisted. |

---

*Scope note:* backend NestJS code + contracts only. I ran no test suite (Phase-3 serializes it), modified no src/docs/schema, and did not commit. Live-PG migration idempotency re-runs and frontend wiring are `требует ручной проверки`. Policy calls (outbox no-consumer/analytics-sink D2; view-counter storage C1) are architect decisions; the ФЗ-152 consent-reveal atomicity (B4) and priceCents overflow (E1) route to security. This file is my only output.
