# ZooLink HYPER² Audit — Round 2 · data-analyst (instrumentation & measurability, forward-compat lens)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) · **Method:** independent re-derivation
from code first (outbox writer/relay/types, listing.service reveal+markSold+getAnalytics, schema, event-catalog, users
consent columns, ADR-0014/0015), **then** diffed against my round-1 `AUDIT2/data-analyst.md`. Grounded in code, not the prior audit.

**Finding format:** `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ instrumentation · measurability · forward-compat · trust · privacy · data-quality.
Delegate scope: I modified **no** product code or docs — this file is my sole output. Items I could not fully verify say `требует ручной проверки`.

---

## Part 0 — Verified reality baseline (what is actually true in the code now)

| Fact | Verdict | Evidence |
|---|---|---|
| Event envelope stamps `schemaVersion` + `occurredAt` + `market` centrally, in-tx | ✅ present | `outbox.service.ts:12-29` writes envelope-first; `outbox.types.ts:40-52` makes them required on `OutboxPublishInput` |
| Value events emitted in-tx | ✅ present | `Listing.Sold` (`listing.service.ts:574-583`), `ContactReveal.Created` (`:483-490`), `Moderation.Decided`/`Listing.Activated` (`moderation.service.ts:422-445`), `Moderation.Escalated` (`moderation-escalation.service.ts:92`) |
| Durable value sources exist independent of the event stream | ✅ present | `listings.sold_at` column; `contact_reveals` table (`database_schema.sql:975-984`) |
| `views` capture source | ❌ absent | `listing.service.ts:617` `views: 0` hard-coded; no `listings.view_count` column (schema confirmed), no `Listing.Viewed` event (grep = 0) |
| Registered `OUTBOX_CONSUMERS` (any consumer/materialization) | ❌ **ZERO** | grep across `backend/src`: only the token def, the `@Optional()` inject (`outbox.relay.ts:44`), and comments — **no `provide: OUTBOX_CONSUMERS` anywhere** |
| Outbox prune/retention/purge job | ❌ none | grep `DELETE FROM outbox`/purge/prune = 0; the scheduler's `RetentionService` is listing-expiry, not outbox purge |
| `household` model | ❌ absent | grep across code+schema+specs = 0 hits |
| booking / order aggregates or events | ❌ absent | no booking/orders tables; `goods_marketplace`/`service_marketplace` are seeded FORM-only toggles |
| Offering polymorphic seam | 📄 Accepted, not built | ADR-0014 (`ECOSYSTEM_ADR_PLAN.md:10`), ADR-0015 `market_scope∈{pet,livestock,both}` (`0015-*.md:77`) — no table yet |
| promo/marketing consent | ⚠️ flag only | `users.notification_prefs` JSONB default `{"email":true,"sms":true,"promo":false}` (`database_schema.sql:124`); **no consent provenance, no audit of pref change** |

---

## Part 1 — Diff vs round-1 (`AUDIT2/data-analyst.md`)

### CONFIRMED (round-1 finding stands, re-verified against current code)

`[MAJOR][instrumentation][CONFIRMED] backend/src/lib/outbox/outbox.relay.ts:112-118 → value events (Listing.Sold, ContactReveal.Created, Moderation.*) are emitted with a correct in-tx envelope, but there is ZERO registered OUTBOX_CONSUMER and NO analytics/counter/read-model materializing them. "Analytics history is captured" is true only at the raw-JSONB-log level (rows persist — no purge job found), nothing turns it into a queryable metric → (a) register the analytics/counter consumer event-catalog §2 already names for ContactReveal.Created; (b) confirm outbox_events is NEVER pruned before a projection exists.`

`[MINOR][data-quality][CONFIRMED] backend/src/lib/outbox/outbox.relay.ts:116 → a no-consumer event (matched.length===0) is marked processed_at identically to a delivered one, logged only at debug → in-table you cannot distinguish "delivered" from "dropped, no consumer" → add a delivered/consumer marker, or keep the analytics consumer registered so ContactReveal.Created is never a silent no-op.`

`[MAJOR][measurability][CONFIRMED] backend/src/modules/listing/listing.service.ts:577 → only the SALE leg of the value-event family is observable. Service-booking and order value-events DO NOT EXIST (no Booking/Offering aggregate) → "частота × широта" needs all three; 2 of 3 uninstrumentable until the Offering seam (ADR-0014) lands → reserve a unified value-event family form-now so breadth is countable the day each Offering type ships.`

`[CRITICAL][measurability][CONFIRMED] backend/prisma/schema.prisma (users) → "household" is not modeled anywhere (grep = 0). The north-star DENOMINATOR "active animal-household" cannot be computed — no household entity, no grouping key, no co-owner dedup → reserve a nullable household/account grouping key now, OR explicitly define the MVP unit as "active animal-owning user" and record that substitution as a metric-definition decision (prevents silent drift).`

`[CRITICAL][measurability][CONFIRMED] whole repo → the proxy "share-of-needs-met" needs a per-animal NEEDS denominator (vet/grooming/food/training/boarding lifecycle). Needs are not modeled → do NOT report any share-of-needs number until a needs taxonomy exists (reporting one would be a fabricated metric).`

`[MAJOR][trust][CONFIRMED] backend/src/modules/listing/listing.service.ts:554-583 → Listing.Sold is OWNER-SELF-MARKED, unverified (no counterparty confirmation, no transaction proof) → the north-star's core value-event is gameable and conflates "removed from search" with "value delivered" → treat MVP sale-count/time-to-sale as LOW-CONFIDENCE; re-anchor on verified completion when Reviews/proof-of-transaction lands.`

