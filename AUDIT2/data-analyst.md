# ZooLink HYPER Audit — Phase 2 · data-analyst (instrumentation & measurability, forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** verified my prior 06-30 CRITICALs against
current code (outbox writer/relay/types, listing.service reveal+markSold+getAnalytics, event-catalog spec, schema),
then judged north-star measurability and event-model forward-compat. Grounded in code, not the stale audit.

Finding format: `[severity][criterion][data-analyst] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ instrumentation · measurability · forward-compat · trust · privacy · data-quality.

---

## Part 0 — Fix-status of my prior CRITICALs (verified reality baseline)

| Prior CRITICAL (06-30) | Status | Evidence |
|---|---|---|
| **Event seam emits value-events in-tx with `schemaVersion`/`occurredAt`/`market`** | ✅ **FIXED** | `outbox.service.ts:12-29` stamps the full envelope (schemaVersion/occurredAt/market) centrally, in the caller's tx; `outbox.types.ts:40-52` makes envelope fields required on `OutboxPublishInput`; catalog §1 (`event-catalog.md:26-39`) normative. Producer cannot omit envelope. (commits aa3ae3b/226e024) |
| **`sold_at` / `Listing.Sold` wired (owner-mark-sold)** | ✅ **FIXED** | `listing.service.ts:539-589` `markSold` writes `sold_at` + `is_active=false` in a guarded single-winner `updateMany`, audits, and emits `Listing.Sold` (schemaVersion 1, market, occurredAt=soldAt) **in the same tx**. `schema.prisma:291` `sold_at` column exists. |
| **`contact_reveals` writer + reveal event** | ✅ **FIXED** | `listing.service.ts:479-492` writes a `contact_reveals` row **and** emits `ContactReveal.Created` in ONE tx. Table + indexes exist (`schema.prisma:166-177`). NB event is named **`ContactReveal.Created`** (matches catalog §2 `event-catalog.md:55`), not `Contact.Revealed`. |
| **`views` — any data source now?** | ❌ **NOT FIXED (acknowledged)** | `listing.service.ts:617` `views: 0` hard-coded; `dto:420-425` and `:596` document "no capture source in MVP (GAP-TRACE-006)". No `listings.view_count` column, **no `Listing.Viewed` event**, no impression capture anywhere (grep confirmed). |
| **Outbox marks no-consumer events processed → breaks "history captured"?** | ⚠️ **PARTIALLY** — see F1 | `outbox.relay.ts:112-118` sets `processed_at=now()` even when `matched.length===0`. The row is **not deleted**, so the append-only log persists; but there is **no analytics consumer and no read-model** materializing it. |

**Net:** 3 of 4 prior CRITICALs are genuinely fixed and well-built (in-tx atomicity, full envelope, guarded transitions).
`views` remains uninstrumentable and is now the single biggest measurability hole on an *implemented* surface.

---

## Part 1 — "Analytics history is captured now"? (the outbox-processed nuance)

`[MAJOR][instrumentation][data-analyst] backend/src/lib/outbox/outbox.relay.ts:112 → value-events (Listing.Sold, ContactReveal.Created) are emitted in-tx and the outbox row PERSISTS after processed_at is set (not deleted), so the raw event log IS durable — BUT there is NO registered OUTBOX_CONSUMER (worker.module.ts only runs the relay; grep finds zero consumers), NO analytics/counter read-model, and NO dimensional store. "History is captured" is true only at the raw-JSONB-log level; nothing turns it into a queryable metric. Any future retention/prune of processed outbox rows would silently destroy that history (no such job found → требует ручной проверки on prune policy) → (a) confirm outbox_events is NEVER pruned OR add an append-only analytics_events projection consumer before pruning is introduced; (b) register the analytics/counter consumer the catalog §2 already names for ContactReveal.Created.`

`[MINOR][data-quality][data-analyst] backend/src/lib/outbox/outbox.relay.ts:116 → no-consumer events are logged only at debug and indistinguishable, in the table, from delivered ones (processed_at set either way) → an analyst cannot tell "delivered to a consumer" from "dropped, no consumer" → add a nullable delivered_count / consumer marker, or keep the analytics consumer registered so ContactReveal.Created is never a no-op drop.`

---

## Part 2 — North-star measurability (частота × широта of completed value-events per active pet-household)

North-star (`future-features.md:201`): completed **value-events** (sale / service-booking / order) per active **pet-household** per period; proxy = **share-of-needs-met**. Verdict: **the metric is ~15% instrumentable today.**

`[CRITICAL][measurability][data-analyst] backend/src/modules/listing/listing.service.ts:577 → only the SALE leg of the value-event family is observable (Listing.Sold). Service-booking and order value-events DO NOT EXIST (no ServiceOffering/ProductOffering/Booking aggregate — active-user.md confirms unbuilt) → "частота × широта" needs all three completed-value types; 2 of 3 are uninstrumentable → the north-star numerator is structurally incomplete until the Offering seam (ADR-A/D) lands. Instrument a unified value-event family form-now (see Part 3) so breadth is countable the day each Offering type ships.`

`[CRITICAL][measurability][data-analyst] backend/prisma/schema.prisma (users) → "household" is NOT modeled anywhere (grep: only the future-features.md mention). Users are individuals; Animal is per-owner. The north-star DENOMINATOR is "active pet-household" and cannot be computed — there is no household entity, no grouping key, no way to dedupe co-owners → the per-household rate is uninstrumentable → reserve a household/account grouping key now (even a nullable household_id on users) or explicitly define the MVP unit as "active pet-owning user" and record that substitution as a metric-definition decision (avoids silent drift).`

`[CRITICAL][measurability][data-analyst] whole repo → the proxy "share-of-НУЖД-met" needs a DENOMINATOR of a pet's NEEDS (vet/grooming/food/training/boarding over its lifecycle). Needs are not modeled at all — no need/lifecycle catalog, no per-animal need state → "доля потребностей закрытых на ZooLink" is uncomputable → this is inherently blocked until the Animal-as-backbone lifecycle (future-features.md:204) exists; flag as not-instrumentable-in-MVP and do not report a share-of-needs number until a needs taxonomy exists (reporting one would be a fabricated metric).`

