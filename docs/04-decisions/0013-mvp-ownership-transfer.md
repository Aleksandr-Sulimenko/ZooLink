# ADR-0013: MVP Ownership Transfer — simplified direct transfer, controlled owner-lock path, deferred verification gates

**Status**: Accepted
**Date**: 2026-06-26
**Amends/clarifies**: [ADR-0004](0004-animal-as-aggregate.md) (animal aggregate owns its ownership-change rules), [ADR-0006](0006-ai-agents-operate-platform.md) / [ADR-0011](0011-agent-principal-actor-model.md) (a transfer can be initiated/approved by a HUMAN or AGENT principal — actor snapshot applies).
**Related**: [ADR-0002](0002-hard-split-markets.md), [ADR-0007](0007-orm-strategy.md) (SQL-canonical DB workflow), [ADR-0009](0009-mvp-vs-target-architecture.md) (modular monolith), [ADR-0010](0010-nft-digital-assets-hooks.md) (form-now/behaviour-gated precedent).

## Context and Problem Statement

We are starting **Animal Slice 2 — ownership transfer + history**. A **truth-hierarchy inversion** must be settled before any code is written:

- **Apex business requirement (in-scope).** `docs/02-requirements/business-requirements/animal-domain.md:56-61` (GAP-TRACE-007, normative) states ownership transfer **is supported** in MVP via a formal workflow that re-attributes the animal and records `ownership_transfers` + `animal_ownership_history` — explicitly **not** "create a new profile". This is the apex requirement and was already corrected in the BR.
- **Schema trigger (blocks it).** `database_schema.sql` function `trg_animals_immutable_and_owner` — the **effective** definition is the second `CREATE OR REPLACE` at ~line 1063 (it runs last, so it is canon) — `RAISE`s `'Changing ownership is not allowed during MVP phase.'` on **any** change to `owner_id` **or** `organization_id`. This physically blocks the apex requirement.
- **State machine (says post-MVP, models a heavy flow).** `docs/specs/statemachines/ownership_transfer_state_machine.md:6` MVP-note says the flow is post-MVP; the diagram models a heavy `PENDING → IN_PROGRESS → COMPLETED` flow gated by `payment_confirmed` / `vet_check` / `legal_docs`.
- **rbac-matrix (says locked).** `docs/specs/security/rbac-matrix.md:63` — "Animal ownership transfer | initiate/confirm own (locked in MVP)".
- **The table exists but is shaped for the heavy flow.** `ownership_transfers` (`database_schema.sql:508`, Prisma `schema.prisma:492`) has `from_user_id` / `to_user_id` / `status IN (PENDING,IN_PROGRESS,COMPLETED,FAILED)` / `from_confirmed` / `to_confirmed` / `payment_confirmed` / `failure_reason` / `expires_at`. `animal_ownership_history` (`database_schema.sql:219`) has `animal_id, owner_id, start_date, end_date, transfer_reason`. **No transfer API contract exists yet** — `animals-api.yaml` has only `GET /animals/{id}/ownership-history`.

The owner (user) has decided the MVP **shape**: a **simplified direct transfer**, not the heavy two-party verified flow. This ADR ratifies that shape, resolves the inversion toward the apex BR, decides the schema-shaping change to the lock, and hands clean briefs to alpha-analyst (contract) and backend-engineer (code + migration). Per `truth-hierarchy.md`, the conflict is fixed **toward the requirement**, not merely "to make artifacts match".

## Decision Drivers

1. **Apex business requirement wins** — transfer is in MVP scope; the schema lock and the two specs are the lower-tier artifacts that must change (truth-hierarchy.md).
2. **Form-now / behaviour-gated (phasing rule, `IMPLEMENTATION_PLAYBOOK.md §5`)** — the heavy verification (`payment_confirmed`/`vet`/`legal`/`IN_PROGRESS`) is deferred **behind a real gate**, not deleted; the table form already accommodates it. Mirrors ADR-0010 (NFT hooks) and Payment-behind-`feature_toggles`.
3. **Irreversibility of the data trail** — a transfer that re-attributes the animal must atomically append `animal_ownership_history` (close the prior interval, open the new one); a missed append is unrecoverable history loss. Same class of driver as ADR-0011 §1.
4. **Immutability invariants stay intact** — only the `owner_id`/`organization_id` lock is relaxed; `species_id`/`sex`/`date_of_birth`/`breed_id` immutability and the existing relaxed breed-normalization rule (`trg_animals_immutable_and_owner` ~1063) MUST remain enforced. The relaxation must be **narrow and controlled** — not "owner_id is now freely mutable".
5. **Agent-as-principal (ADR-0006/0011)** — a transfer may be initiated/accepted/overridden by a HUMAN **or** AGENT principal; the actor must be snapshotted on the transfer record (`{actor_id, principal_type}`), consistent with ADR-0011 §1/§6. No cross-column `principal_type ⟂ role` coupling (ADR-0011 §7).
6. **Two markets stay separated (ADR-0002)** — transfer rules are market-agnostic in MVP (no payment/vet/legal), so no per-market divergence is introduced now; the deferred verification gates are where market/jurisdiction differences will later live.

