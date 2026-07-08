# ZooLink HYPER³ Round-3 · Phase 2 — data-analyst (metrics · event taxonomy · marketplace-health · abuse-detection · data-quality)

**Date:** 2026-07-08 · **Branch:** `backend` · **HEAD:** `0fcc182` · **Method:** independent re-derivation from
code first (listing.service view-capture + reveal, outbox relay/types, notification consumer/registry, favorite.service,
claim-code.service, transfer.service rate-limit, getAnalytics, schema/migration ledger), **then** diffed vs
`AUDIT3/data-analyst.md` and `AUDIT2/data-analyst.md`. Grounded in code, not prior audits.

**Finding format:** `[severity][criterion][axis][status] file:line → problem → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO. Criterion ∈ instrumentation·measurability·abuse-detect·trust·privacy·data-quality·forward-compat.
Axis ∈ same|new|trash|strat. Status ∈ NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED. Strategic findings carry `[NS|WW|PERSP]`.
Delegate scope: I modified **no** product code or docs — this file is my sole output. Unverifiable items say `requires manual verification`.

---

## Part 0 — Verified reality baseline (what is actually true in the code now)

| Fact | Verdict | Evidence |
|---|---|---|
| `listings.view_count` column + best-effort deduped increment on public detail read | ✅ **built** | `listing.service.ts:279-292` `captureView`; column mig 0031; `getAnalytics.views = Number(row.view_count)` (`:762`) |
| View capture is a **cumulative scalar counter**, NOT a per-view event/row | ✅ true | only `view_count { increment: 1 }` (`:288`); grep `Listing.Viewed` = 0; no `listing_views` table |
| Contact-reveal deduped + rate-limited + durable row | ✅ built | `revealContact` `:533-626`; `uq_contact_reveals_viewer_listing`; per-market limit pet 10/h, livestock 5/h (`:529,633`) |
| First real outbox consumer exists (NotificationConsumer) | ✅ built | `notification.consumer.ts`; subscribes to registry keys only (`:31`) = Moderation.Decided + OwnershipTransfer.{Initiated,Accepted,Declined,Cancelled,Expired} |
| Analytics value-events have **NO** consumer/projection | ✅ true | registry has no `Listing.Sold`/`ContactReveal.Created`/`Moderation.Escalated`/`Listing.Activated` → relay marks them processed with `matched.length===0` (`outbox.relay.ts:116`) |
| Outbox is **never purged** | ✅ true | grep `DELETE FROM outbox`/prune/purge = 0; only a *comment* guardrail (`notification.consumer.ts:22`) — not enforced |
| OfferingRef seam added to value payloads (schemaVersion 2) | ✅ built | `Listing.Sold` + `ContactReveal.Created` carry `offeringType/offeringId` (`:710,606`); favorites row too (`favorite.service.ts:68`) |
| Value-event **marker** (`valueType`/`valueEvent`) | ❌ absent | grep = 0 → cross-offering funnels still enumerate `event_type` names, not `GROUP BY valueType` |
| Listing-creation rate-limit / per-actor quota | ❌ **absent** | `listing.controller.ts:70` POST has only `Roles`+`IdempotencyInterceptor` (dedups retries, not distinct listings); no INCR/Throttle |
| Favorites/view/reveal fraud signal (event or aggregate) | ❌ absent | detection is raw-table SQL only; no anomaly event, no per-actor rate metric |

---

## Part 1 — DIFF vs AUDIT3 / AUDIT2

### FIXED-VERIFIED

`[CRITICAL→partially-FIXED][measurability][same][FIXED-VERIFIED] listing.service.ts:279-292,762 → AUDIT3's single reserve-now-or-lose-forever item (views funnel-top, GAP-TRACE-006, raised MAJOR→CRITICAL) is now CAPTURED: an ACTIVE-only, seller-self-excluded, Redis-deduped (SET NX EX 1800) atomic increment of listings.view_count on GET /listings/{id}; getAnalytics.views is real (was hard-0). The irreversible-loss clock is stopped — from HEAD forward, detail-view demand is recorded. VERIFIED. BUT it was built as a bare cumulative counter, not a timestamped signal — see the NEW data-quality/abuse findings below; the loss is stopped, the metric is thin.`

