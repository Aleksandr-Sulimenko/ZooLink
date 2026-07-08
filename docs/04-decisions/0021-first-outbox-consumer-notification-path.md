# ADR-0021: First real outbox consumer — the in-app notification path (end the silent event layer)

**Status**: Proposed
**Date**: 2026-07-03

## Context and Problem Statement

The transactional-outbox mechanism (ADR-0009, `lib/outbox/*`) is fully built and correct:
producers write `outbox_events` in-tx with a complete envelope (`schemaVersion`/`occurredAt`/
`market`, ADR-0002), and the worker relay claims, dispatches, retries and dead-letters. But
**zero consumers are registered** (`OUTBOX_CONSUMERS` is `@Optional()` and empty). Two consequences,
both surfaced independently by three AUDIT3 lanes (active-user, reviewer-qa, data-analyst) and
`AUDIT3_FORWARD_COMPAT.md` §"dead-feature cluster" #2/#3:

1. **Every event is produced and immediately marked `processed_at=NOW()` with no side effect.**
   Moderation decisions, ownership transfers and (armed) contact-reveals happen **in silence** — the
   seller is never told their listing was approved/rejected; the transfer counterparty is never
   notified. The green suite masks this: `moderation.e2e` asserts only that an outbox row exists.
2. **The relay claims `WHERE processed_at IS NULL`** (`outbox.relay.ts:87`). A consumer registered
   *later* will therefore **never see any event emitted before it existed** — they are already
   stamped processed. "Just add the consumer in Phase 2" does **not** replay history
   (data-analyst NEW finding + probe C13).

The notification substrate already exists: `notification_templates`/`notification_logs`/
`notification_suppressions` tables, seeded templates (migration 0010), `notification_logs.idempotency_key`
UNIQUE (migration 0009), `users.notification_prefs`/`preferred_language`, and the normative delivery
mechanics in spec `13-notification-domain.md` + the event→notification matrix in `event-catalog.md` §3.
What is missing is **the consumer that connects the two** — the first real `OutboxConsumer`.

This ADR fixes the structural questions (consumer-registration shape, the replay/forward-only
policy, the MVP channel/consent model, and forward-compat of the envelope) so a backend slice can
build it. It does **not** write code.

## Decision Drivers

- **End the silence** — moderation/transfer outcomes must reach the user; this is the P1 gating
  *product* fact (`AUDIT3_FORWARD_COMPAT.md` §P1.2). Highest priority.
- **Replay correctness** — a wrong policy either spams users with stale events or silently loses
  history. Must be decided explicitly, not left to relay mechanics.
- **ФЗ-38 / ФЗ-152** — transactional notifications are **not** advertising and need no consent;
  marketing does. The two must not be conflated in the delivery path.
- **Forward-compat (anti-rewrite)** — the consumer must not hardcode `listing`; it must survive the
  Offering seam (ADR-0014/0015) so services/goods/orders drop in without rewriting it.
- **Idempotency** — outbox delivery is at-least-once; materialization must be dedup-safe.
- **MVP focus** — deliver the smallest channel that ends the silence without a provider integration
  or new consent machinery.

## Considered Options

### Option 1: One notification consumer, IN-APP channel now, email/SMS form-deferred, forward-only replay
A single `NotificationConsumer implements OutboxConsumer`, provided under `OUTBOX_CONSUMERS` in the
worker, subscribed to the explicit transactional event set. For each event it materializes a durable
**in-app** `notification_logs` row (channel `IN_APP`), idempotent on `(event.id, recipient, template)`.
Email/SMS stay form-now (templates + ADR-0008 provider ports) behind a gate, wired in a later slice.
Replay policy = **forward-only**: the consumer only acts on events emitted after it ships; historical
`processed`-stamped events are *not* re-notified.

Pros:
- Ends the silence immediately with the one channel that needs **no external provider and no consent**
  (in-app transactional).
- Forward-only is the *correct* semantics for notifications — re-notifying about a 3-week-old approval
  would be spam and a trust hit.
- Small, testable, self-contained; the notification substrate already exists.
- Registry-driven event→template mapping keeps the consumer open for new offering types.

Cons:
- Requires widening `notification_logs.type` CHECK to add `IN_APP` (a small notification-owned migration).
- Events emitted *before* the consumer ships are permanently un-notified (accepted: the feature did not
  exist then).
