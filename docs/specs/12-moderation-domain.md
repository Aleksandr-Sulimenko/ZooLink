---
version: "1.0"
lastUpdated: "2026-06-15"
author: "System Analyst"
status: "Draft"
---

# Spec: Moderation Domain

## Outcome
Provide a reliable moderation workflow for user-generated content (listings, animal profiles, etc.) to ensure compliance with platform policies, legal requirements, and community standards. Enable moderators to review submissions, make decisions (approve, reject, request changes), and maintain an audit trail of all moderation actions.

## Scope & Boundaries
**In Scope:**
- Moderation queue for listings awaiting review
- Moderation queue for animal profiles awaiting review (if applicable)
- Moderator interface for viewing queue items, accessing item details, and making decisions
- Decision types: Approve, Reject, Request Changes (with specific reasons)
- Automated moderation triggers (e.g., profanity detection, duplicate detection) - deferring to phase 2
- Appeal process for rejected items - deferring to phase 2
- Audit trail recording: moderator ID, timestamp, decision, reason, and any notes
- Notifications to users upon moderation decision (via Notification Domain)
- Role-based access control: only users with MODERATOR or ADMIN role can access moderation features
- Integration with Listing Domain (for listing moderation) and Animal Domain (for animal profile moderation)
- Bulk moderation actions (approve/reject multiple items) - deferring to phase 2

**Out of Scope:**
- Automated content moderation (AI-based image/text analysis) - deferred to phase 2
- User reputation system based on moderation history - deferred to phase 2
- Legal review workflow for high-risk items - deferred to phase 2
- Public moderation logs (transparency reports) - deferred to phase 2
- Integration with external moderation services (e.g., third-party content filters) - deferred to phase 2

## Constraints
- **Legal:** Must comply with Russian Federal Law 152-ФЗ (Personal Data) when handling user-generated content that may contain personal data. Must adhere to Russian laws regarding prohibited content (extremism, etc.).
- **Performance:** Moderation queue retrieval < 2s under normal load; individual moderation decision processing < 1s.
- **Usability:** Moderator interface must be simple and efficient for high-volume moderation (target: <30 seconds per item review).
- **Scalability:** System must support 10k+ moderation decisions per day.
- **Technology:** Must align with selected stack (NestJS, TypeScript, PostgreSQL, Redis).
- **Data:** Moderation decisions and audit logs must be stored immutably (append-only) to prevent tampering.
- **Reliability:** Moderation decisions must be persisted reliably; no loss of decisions or audit trail.

## Prior Decisions
- Moderation is implemented as a dedicated NestJS module with its own service and controller.
- Moderation queue is stored in PostgreSQL with a status field (PENDING, APPROVED, REJECTED, CHANGES_REQUESTED).
- Each moderatable entity (listing, animal profile) has a moderation status and a reference to the moderation decision record.
- Moderators access the queue via a paginated API endpoint with filtering options (by entity type, date submitted, etc.).
- Decision reasons are selected from a predefined list (configurable via Admin Domain) with optional free-text notes.
- Notifications are sent asynchronously via the Notification Domain after a moderation decision is made.
- Audit trail is stored in a separate table to ensure immutability and enable forensic analysis.
- Moderation interface is part of the admin panel (Admin Domain) but accessible to users with MODERATOR role.

## NFR Traceability
This specification addresses the following Non-Functional Requirements:
- **Performance (NFR-PERF)**: Moderation API latency < 800ms for 95% of requests under load test (50 RPS) (see docs/02-requirements/nfr/performance.md)
- **Security (NFR-SEC)**: Moderation actions require authentication and authorization; audit logs are tamper-evident (see docs/02-requirements/nfr/security.md)
- **Accessibility (NFR-ACC)**: Moderator interface follows WCAG 2.1 AA guidelines (see docs/02-requirements/nfr/accessibility.md)

## Process Flow (BPMN-style)

Pre-moderation workflow (ADR-0003): a listing is not publicly visible until approved. Couples to [`statemachines/listing_state_machine.md`](statemachines/listing_state_machine.md). All decisions are written append-only to `moderation_decisions`.

```mermaid
flowchart TD
    subgraph Owner["Listing Owner"]
        A[Submit listing for review] --> Q
        N1[Receive: Approved -> live]
        N2[Receive: Rejected + reason]
        N3[Receive: Changes requested + notes]
        N3 --> ED[Edit & resubmit]
        ED --> Q
    end

    subgraph System["ZooLink System"]
        Q[listing -> PENDING_MODERATION<br/>enqueue; start SLA timer] --> SLA{SLA timer<br/>expired?}
        SLA -- Yes, no action --> TO[Escalate to ADMIN<br/>emit Moderation.Escalated<br/>listing STAYS PENDING_MODERATION<br/>never auto-approved/rejected]
        SLA -- No --> WAIT[Item waits in queue]
        TO --> WAIT
    end

    subgraph Moderator["Moderator (MODERATOR/ADMIN)"]
        WAIT --> R[Open item, review against policy]
        R --> D{Decision}
        D -- Approve --> AP[moderation_status = APPROVED<br/>listing -> ACTIVE<br/>append moderation_decisions]
        D -- Reject --> RJ[moderation_status = REJECTED<br/>listing -> DEACTIVATED<br/>append moderation_decisions + reason]
        D -- Request changes --> CR[moderation_status = CHANGES_REQUESTED<br/>listing -> DRAFT<br/>append moderation_decisions + notes]
    end

    AP --> N1
    RJ --> N2
    CR --> N3
    AP --> E([End: live])
    RJ --> E2([End: not published])
```

