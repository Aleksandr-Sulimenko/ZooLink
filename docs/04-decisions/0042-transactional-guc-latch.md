# ADR-0042: Transactional GUC latch for a database-enforced lock

**Status**: Proposed
**Date**: 2026-08-08

> Landed with F1 Pack 4 (migration 0042). Gated by the holder (m-20260808-120146): rule 7 inverted after his review, rule 9 added.
> Author: orchestrator (zoolink track), by the holder's assignment.
> RU mirror: docsRU/04-decisions/0042-transactional-guc-latch.md

## Context and Problem Statement

Two independent locks in this codebase are enforced **in the database** (a trigger), yet must stay
openable for exactly one legitimate application path. Both solved it the same way: the service sets a
**transaction-local Postgres setting** (`SET LOCAL app.*`), and the trigger allows the otherwise-forbidden
write **iff** that setting is on.

- **Precedent 1 — `app.ownership_transfer`** (ADR-0013, migration `20260626_0023:105-107`): `animals`
  ownership columns are immutable; the transfer workflow lifts the lock inside its own transaction.
- **Precedent 2 — `app.reference_data_admin`** (this pack, migration `0042`): `species.market` must
  survive an unconditional migration replay that would otherwise overwrite an operator's decision on
  every boot; the admin reference-data path lifts the lock inside its own transaction.

A second occurrence is still a coincidence, but a pattern is named **on** the second one, because the
third arrives to whoever never saw the first two. Nothing today states the invariants of this technique,
so the third case would re-derive them by guessing — the exact failure mode directive №10 forbids.

## Decision Drivers

- **Truth in the database, not in a caller's discipline**: the lock must hold for *raw SQL too* (migration
  replay, psql, a future service) — otherwise it is a convention, not a lock.
- **One legitimate path stays open** without weakening the lock for anyone else (no-capability-regression
  law: a fence is added *on top of* an ability, never *instead of* it).
- **Failure direction must be loud on the human path**: a lock that silently swallows a human's write is
  the silent-failure class we systematically eliminate (Г-М1, this pack).
- **No new hidden state**: no flag column, no registry table that can rot apart from reality.
- **Blast radius on rollback** must be stated, because the lock (DB) and its key (code) are deployed by
  different mechanisms and can be reverted independently.

## Considered Options

### Option 1: Transaction-local GUC latch (`SET LOCAL app.*` + trigger check) — CHOSEN
The trigger denies the write unless `current_setting('app.<name>', true) = 'on'`; the one legitimate
service sets it with `set_config('app.<name>','on', true)` **inside the same transaction** as the write.

Pros:
- The lock is enforced against **every** writer, including raw SQL and replayed migrations.
- The key is scoped to a single transaction — it cannot leak to a later statement, request, or session
  (measured: after `COMMIT` the setting reads back as `''`, and the next transaction has no latch).
- Zero new schema state; nothing to keep in sync.
- Already proven in production code once (ADR-0013), so the idiom is familiar, not novel.

Cons:
- The key lives in application code ⇒ forgetting it turns a legitimate path into a failure. Mitigated by
  making that failure **loud** (see Consequences / Г-М1).
- Rollback needs a stated order (rule 7): reverting the code while the trigger still stands locks the
  legitimate path out — deliberately, because that failure is loud and costs availability, not data.
- A latch is *per transaction*, so a legitimate path split across transactions must set it in each.

### Option 2: `SECURITY DEFINER` function as the only writer
Revoke direct UPDATE, expose a function that performs the write.

Pros: no caller-side flag; the allowed operation is named explicitly.
Cons: moves business logic into the database (ADR-0007 keeps logic in the service); a much larger change;
grants/ownership become part of the deploy; ORM paths must be rewritten.

### Option 3: Application-only enforcement (drop the DB trigger)
Pros: simplest; nothing to remember in SQL.
Cons: **does not hold** for the very writer we are defending against — a replayed migration is raw SQL and
never passes through the service. This option cannot solve either precedent's problem.

### Option 4: Registry of applied migrations (for precedent 2 specifically)
Rejected by the holder in this pack, with the reason recorded because it generalises: it would make the
healing replay conditional, so a volume that drifted for *any other* reason gets stamped "applied" and
stays broken **while a table asserts health** — one mine traded for a bigger one (a false-green about DB
state). Also unatomic for the 27 migration files that carry their own `BEGIN;`.

## Decision

**Option 1.** A database-enforced lock that must stay open for exactly one application path uses a
**transaction-local GUC latch**, under the rules below.

### Rules (normative)

1. **Naming**: `app.<subject>_<capability>` in `snake_case`, always under the `app.` prefix
   (e.g. `app.ownership_transfer`, `app.reference_data_admin`). One latch per lock — never a shared
   "god latch" that opens several locks at once.
2. **Always `SET LOCAL` / `set_config(..., true)`** — the third argument `is_local = true` is mandatory.
   A session-scoped setting would outlive the write and silently open the lock for later statements.
3. **Always read with the missing-ok form**: `current_setting('app.x', true)` and compare with
   `IS DISTINCT FROM 'on'` (a two-argument read raises when the setting was never set; after `COMMIT` the
   value reads back as `''`, **not** NULL — an `IS NULL` check would be a false green).
4. **The latch is set in the same transaction as the write it authorises** — never in a preceding one, and
   never at connection setup. For Prisma/Kysely this means the write must run inside an explicit
   transaction that also issues the `set_config` (precedent: `transfer.service`).
