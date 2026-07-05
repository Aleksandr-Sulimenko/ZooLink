---
version: "1.0"
lastUpdated: "2026-06-17"
author: "Architecture Review Board"
status: "Approved"
---

# Spec: Domain Event Catalog & Outbox Relay Contract

## Outcome
Make the event-driven seams implementable. Defines (1) the **outbox relay contract** (how `outbox_events` is
drained), (2) the **MVP event catalog** (every event a producer writes and who consumes it), and (3) the
**event → notification** mapping. Without this a backend dev cannot build the worker (ADR-0009) or the
notification flow.

## 1. Outbox relay contract
- **Producer:** within the same DB transaction that mutates an aggregate, the domain writes a row into
  `outbox_events(aggregate_type, aggregate_id, event_type, payload)` (transactional outbox — atomic with the change).
- **Relay:** the background `worker` (ADR-0009) polls `outbox_events WHERE processed_at IS NULL`
  (index `idx_outbox_unprocessed`) every `OUTBOX_POLL_MS` (default 1000 ms), ordered by `created_at`, in batches.
  Optionally woken by `pg_notify('outbox', ...)`. After a consumer succeeds it sets `processed_at = now()`.
- **Delivery semantics:** **at-least-once.** Consumers MUST be **idempotent** (key on `outbox_events.id` or a
  natural idempotency key). A failed handler leaves `processed_at` NULL → retried with capped exponential backoff;
  after `OUTBOX_MAX_ATTEMPTS` (default 10) the row is parked (`processed_at` set + alert) for manual inspection.
- **Ordering:** per-`aggregate_id` order is preserved by processing a single aggregate's events sequentially.
- **Payload envelope:** JSONB; every payload carries the envelope fields `schemaVersion` (number; bump on a
  payload-shape change), `occurredAt` (ISO-8601 domain occurrence time) and `market` (`pet`|`livestock` per
  ADR-0002, or `null` for a market-agnostic event), alongside the event's domain fields. `aggregate_id` and the
  row id (the event id) are columns on `outbox_events`. Envelope keys use the API `camelCase` convention; the
  `OutboxService.publish` writer stamps them so a producer cannot omit them.

> **(round-N, normative — event envelope `market`/`schemaVersion`/`occurredAt`, audit 2026-06-30) WHAT:** the
> required payload envelope now explicitly lists `schemaVersion`, `occurredAt` and **`market`** (the last was
> not previously named), and pins them to `camelCase`, stamped centrally by the outbox writer.
> **WHY:** the analytics/notification consumers (and Part B marketplace-health metrics by market) need the
> market on every event without re-joining species per event; capturing it from the first event means history
> is never un-attributable. `schemaVersion`/`occurredAt` were already implied by §1 but unenforced in code.
> **WHY-BETTER-for-the-whole-project:** a single writer-stamped envelope keeps producers honest (no per-call
> drift), preserves ADR-0002 market separation in the event stream, and makes the deferred consumers a pure
> add-on — they read a complete envelope the day they are registered. RU mirror updated.

## 2. MVP event catalog