---

## §1 — Ratify MVP ownership transfer + the simplified direct-transfer shape

**Decision:** Ownership transfer **is in MVP** (resolves GAP-TRACE-007 toward the apex BR). The MVP shape is a **simplified direct transfer**:

> Current owner **initiates** a transfer of an animal to a recipient (an existing **user** or **organization**) → recipient **accepts** or **declines** → on **accept**, in **one transaction**: the animal's `owner_id`/`organization_id` is **atomically re-attributed**, the `ownership_transfers` row moves `PENDING → COMPLETED`, and `animal_ownership_history` is appended (close the prior owner's interval `end_date`, open the new owner's interval `start_date`). Initiator may **cancel** a still-`PENDING` transfer; an unaccepted transfer **expires** after a timeout.

**Explicitly deferred behind a gate (form exists, behaviour later):** the heavy verification phase — `IN_PROGRESS`, `payment_confirmed`, vet-check, legal/CITES docs, escrow, two-sided `from_confirmed && to_confirmed` mutual-acknowledgement-before-progress. These remain **modelled** in the (now clearly-labelled) post-MVP section of the state machine and the existing table columns are **kept as the forward-compatible form**. The MVP flow simply does **not transition through `IN_PROGRESS`** and does **not consult** `payment_confirmed`.

**Gate mechanism:** a `feature_toggles` row **`ownership_transfer_verification`** (default **off** in MVP), mirroring how Payment/NFT behaviour is gated (`feature_toggles.payments`, ADR-0010). When off → MVP direct flow (`PENDING → COMPLETED` on accept). When on (Phase 2) → the verification phase activates additively, reusing the already-present columns. **No schema rewrite** is required to turn it on. (The toggle is **form**: backend reads it; MVP ships it off.)

This follows ADR-0011's pattern exactly: *irreversible/rewrite-forcing form now (the transfer record, history append, actor snapshot, the controlled lock path); behaviour gated, default to the safe MVP value.*

---

## §2 — Trigger resolution: owner lock changes from "block all" to "controlled transfer path only"

The owner-lock must change from **"block every `owner_id`/`organization_id` change"** to **"`owner_id`/`organization_id` changes **only** through the controlled transfer path."** The immutable `species_id`/`sex`/`date_of_birth`/`breed_id` checks are **unchanged**.

**Considered options**

### Option A: Transaction-local GUC flag the transfer service sets, the trigger checks (Chosen)
The transfer service, inside the same transaction that re-attributes the animal, sets a transaction-local Postgres setting — `SET LOCAL app.ownership_transfer = 'on'` (or `set_config('app.ownership_transfer','on', true)`). The trigger, on an `owner_id`/`organization_id` change, allows it **iff** `current_setting('app.ownership_transfer', true) = 'on'`; otherwise it raises (message updated from "not allowed during MVP" to "only through the ownership-transfer workflow").

Pros:
- **Minimal, surgical** — one branch in the existing trigger; the immutable-field checks and the whole trigger structure are untouched.
- **`SET LOCAL` is transaction-scoped** — the permission cannot leak to another statement/connection; outside the transfer transaction the lock is fully in force. A stray `UPDATE animals SET owner_id=...` from anywhere else is still blocked.
- No new procedure/role/privilege; works with the existing Prisma+Kysely transaction the service already opens for the atomic re-attribution + history append.
- Forward-compatible: the same flag guards the Phase-2 verified-completion path unchanged.

