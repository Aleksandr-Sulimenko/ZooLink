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
- **Payload:** JSONB; every payload includes `event_id`, `occurred_at`, `aggregate_id`, and a `schema_version`.

## 2. MVP event catalog

| event_type | aggregate_type | Producer | Payload (key fields) | Consumers (action) |
|---|---|---|---|---|
| `Listing.Submitted` | Listing | listing module (DRAFT→PENDING_MODERATION) | listing_id, seller_id | moderation (enqueue), notification (none) |
| `Moderation.Decided` | Listing/Animal | moderation module | entity_type, entity_id, decision (APPROVED/REJECTED/CHANGES_REQUESTED), reason | listing (apply status), **notification (notify owner)** |
| `Moderation.Escalated` | Listing | moderation **SLA job** (worker) | entityId, market, waitingSeconds, slaState | **notification (notify ADMIN)**. Emit-only in 4c (admin fan-out is the notification consumer). The job **never** mutates `status`/`moderation_status` — item stays PENDING_MODERATION (M-13). **Idempotent:** emitted **once** per overdue item (`listings.escalated_at` marker, set in the same tx as the outbox write); reset on re-enqueue (M-14/4d). |
| `Listing.Activated` | Listing | listing module (→ACTIVE) | listing_id, seller_id | search-index (publish), notification (notify owner) |
| `Listing.Expired` | Listing | worker (duration elapsed) | listing_id, seller_id | search-index (remove), **notification (notify owner)** |
| `Listing.Sold` | Listing | listing module (owner marks sold, MVP) | listing_id, seller_id | search-index (remove), notification (notify owner) |
| `Listing.Deactivated` | Listing | listing/moderation module | listing_id, reason | search-index (remove), notification (if moderator-removed) |
| `User.Registered` | User | identity module | user_id | notification (welcome/verify — SMS handled inline) |
| `ContentReport.Filed` | ContentReport | moderation module | report_id, entity_type, entity_id | moderation (enqueue) |
| `ContentReport.Actioned` | ContentReport | moderation module | report_id, target, action | listing (deactivate target), **notification (notify reporter+owner)** |
| `ContactReveal.Created` | Listing | contact module | listing_id, viewer_id | analytics/counter (rate-limit + owner stats) |
| `Payment.Completed` / `Payment.Failed` | Payment | payment module | **Фаза 2+ (gated `feature_toggles.payments`)** | listing (SOLD), notification |

> Producers/consumers are **modules within the monolith** (ADR-0009), not microservices. "Consumer" = an
> in-process handler subscribed to the relayed event.

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