`[MAJOR][forward-compat][same][FIXED-VERIFIED] listing.service.ts:606,710 → AUDIT2/AUDIT3 form-now reservation part (1) — polymorphic OfferingRef {offeringType, offeringId} — is now in BOTH value payloads at schemaVersion 2 (additive, no consumer breakage since neither is subscribed). The day a service-booking/order Offering ships, its completed-value event is polymorphically attributable. VERIFIED for the OfferingRef half.`

### CONFIRMED (still true against current code)

`[MAJOR][instrumentation][same][CONFIRMED] outbox.relay.ts:104-118 → the analytics value-event stream is STILL raw-log-only. NotificationConsumer (first consumer) subscribes to transfer/moderation-decision lifecycle events, NOT to Listing.Sold / ContactReveal.Created / Moderation.Escalated / Listing.Activated → those are dispatched with matched.length===0 and marked processed_at=NOW() with a debug log. No counter, no dimensional store, no projection materializes them → sale-count, time-to-sale, reveal-lead metrics remain unqueryable except by scanning outbox_events.payload JSONB directly. Fix: register an append-only analytics_events projection consumer (or a catch-all valueEvent projection) BEFORE any purge exists.`

`[MAJOR][data-quality][same][CONFIRMED] outbox.relay.ts:116 → replay-blindness stands. A no-consumer event is stamped processed_at identically to a delivered one; the relay claim filters processed_at IS NULL (`:87`). An analytics consumer registered LATER will never receive any Listing.Sold/ContactReveal.Created emitted before it existed — history survives in the table but is reachable only by a bespoke payload-backfill script. NotificationConsumer shipping did NOT change this for the analytics stream (it doesn't subscribe to the value events). Fix: register the analytics projection NOW so day-one events are materialized, OR document+test the payload-backfill as the only historical route.`

`[MAJOR][trust][same][CONFIRMED] listing.service.ts:698 → Listing.Sold is still OWNER-SELF-MARKED, unverified (no counterparty confirmation, no proof-of-transaction). The north-star's core value-event conflates "removed from search" with "value delivered" and is gameable → treat MVP sale-count / time-to-sale as LOW-CONFIDENCE; re-anchor on verified completion when Reviews/transaction-proof lands.`

`[CRITICAL][measurability][same][CONFIRMED] whole repo → north-star denominators still absent: no household model (per-household rate uncomputable → use "active animal-owning user" as the documented MVP substitute unit) and no needs taxonomy (do NOT report any share-of-needs number — it would be fabricated). Additive later; no live history lost.`

`[MINOR][privacy][same][CONFIRMED] audit_log ip_address/user_agent → PII-at-rest (ФЗ-152); outbox payloads remain PII-free (pseudonymous UUIDs only — good regression posture). Analytics must NEVER join on audit_log ip/UA. Coordinate legal (TTL/lawful basis) + security (access scope).`

### SEV-CHG

`[SEV-CHG: form-now-reservation → HALF-DONE][forward-compat][same][SEV-CHG] listing.service.ts:704 (+ContactReveal :599) → AUDIT2/AUDIT3 reservation part (2) — a canonical value-event MARKER (envelope valueEvent:true + valueType:'sale'|'booking'|'order', OR a *.Completed naming rule) — was NOT built. OfferingRef (part 1) shipped; the marker did not. So "breadth = one GROUP BY across all completed-value legs" is still impossible: a consumer must hardcode the set {Listing.Sold, Payment.Completed, Booking.Completed…}. Cheap to add to the two existing payloads now (schemaVersion already bumped to 2 for both — a valueType field would have been free in the same bump); a rewrite of every future consumer later. Fix: add valueType to the envelope on the next schema touch.`

### NEW