Cons:
- The guarantee is "owner_id only changes when the service opts in", **not** "only this exact stored procedure may do it" — a future raw migration could set the flag. Acceptable: the trigger's job is to stop accidental/unaudited app-path mutation, not to defend against a superuser running arbitrary SQL (the DB-workflow already trusts migrations). The **invariants in §3 (history append, single active transfer, recipient≠owner)** are enforced in the service layer + table constraints, not assumed from the trigger.

### Option B: SECURITY DEFINER stored procedure `transfer_animal_ownership(...)` does the re-attribution
A single SQL function owns the `owner_id` update; the trigger checks `current_user`/a context that only the function sets.

Pros:
- Re-attribution is funnelled through exactly one named DB routine; strongest "only this path" guarantee.

Cons:
- Pushes transfer **business logic into the database** (history append, validation, actor snapshot, idempotency) — against this project's ORM strategy (ADR-0007: Prisma/Kysely in the service layer; SQL functions reserved for triggers/integrity, not orchestration).
- Harder to test/observe than service code; duplicates logic that already lives in NestJS; the actor/principal resolution (ADR-0011) lives in the app, not the DB.
- Heavier to evolve when the verification phase turns on.

### Option C: Drop the owner_id branch from the trigger; rely solely on the service layer
Remove the lock entirely; the application is the only thing that changes `owner_id`.

Cons:
- Removes defense-in-depth: a bug, a bad migration, or a future careless `UPDATE` could silently re-attribute an animal with **no history append** — exactly the unrecoverable data-trail loss driver #3 warns against. The whole point of the trigger is to make "owner changed without going through transfer" impossible. Rejected.

**Decision: Option A** — a transaction-local GUC (`app.ownership_transfer`) that the transfer service sets and the trigger checks. Keep all immutable-field checks; only the owner/org branch becomes conditional.

**ЧТО (WHAT):** Change `trg_animals_immutable_and_owner` so the `owner_id`/`organization_id`-change branch raises **unless** `current_setting('app.ownership_transfer', true) = 'on'`; update the exception text to "Changing ownership is only allowed through the ownership-transfer workflow." All other (`species_id`/`sex`/`date_of_birth`/`breed_id`) checks unchanged.
**ПОЧЕМУ (WHY):** The apex BR requires controlled ownership change; a blanket block contradicts it, while removing the lock loses the defense-in-depth that guarantees every re-attribution is accompanied by a history append.
**ПОЧЕМУ ТАК ЛУЧШЕ (WHY-BETTER for the whole project):** Smallest possible relaxation of a safety invariant (one conditional branch, transaction-scoped, leak-proof outside the transfer txn); keeps integrity logic in a trigger and orchestration in the service (honours ADR-0007); the same flag transparently guards the Phase-2 verified path (no future trigger rewrite); no new role/grant/procedure. The stronger SECURITY-DEFINER option was rejected for pushing business logic into the DB against the ORM strategy; the no-lock option was rejected for losing the history-append guarantee. **First use of the `app.*` GUC idiom in this codebase — see Implementation Notes for the convention.**

---

## §3 — `ownership_transfers` MVP lifecycle, mapped onto the existing columns

**MVP states used now:** `PENDING`, `COMPLETED`, and a terminal **`CANCELLED`** (initiator-cancel / recipient-decline / expiry). **`IN_PROGRESS` is reserved (Phase-2)**; **`FAILED` is reserved for the verified flow** (a verification check failing). Decline/cancel/expire in MVP are **not** "FAILED" (no verification failed) — they are `CANCELLED`. This **reconciles** the state machine's single `FAILED` bucket by splitting "the parties chose not to proceed" (`CANCELLED`, MVP) from "a verification gate failed" (`FAILED`, Phase-2).

**Transitions (MVP):**
| From | To | Trigger | Guard |
|---|---|---|---|
| `[*]` | `PENDING` | initiate | initiator is current owner; recipient ≠ current owner; no other active `PENDING` for this animal |
| `PENDING` | `COMPLETED` | recipient **accepts** | recipient is the named `to_*`; transfer not expired | atomic: re-attribute animal + append history + set `completed_at` |
| `PENDING` | `CANCELLED` | recipient **declines** | recipient is the named `to_*` | record `failure_reason='declined'` |
| `PENDING` | `CANCELLED` | initiator **cancels** | actor is the initiator | record `failure_reason='cancelled_by_initiator'` |
| `PENDING` | `CANCELLED` | **expiry** | `now() > expires_at` (worker/lazy) | record `failure_reason='expired'` |
| `COMPLETED` | `[*]` | terminal | — |
| `CANCELLED` | `[*]` | terminal (a new transfer may be initiated) | — |