`[MAJOR][forward-compat][CONFIRMED] backend/src/lib/outbox/outbox.types.ts:6-14,40-52 → the outbox MECHANISM extends cleanly (generic aggregateType/aggregateId + envelope) and market-from-first-capture is exactly right, BUT there is no polymorphic OfferingRef in payloads (Listing.Sold payload is listing-specific, listing.service.ts:581) and no canonical value-event marker → cross-Offering funnels (sale+booking+order as one family) will need per-type special-casing → reserve FORM-NOW: (1) optional OfferingRef {offeringType, offeringId}; (2) a value-event convention (envelope valueEvent:true + valueType:'sale'|'booking'|'order', OR a *.Completed naming rule) so breadth is one GROUP BY, not N producers.`

`[MINOR][privacy][CONFIRMED] backend/src/lib/audit/audit.types.ts + audit-log.dto.ts → audit_log stores raw ip_address/user_agent (PII-at-rest, ФЗ-152) exposed via admin DTO; OUTBOX payloads themselves are clean (pseudonymous IDs only — good) → keep event payloads PII-free (they are); analytics must NEVER join on audit_log ip/UA; coordinate legal (lawful basis + TTL) + security (access scope). требует ручной проверки on retention TTL.`

`[INFO][forward-compat][CONFIRMED] docs/specs/event-catalog.md:56 → Payment.Completed/Failed reserved (Фаза-2, gated) — the natural home of the order value-event; ensure it carries the same OfferingRef + valueType so the order leg drops in without a new taxonomy.`

### SEV-CHG

`[SEV-CHG: MAJOR→CRITICAL][measurability][SEV-CHG] backend/src/modules/listing/listing.service.ts:617 → views hard-0, no Listing.Viewed/impression event, no view_count column (GAP-TRACE-006). Round-1 rated this MAJOR; I raise it to CRITICAL. Rationale: unlike every other gap here, this is (a) on an ALREADY-LIVE surface (listings are viewable now), (b) TRULY irreversible — an impression not captured is gone forever, no backfill possible, and (c) the funnel TOP: without it search→contact conversion, listing CTR and true match-rate are all uncomputable. Every day unshipped is permanently-lost funnel-top data → emit a coarse deduped Listing.Viewed (per viewer/day) OR a listings.view_count counter NOW. This is the single reserve-now item where delay = irreversible loss.`

### NEW (not raised in round-1)