`[MAJOR][data-quality][new][NEW] listing.service.ts:288 → view_count is a MONOTONIC CUMULATIVE SCALAR — there is no timestamped per-view record. Consequence: the "counts + series-ready (B9)" analytics contract HOLDS for contactReveals (contact_reveals.created_at → any time-bucketed series) but FAILS for views: you can read a lifetime total, but you can NEVER produce a views-over-time series, a daily-unique-viewers curve, a view→reveal conversion cohort, or a per-hour spike. getAnalytics.views (`:762`) is a lifetime number with no time axis. This also disables anomaly/inflation detection (see trash lens). Fix: either (a) an append-only listing_views(listing_id, viewer_key_hash, occurredAt) capture (pseudonymous, ФЗ-152-safe) — the series+abuse source, OR (b) at minimum a coarse daily bucket counter. The dedup Redis key already computes viewerKey — emitting a Listing.Viewed event alongside the increment is the cheap seam.`

`[MAJOR][abuse-detect][new][NEW] listing.controller.ts:70 + listing.service.ts create → LISTING-FLOOD is uncapped and un-instrumented. POST /listings has Roles + Idempotency (dedups a retried identical request, NOT distinct listings) — no per-actor creation rate-limit and no creation-rate metric. One user/agent can mint unlimited DRAFT→PENDING_MODERATION listings, flooding the moderation queue (a DoS-of-moderation vector) with zero analytics visibility. Detection today = counting audit_log action='listing.created' per actor by hand. Fix: (analytics) a per-actor listings-created rate signal + queue-inflow anomaly metric; (control, → security) a creation rate-limit uniform with the reveal/transfer limiter. This is the marketplace-health blind spot most likely to bite at launch. → security`

`[MINOR][data-quality][new][NEW] listing.service.ts:284-291 → view dedup is best-effort and weakens under Redis pressure: a memory-eviction or flush of the 30-min NX key re-opens counting for the same (viewer, listing); a Redis error path (`catch`) simply skips the increment (under-count). So view_count drifts BOTH ways vs truth (evict→over, error→under) and is silently unreconcilable (no per-view ground truth to audit against — see the scalar-counter finding). Acceptable for a soft funnel-top signal; must NOT be a billing input. Fix: document view_count as advisory-only; never let boosted-listings (Phase-2) price or rank on it without the event-level source.`

### REFUTED

`[—][instrumentation][same][REFUTED] The AUDIT2/AUDIT3 premise "ZERO registered OUTBOX_CONSUMERS — the event layer is entirely silent" is now FALSE. NotificationConsumer (notification.consumer.ts) is a real, registered, idempotent consumer (worker graph) materializing IN_APP notification_logs for the moderation-decision + transfer lifecycle. The "silent event layer" is refuted for those events. Residual (narrower, above): the ANALYTICS value events specifically still have no consumer — that is the CONFIRMED finding, not this refuted-broad one.`

---

## Part 2 — NEW AXIS: abuse-detectability (headline)

**Question:** can the event/metric layer DETECT each abuse vector, and what event/column is missing to see it?