### Key rules
- **Actors:** Owner (submits/edits), Moderator (decides), System (queue, SLA, persistence, notifications).
- **Branches covered:** Approve / Reject / Changes-requested — each maps to a `listings.status` + `moderation_status` transition. **SLA-timeout does NOT decide:** it **escalates to ADMIN** (`Moderation.Escalated`) and the item **stays `PENDING_MODERATION`** — never auto-approved or auto-rejected (see round-5 §SLA and `statemachines/listing_state_machine.md`).
- **Audit:** every decision is an append-only `moderation_decisions` row (immutable; UPDATE/DELETE blocked by trigger).
- **Notifications** are dispatched via the Notification domain on every terminal decision.

> **(round-N, normative — D1 reconciliation) WHAT:** the SLA-timeout branch (mermaid + the "Branches covered" bullet) changed from "auto-reject → listing EXPIRED / moderation_status REJECTED" to "**escalate to ADMIN, item stays PENDING_MODERATION, never auto-approved/rejected**" (and the `TO → Rejected-notification` edge was removed).
> **WHY:** the spec contradicted itself — the BPMN diagram + line-98 bullet said auto-reject, but the round-5 normative §SLA/escalation **and** `listing_state_machine.md:23/58/85` already say escalate-stays-PENDING. Per the truth hierarchy a code↔doc/doc↔doc conflict is fixed toward the normative text + state machine; the diagram was the stale lower-fidelity artifact.
> **WHY-BETTER-for-the-whole-project:** one consistent SLA semantics across spec↔state-machine↔contract (`slaState`/`escalated` are derived-read-only in 4a); no silent destruction of a seller's listing on operator slowness (a non-decision must never terminate content); the active escalation event/job is cleanly scoped to **Slice 4b**, leaving 4a's lock-expiry-computed model self-sufficient. Alternative (make the auto-reject real) was rejected: it would re-introduce a punitive auto-terminal the state machine forbids and break the P0 "only APPROVE→ACTIVE / explicit decision→terminal" model.

## Task Breakdown
1. **Backend (NestJS)**
   - [ ] Create `moderation` module with NestJS CLI
   - [ ] Define ModerationDecision model (Prisma) with fields: id, moderatorId (User reference), entityType (Listing/Animal), entityId, decision (APPROVED/REJECTED/CHANGES_REQUESTED), reason (enum), notes (optional), createdAt
   - [ ] Add moderationStatus field to Listing and Animal entities (or create association table)
   - [ ] Implement ModerationController (get queue, get item details, submit decision)
   - [ ] Implement ModerationService (business logic for queue retrieval, decision processing, notification triggering)
   - [ ] Create moderation reason enum and configuration mechanism (via Admin Domain)
   - [ ] Set up rate limiting for moderation endpoints
   - [ ] Write unit and integration tests for moderation flows
   - [ ] Create OpenAPI (Swagger) docs for moderation endpoints

2. **Frontend (React)**
   - [ ] Create moderation queue page (part of admin panel)
   - [ ] Implement item detail view (show listing/animal details with moderation controls)
   - [ ] Implement decision submission form (reason selection, notes)
   - [ ] Create moderator role-based route protection
   - [ ] Implement real-time queue updates (via WebSocket or polling)
   - [ ] Write unit and e2e tests for moderation flows

3. **Infrastructure**
   - [ ] Configure PostgreSQL indexes for moderation queue queries (by status, entityType, createdAt)
   - [ ] Set up Redis caching for moderation queue (optional, for performance)
   - [ ] Add security headers and CORS configuration
   - [ ] Implement logging for moderation events (decision made, queue accessed)

## Verification Criteria
- [ ] Unit tests achieve >90% coverage for moderation module (backend)
- [ ] Integration tests cover: queue retrieval, decision submission (all decision types), notification triggering, audit log creation
- [ ] E2E tests (Cypress/Playwright) cover full moderator flow: login -> view queue -> review item -> submit decision -> verify notification sent
- [ ] Manual testing: verify moderation decision persists correctly, audit log is immutable, notifications are sent
- [ ] Performance: moderation API latency < 800ms for 95% of requests under load test (50 RPS)
- [ ] Security: verify that only MODERATOR and ADMIN roles can access moderation endpoints
- [ ] Documentation: OpenAPI spec generated and available at /api/docs
- [ ] NFR Traceability: Verify that performance, security, and accessibility requirements are properly addressed and documented