5. **Failure direction is asymmetric and deliberate** (Г-М1, generalised): a write blocked by a missing
   latch must be **loud** (`RAISE EXCEPTION` naming the subject and a `HINT` for what to do) when the
   write comes from a human/application path, and may be **silent for the caller** only for the
   machine path the lock exists to stop — and even then it must leave a trace and be **counted** in the
   caller's own output (Г-М2), because a trace nobody reads is not a witness.
6. **Discriminating human-path from machine-path is done on the ROW'S HISTORY, not on a value that
   persists.** This rule is written in blood: the first draft of Г-М1 used "the actor column is not null
   in the new row", but that column stays non-null **forever** after the first operator edit — the lock
   would have raised on every replay of exactly the scenario it protects, and since services gate on the
   provisioner's success, **the stack would not have booted at all**. Use the *old* row plus the *change*
   in the actor column (i.e. does this statement stamp an actor), never the new value alone.
7. **Rollback order is part of the change: revert the CODE first, drop the trigger second.**
   *This rule was inverted in the first draft, and the reason it is written out is that the wrong order
   looks more logical.* Both windows, judged by failure direction (rule 5), not by convenience:
   - **code first** (chosen): the trigger still stands while the key is already gone ⇒ the legitimate path
     fails **loudly**, naming the subject, with a HINT. A **noisy, visible, temporary loss of
     availability — with no data loss.**
   - **trigger first** (rejected): between dropping the trigger and reverting the code there is **no lock**
     ⇒ a replay can **silently** overwrite the operator's decision, and — measured in this pack — there is
     nothing to restore it from, because the unconditional UPDATE runs before any later migration and
     destroys the prior value. A **silent, irreversible loss of data.**
   The rule follows from rule 5: we always choose noisy unavailability over silent loss. "A lock without
   its key" is true as a fact, but it describes *availability*, not *integrity* — and integrity wins.
8. **Every latch is registered here** (table below) so the third case finds the first two.
9. **Every new latch arrives with a RED-BEFORE.** A latch is not accepted until it is shown that the
   corresponding test is **RED without the trigger** and green with it. Without this, the third case will
   bring a latch that locks nothing, and we will find out on the fourth. (The verification section below is
   this pack's evidence; rule 9 makes it normative for future latches.)

### Registry of latches

| GUC | Lock it opens | Trigger / migration | Legitimate path | ADR |
|---|---|---|---|---|
| `app.ownership_transfer` | `animals.owner_id`/`organization_id` immutability | `trg_animals_immutable_and_owner` (0023) | ownership-transfer workflow (`transfer.service`) | ADR-0013 |
| `app.reference_data_admin` | `species.market` overwrite by replayed migration 0007 | `trg_species_market_replay_guard` (0042) | admin reference-data PATCH (`reference-data.service`) | this ADR |

## Consequences

**Positive**: the lock holds against raw SQL and replayed migrations; the key cannot leak beyond its
transaction; no new schema state; the pattern is now named, with its two known traps written down
(rule 3 — `''` not NULL; rule 6 — history, not persisted value).

**Negative / accepted**: forgetting the latch on a legitimate path is a hard failure — accepted precisely
*because* rule 5 makes it loud rather than silent. Rollback requires a stated order (rule 7: code first, trigger second — noisy unavailability over silent loss). A latch does not travel
across transactions.

**Known narrow hole (named, not hidden)**: when the latch is lost **and** the write carries the same actor
as already recorded **and** it matches the machine path's fingerprint, the suppression is silent for the
caller (a warning is emitted and it is counted per Г-М2, but no exception is raised). Fully closing it
would need a fragile mechanism (paired triggers on a transactional flag, or parsing `current_query()`),
and a fragile lock is worse than a named hole: it creates the *appearance* of protection and breaks
silently. Decision: **document, count, do not "fix" with fragility.**

## Verification (how this ADR is checked, not asserted)

- Latch does not outlive its transaction: after `COMMIT`, `current_setting('app.x', true)` returns `''`
  and the same write fails in the next transaction. *(Measured in this pack.)*
- Loud on the human path: the application path with the latch deliberately removed fails with the subject
  named and a `HINT`. *(Measured.)*
- Silent path leaves a counted trace: the provisioner prints `operator decisions preserved: N`, zero
  included. *(Г-М2.)*
- The lock holds for raw SQL: the replayed migration cannot overwrite an operator-owned row. *(Measured,
  with a red-before on the old form.)*
- Rule 6 regression guard: a row already edited by an operator does **not** raise on replay — i.e. the
  provisioner completes and services boot. *(Measured; this is the axis that the first draft would have
  failed.)*

## Related

ADR-0013 (first latch) · ADR-0007 (logic stays in the service, not the DB) · ADR-0018 (cross-aggregate
access) · ADR-0006 (agent-as-principal — an AI operator hits the *same* loud/silent asymmetry as a human) ·
AUDIT5 §F1d and the migration audit of 2026-08-08 (why precedent 2 exists) · agent-os memory:
`memory/reviewer-qa/lesson-optional-witness-proves-nothing.md`,
`memory/reviewer-qa/method-dated-fossil-proves-it-fired.md`,
`memory/shared/lesson-fix-two-paths-of-three.md` (three homes of one truth: canon, migration, meta-gate
registry) and its refinement `memory/shared/lesson-derived-artifact-resync-against-canon.md`.
*Names verified by lookup, not from memory — an unresolvable reference is a dead reference, and every one
of ours was born exactly this way.*