| Abuse vector | Detectable today? | Where the signal is / isn't | Missing event/column |
|---|---|---|---|
| **View-count inflation** (bot/IP-rotation/Sybil boosting own listing) | ❌ **No** | Only a cumulative `view_count` scalar; no per-view (viewer, ip, ts) record → cannot separate organic from flood, no velocity, no unique-viewer | `listing_views` append-only (viewer_key_hash, ip_hash, occurredAt) OR `Listing.Viewed` event. → security |
| **Contact-reveal quota-gaming** (post billing-unit fix) | ⚠️ **Partial** | `contact_reveals` rows carry viewer_id/seller_id/listing_id/created_at (durable, timestamped) + per-market hourly INCR cap → row-level SQL CAN spot bursts & viewer↔seller collusion graphs | No built fraud aggregate/event; detection is manual SQL. Add a reveal-velocity + viewer↔seller-collusion metric. |
| **Seller faking own demand** (Sybil accounts revealing seller's own listings) | ⚠️ **Partial** | Detectable via a viewer→seller identity/IP graph over contact_reveals + users.created_at, but no signal computes it | Sybil-cluster metric (shared signup IP / signup velocity); no signup-IP captured for analytics (only PII audit_log). |
| **Listing-flood** (queue DoS) | ❌ **No** | No creation rate-limit, no per-actor creation metric; only audit_log rows | Per-actor creation-rate signal + moderation-queue-inflow anomaly + a creation rate-limit. → security |
| **Favorites inflation** (Sybil ring favoriting) | ⚠️ **Partial** | `favorites` has UNIQUE(user_id, listing_id) (one/user) + user_id + created_at → a burst from freshly-created accounts is visible in raw rows | No favorites_count, no event, no anomaly signal; join to users.created_at is manual. |
| **Claim-code spam / brute-force** | ✅ **Bounded** (control good, signal thin) | Transfer-initiate is per-principal/hour rate-limited (INV-C5-4, transfer.service.ts:146); codes are 80-bit entropy, single-use GETDEL, uniform-422 no-enumeration → brute force infeasible, spam throttled | No redeem-attempt counter (defense-in-depth telemetry). Low priority. |
| **Sybil rings (general)** | ❌ **No** | No signup-velocity metric, no device/IP fingerprint for analytics, no behavioral graph | Signup-velocity + shared-IP-cluster + first-N-actions behavioral signals (all Phase-2 pre-monetization). → security |

**Verdict:** the abuse-detection layer is **structurally thin**. The two vectors that directly corrupt marketplace-health numbers — **view-count inflation** and **listing-flood** — are the LEAST detectable, because both were built as side-effects (a scalar counter; an unlimited create) with no timestamped event. Contact-reveal and favorites are *partially* detectable only because their durable rows happen to carry (actor, ts); nothing computes a signal from them.

---

## Part 3 — Trash lens (adversarial data scenarios → security)

- **T1 — view-count poisoning (metric poisoning).** Rotate IP (or clear session for anon) → each request is a fresh `ip:{ip}` dedup key → unlimited increments of a competitor's OR one's own listing view_count. No cap, no per-view log → invisible. Poisons view→reveal conversion, listing CTR, and any Phase-2 boosted-listing ranking that reads view_count. Chain: inflate own listing → appear popular → win buyer trust. **→ security** (needs event-level capture + IP-cluster cap).
- **T2 — moderation-queue flooding (event flooding).** Script POST /listings in a loop (only Roles+Idempotency gate) → thousands of PENDING_MODERATION rows → drowns human/agent moderators; each also emits nothing that flags the flood. Chain: flood → moderation SLA-escalation (`Moderation.Escalated`) fires en masse → auto-escalation itself becomes the DoS amplifier. **→ security.**
- **T3 — outbox accidental-archive blowup.** No purge + no analytics consumer → outbox_events grows unbounded as an accidental archive that is ALSO unreplayable by a late consumer (processed_at filter). A flood (T2) or a future high-volume event inflates it without bound. Not a security exploit, but a data-quality/ops time-bomb: the moment someone adds a naive `DELETE FROM outbox_events WHERE processed_at < …` retention job (the comment guardrail is not enforced), all pre-projection analytics history is destroyed. Fix: enforce the guardrail in code/ops (a migration comment + a devops runbook line), and land the projection before any purge.
- **T4 — reveal-collusion ring.** N Sybil buyers each reveal a seller's listing (within the hourly cap, spread over time) → seller looks high-demand; or a buyer reveals across many listings to map a seller's whole catalog. Rows are durable+timestamped so it IS reconstructable — but nothing computes the viewer↔seller bipartite-density signal. **→ security** for the ring-detection metric.

---

## Part 4 — STRATEGIC lens (NEW)

`[MAJOR][measurability][strat][NEW][NS] whole event taxonomy → an AI moderator/admin/business-operator can act on the LIFECYCLE stream (Moderation.Decided, Listing.Activated, Moderation.Escalated, OwnershipTransfer.*, Listing.Sold, ContactReveal.Created) — these are machine-readable, in-tx, market-tagged. That part is agent-ready. BUT the ABUSE/HEALTH stream an agent-operator most needs to make autonomous trust-and-safety decisions is HUMAN-ONLY or absent: there is no Suspicious/Anomaly event family, no Listing.Viewed stream, no per-actor rate signal, no Sybil/flood/collusion signal. An AI moderator literally cannot subscribe to "this seller is inflating views" or "this actor is flooding the queue" because no such event exists — it would have to run bespoke SQL. For the agent-run future, the missing layer is a machine-emitted abuse/anomaly event family (Listing.Viewed + Actor.RateExceeded + Suspicious.* with pseudonymous actor + score + reason-code). Cheapest to design now as part of the same envelope. → security co-design.`

`[MAJOR][measurability][strat][NEW][WW] value stream → the metrics let us see PLATFORM-EXTRACTION and SELLER-side proxies (views, reveals, self-marked sold, time-to-sale = sold_at−created_at by market — all market-separated per ADR-0002, good), but the BUYER-WIN side is blind. There is no buyer-outcome signal: no "did the buyer acquire the animal", no review, no transaction confirmation. contact_reveals shows buyer INTENT, not buyer SATISFACTION. So we can compute whether the platform extracted value and whether a seller cleared inventory, but NOT whether both sides won. Match-rate is a one-sided proxy. Fix: reserve a buyer-outcome seam (reveal→outcome feedback, or the Reviews aggregate) so the win-win can be measured, not assumed — do not report "match-rate" as a two-sided-win metric until a buyer-side signal exists.`

`[MAJOR][forward-compat][strat][NEW][PERSP] view-as-counter + no-abuse-events → this instrumentation debt is dramatically cheaper to close NOW, before Phase-2 monetization. Once boosted_listings/premium ship, view_count and reveal-counts become MONEY inputs — at which point (a) inflation directly steals revenue, and (b) past view history for baselining "normal" is unbackfillable (T1). Adding the Listing.Viewed event + per-actor rate signals is a small seam today; retrofitting them after money rides on the numbers means shipping monetization on numbers you cannot trust or defend. Sequence: land the event-level view capture + abuse-event family BEFORE flipping any revenue toggle.`

`[INFO][forward-compat][strat][CONFIRMED][NS] event-catalog.md — Payment.Completed/Failed reserved (Phase-2, gated) is the natural home of the order value-event. Ensure it carries the SAME OfferingRef + the still-missing valueType marker (Part-1 SEV-CHG) so the order leg drops into the north-star without a new taxonomy.`

---

## Part 5 — Probes (deterministic; carry-forward + new)

Carry forward AUDIT2 §A/B/C and AUDIT3 C13 (replay-blindness — still PASSES-the-bug), C14 (consent provenance). New this round:

- **C15 — view-count is scalar-not-series.** GET a listing N times across 3 distinct viewer keys within 30 min → assert view_count == 3 (deduped) AND assert there is NO per-view row/event to reconstruct WHEN the 3 views happened. **Predicted PASS-of-the-gap** → confirms the series-readiness failure for views.
- **C16 — view-count inflation is invisible.** Increment via 50 rotating IPs → assert view_count == 50 and assert no signal/event flags the burst. **Predicted PASS-of-the-gap** → confirms T1. → security.
- **C17 — listing-flood is uncapped.** Create 100 listings as one actor with distinct Idempotency-Keys → assert all 100 succeed (no rate-limit) and no flood metric/event fires. **Predicted PASS-of-the-gap** → confirms T2. → security.
- **C18 — analytics value events have no consumer.** Emit Listing.Sold + ContactReveal.Created, run the relay one tick with NotificationConsumer registered → assert both are marked processed with matched.length===0 (no notification_logs row for them) and no projection table receives them. **Predicted PASS** → confirms the analytics stream is still raw-log-only.
- **C19 — outbox no-purge guardrail is unenforced.** Grep the codebase/migrations/ops for any DELETE/prune of outbox_events → assert the only reference is the comment (`notification.consumer.ts:22`). **Predicted PASS-of-the-gap** → the guardrail is documentation, not a control.

*Scope note:* frontend analytics wiring and any external warehouse are out of scope. Outbox retention policy = none found (comment-only guardrail). Whether Phase-2 Notification/Payment design plans the abuse-event family or buyer-outcome signal = `requires manual verification`. I modified no product code or docs; this file is my sole output.