| event_type | aggregate_type | Producer | Payload (key fields) | Consumers (action) |
|---|---|---|---|---|
| `Listing.Submitted` | Listing | listing module (DRAFT→PENDING_MODERATION) | listing_id, seller_id | moderation (enqueue), notification (none) |
| `Moderation.Decided` | Listing/Animal | moderation module | entity_type, entity_id, decision (APPROVED/REJECTED/CHANGES_REQUESTED), reason | listing (apply status), **notification (notify owner)** |
| `Moderation.Escalated` | Listing | moderation **SLA job** (worker) | entityId, market, waitingSeconds, slaState | **notification (notify ADMIN)**. Emit-only in 4c (admin fan-out is the notification consumer). The job **never** mutates `status`/`moderation_status` — item stays PENDING_MODERATION (M-13). **Idempotent:** emitted **once** per overdue item (`listings.escalated_at` marker, set in the same tx as the outbox write); reset on re-enqueue (M-14/4d). |
| `Listing.Activated` | Listing | listing module (→ACTIVE) | listing_id, seller_id | search-index (publish), notification (notify owner) |
| `Listing.Expired` | Listing | worker (duration elapsed) | listing_id, seller_id | search-index (remove), **notification (notify owner)** |
| `Listing.Sold` | Listing | listing module (owner marks sold, MVP) | listing_id, seller_id, **offeringType, offeringId** (v2) | search-index (remove), notification (notify owner) |
| `Listing.Deactivated` | Listing | listing/moderation module | listing_id, reason | search-index (remove), notification (if moderator-removed) |
| `User.Registered` | User | identity module | user_id | notification (welcome/verify — SMS handled inline) |
| `ContentReport.Filed` | ContentReport | moderation module | report_id, entity_type, entity_id | moderation (enqueue) |
| `ContentReport.Actioned` | ContentReport | moderation module | report_id, target, action | listing (deactivate target), **notification (notify reporter+owner)** |
| `ContactReveal.Created` | Listing | contact module | listing_id, viewer_id, seller_id, **offeringType, offeringId** (v2) | analytics/counter (rate-limit + owner stats) |
| `OwnershipTransfer.Initiated` | OwnershipTransfer | animal/transfer module (T1) | transferId, animalId, fromUserId, fromOrganizationId, toUserId, toOrganizationId | **notification (notify to-party)** |
| `OwnershipTransfer.Accepted` | OwnershipTransfer | animal/transfer module (T2) | (as above) | **notification (notify from-party / initiator)** |
| `OwnershipTransfer.Declined` | OwnershipTransfer | animal/transfer module (T3) | (as above) | **notification (notify from-party / initiator)** |
| `OwnershipTransfer.Cancelled` | OwnershipTransfer | animal/transfer module (T4) | (as above) | **notification (notify to-party)** |
| `OwnershipTransfer.Expired` | OwnershipTransfer | animal/transfer module (T5, lazy-on-read) | (as above) | **notification (notify BOTH parties)** |
| `Payment.Completed` / `Payment.Failed` | Payment | payment module | **Фаза 2+ (gated `feature_toggles.payments`)** | listing (SOLD), notification |

> Producers/consumers are **modules within the monolith** (ADR-0009), not microservices. "Consumer" = an
> in-process handler subscribed to the relayed event.

> **(round-N, normative — polymorphic value-event subject, ADR-0018 §Amendment D5 / ADR-0014 OfferingRef seam) WHAT:** the value-signal events `Listing.Sold` and `ContactReveal.Created` now carry `offeringType` (enum, default `ANIMAL_LISTING`) and `offeringId` (the subject id; == `listing_id` for `ANIMAL_LISTING`) in their payload, and their `schemaVersion` is bumped **1 → 2** (payload-shape change per §1). **WHY:** the analytics/marketplace funnel must eventually span *all* offering subtypes (services, goods, expertise — ADR-0014), not just animal listings; without a subject discriminator on the value events, a later offering type would either be invisible to the funnel or force a breaking event rewrite. **WHY-BETTER:** the addition is purely additive (existing consumers keep reading `listingId`/`sellerId`); the notification consumer (ADR-0021) does not subscribe to these two event types (its registry is an allow-list of `OwnershipTransfer.*`), so the bump breaks nothing; and it mirrors the D2 OfferingRef seam already on `favorites`/`saved_searches` — one consistent polymorphic subject shape across the platform, reserved cheaply now rather than migrated under load later.

## 3. Event → notification matrix
Notifications are sent by the **notification module as a consumer of the relayed event** (not by direct calls).
Each row maps to a `notification_templates(name, type, language)` row (seed in a migration).