- Does not, by itself, solve the *analytics* replay-blindness (separate consumer, separate policy).

### Option 2: Catch-all replay — backfill notifications on consumer deploy
Register the consumer and run a one-off replay reading `outbox_events` payloads directly, so historical
events also generate notifications.

Pros:
- No "lost" events; every past event gets its notification.

Cons:
- **Spams users** with stale moderation/transfer outcomes at deploy — a serious trust and ФЗ-38/UX harm.
- Conflates the *notification* delivery decision (must be forward-only) with the *analytics* history
  decision (which legitimately wants backfill). Wrong tool for the notification path.

### Option 3: Email/SMS as the MVP channel (skip in-app)
Wire the ADR-0008 providers (Unisender/SMS.RU) and send email/SMS as the first channel.

Pros:
- Reaches users off-platform; matches most `event-catalog.md` §3 rows (email templates).

Cons:
- Requires a live external provider integration, credentials, suppression/bounce handling, webhook — a
  much larger slice that delays ending the silence.
- Email needs deliverability/consent hygiene; heavier ФЗ-38 surface than in-app transactional.
- Higher blast radius for a first consumer that should be minimal and reversible.

## Decision

Adopt **Option 1**.

1. **Consumer registration.** A single `NotificationConsumer implements OutboxConsumer` is provided as
   an array element under the existing `OUTBOX_CONSUMERS` token, in the **worker** context
   (`OutboxRelayModule` composition). Its `eventTypes` is an **explicit allow-list** (not `'*'`) of the
   transactional notifiable events. Event→notification mapping is a **registry** (one entry per
   `eventType`: `{ templateName, recipientResolver, channelSet }`) so adding an event or an offering type
   is a registry edit, never a change to the dispatch core.

2. **Replay policy = FORWARD-ONLY for the notification path.** The consumer acts only on events relayed
   after it ships; events already stamped `processed_at` are **not** re-notified. This is deliberate:
   stale notifications are harmful. The pre-consumer gap (events that occurred while no consumer existed)
   is an **accepted** one-time loss — the feature did not exist for those events.
   - **Guardrail (belt for analytics):** `outbox_events` **must never be pruned** until a durable
     analytics projection exists. This keeps a bespoke payload-replay physically possible for the
     *analytics* consumer (a separate future decision), so forward-only-for-notifications does not
     foreclose backfill-for-analytics. No purge job may be added without a superseding ADR.

3. **MVP channel & consent model.**
   - **IN_APP now:** every transactional event materializes one durable `notification_logs` row
     (channel `IN_APP`), rendered from the existing template body. **Always written**, ignoring
     `notification_prefs` — transactional notifications are not advertising (ФЗ-38); this matches
     spec `13-notification-domain.md` §"Transactional vs promotional".
   - **Email/SMS = form-now, behavior gated:** templates + ADR-0008 provider ports remain; actual
     provider dispatch is a later slice behind a gate. The IN_APP row is the MVP "you were told".
   - **Promotional** notifications are out of C4 scope; they require the versioned consent record
     (ADR-0020) and provenance (data-analyst ФЗ-38 finding) before any send.

4. **Forward-compat of the envelope (no `listing` hardcoding).** The consumer reads only the generic
   `OutboxEvent` (`aggregateType`/`aggregateId`/`eventType`/`payload`/envelope). The registry's
   `recipientResolver` resolves the target user via the **owning aggregate's service** (ADR-0018 —
   no raw cross-aggregate join), not a listing-specific path. Payloads that will later carry an
   `OfferingRef {offeringType, offeringId}` (ADR-0014, reserve-now) resolve through the same seam.
   The materialization stores `user_id` + `template` + `content`; it has no offering-typed column to
   retrofit.

5. **Event coverage (MVP).** Materialize: `Moderation.Decided` (APPROVED/REJECTED/CHANGES_REQUESTED →
   seller); the **ownership-transfer lifecycle** (`OwnershipTransfer.Initiated` → to-party;
   `Accepted`/`Declined`/`Cancelled`/`Expired` → the other party); `Listing.Expired`/`Listing.Sold`/
   `Listing.Activated` → seller; `ContentReport.Actioned` → reporter (+owner if removed).
   `ContactReveal.Created` is **not** a user notification (it is an analytics/counter concern — leave
   to the analytics consumer). The ownership-transfer events are **added to `event-catalog.md` §2/§3**
   as part of this decision (they are not yet catalogued; the transfer service must emit them in-tx).