`[MAJOR][trust][data-analyst] backend/src/modules/listing/listing.service.ts:554 → Listing.Sold is OWNER-SELF-MARKED and unverified (no counterparty confirmation, no transaction proof) → as the north-star's core value-event it is gameable (mark-sold to boost own stats / off-platform-completed sales invisible) and conflates "removed from search" with "value delivered" → treat MVP time-to-sale / sale-count as a LOW-CONFIDENCE proxy; when Reviews/proof-of-transaction (ADR-E, future-features.md:177) lands, re-anchor the value-event on verified completion.`

`[MAJOR][measurability][data-analyst] backend/src/modules/listing/listing.service.ts:617 → with views hard-0 and no Listing.Viewed/impression event, the marketplace funnel is missing its TOP (impression→detail-view→reveal→sale). Only reveal→sold is observable → search→contact conversion, listing CTR and true match-rate are uncomputable; view history is IRRECOVERABLE (future-features.md:201) → emit a coarse Listing.Viewed value-event (deduped per viewer/day) or a view_count counter NOW; every day unshipped is permanently lost funnel-top data.`

---

## Part 3 — FORWARD-COMPAT of the event model (unified *.Completed family across Offering types)

`[MAJOR][forward-compat][data-analyst] backend/src/lib/outbox/outbox.types.ts:40 → the outbox MECHANISM extends cleanly (generic aggregateType/aggregateId strings + envelope), and the envelope carrying market from first capture (event-catalog.md:31-39) is exactly right for ADR-0002 ecosystem funnels. BUT there is NO polymorphic OfferingRef in payloads (Listing.Sold payload = {listingId, sellerId} — listing-specific, listing.service.ts:581) and NO canonical "value-event family" marker/naming → cross-Offering funnels (sale+booking+order as one *.Completed family) will need per-event-type special-casing and a retrofit convention → reserve FORM-NOW in the envelope: (1) an optional OfferingRef {offeringType, offeringId} so any completed value-event is polymorphically attributable; (2) a canonical value-event convention (a *.Completed naming rule OR an envelope valueEvent:true + valueType:'sale'|'booking'|'order') so breadth is one GROUP BY, not N producers. Cheap as a seam now, a rewrite of every consumer later.`

`[MAJOR][forward-compat][data-analyst] backend/src/lib/outbox/outbox.types.ts:30 → EventMarket is only 'pet'|'livestock'|null, but the ecosystem vision needs market_scope 'pet'|'livestock'|BOTH for cross-market service/goods verticals (future-features.md:160,163 ADR-B) → today's binary market cannot tag a cross-market Offering event → widen the envelope's market/market_scope form-now (or document that services/goods events use null until ADR-B), so ecosystem discovery/analytics don't blend markets (ADR-0002) or lose the both-scope.`