| Event | Channel(s) | Template name | Recipient |
|---|---|---|---|
| `User.Registered` | SMS | `user_verify_code` | the user |
| `Moderation.Decided` = APPROVED | email | `listing_approved` | seller |
| `Moderation.Decided` = REJECTED | email | `listing_rejected` | seller |
| `Moderation.Decided` = CHANGES_REQUESTED | email | `listing_changes_requested` | seller |
| `Listing.Expired` | email | `listing_expired` | seller |
| `ContentReport.Actioned` | email | `report_resolved` | reporter (+ owner if removed) |
| `Moderation.Escalated` | email | `moderation_sla_escalated` | ADMIN (escalation queue) |
| `OwnershipTransfer.Initiated` | in-app | `transfer_initiated` | to-party |
| `OwnershipTransfer.Accepted` | in-app | `transfer_accepted` | from-party (initiator) |
| `OwnershipTransfer.Declined` | in-app | `transfer_declined` | from-party (initiator) |
| `OwnershipTransfer.Cancelled` | in-app | `transfer_cancelled` | to-party |
| `OwnershipTransfer.Expired` | in-app | `transfer_expired` | both parties |

> **(round-N, normative — ownership-transfer events + first `IN_APP` consumer, ADR-0021, C4) WHAT:**
> added the `OwnershipTransfer.{Initiated,Accepted,Declined,Cancelled,Expired}` events (aggregate =
> OwnershipTransfer) to §2 and their `IN_APP` notification routes to §3, and recorded that the
> notification module is now a **real** consumer (channel `IN_APP`) rather than a form-only stub. The
> transfer service emits each event in the **same tx** as the state change (initiate/accept/decline/
> cancel/lazy-expire); recipient = "the other party" relative to who acted (system-expiry → both).
> **WHY:** the ownership-transfer outcomes were produced-then-silent (no consumer), and the transfer
> events were not catalogued at all, so a backend dev could not build their emission or notification
> from §2/§3. ADR-0021 makes `IN_APP` the MVP channel (no provider, no consent — transactional ≠
> advertising, ФЗ-38). **WHY-BETTER-for-the-whole-project:** ends the "silent event layer" for the two
> highest-value flows (moderation + transfer) with the smallest reversible change; the registry-driven
> consumer stays Offering-ready (ADR-0014) — a new event/offering type is a registry edit, not a
> dispatch-core change; forward-only replay (relay `WHERE processed_at IS NULL`) is the correct
> spam-safe semantics, with the no-purge guardrail keeping analytics backfill open. RU mirror updated.

> **(round-N, normative — `Moderation.Escalated`, Slice 4c) WHAT:** added the `Moderation.Escalated`
> event (aggregate = Listing) to the catalog + notification matrix. The moderation SLA job scans
> `PENDING_MODERATION` items past the SLA threshold and emits it via the outbox; it sets
> `listings.escalated_at` (in the **same** tx as the outbox write) so a re-tick does not re-emit.
> Consumer = notification → ADMIN.
> **WHY:** the SLA escalation was already normative in the moderation spec (§SLA, `slaState=ESCALATED`)
> and the D1 reconciliation removed the old auto-reject, but the **event** that carries the escalation
> to ADMIN was missing from the catalog — a backend dev could not build the job's emission from §2.
> **WHY-BETTER-for-the-whole-project:** keeps escalation a pure **read-side, additive** signal — the
> job never mutates `status`/`moderation_status` (M-13: item stays PENDING_MODERATION, never auto-
> decided), so it cannot harm a listing; `escalated_at` gives at-least-once-safe **once-per-item**
> emission consistent with the outbox's idempotent-consumer rule (§1); admin fan-out reuses the
> existing notification-consumer pattern (no new transport). Emit-only now; the active reset on
> re-enqueue is deferred to M-14/4d (which owns the ACTIVE→PENDING re-moderation transition).

## Verification
- Worker can be built solely from §1 + §2 (no missing producer/consumer/payload).
- Every notification template referenced in §3 has a seed row (notification seed migration).
- Consumers are idempotent (re-delivering an event causes no double effect).

## Related
- [ADR-0009](../04-decisions/0009-mvp-vs-target-architecture.md) (worker/outbox), `database_schema.sql` (`outbox_events`, `notification_templates`)
- [Notification Domain](13-notification-domain.md), [Moderation Domain](12-moderation-domain.md), [Listing SM](statemachines/listing_state_machine.md)
- 🌐 RU mirror: [docsRU/specs/event-catalog.md](../../docsRU/specs/event-catalog.md)