## Consequences

### Positive
- Moderation, transfer and listing-lifecycle outcomes stop happening in silence — the P1 product blocker
  is closed with a minimal, provider-free, consent-free channel.
- The outbox stops being a write-only sink; the first real consumer proves the ADR-0009 seam end-to-end.
- Forward-only is the correct, spam-safe semantics; the no-purge guardrail keeps analytics backfill open.
- Registry + service-based recipient resolution makes the consumer Offering-ready (ADR-0014/0015) with no
  rewrite — one entry per new event/offering type.

### Negative
- Requires a small notification-owned migration to add `IN_APP` to `notification_logs.type` (and
  `notification_suppressions.channel` if in-app is ever suppressible — not in MVP).
- Events emitted before the consumer ships are never notified (accepted one-time gap).
- Email/SMS remain unbuilt — users get in-app only until the provider slice lands.

### Neutral
- Analytics replay-blindness (data-analyst NEW / probe C13) is explicitly **out of scope** here; it is
  parked behind the no-purge guardrail for a separate analytics-projection decision.
- The relay's "no matching consumer → mark processed" behavior is retained (correct for
  non-notifiable events); the test suite, not the relay, is what must stop masking silence.

## Implementation Notes (build-spec for backend-engineer)

- **New:** `backend/src/modules/notification/notification.consumer.ts` — `NotificationConsumer implements
  OutboxConsumer`; `eventTypes` = the explicit allow-list above; provided under `OUTBOX_CONSUMERS` in the
  worker module graph (NOT the API). Keep the dispatch core dumb; put the mapping in a `NOTIFICATION_REGISTRY`.
- **Recipient resolution** via the owning module's service (`ListingService`, transfer/`AnimalService`,
  moderation) — no raw join (ADR-0018). A bounded `getRecipientUserId(aggregateId)` read is fine.
- **Idempotency of materialization:** compute `notification_logs.idempotency_key` from
  `(outbox event.id ‖ recipient ‖ templateName)`; INSERT `ON CONFLICT (idempotency_key) DO NOTHING`
  (index `uq_notification_idempotency` already exists). At-least-once redelivery → exactly one row.
- **Content:** render the existing seeded template body (Handlebars, per spec 13) into
  `notification_logs.content`; `type = 'IN_APP'`; `recipient = user_id`; `status='SENT'`. IN_APP reuses
  the EMAIL template row as the content source (no new template seed; `notification_logs.type` is the
  *channel*, template.type is the *source*).
- **Migration (notification-owned, e.g. 0029):** widen `notification_logs.type` CHECK to
  `('EMAIL','SMS','IN_APP')`. Idempotent, run twice on live PG, negative test. Update `database_schema.sql`
  + ERD + `data-model.md` + table-count note + EN↔RU.
- **Producer gap:** the ownership-transfer service must `outbox.publish` the transfer lifecycle events in
  the same tx as the state change (they are not emitted today). Add them to `event-catalog.md` §2/§3
  (via doc-keeper for EN↔RU).
- **Test invariants (replace the masking fixtures — `AUDIT3_FORWARD_COMPAT.md` §"Implication"):**
  1. `produce Moderation.Decided → relay tick → assert exactly one notification_logs IN_APP row`
     (correct template, recipient = seller). Repeat per notifiable event type.
  2. **Dedup:** relay the same event twice / redeliver same `event.id` → still exactly one row.
  3. **Forward-only (probe C13):** emit event with no consumer → tick (marked processed) → register
     consumer → tick again → assert **no** notification (documents the forward-only cut).
  4. **Transactional-always:** recipient with `notification_prefs.promo=false`/`email=false` still gets
     the IN_APP transactional row (consent independence).
  5. **No-silence gate:** update `moderation.e2e` (and transfer e2e) to assert the notification row, not
     merely the outbox row.

## Related Decisions

- [ADR-0009](0009-mvp-vs-target-architecture.md): worker + transactional outbox (this is its first consumer).
- [ADR-0002](0002-two-marketplaces.md) / [ADR-0015](0015-market-scope-refines-0002.md): market/`market_scope`
  carried in the envelope; notifications never blend markets.