`[MAJOR][forward-compat][NEW] backend/src/lib/outbox/outbox.relay.ts:80-93 → the relay's claim query filters processed_at IS NULL. Because a no-consumer event is stamped processed_at=NOW() (line 112), an analytics consumer REGISTERED LATER will NEVER receive any event emitted before it existed — the relay skips all already-processed rows. So "just add the analytics consumer in Phase 2" does NOT backfill history; the raw rows survive in outbox_events (payload intact) but are reachable only by a bespoke replay script reading the table directly. Round-1 said "no read-model"; this is the sharper mechanism: adding a consumer late ≠ replay → EITHER register a catch-all analytics projection consumer NOW (so the log is materialized from day one), OR add an explicit, tested backfill path (SELECT ... FROM outbox_events reading payload) and document it as the only route to historical events. Combined with the no-purge fact, outbox_events is silently doubling as an unbounded accidental archive that is unreplayable by the normal path.`

`[MAJOR][privacy][NEW] backend/src/... (users.notification_prefs) → the retention/lifecycle marketing engine growth will build needs PROVABLE consent under ФЗ-38 «О рекламе». Today promo consent is a single mutable JSONB flag notification_prefs.promo (default false — good opt-in posture), but there is NO consent PROVENANCE (grant timestamp, policy/offer version) and NO audit of pref changes (grep: only admin-reset and retention-reset write notification_prefs — no user self-service path and no consent-change audit row) → when a promo/retention campaign later sends to a user, the platform cannot prove WHEN and to WHAT version they consented (ФЗ-38 burden of proof is on the sender). This is prospective loss: consent granted without provenance now is unreconstructable later → reserve a consent seam form-now — a consent-grant record (subject, purpose=promo, granted_at, policy_version, withdrawn_at) or at minimum audit every notification_prefs.promo transition. Coordinate legal (ФЗ-38 lawful basis) + security (retention). требует ручной проверки on whether Notification-domain (Phase 2) plans this.`

### REFUTED

`[—][measurability][REFUTED] backend/src/lib/outbox/outbox.service.ts:12-20 → the round-2 hot-spot premise "market_scope missing from the event envelope, so pet/livestock cannot be separated in analytics" is FALSE for the events that exist today. OutboxService.publish stamps market into every payload from first capture (outbox.service.ts:18; envelope required by outbox.types.ts:47), and Listing.Sold carries the correct pet/livestock value derived from species (verified: marketOf() at listing.service.ts:627). ADR-0002 separation IS preserved in the event stream. The market-separation concern is therefore refuted as a present gap. Residual (below) is only the future 'both' scope for species-less offerings — a forward-compat reservation, not a current break.`

`[MAJOR][forward-compat][CONFIRMED] backend/src/lib/outbox/outbox.types.ts:30 → residual of the above: EventMarket = 'pet'|'livestock'|null, but ADR-0015 (Accepted 2026-07-01, 0015-market-scope-refines-0002.md:77) ratifies market_scope∈{pet,livestock,both} for species-less offerings (services/goods/consultations). Today's binary type cannot tag a both-scope Offering event → widen the envelope to carry market_scope with 'both' form-now (or document that species-less events use null until the Offering seam ships), so ecosystem analytics neither blend markets (ADR-0002) nor lose the both-scope.`

---

## Part 2 — North-star measurability, re-scored

North-star (`future-features.md:201`, accepted 2026-06-30): **frequency × breadth** of completed value-events (sale / service-booking / order) **per active animal-household** per period; proxy = **share-of-needs-met**.

Component-by-component instrumentability **today**:

| North-star component | State | Instrumentable? |
|---|---|---|
| Market split (ADR-0002) in the value stream | envelope `market` from first capture | **100%** |
| Value-event: **sale** | `listings.sold_at` + `Listing.Sold` (durable, but self-marked/low-confidence) | ~**80%** (capture yes; trust caveat) |
| Value-event: **service-booking** | no aggregate, no event | **0%** |
| Value-event: **order** | no aggregate, no event (Payment.Completed reserved, gated) | **0%** |
| **breadth** (across offering types) | single offering type; Offering seam accepted-not-built; no value-event family marker / OfferingRef | **0%** |
| **household** denominator | not modeled anywhere | **0%** |
| **share-of-needs** proxy | no needs taxonomy | **0%** |
| Leading indicator: contact-reveal | `contact_reveals` table + `ContactReveal.Created` (durable) | **100%** (funnel step, not a completed-value leg) |
| Funnel TOP: **views/impressions** | hard-0, irreversible | **0%** |

**Reassessed headline: ~18% instrumentable** (round-1 said ~15%). I nudge it *up* slightly — the envelope (market/schemaVersion/occurredAt) and two genuinely durable value sources (`sold_at`, `contact_reveals`) are stronger forward-compat foundations than 15% implies. But this 18% is **foundation-weighted**: the north-star's two *defining* axes — **breadth** and **household** — are BOTH 0%, and the metric is multiplicative, so **the north-star ratio as literally defined is 0% computable today.** What can honestly be reported now is a *single-market, single-offering, per-user* proxy: sale count + contact-reveal count by market. Anything called "share-of-needs" or "per-household" would be fabricated.

---

## Part 3 — What is irreversibly lost (the forward-compat verdict)

**Truly irreversible (loss happening now):**
1. **Views / impressions** — no capture anywhere on a live surface. Every impression now is permanently gone. This is the ONE item where "reserve now" is not optional. Reserve = cheap (`listings.view_count` counter OR deduped `Listing.Viewed`); delay = irreversible funnel-top loss.

**Prospective loss (unreconstructable if not captured at the moment of the act):**
2. **Promo consent provenance** (ФЗ-38) — consent granted without a timestamped, versioned record cannot be reconstructed later. Capture at grant time or lose the proof.

**NOT irreversibly lost (recoverable / additive later, contra the round-2 premise):**
- **sale & contact history** — durable in `listings.sold_at` + `contact_reveals` + persisted `outbox_events` rows (no purge). Recoverable.
- **outbox event history** — physically persists, BUT is **unreplayable by a later-added relay consumer** (processed_at filter) → recoverable only via a bespoke payload-backfill. Becomes irreversible IF a purge is ever added before a projection exists (currently none — safe, but fragile).
- **household / booking / order / breadth / needs** — additive later; no live history to lose because the features/grouping don't exist yet. The cost of deferral is a schema/seam reservation (household key, OfferingRef, value-event marker, market_scope 'both'), not lost data.

**Reserve-now priority (cheap now, rewrite/loss later):** (1) views capture [irreversible] → (2) OfferingRef + value-event-family marker + market_scope 'both' in the envelope [ADR-0014/0015 anti-rewrite] → (3) household grouping key OR documented substitute unit → (4) consent provenance seam [ФЗ-38].

---

## Part 4 — Analytics probes (deterministic; carry forward from round-1, still valid)

Reuse round-1 probes A/B/C (`AUDIT2/data-analyst.md` §"Analytics probes"): in-tx emission (A1-A3), envelope completeness on 100% of rows (B4-B6), and the gap-documenting FAILs (C7 views, C8 value-event breadth, C9 household, C10 no-consumer drop, C11 OfferingRef, C12 PII-free). Two additions this round:
- **C13 — replay-blindness (NEW).** Emit an event with zero consumers → relay one tick → register a consumer → relay again → assert the consumer received **nothing** (processed_at already set). **Predicted PASS of the bug** → confirms adding a consumer late does not backfill; only a direct payload replay does.
- **C14 — consent provenance (NEW).** Assert a consent-grant record (subject/purpose/granted_at/policy_version) OR an audit row exists for a notification_prefs.promo transition. **Predicted FAIL** → confirms the ФЗ-38 provenance gap.

*Scope note:* frontend analytics wiring and any external warehouse are out of scope. Outbox prune policy = none found (`требует ручной проверки` on any future ops runbook). Whether Notification-domain Phase-2 design already plans consent provenance = `требует ручной проверки`.