---

## Queue operations (round-5, normative)

- **Queue & FIFO:** the queue = listings in `PENDING_MODERATION` ordered by `moderation_enqueued_at ASC` (set on
  submit), index `idx_listings_modqueue`. Target <2 s / 100 items.
- **Assignment / lock (no double moderation):** a moderator **claims** an item — `assigned_to`, `locked_at`,
  `lock_expires_at` (migration 0009). A claim is exclusive for `MOD_LOCK_TTL` (default 15 min, auto-released on
  expiry). Two moderators (or an AI agent + human) cannot act on the same item; second claim → `409`.
- **Reason taxonomy:** `moderation_reasons` is seeded (migration 0010): `prohibited_species, incomplete_info,
  poor_photos, suspected_fraud, price_violation, wrong_category, duplicate, animal_welfare, policy_violation`.
  A **reason is mandatory** on REJECT and CHANGES_REQUESTED; its `description_localized` feeds the
  `listing_rejected`/`listing_changes_requested` notification (`reason` variable).
- **Re-moderation on edit:** editing an ACTIVE listing's **material fields** (title, description, photos, price,
  species/breed, listing_type) returns it to `PENDING_MODERATION` (`moderation_status='PENDING'`); trivial edits
  (e.g. toggling a saved flag) do not. Enforced at the service layer.
- **SLA & escalation:** SLA clock starts at `moderation_enqueued_at`; on timeout the item is **escalated to ADMIN**
  (event `Moderation.Escalated`) and stays `PENDING_MODERATION` — never auto-approved/rejected.
- **Animal moderation:** in MVP animals are **not** independently pre-moderated; an animal is reviewed via its
  listing. `entity_type='ANIMAL'` in `moderation_decisions`/`content_reports` is used only for **report-driven**
  decisions (e.g. acting on a reported animal), not a standalone animal queue.
- **Appeals:** **no appeal flow in MVP** — a hard REJECT is terminal (the seller may create a new corrected listing);
  CHANGES_REQUESTED is the fixable path. (Appeals are Фаза 2; appeal-rate is not an MVP metric.)
- **Audit:** every decision writes `moderation_decisions` (append-only) **and** an `audit_log` row.
- **AI moderator (ADR-0006):** an AGENT uses the same claim/lock contract; gated by a feature toggle, off in MVP.

## Claim/lock state machine & contract-shape (B10, round-5 normative)

Contract-shape laid now in `moderation-api.yaml` (FORM now, behavior with the Moderation domain). Aligns the
contract to the round-5 queue operations above.

### Claim/lock state machine (per queue item, relative to the calling principal)

```mermaid
stateDiagram-v2
    [*] --> FREE: enqueued (PENDING_MODERATION)
    FREE --> CLAIMED_BY_ME: claim (POST .../claim) by me
    FREE --> CLAIMED_BY_OTHER: claim by another principal
    CLAIMED_BY_ME --> CLAIMED_BY_ME: re-claim (idempotent, refresh lockExpiresAt)
    CLAIMED_BY_ME --> FREE: release (DELETE .../claim) | decision recorded
    CLAIMED_BY_ME --> LOCK_EXPIRED: lockExpiresAt < now (MOD_LOCK_TTL)
    CLAIMED_BY_OTHER --> LOCK_EXPIRED: holder's lockExpiresAt < now
    CLAIMED_BY_OTHER --> FREE: holder releases | holder decides
    LOCK_EXPIRED --> CLAIMED_BY_ME: re-claim by me
    LOCK_EXPIRED --> CLAIMED_BY_OTHER: re-claim by another
```

- **Trigger/guard table**

| From | Action | Guard | To | Else |
|---|---|---|---|---|
| FREE / LOCK_EXPIRED | claim | item is PENDING_MODERATION | CLAIMED_BY_ME | 404 if not in queue |
| CLAIMED_BY_OTHER (live lock) | claim | — | (no transition) | **409 `ALREADY_CLAIMED`** (carries current holder Actor + lockExpiresAt) |
| CLAIMED_BY_ME | claim (re-claim) | caller == holder | CLAIMED_BY_ME (refresh TTL) | — |
| CLAIMED_BY_ME | release (DELETE) | caller == holder OR ADMIN | FREE | **409 `NOT_LOCK_HOLDER`** |
| CLAIMED_BY_ME | submit decision | caller holds live lock | FREE (+ decision) | **409 `NOT_LOCK_HOLDER`** / **409 `ITEM_NOT_CLAIMED`** if no live lock |

- **Lock TTL:** `MOD_LOCK_TTL` (default 15 min). Expiry auto-releases (no background job required — expiry is
  computed from `lock_expires_at < now()`); a background sweep MAY null stale columns but is not required for correctness.
- **AGENT parity:** an AGENT principal uses the identical claim/lock contract (ADR-0006, gated).