- [ADR-0014](0014-offering-supertype-polymorphic-seam.md): the registry + service-resolution keep the
  consumer Offering-ready (`OfferingRef` reserve-now).
- [ADR-0018](0018-cross-aggregate-access-rule.md): recipient resolution routes through the owning service.
- [ADR-0020](0020-versioned-consent-record-model.md): the prerequisite for any *promotional* send (out of
  scope here; transactional needs no consent).
- [ADR-0008](0008-rf-provider-matrix.md): the RF email/SMS provider ports (form-now, deferred).

## Amendment — 2026-07-08 (Slice H3 / AUDIT4 P2-5): reconcile promised vs built coverage; IN_APP read now exists

This ADR stays **Accepted**; the amendment records the *reconciled reality* against §5 (event coverage)
and §Negative, without rewriting the original prose (the honest history is preserved above).

**WHAT.** Three findings (alpha-analyst F1/F3, backend-engineer D2) showed the built registry and the
IN_APP channel had drifted from §5's promise. The reconciled truth as of Slice H3:

- **Built & live in `NOTIFICATION_REGISTRY`:** `Moderation.Decided` (→ seller) and the full
  **ownership-transfer lifecycle** `OwnershipTransfer.{Initiated,Accepted,Declined,Cancelled,Expired}`
  (→ the other party / both on Expired). These match §5 and are proven end-to-end.
- **Promised in §5 but NOT YET BUILT (registry has no entry) — DEFERRED, tracked here:**
  `Listing.Expired` / `Listing.Sold` / `Listing.Activated` (→ seller) and `ContentReport.Actioned`
  (→ reporter/owner). These events either have no producer yet or no seeded template; until a route +
  template ship, the relay's "no matching consumer → mark processed" path applies (they are not
  notified). This is a **known, documented deferral**, not silent drift — the honest state is that
  IN_APP coverage today is *moderation-decision + transfer-lifecycle only*. Building the remaining
  routes is a registry edit + template seed (a follow-up slice), exactly as the ADR's design intends.
- **`OwnershipTransfer.Expired` starvation closed (P2-6):** a worker-side expiry sweeper
  (`lib/scheduler/transfer-expiry.*`) now proactively expires overdue PENDING transfers and emits the
  event in-tx, so this registered route actually fires without waiting for a lazy read.
- **IN_APP is no longer write-only (P2-5):** `GET /v1/me/notifications` (notification-api.yaml,
  own-scope, PageMeta, ETag) surfaces the materialised IN_APP rows, and the contract `type` enum now
  includes `IN_APP`. The §Positive claim "outcomes stop happening in silence" and the ADR-0021 §3
  "you were told" are now true **end-to-end** for the built event set.

**Still deferred (unchanged):** the EMAIL/SMS provider channels; the analytics replay-sink / no-purge
projection (§Neutral); IN_APP suppression. `notification_state_machine.md` should gain an IN_APP lane
(`[*] → SENT`, terminal, no `notification_prefs` guard) and `event-catalog.md §3` should be corrected so
its channel assignment + "registry allow-list" note match this reconciled set — routed to **doc-keeper**
(EN↔RU) as a documentation-consistency follow-up (no behavioural change).

**WHY-BETTER-for-the-whole-project.** Recording the *gap* between promise and build (rather than quietly
trimming §5 or over-claiming completeness) keeps the ADR a truthful contract: a reader/agent sees exactly
which events notify today and which are queued, and the deferral has an explicit close-out path. No
Accepted decision was rewritten; the coverage promise remains the target, now with a dated reality check.

## References

- `docs/specs/event-catalog.md` §1–§3 (outbox contract, catalog, event→notification matrix).
- `docs/specs/13-notification-domain.md` §"Delivery mechanics" (transactional-always, idempotency key).
- `backend/src/lib/outbox/{outbox.relay.ts,outbox.types.ts,outbox.service.ts}` (mechanism; zero consumers).
- `AUDIT3_FORWARD_COMPAT.md` §"dead-feature cluster" #2/#3; `AUDIT3/data-analyst.md` (replay-blindness
  NEW finding + probes C13/C14); `AUDIT3/active-user.md`, `AUDIT3/reviewer-qa.md`.
- 🌐 RU mirror: [docsRU/04-decisions/0021-first-outbox-consumer-notification-path.md](../../docsRU/04-decisions/0021-first-outbox-consumer-notification-path.md)