`[MINOR][privacy][data-analyst] backend/src/lib/audit/audit.types.ts:34-35,74-75 → audit_log stores raw ip_address/user_agent (PII-at-rest, ФЗ-152) exposed via admin audit DTO (audit-log.dto.ts:147-148). The OUTBOX payloads themselves are clean (only pseudonymous userIds/sellerIds — good) → keep event payloads PII-free (they are); for audit_log ip/UA, coordinate legal on lawful-basis + retention TTL and security on access-scope. Analytics must NEVER join on audit_log ip/UA — use pseudonymous IDs only.`

`[INFO][forward-compat][data-analyst] docs/specs/event-catalog.md:56 → Payment.Completed/Failed already reserved (Фаза-2, gated) — good; it is the natural home of the order value-event. Ensure when built it carries the same OfferingRef + valueType so the order leg of the north-star drops in without a new taxonomy.`

---

## Analytics probes (concrete checks for Phase-3 reviewer-qa / backend to run)

> Format: **assert** — how to run against the `backend` build (dev-token or phone-OTP). Each is deterministic.

**A. In-tx emission on every value-state change (atomicity — the fix I most want re-proven).**
1. **Listing.Sold emitted in-tx.** markSold an ACTIVE listing → assert exactly ONE `outbox_events` row with `event_type='Listing.Sold'`, `aggregate_id`=listingId, created in the SAME tx as `listings.sold_at` (query both; sold_at non-null ⟺ event row present). Then force the tx to roll back (e.g. duplicate/concurrent mark-sold losing the single-winner race, service.ts:556) → assert NO orphan Listing.Sold row and NO sold_at. Proves atomic seam.
2. **ContactReveal.Created emitted in-tx.** POST contact-reveal (buyer≠seller, ACTIVE) → assert one `contact_reveals` row AND one `ContactReveal.Created` outbox row, same viewer/seller/listing. Trigger rate-limit rejection (429, service.ts:516) → assert NEITHER row written (gate precedes tx).
3. **No value-event on failed precondition.** contact-reveal on non-ACTIVE (404) and self-reveal (422) → assert zero outbox rows and zero contact_reveals rows.

**B. Envelope completeness (schema_version + market + occurredAt on 100% of events).**
4. For EVERY row in `outbox_events`: assert `payload->>'schemaVersion'` is a number, `payload->>'occurredAt'` is ISO-8601, and `payload ? 'market'` is present (value ∈ {pet, livestock, null}). Zero rows may miss any envelope key. (Guards producer drift — the whole point of centralizing in OutboxService.publish.)
5. `market` correctness: create a pet-species listing + a livestock-species listing, drive each to Sold → assert the two Listing.Sold rows carry `market='pet'` and `market='livestock'` respectively (no cross-join to species needed downstream).
6. `occurredAt` == domain time, not relay time: assert Listing.Sold `occurredAt` equals `listings.sold_at`, and ContactReveal.Created `occurredAt` equals `contact_reveals.created_at` (both pass revealedAt/soldAt explicitly).

**C. Funnel-completeness / measurability assertions (these should FAIL today — they document the gaps).**
7. **views funnel-top gap.** GET `/v1/listings/{id}/analytics` after N public GETs of the listing → assert `views` reflects N. **Predicted FAIL** (`views:0` always) → documents GAP-TRACE-006; view history irrecoverable.
8. **value-event breadth gap.** Enumerate distinct `event_type` where the event is a completed value-event → assert the set == {sale, booking, order} legs. **Predicted FAIL**: only `Listing.Sold` exists → 1 of 3 north-star legs instrumented.
9. **household denominator gap.** Assert a `household_id` (or documented substitute unit) exists to group value-events per household. **Predicted FAIL**: no household model → north-star rate uncomputable; forces the metric-definition decision.
10. **no-consumer drop visibility.** Run the relay one tick after emitting ContactReveal.Created with zero consumers registered → assert `processed_at` is set AND the row still exists (history durable). Then assert there is a registered analytics consumer OR a projection table. **Predicted: row persists but NO consumer/projection** → confirms Part-1 F1 (history is raw-log-only).
11. **forward-compat OfferingRef reservation.** Assert Listing.Sold payload carries a polymorphic offering reference (offeringType+offeringId) and a value-event marker. **Predicted FAIL** (payload is listing-specific) → confirms the form-now seam recommendation.
12. **PII-free events.** Scan all `outbox_events.payload` for phone/email/ip/user_agent/full_name substrings → assert NONE present (only pseudonymous UUIDs). Guards ФЗ-152 in the event stream (should PASS today — regression guard).

---

*Scope note:* frontend analytics/event wiring and any external warehouse are out of scope (`требует ручной проверки`).
Outbox-row prune/retention policy is `требует ручной проверки` (none found in code — the durability of captured history depends on it). I modified no product code or docs; this file is my sole output.