### SLA / escalation
- `slaState ∈ {ON_TRACK, BREACHED, ESCALATED}` derived from `waitingSeconds` vs target (ADR-0003: pet <4h,
  livestock <6h business hours — exact thresholds owned by config). **ESCALATED** = SLA-timeout fired →
  `Moderation.Escalated` event to ADMIN; item **stays PENDING_MODERATION**, never auto-approved/rejected.
- Queue filters: `market`, `slaState`, `escalated=true` (≡ `slaState=ESCALATED`), `lockState`.
- `meta.counts` (byMarket, bySlaState) gives operator-tab badge totals over the full filtered queue.

### Agent-transparency (Owner-decision #5, locked 2026-06-24 — show "decided by AI" to EVERYONE)
- Operator decision records (`ModerationDecision`) already carry the `Actor` agent-badge (B0.6/ADR-0011 §6).
- **Owner-facing:** `GET /listings/{id}/moderation-result` → `OwnerModerationResult` carries
  `decidedBy.principalType` + `decidedByAgent` so the **seller** sees whether an AI or a human decided, plus
  the resolved reason/notes and the human-override chain (`isHumanOverride`/`supersedesDecisionId`). The owner
  read in `listings-api` SHOULD embed the same projection as an additive `lastModerationResult` field
  (flagged for backend + doc-keeper).

### Decision-templates = controlled dictionary (TABLE, not enum) — phasing decision §5
**ЧТО:** Canned decision notes for REJECT/CHANGES_REQUESTED are modeled as reference-data — a NEW
`decision_templates` table (controlled, Admin-extensible dictionary; `code` PK, `body_localized` JSONB,
`applies_to_decision`, `market`, `related_reason_code`, `sort_order`, `is_active`, provenance) — surfaced by
`GET /moderation/decision-templates` and selected via `ModerationActionRequest.templateCode`. **NOT an enum.**

**ПОЧЕМУ:** Templates are business-editable content that grows over time and that an AI agent must select by a
stable key. They are notes (free prose), distinct from the mandatory `moderation_reasons` taxonomy (why-rejected).

**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** By §5 cost-of-change — an enum would force a **contract + schema rewrite**
every time an operator adds/edits a template (rewrite-test = yes); a table makes a new template a single data
row with **zero schema/contract change**. It mirrors the proven `moderation_reasons` reference-data shape and the
A2 reference-data convention (`sort_order`/provenance/JSONB localization), keeps both locales for the operator
editor (B0.4), and gives the AGENT a stable `code` to pick — agent-first, forward-compatible. → **schema
migration flagged for `zoolink-backend-engineer`** (NOT implemented in this contract round).

### B10 error codes (extend API_CONVENTIONS §4 domain-specific set)
| code | HTTP | When |
|---|---|---|
| `ALREADY_CLAIMED` | 409 | claim on an item with another principal's live lock |
| `NOT_LOCK_HOLDER` | 409 | release/decide by a non-holder |
| `ITEM_NOT_CLAIMED` | 409 | decide on an item with no live lock |

## Admin Slice 4a — moderation invariants & negative cases (round-N, normative)