**Invariants (MVP):**
1. Only the **current owner** (the animal's present `owner_id`, or an authorized org-admin of the present `organization_id`) may initiate.
2. **Recipient ≠ current owner** (no self-transfer).
3. **At most one active `PENDING` transfer per animal** at a time (a second initiate while one is PENDING is rejected) — enforced by a **partial unique index** `UNIQUE (animal_id) WHERE status = 'PENDING'`.
4. On accept, **atomic** (one transaction): animal re-attribution (under the §2 GUC) + `ownership_transfers.status=COMPLETED` + `animal_ownership_history` append (close old interval `end_date`, open new `start_date`) + `animals.owned_since` updated. All-or-nothing.
5. The transfer record snapshots the **acting principal** of each act (ADR-0006/0011): who initiated and who accepted/declined, each as `{actor_id, principal_type}`.
6. `expires_at` is set at initiate (default timeout — see open question OQ-2 for the value).

**Mapping onto the EXISTING `ownership_transfers` columns + required deltas:**

| MVP need | Existing column | Status |
|---|---|---|
| animal | `animal_id` | ✅ exists |
| from (user) | `from_user_id` | ✅ exists |
| to (user) | `to_user_id` | ✅ exists |
| status incl. CANCELLED | `status` CHECK = `(PENDING,IN_PROGRESS,COMPLETED,FAILED)` | ⚠️ **DELTA — add `CANCELLED`** to the CHECK |
| decline/cancel/expiry reason | `failure_reason` | ✅ reuse (rename-in-concept to "terminal reason"; no column rename needed) |
| expiry | `expires_at` | ✅ exists |
| two-sided ack (deferred) | `from_confirmed`/`to_confirmed` | ✅ keep as Phase-2 form (unused in MVP direct flow) |
| payment (deferred) | `payment_confirmed` | ✅ keep as Phase-2 form (unused in MVP) |
| **transfer to an ORGANIZATION** | — | 🔴 **DELTA — missing.** Animals can be org-owned (`animals.organization_id`), and the BR says transfer to "user **or** organization". The table only has `from_user_id`/`to_user_id`. **Add `from_organization_id`/`to_organization_id`** (nullable FK→`organizations`), with a CHECK that each side has **exactly one** of user/org set (mirroring `animals` chk_animals_owner). |
| **completed_at** | — | ⚠️ **DELTA — add** `completed_at TIMESTAMPTZ NULL` (when the transfer finalized; distinct from `updated_at`). |
| **actor snapshot** (initiator/acceptor principal_type) | — | ⚠️ **DELTA — add** `initiated_by_principal_type`/`responded_by_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN' CHECK IN (HUMAN,AGENT)` (ADR-0011 §1/§6 parity). `from_user_id` already records *which* user initiated; the principal_type snapshot records *what kind*. |
| **transfer_reason** (free text the initiator gives) | — | ⚠️ **DELTA — add** `transfer_reason TEXT NULL` (the `animals-api.yaml` already exposes a `transferReason` field on history; the transfer that produced it should carry it). Mirrors `animal_ownership_history.transfer_reason`. |
| single active PENDING | — | ⚠️ **DELTA — add** partial unique index `UNIQUE (animal_id) WHERE status='PENDING'`. |

`animal_ownership_history` **needs one delta** to support org-owned animals (**OQ-1 RESOLVED — user *and* org transfer is in MVP**, owner-confirmed): today `owner_id` is `NOT NULL REFERENCES users`, but an org-owned animal has no user owner, so the history table mirrors the `animals` ownership shape:

| MVP need | Existing column | Status |
|---|---|---|
| user owner | `owner_id` | ⚠️ **DELTA — make NULLABLE** (was `NOT NULL`) |
| org owner | — | 🔴 **DELTA — add** `organization_id UUID NULL REFERENCES organizations(id) ON DELETE RESTRICT` |
| exactly-one-of | — | ⚠️ **DELTA — add** CHECK `(owner_id IS NOT NULL AND organization_id IS NULL) OR (owner_id IS NULL AND organization_id IS NOT NULL)` (mirrors `animals` chk_animals_owner) |
| index | — | add `CREATE INDEX idx_aoh_org ON animal_ownership_history(organization_id) WHERE organization_id IS NOT NULL` (parity with `idx_aoh_owner`) |

`animal_id, start_date, end_date, transfer_reason` are unchanged. This is part of the **confirmed** migration (no longer an open question). Note: making `owner_id` nullable means any existing index/FK assuming non-null still holds for user-owned rows; backend must confirm `idx_aoh_owner` stays valid (it does — partial-friendly).

**ЧТО:** MVP lifecycle = `PENDING → {COMPLETED | CANCELLED}`; `IN_PROGRESS`/`FAILED` reserved Phase-2; column deltas above.
**ПОЧЕМУ:** The existing table was shaped for the heavy flow and is **missing the org-transfer columns** the BR requires and the actor snapshot ADR-0011 requires; `CANCELLED` cleanly separates "parties stopped" from "verification failed".
**ПОЧЕМУ ТАК ЛУЧШЕ:** Reuses the existing table and its Phase-2 columns (no throwaway), adds only what MVP genuinely needs, keeps the actor model consistent platform-wide (ADR-0011), and makes the single-active-PENDING and exactly-one-of-user/org invariants DB-enforced rather than service-only.

---

## §4 — Doc reconciliations owed (doc-first; each carries the triple)

These artifacts are **lower in the truth hierarchy** than the BR and must be brought in line. Each edit carries its own WHAT/WHY/WHY-BETTER triple in its commit (per `doc-code-protocol.md`); EN↔RU must mirror (delegate the mechanical mirror to **doc-keeper**).

1. **`docs/specs/statemachines/ownership_transfer_state_machine.md`** — rewrite the MVP-note (line 6): transfer is **in MVP** as a **simplified direct flow** (`PENDING → COMPLETED` on accept, `PENDING → CANCELLED` on decline/cancel/expire). Clearly label the `IN_PROGRESS`/payment/vet/legal section as **Phase-2, gated by `feature_toggles.ownership_transfer_verification`**. Add `CANCELLED` to the diagram (MVP terminal) and clarify `FAILED` is the Phase-2 verification-failure terminal. *(alpha-analyst authors the normative state detail; doc-keeper mirrors.)*
2. **`docs/specs/security/rbac-matrix.md:63`** — replace "initiate/confirm own (locked in MVP)" with the **real MVP transfer permissions**: USER = initiate own (as current owner) / accept-or-decline incoming / cancel own-initiated; MODERATOR = R; ADMIN = R/U (override). Row applies identically regardless of `principal_type` (ADR-0011 §7).
3. **`docs/specs/02-animal-domain.md`** — add a `(round-N, normative)` section specifying the MVP transfer rules (states, transitions, invariants from §3), referencing this ADR and the state machine. Update the implementation-checklist line 59 ("ownership transfer") to point at the simplified flow.
4. **`docs/02-requirements/business-requirements/animal-domain.md:56-61`** — already corrected (GAP-TRACE-007). **Confirm**, no further edit; this ADR ratifies it.
5. **`REQUIREMENTS_TRACEABILITY_GAP_AUDIT.md`** — mark **GAP-TRACE-007 resolved** (BR corrected + ADR-0013 ratifies + specs reconciled).
6. **`docs/03-architecture/data-model.md`** + **`ZooLink_ERD.mmd`** — add the `ownership_transfers` deltas (org columns, `completed_at`, principal_type snapshots, `transfer_reason`, CANCELLED status, partial unique index) **and the `animal_ownership_history` deltas** (`owner_id` nullable, new `organization_id` FK, exactly-one-of CHECK, `idx_aoh_org`).

---

## §5 — Contract surface for alpha-analyst

Endpoints the simplified flow needs (author against `API_CONVENTIONS.md`; URI `/v1`; RFC7807 errors; `{actor_id, principal_type}` on actor-bearing responses per ADR-0011 §6):

| Endpoint | Purpose | Actor / authz | Idempotency / concurrency |
|---|---|---|---|
| `POST /animals/{id}/transfers` | **initiate** (body: recipient user or org, optional `transferReason`) | caller must be current owner (or org-admin of owning org) | `Idempotency-Key` (24h); reject if an active `PENDING` exists (409) |
| `POST /transfers/{transferId}/accept` | recipient **accepts** → re-attribute | caller must be the named recipient | `ETag`/`If-Match` on the transfer (412/428) to avoid double-accept; atomic |
| `POST /transfers/{transferId}/decline` | recipient **declines** | caller must be the named recipient | `If-Match` |
| `POST /transfers/{transferId}/cancel` | initiator **cancels** a PENDING | caller must be the initiator | `If-Match` |
| `GET /transfers/{transferId}` | read one transfer | initiator, recipient, MODERATOR, ADMIN | `ETag` |
| `GET /transfers?role=initiated\|incoming&status=...` | list **my** transfers | the authenticated principal | `page`/`limit` + `PageMeta` |
| `GET /animals/{id}/ownership-history` | **exists** — keep | owner / MODERATOR / ADMIN | `ETag`/`Cache-Control` |

Concurrency expectations to specify: single-active-PENDING (409 on duplicate initiate), accept is idempotent under `Idempotency-Key`, **expiry is lazy-on-read** (no background worker — OQ-2 resolved): a `PENDING` transfer past `expires_at` is treated as `CANCELLED(reason='expired')` the next time it is read/accepted/listed (and the terminal status is persisted at that point). The accept response carries the new owner and the appended history interval.

---

## Decision (summary)

1. Ownership transfer **is in MVP** as a **simplified direct transfer** (`PENDING → COMPLETED` on accept; `PENDING → CANCELLED` on decline/cancel/expire). GAP-TRACE-007 resolved toward the apex BR.
2. The owner-lock trigger relaxes to a **controlled path** via a **transaction-local GUC** `app.ownership_transfer` (Option A); immutable `species/sex/DoB/breed` checks untouched.
3. Heavy verification (`IN_PROGRESS`/payment/vet/legal/escrow/two-sided-ack) is **deferred behind `feature_toggles.ownership_transfer_verification`** (default off), reusing the existing table columns as forward-compatible form.
4. `ownership_transfers` gets a migration delta: `CANCELLED` status, `from/to_organization_id` (+ exactly-one-of-user/org CHECK), `completed_at`, `initiated_by/responded_by_principal_type`, `transfer_reason`, partial unique index on `(animal_id) WHERE status='PENDING'`. **`animal_ownership_history` also gets a delta** (OQ-1 resolved): `owner_id` made nullable + new nullable `organization_id` FK + exactly-one-of(owner_id, organization_id) CHECK + `idx_aoh_org`.
5. **Expiry = 72h, lazy-on-read** (OQ-2 resolved); **accept/decline is the sufficient MVP legal trail, no KYC/agreement artifact** (OQ-3 resolved) — CITES/legal_docs verification stays deferred behind `feature_toggles.ownership_transfer_verification`.
6. Doc reconciliations (§4) and the contract surface (§5) are handed to doc-keeper / alpha-analyst; service invariants + negative tests to backend-engineer.

## Consequences

### Positive
- Apex requirement satisfied; one canonical truth across BR↔ADR↔schema↔spec↔contract.
- Pedigree/identity/audit preserved (re-attribution, never re-register); history append is atomic and trigger-guarded.
- Agent-ready: a transfer can be initiated/accepted by a HUMAN or AGENT principal, snapshotted per ADR-0011 — no future rewrite to let an agent broker transfers.
- Phase-2 verified transfer turns on additively (a feature toggle + the already-present columns), no schema rewrite.

### Negative
- A migration delta on an existing table (new columns + CHECK widen + partial unique index) and a trigger edit.
- Introduces the `app.*` GUC idiom (a new convention to document and use consistently).
- Org-transfer adds a second migrated table (`animal_ownership_history` gains org column + nullable owner_id + CHECK) alongside the `ownership_transfers` delta.

### Neutral
- MVP ships the verification toggle **off**; no payment/vet/legal behaviour exists yet.
- `from_confirmed`/`to_confirmed`/`payment_confirmed` stay as dormant Phase-2 form.

## Open Questions — RESOLVED (2026-06-26)

All three are resolved with the architect's recommended options. Each took the safe, BR-aligned, forward-compatible choice; none changes the ratified core. Provenance differs per question — see the note below.

- **OQ-1 — `animal_ownership_history` for org-owned animals → RESOLVED: option (a) (owner decision).** User **and** org transfer is in MVP. The history table mirrors the `animals` ownership shape: `owner_id` becomes nullable + a nullable `organization_id` FK + exactly-one-of(owner_id, organization_id) CHECK + `idx_aoh_org`. *Rationale:* the BR says transfer to "user **or** organization"; recording an org-admin user as the historical owner (rejected option (b)) would misattribute the trail, and deferring org-transfer (rejected (c)) would under-deliver the BR. Folded into the §3 confirmed migration.
- **OQ-2 — transfer expiry → RESOLVED: 72h, lazy-on-read, no background worker (orchestrator-accepted default = architect recommendation; owner may revise).** A `PENDING` transfer past `expires_at` is treated/persisted as `CANCELLED(reason='expired')` on next read/accept/list. *Rationale:* 72h matches the state-machine constant; lazy-on-read avoids standing up a scheduler in MVP (a worker can be added later without changing the contract, and would tie into the GAP-TRACE-012 listing-expirer when that lands).
- **OQ-3 — MVP legal trail → RESOLVED: accept/decline is sufficient; no KYC/agreement artifact in MVP (owner decision).** *Rationale:* an MVP pet/livestock ownership change needs only recipient consent (the recorded accept) for its audit trail; CITES/regulated-species `legal_docs` verification stays deferred behind `feature_toggles.ownership_transfer_verification`, where jurisdiction/market rules will later live (ADR-0002).

> **Provenance note:** Per the orchestrator's account, **OQ-1 and OQ-3 were answered directly by the owner** (selected from explicit options on 2026-06-26) — they are owner-authoritative. **OQ-2 (72h / lazy-on-read) was an orchestrator-accepted sensible default**, which happens to equal the architect's own recommendation; the owner has not explicitly picked it and **may revise** it (it is the lightest-weight of the three to change — a constant + read-path behaviour, no contract break). All three coincide with the architect's recommended safe options, so none introduces new risk or changes a ratified decision. A later direct owner statement on any question supersedes this section (the owner is the apex source) and amends this ADR.

## Related Decisions
- [ADR-0004](0004-animal-as-aggregate.md) — the animal aggregate owns ownership-change rules; this ADR defines them for MVP.
- [ADR-0006](0006-ai-agents-operate-platform.md) / [ADR-0011](0011-agent-principal-actor-model.md) — actor snapshot `{actor_id, principal_type}` applies to transfer acts.
- [ADR-0010](0010-nft-digital-assets-hooks.md) — precedent for "form now, behaviour behind a feature toggle".
- [ADR-0007](0007-orm-strategy.md) — why the lock stays a trigger and orchestration stays in the service (rejecting Option B).
- [ADR-0002](0002-hard-split-markets.md) — markets stay separate; deferred verification is where market/jurisdiction rules later diverge.

## References
- `docs/02-requirements/business-requirements/animal-domain.md:56-61` (GAP-TRACE-007, apex BR).
- `database_schema.sql` — `trg_animals_immutable_and_owner` (~663 first def, **~1063 effective def**), `ownership_transfers` (~508), `animal_ownership_history` (~219), `animals` chk_animals_owner (~233).
- `docs/specs/statemachines/ownership_transfer_state_machine.md`, `docs/specs/security/rbac-matrix.md:63`, `docs/specs/02-animal-domain.md`.
- `docs/03-architecture/api-contracts/animals-api.yaml` (existing ownership-history GET + `transferReason`).
- `IMPLEMENTATION_PLAYBOOK.md §3` (DB-workflow), `§5` (phase-boundary / rewrite test); `agent-os/instructions/truth-hierarchy.md`, `doc-code-protocol.md`.

## Implementation Notes — the `app.*` GUC convention (new)
- The transfer service opens the transaction, runs `SELECT set_config('app.ownership_transfer','on', true)` (the `true` third arg = transaction-local, equivalent to `SET LOCAL`), performs the animal re-attribution + history append, commits. The flag auto-clears at transaction end — it cannot leak to another statement, connection, or pooled session.
- The trigger reads `current_setting('app.ownership_transfer', true)` (the `true` = "missing → NULL, don't error") and treats anything other than `'on'` as "blocked".
- This is the **first** `app.*` custom GUC in the codebase. Establish it as the convention for "the service explicitly opts into a normally-blocked controlled mutation"; document it in `data-model.md`. Backend must ensure the `set_config` and the mutation are in the **same** Prisma/Kysely transaction.