> **Source-of-truth note.** This is the shared invariant/negative-case list for
> **backend-engineer** and **reviewer-qa** (the gate) for Slice 4a — the same role as the
> listings `L-P0..L-15` / `L2-1..L2-16` lists. Contract:
> [moderation-api.yaml](../03-architecture/api-contracts/moderation-api.yaml) (complete — the
> preflight found no endpoint/schema gap; no migration — claim/lock columns, the append-only
> `moderation_decisions` ledger, `decision_templates`/`moderation_reasons` dictionaries, and the
> P0 trigger are all on live PG). State machines: [listing_state_machine.md](statemachines/listing_state_machine.md)
> (the `status`/`moderation_status` model + P0) and the claim/lock machine above.
>
> **WHAT:** formalize the Slice-4a moderation invariants (P0 ACTIVE-gate, atomic decision+
> transition+audit, claim/lock single-winner, append-only + human-override, agent-as-principal
> transparency, mandatory reason, authz, derived-read-only SLA).
> **WHY:** the contract is complete but the invariants were spread across the round-5 prose, the
> two state machines, ADR-0003/0006/0011, and the schema triggers — backend and the gate need
> one numbered list to build and verify against (no re-derivation, no divergence).
> **WHY-BETTER-for-the-whole-project:** one source of truth keys backend tests and QA coverage
> off the same invariants; the P0 ACTIVE-requires-APPROVED guard stays the single safety anchor
> (DB trigger backstop + service); the append-only ledger + human-override chain stay tamper-proof
> and regulator-exportable; agent-as-principal transparency (owner-decision #5) is wired now so
> the AGENT path turns on (behind its toggle) without a rewrite; SLA stays a derived read in 4a
> so the active-escalation job is cleanly deferrable to 4b.

### Slice-4a scope

**IN:** queue read (FIFO, filters, counts), claim / release, listing-detail-for-moderation,
submit decision (APPROVE / REJECT / REQUEST_CHANGES, incl. human-override row), decisions list,
reasons & decision-templates dictionaries, owner moderation-result read. **Snapshot/transparency
plumbing for AGENT decisions works now**; AGENT decisioning is gated by a feature toggle (off in
MVP). **Deferred to Slice 4b** (endpoints/tables exist — tracked, NOT silently built or dropped):
**content-reports** (`createContentReport` / `listContentReports` / `resolveContentReport`;
`content_reports` table) and the **active SLA-escalation job** (the scheduler exists, but lock
expiry is **computed** `lock_expires_at < now()`, so 4a needs no background job for correctness;
the `Moderation.Escalated` emission + admin escalation handling is 4b). Appeals, bulk actions, and
AI content-analysis are Фаза 2 (round-5 §Appeals / scope).

### Invariants & negative cases

| # | Invariant (MUST hold) | Negative case (MUST be rejected/handled) | Enforced by | Error → HTTP / code |
|---|---|---|---|---|
| M-P0 | **No ACTIVE without APPROVED.** `APPROVE` is the **only** decision that sets a listing ACTIVE; `REJECT`→DEACTIVATED, `REQUEST_CHANGES`→DRAFT. No endpoint reaches ACTIVE except `submitModerationAction(APPROVE)`. | any path setting `status=ACTIVE` while `moderation_status≠APPROVED`. | DB `trg_listing_active_requires_approval` (RAISE) + service | 422 `VALIDATION_ERROR` (trigger backstop) |
| M-1 | **Atomic decision + transition + audit.** The `moderation_decisions` append, the `listings.status`/`moderation_status` flip, **and** the `audit_log` row are **ONE transaction** — all-or-nothing. | a committed decision with no transition; a transition with no ledger row; a decision with no audit row. | single DB transaction (service) | 500 `INTERNAL` (rolls back; no partial state) |
| M-2 | **Claim single-winner (TOCTOU).** Concurrent claims on a FREE item → exactly one 200, the rest 409; guarded conditional UPDATE / `SKIP LOCKED`. | two principals both believe they hold the lock. | service guarded UPDATE (`WHERE assigned_to IS NULL OR lock_expires_at < now()`) | 409 `ALREADY_CLAIMED` (carries holder Actor + lockExpiresAt) |
| M-3 | **Re-claim by holder is idempotent** — refreshes TTL (`MOD_LOCK_TTL`=15 min); **lock expiry is computed** (`lock_expires_at < now()` frees it; no background job needed in 4a). | a holder's re-claim erroring; a stale lock blocking forever. | service (holder check + computed expiry) | 200 (idempotent refresh) |
| M-4 | **Decide requires a live lock held by the caller**; success releases the lock. | action on an item locked by another principal. | service (holder + live-lock check) | 409 `NOT_LOCK_HOLDER` |
| M-5 | — (same gate, no-lock case) | action on an item with **no** live lock. | service | 409 `ITEM_NOT_CLAIMED` |
| M-6 | **Append-only ledger.** `moderation_decisions` UPDATE/DELETE is blocked. | any UPDATE/DELETE of a decision row. | DB `trg_block_modify_append_only` (RAISE) | DB exception (not an API path) |
| M-7 | **Human-override = NEW row**, never a mutation: `supersedesDecisionId` set + `isHumanOverride=true` + `principalType=HUMAN`; the superseded row is untouched; biconditional `isHumanOverride ⟺ supersedesDecisionId` holds; the superseded decision must be on the **same** `(entityType, entityId)`. | mutating the superseded row; override with `principalType=AGENT`; one of the override pair set without the other; superseding a decision on a different entity. | DB `chk_moddec_override` + service (HUMAN-only + same-entity check) | 422 `VALIDATION_ERROR` (mismatch/different-entity); 403 `FORBIDDEN` (AGENT attempts override) |
| M-8 | **Agent-as-principal end-to-end.** An AGENT decision snapshots `actor_principal_type='AGENT'` + `actor_role`; the owner-result and the decisions-list expose `principalType`/`decidedByAgent` (transparency to everyone — owner-decision #5). No HUMAN-only decision path; AGENT decisioning gated by the feature toggle (off MVP) but snapshot+transparency plumbing works now. | an AGENT decision that hides its principalType; a decision with no actor snapshot. | service snapshot (ADR-0011 §1/§6) + schema columns + feature toggle | n/a (write-time invariant); 403 if AGENT acts while toggle off |
| M-9 | **`reason` mandatory for REJECT / REQUEST_CHANGES**; must FK a seeded `moderation_reasons.code`. (`APPROVE` needs no reason.) | REJECT/REQUEST_CHANGES with no reason, or an unknown reason code. | service + FK to `moderation_reasons` | 422 `VALIDATION_ERROR` |
| M-10 | **`templateCode` optional**, must reference a `decision_templates.code` when present (server resolves body into notes; `notes` may extend/override). | an unknown `templateCode`. | service + FK to `decision_templates` | 422 `VALIDATION_ERROR` |
| M-11 | **Operator authz:** queue / claim / release / action / decisions / reasons / templates = **MODERATOR | ADMIN only**. | a USER (or unauthenticated) hits any operator endpoint. | `x-required-roles` + service | 403 `FORBIDDEN` (401 if unauthenticated) |
| M-12 | **Owner-result object-level authz:** `getOwnerModerationResult` (and the embedded `lastModerationResult`) = the listing **owner** OR MODERATOR/ADMIN only. | a non-owner USER reads another seller's moderation result. | service object-level rule (like Slice-1 read-scope) | 403 / 404 (no existence/detail leak) |
| M-13 | **SLA derived & read-only in 4a:** `slaState`/`escalated`/`waitingSeconds` are **computed** from `moderation_enqueued_at` vs thresholds; **no auto-reject/auto-approve**; the item never leaves PENDING_MODERATION on timeout (escalation event/job = 4b). | any code transitioning an item off PENDING_MODERATION on SLA timeout. | service (derived read; no write path on timeout) | n/a (derived); D1 reconciliation |
| M-14 | **Re-moderation on material edit:** editing an ACTIVE listing's material fields (title/description/photos/price/species/breed/listing_type) returns it to PENDING_MODERATION (`moderation_status='PENDING'`); trivial edits do not. | a material edit leaving a listing ACTIVE without re-review. | service (material-field detection) | n/a (transition); composes with M-P0 |

**B10 / domain error codes used:** `ALREADY_CLAIMED` (409), `NOT_LOCK_HOLDER` (409),
`ITEM_NOT_CLAIMED` (409); plus the standard `VALIDATION_ERROR` (422 — reason/template/override/
P0-trigger), `FORBIDDEN` (403 — operator authz, owner-scope, AGENT-override/toggle), `NOT_FOUND`
(404 — not in queue / owner-scope no-leak), `INTERNAL` (500 — atomic-txn rollback).

**RBAC (rbac-matrix.md):** moderation queue & decision = MODERATOR (C: approve/reject/changes) +
ADMIN (C); owner moderation-result = listing owner or MODERATOR/ADMIN. The operator row applies
identically regardless of `principal_type` (ADR-0011 §7 — an AGENT moderator holds the same row).

## Slice 4b — content-reports invariants & negative cases (round-N, normative)

> **Source-of-truth note.** Shared invariant/negative-case list for **backend-engineer** and
> **reviewer-qa** for Slice 4b (content-reports), same placement/pattern as the M-list above.
> Contract: [moderation-api.yaml](../03-architecture/api-contracts/moderation-api.yaml)
> (`/content-reports` block). Lifecycle:
> [content_report_state_machine.md](statemachines/content_report_state_machine.md). No migration —
> `content_reports`, the dedup partial-unique `uq_open_report_per_reporter_entity`, and the status
> CHECK are on live PG.
>
> **WHAT:** add the reporter-read path (file / role-scoped list / object-scoped get / MOD-resolve)
> and formalize CR-1..CR-11. **WHY:** rbac-matrix:67/101 grants USER "C own, R own" on content
> reports — the read path is **in MVP** (DRIFT-2), and resolve's `If-Match` needs a real GET as its
> ETag source (DRIFT-1); without these the report flow is unbuildable. **WHY-BETTER-for-the-whole-
> project:** reuses the listings read-scope pattern (USER self-scoped, can't widen — IDOR-safe);
> the dedup index makes report-spam a DB-enforced 409 not a service race; the reason enum keeps the
> data agent-friendly and garbage-free with no migration; resolve stays MOD/ADMIN-only and append-
> trail + audit stay atomic; the report-resolve and entity-action flows stay decoupled (DRIFT-3).

### Slice-4b scope

**IN:** `POST /content-reports` (file), `GET /content-reports` (role-scoped list),
`GET /content-reports/{id}` (object-scoped get — DRIFT-1), `PATCH /content-reports/{id}`
(resolve, MOD/ADMIN). MVP entity_types **LISTING | ANIMAL | USER**; **MESSAGE** is forward-compat
form, rejected in MVP (ADR-0005). **Deferred/forward-compat (tracked, not built):** MESSAGE
reports (chat is Фаза 2+), a "resolve-and-act" convenience that composes report-resolve with a 4a
entity decision (kept decoupled per DRIFT-3), report-driven animal/user moderation queues.

### Invariants & negative cases

| # | Invariant (MUST hold) | Negative case (MUST be rejected/handled) | Enforced by | Error → HTTP / code |
|---|---|---|---|---|
| CR-1 | **`reporter_id` = authenticated actor** (server-derived). | a body `reporterId` (any value — IDOR). | service (ignore/reject body reporterId) | body value not trusted; never client-set |
| CR-2 | **Dedup:** at most one OPEN report per `(reporter, entity_type, entity_id)`. | a second report while one is OPEN for the same target. | DB `uq_open_report_per_reporter_entity` (23505) + service | 409 `DUPLICATE_REPORT` |
| CR-3 | **Target must exist** for its `entity_type`. MVP set = LISTING|ANIMAL|USER. | report on a non-existent entity; a `MESSAGE` report (chat out of MVP, ADR-0005). | service existence check + entity_type gate | 404 `NOT_FOUND` (missing target); 422 `ENTITY_TYPE_UNAVAILABLE` (MESSAGE) |
| CR-4 | **File authz:** any **authenticated** user may file. | an unauthenticated request. | global auth | 401 `UNAUTHENTICATED` |
| CR-5 | **Read-scope:** a USER sees **only their own** reports on list **and** get (`reporter_id=actor`, AND-intersected, can't widen); MODERATOR|ADMIN see all. | a non-owner USER reads another's report (list leak or `GET /{id}`). | service object/query scope (listScope pattern) | 404 `NOT_FOUND` on get (no existence leak); self-scoped rows on list |
| CR-6 | **Resolve authz: MODERATOR|ADMIN only** — a reporter cannot resolve their own report. | a USER (incl. the reporter) PATCHes a report. | `x-required-roles:[MODERATOR,ADMIN]` + service | 403 `FORBIDDEN` |
| CR-7 | **Transition legality:** OPEN→{REVIEWED,DISMISSED,ACTIONED}; REVIEWED→{DISMISSED,ACTIONED}. | an illegal target (e.g. →OPEN, or skipping rules). | service (transition table) | 422 `VALIDATION_ERROR` |
| CR-8 | **Terminal immutability:** DISMISSED/ACTIONED are terminal. | resolve on an already-terminal report. | service (state precondition) + status CHECK | 409 `REPORT_TERMINAL` |
| CR-9 | **Resolve sets `resolved_by` + audit in one txn.** Actor snapshot `{actorId, principalType}` (agent-ready). | a terminal transition with no `resolved_by` or no audit row; partial write. | single DB transaction (service) | 500 `INTERNAL` (rolls back) |
| CR-10 | **Optimistic concurrency on resolve** (`If-Match` from `GET /content-reports/{id}`). | concurrent resolve with a stale ETag; missing If-Match. | service ETag compare | 412 `STALE_RESOURCE` / 428 |
| CR-11 | **`reason` ∈ enum** {SPAM,ABUSE,FRAUD,INAPPROPRIATE,OTHER}; **`entity_type` ∈ MVP set**. | a free-string/unknown reason; an out-of-set entity_type. | service enum validation (DB column stays VARCHAR(50)) | 422 `VALIDATION_ERROR` |
| CR-12 | **ACTIONED is decoupled from the entity action** (DRIFT-3, MVP-loose): resolve records report status only; the entity action is a separate 4a step. | report-resolve attempting to also mutate/deactivate the target entity. | service (resolve carries no entity-action fields) | n/a (by contract shape) |

**B10 / domain error codes used (extend API_CONVENTIONS §4):** `DUPLICATE_REPORT` (409),
`ENTITY_TYPE_UNAVAILABLE` (422), `REPORT_TERMINAL` (409); plus standard `VALIDATION_ERROR` (422 —
reason/entity_type/transition), `FORBIDDEN` (403 — resolve authz), `NOT_FOUND` (404 — target
missing / read-scope no-leak), `UNAUTHENTICATED` (401), `STALE_RESOURCE` (412), `INTERNAL` (500),
`RATE_LIMITED` (429 — report-spam).

**RBAC (rbac-matrix.md:67/101, confirmed — the reporter-read path honours it):** USER = **C own,
R own** (file any; read **own** reports only); MODERATOR = R/U (resolve) all; ADMIN = R/U/D all.
The read path built here matches "R own" exactly (CR-5); resolve stays operator-only (CR-6).

## Slice 4c — SLA-escalation + moderation-result-embed invariants (round-N, normative)

> **Source-of-truth note.** Shared invariant list for **backend-engineer** and **reviewer-qa**
> for Slice 4c — the **additive/safe pair**: (A) the SLA-escalation job emitting
> `Moderation.Escalated`, and (B) the `lastModerationResult` listing-embed. Event:
> [event-catalog.md](event-catalog.md) (`Moderation.Escalated`). Embed:
> [listings-api.yaml](../03-architecture/api-contracts/listings-api.yaml) `Listing.lastModerationResult`
> (inline mirror of [moderation-api.yaml](../03-architecture/api-contracts/moderation-api.yaml)
> `OwnerModerationResult`). **M-14 (the ACTIVE→PENDING re-moderation transition + `escalated_at`
> reset) is split to Slice 4d — NOT in scope here.**
>
> **WHAT:** formalize the escalation-job invariants (SLA-1..5) and the embed invariants (EMB-1..4).
> **WHY:** 4c builds two independent, side-effect-light pieces on top of the already-normative
> SLA model (M-13, D1 reconciliation) and the 4a owner-result; they need explicit invariants so the
> job stays read-only and the embed stays leak-free.
> **WHY-BETTER-for-the-whole-project:** the escalation job is **pure read-side** (never mutates
> listing state) so it can ship without any risk to content; `escalated_at` makes emission
> at-least-once-safe and once-per-item; the embed reuses the 4a object-scope (no new authz surface)
> and is single-get-only (no list N+1). Both are additive — a consumer ignoring them keeps working.

### Slice-4c scope

**IN:** (A) the SLA-escalation job (scan PENDING_MODERATION past threshold → emit
`Moderation.Escalated` once per item via outbox; set `listings.escalated_at`); (B) the
`lastModerationResult` embed on `GET /listings/{id}`. **Deferred:** admin-notification **fan-out**
is the notification consumer of the event (emit-only in 4c; recommend the active fan-out as a
fast-follow — the queue **already** surfaces `escalated`/`slaState=ESCALATED` as a derived read, so
operators are not blind in the interim). **NOT in 4c (→ Slice 4d, M-14):** the ACTIVE→PENDING
re-moderation transition, the `escalated_at` **reset** on re-enqueue, resolve PATCH source-states,
species/breed re-moderation clarification.

### Invariants & negative cases

| # | Invariant (MUST hold) | Negative case (MUST be rejected/handled) | Enforced by | Error / signal |
|---|---|---|---|---|
| SLA-1 | **Idempotent emission:** `Moderation.Escalated` is emitted **at most once** per overdue item — `listings.escalated_at` is set in the **same transaction** as the outbox write; an item with `escalated_at` non-null is skipped. | two SLA ticks emitting two events for the same item. | service/job (`WHERE escalated_at IS NULL`) + outbox tx | exactly one outbox row per item |
| SLA-2 | **Single-instance run:** concurrent job ticks do not double-process — a Postgres **advisory lock** (distinct key) serializes the scan. | two worker instances both scanning + emitting. | `pg_advisory_lock`/`pg_try_advisory_lock` (distinct key — see flag for backend) | second tick no-ops |
| SLA-3 | **No state mutation:** the job **never** writes `status`/`moderation_status`; the item **stays PENDING_MODERATION** (M-13). | the job auto-rejecting/auto-approving/expiring an overdue item. | service/job (only `escalated_at` + outbox written) | n/a — invariant; backstop M-P0 trigger |
| SLA-4 | **Re-escalation after re-enqueue:** once `escalated_at` is reset (M-14/4d on ACTIVE→PENDING re-moderation), a newly-overdue item escalates again. | a re-enqueued item that can never escalate because `escalated_at` was never reset. | the reset is **4d's** responsibility (flagged); 4c only honours `escalated_at IS NULL` | n/a (cross-slice contract) |
| SLA-5 | **Threshold correctness:** escalate iff `waitingSeconds > threshold(market)` (pet <4h, livestock <6h business-hours — config, ADR-0003). Just-under = not escalated; just-over = escalated. | escalating an item just under threshold, or missing one just over. | service threshold check (config-driven) | n/a (correctness; QA boundary tests) |
| EMB-1 | **Owner-only & additive:** `lastModerationResult` is populated only for the listing **owner** (seller/org-admin) or MOD|ADMIN on `GET /listings/{id}`; **absent/null** for a non-owner/anonymous reader. | a non-owner read exposing moderation reason/notes/decider. | service object-scope (reuse 4a owner-result scope) | field omitted (no leak) |
| EMB-2 | **Agent-transparency surfaced:** an AGENT decision sets `decidedByAgent=true` + `decidedBy.principalType=AGENT` (Owner-decision #5). | hiding the AI-decided signal from the owner. | service projection (from the effective decision snapshot) | n/a (write-time projection) |
| EMB-3 | **Null when never-moderated:** a listing with no effective decision → `lastModerationResult = null`. | fabricating a result for an unmoderated listing. | service (null when no decision row) | null |
| EMB-4 | **Single-get only (no N+1):** the embed is on `GET /listings/{id}` only; the `GET /listings` **list** does NOT embed it. | adding it to the list response (a per-row moderation lookup / N+1 regression). | contract (Listing.lastModerationResult documented single-get-only) + service | not embedded in list |

**Event / codes:** new **event** `Moderation.Escalated` (Listing; payload `{entityId, market,
waitingSeconds, slaState}`; notification template `moderation_sla_escalated` → ADMIN). No new HTTP
error codes (4c is a job + an additive read field).

## Related Documents

- [Content Report State Machine](statemachines/content_report_state_machine.md)

- [Glossary](glossary.md)
- [Listing State Machine](statemachines/listing_state_machine.md)
- [Admin API](../03-architecture/api-contracts/admin-api.yaml)
- [Admin Domain](06-admin-domain.md)
- [Notification Domain](13-notification-domain.md)
- 🌐 RU mirror: [docsRU/specs/12-moderation-domain.md](../../docsRU/specs/12-moderation-domain.md)
