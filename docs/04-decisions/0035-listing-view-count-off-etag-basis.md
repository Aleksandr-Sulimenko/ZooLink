# ADR-0035: Listing ETag / optimistic-concurrency basis decoupled from `updated_at` (view-count off the concurrency path)

**Status**: Accepted
**Date**: 2026-07-08

## Context and Problem Statement

`listings.view_count` (migration 0031, ADR-0018/Wave-D lineage) is a best-effort funnel-top
counter incremented on the **public** detail read `GET /v1/listings/{id}`:

```
// listing.service.ts captureView (:294)
await this.prisma.listings.update({ where: { id: row.id }, data: { view_count: { increment: 1 } } });
```

The schema attaches a **generic** `updated_at` trigger to *every* table that has an `updated_at`
column (migration 0013, `database_schema.sql:675-707`):

```
CREATE OR REPLACE FUNCTION update_updated_at_column() ... NEW.updated_at = NOW(); ...
-- auto-attached BEFORE UPDATE to listings (and all such tables)
```

So the trigger sets `updated_at = NOW()` on **any** UPDATE to the row — including the view-count
increment. And the listing's **ETag is derived from `updated_at`**:

```
// listing.service.ts etag() (:1246)
private etag(row: ListingRow): string { return weakEtag(`listing:${row.id}`, row.updated_at); }
// etag.util.ts weakEtag(id, updatedAt) → W/"sha1(id:updatedAt.toISOString())"
```

The ETag is the **optimistic-concurrency validator** for mutating PATCHes: `assertIfMatch`
(`etag.util.ts:23`) rejects a stale `If-Match` with **412 STALE_RESOURCE**. Two structural
consequences follow, both confirmed by code inspection (AUDIT4 architect finding #1, backend-engineer,
data-analyst; the trash-lens weaponizes them):

1. **Correctness / availability bug — spurious 412 edit-lockout.** Every counted anonymous view
   bumps `updated_at` → the public-read ETag changes on every hit. A seller (or an operator, or an
   AI operator per ADR-0006) who fetched the listing and holds its ETag gets a **412** on their next
   `If-Match` PATCH, because read traffic moved the validator between their GET and their PATCH. On a
   popular listing the owner can be **perpetually locked out of editing** with no error they can act
   on. This is a trivial **griefing / DoS lever**: an attacker rotating IPs (the anon dedup key) or
   refreshing across the 30-min Redis dedup window floods a competitor's listing with views → its
   `updated_at` churns → the victim's edits perpetually 412.

2. **Read-path writes to the entity row.** The public read issues a row-level `UPDATE` on the primary
   `listings` table: hot-row lock contention and MVCC bloat on the hottest query surface, plus the
   conditional-GET `ETag`/`Cache-Control` on that endpoint is busted on every hit (caching defeated).

The defect is **not specific to `view_count`.** The same trigger already moves `updated_at` (and thus
the ETag) when the app writes other **system/derived** columns that live on the listings row and that
a client's edit does not conflict with: `escalated_at` (SLA marker, migration 0024), the D3 `market`
cache recompute (migration 0033), `moderation_enqueued_at`. The root cause is that the ETag — which
must be a **content validator** — is wired to `updated_at`, a **physical row-mtime** that any write
moves. Fixing only `view_count` would leave the same class of bug for every other non-content write.

This ADR fixes the structural question (what the ETag / optimistic-concurrency token is derived from,
and where the view counter lives) so a backend slice can implement it. It writes **no code**.

## Decision Drivers

- **Fix the 412 / ETag breakage (mandatory).** A public read must not change a listing's ETag and must
  not cause a subsequent `If-Match` PATCH to 412. This is a correctness + availability + anti-griefing
  requirement, ranked first.
- **Remove read-path writes to the concurrency basis.** The value the ETag is derived from must never
  be written by a read.
- **General, not view_count-specific.** `escalated_at`, the D3 `market` recompute and other system
  writes exhibit the same ETag-bust; the fix should neutralise the class, not one instance.
- **Semantic truth.** An optimistic-concurrency validator should track **client-visible content/state
  changes** ("did the thing I'm editing change since I fetched it?"), not "was the row physically
  touched". `updated_at` conflates the two.
- **Cost-of-change, anti-rewrite (phase by cost, not label).** Prefer the fix that is cheap now, that
  does **not** get thrown away by a later scale evolution, and that does not force a contract rewrite
  when the counter later moves off-row.
- **No analytics regression (ADR-0006 agent-run business).** `view_count` is intentionally a scalar,
  advisory, best-effort counter (data-analyst, migration 0031 — the ONE irreversibly-lost signal). The
  fix must keep it working and must not degrade it. An agent-run business optimises on metrics.
- **N-1 rolling-deploy write-compat.** Any new NOT NULL column on an app-written table needs a DEFAULT
  or trigger so N-1 pods that don't know the column can still INSERT (the mig-0033 lesson).

## Considered Options

### Option A: Decouple the ETag basis — a dedicated content-version column

Add `listings.content_updated_at TIMESTAMPTZ` (a *content* validator). Bump it to `now()` only on
writes that change **client-visible listing state** — the same writes that legitimately set
`updated_at = new Date()` in the service today (create, material/draft edit, submit, moderation
approve/reject/changes, withdraw/deactivate, mark-sold) and the two cascade-deactivation DB functions
(migration 0025 lineage). Derive the ETag from **`content_updated_at`**, not `updated_at`. System /
derived writes (`view_count` increment, `escalated_at`, D3 `market` recompute) do **not** touch it. The
view counter stays on-row (`view_count`), and its increment no longer affects the ETag. `updated_at`
keeps its meaning (physical mtime) and its generic trigger is untouched.

Pros:
- **Fixes #1 completely** — a view (or any system write) leaves `content_updated_at`, hence the ETag,
  unchanged; the seller's `If-Match` PATCH no longer 412s. The griefing/edit-lockout lever is closed.
- **Fixes the whole class, not just view_count** — `escalated_at`, the market recompute, etc. also stop
  busting the ETag, because only genuine content/state changes bump the validator.
- **Semantically correct and permanent.** The ETag becomes a true content validator. This is the right
  basis *regardless of scale* — it is **not** superseded by a later off-row counter (Option C); it
  composes with it. Non-throwaway.
- **Cheap now:** one nullable-then-NOT-NULL column + a backfill; the `etag()` method swaps one field;
  the mutation paths already thread `updated_at: new Date()`, so adding `content_updated_at: <sameDate>`
  is mechanical and lives in the domain layer where "what is a content change" already belongs.
- **No analytics regression** — `view_count` is untouched; the increment path is unchanged.
- **The generic `updated_at` trigger stays generic** (no column-awareness leaked into shared infra).

Cons:
- Does **not** by itself remove the hot-row `UPDATE`-on-read (view still writes the row) — MVCC/lock
  contention and the write-amplification lever remain (mitigated by the 30-min Redis dedup; addressed
  structurally by Option C, reserved below).
- The service must set `content_updated_at` at each content/state write, and the two cascade DB
  functions must set it too — a finite, enumerable writer set, but it must be got right (guarded by
  tests) or a state change could leave the validator stale.

### Option B: Make the `updated_at` trigger no-op when only `view_count` changed

Modify `update_updated_at_column()` (or the listings trigger) to skip `NEW.updated_at = NOW()` when the
only changed column is `view_count` (`NEW IS DISTINCT FROM OLD` excluding `view_count`). Keeps the ETag
on `updated_at` and the counter on-row.

Pros:
- Smallest migration; both symptoms (ETag bust + `updated_at` churn) disappear for the view path.
- Counter stays on-row; no read-path type change.

Cons:
- **Leaks column-awareness into shared infra.** The trigger is auto-attached to *every* `updated_at`
  table by an elegant derivation (migration 0013); special-casing `view_count` couples a generic
  function to one table's column, and Postgres has no clean "distinct excluding a column" — you
  hard-code the excluded column list, which must grow every time another hot/derived column appears.
- **Solves only `view_count`.** `escalated_at`, the D3 `market` recompute and any future derived column
  still bust the ETag — the class is not fixed.
- Keeps the ETag conflated with physical mtime (semantically muddy); it merely hides one writer.
- **Does not remove the hot-row `UPDATE`-on-read** — contention and the write-amplification DoS lever
  remain, same as A.

### Option C: Move the counter off the entity row entirely

Move `view_count` to a sibling `listing_stats` table (or a Redis-authoritative counter periodically
flushed by a worker tick, mirroring the `MODERATION_ESCALATION_TICK` advisory-lock pattern of migration
0024). The `listings` row is never written on a read.

Pros:
- **Scale-ideal:** removes the read-path write entirely → no ETag bust, no 412, no hot-row contention,
  no MVCC bloat, and no write-amplification DoS lever (the trash-lens finding is fully closed).
- The right long-term end-state for a high-frequency counter.

Cons:
- **Largest change now:** a sibling table (or Redis-authoritative store) + a flush worker + a read-path
  join + repointing `getAnalytics`/`toView` to the new source + durability/loss semantics between
  flushes. A whole slice, for a scale concern that is not yet load-bearing at MVP volume.
- Does **not**, on its own, fix the ETag basis: even with the counter off-row, `escalated_at` / the D3
  recompute still bump `updated_at`. Option C without Option A leaves the class-of-bug open — so the
  correct ETag basis (A) is needed either way.
- Pulling full scale work forward now is not justified by cost-of-change: after A, moving the counter
  off-row later is an **internal refactor**, not a contract change (the ETag basis is already
  `content_updated_at`, and `view_count` is already read through a single service accessor). Deferral
  does **not** force a rewrite.

## Decision

Adopt **Option A now**, and **reserve Option C** as the documented Phase-2 / scale evolution behind the
seam that A establishes. Reject Option B (leaky, partial).

1. **New content-version column.** Add `listings.content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`.
   It is the listing's **content/state validator**. Backfilled once from `updated_at` (the best
   available approximation of "last real change"); `DEFAULT now()` is retained permanently for N-1
   write-compat (an N-1 pod that INSERTs without the column lands a sensible "created now" value).

2. **ETag basis change.** `listing.service.ts etag()` derives the ETag from `content_updated_at`, not
   `updated_at`: `weakEtag(\`listing:${row.id}\`, row.content_updated_at)`. `assertIfMatch` /
   `If-Match` are unchanged; they now compare against a validator a read never moves. The
   `weakEtag(id, Date)` helper signature is unchanged (minimal blast radius).

3. **What bumps the validator (the content/state write set).** `content_updated_at = <now>` is set by
   **every writer that changes client-visible listing state, and by no other**:
   - **Bumps it:** `create` (via DEFAULT on INSERT), `update` (draft + material edit), `submit`
     (→ PENDING_MODERATION), moderation approve/reject/changes-requested (status/moderation_status),
     withdraw/deactivate, mark-sold — i.e. alongside each existing `updated_at: new Date()` in the
     service, set `content_updated_at` to the **same** `Date` — **and** the two cascade-deactivation DB
     functions (`cascade_animal_deactivation` / `cascade_user_deactivation`, migration 0025 lineage)
     add `content_updated_at = now()` beside their existing `status/is_active/updated_at` writes, so a
     DB-driven state change stays truthful.
   - **Does NOT bump it:** the `captureView` `view_count` increment (`:294`), the D3
     `recomputeMarketForSpecies` `market` write (`:789`), the `escalated_at` SLA-marker write (migration
     0024), and any future system/derived write. These deliberately omit `content_updated_at` from their
     `data:`, so the validator — and the ETag — is unmoved.

4. **Counter stays on-row for MVP; off-row reserved.** `view_count` remains a `listings` column and its
   best-effort deduped increment path (migration 0031) is unchanged — **no analytics regression**. The
   remaining read-path row-write (hot-row contention + write-amplification lever) is **accepted at MVP
   volume** behind the existing 30-min Redis dedup, and is the trigger for **Option C** (off-row counter
   via a `listing_stats` sibling or Redis-authoritative + flush-tick) when discovery caching / real
   read volume arrives. Because A already fixes the ETag basis and `view_count` is read through a single
   accessor, that move is an internal refactor, not a contract break — a superseding ADR when it lands.

5. **Analytics sub-resource ETag unchanged (intentional scoping).** `getAnalytics`'s ETag
   (`listing.service.ts:772`, `weakEtag(\`analytics:${id}\`, lastActivityAt ?? updated_at)`) is **not**
   changed: it is a separate read-only resource with no mutating PATCH (no `If-Match`), and its ETag
   *should* reflect view/activity changes. Only the primary listing ETag moves to `content_updated_at`.

## Consequences

### Positive
- A public read no longer changes a listing's ETag; the seller/operator `If-Match` PATCH no longer
  spuriously 412s — the edit-lockout correctness bug and the view-flood griefing lever are closed.
- The fix is **general**: `escalated_at`, the D3 `market` recompute, `moderation_enqueued_at` and any
  future derived write also stop busting the ETag, because only real content/state changes bump the
  validator. The class of bug is closed, not one instance.
- The ETag becomes a semantically correct **content validator**; optimistic concurrency still works for
  genuine edits (a real content change bumps the validator → a stale `If-Match` correctly 412s).
- Conditional-GET caching on the hot public read is restored (the ETag stops churning on view traffic).
- `view_count` and its analytics use are untouched — no regression on the one irreversible signal.
- The change is small and lives in the domain layer; the generic `updated_at` trigger stays generic.
- Composes cleanly with the reserved off-row counter (Option C) — A is not thrown away by it.

### Negative
- The read-path row-`UPDATE` for `view_count` remains at MVP (hot-row contention + write-amplification
  lever), accepted behind Redis dedup until the Option-C scale slice; the trash-lens contention finding
  is only partially retired now (the edit-lockout half is fully fixed).
- Correctness now depends on the service (and the two cascade DB functions) setting `content_updated_at`
  on every content/state write; a missed writer would leave the validator stale on a real change. This
  is pinned by the acceptance tests below.
- A small listings migration (one column + guarded backfill); EN↔RU + schema/ERD/data-model propagation.

### Neutral
- `updated_at` retains its meaning (physical row-mtime) and continues to move on every UPDATE; nothing
  that reads `updated_at` for "when was this row last touched" changes.
- The anon-viewer trust-boundary / `trust proxy` question (AUDIT4 MINOR — view dedup key derivation) is
  **out of scope** here; it affects *count accuracy*, not the ETag basis. Parked for devops+security.

## Implementation Notes (build-spec for backend-engineer)

- **Migration** `migrations/20260708_0035_listings_content_version.sql` (next free number; tables +0 →
  37). Idempotent + N-1-safe backfill in one guarded block (backfill fires **only** on first create, so
  a re-run never clobbers app-written values with the view-polluted `updated_at`):
  ```sql
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_name = 'listings' AND column_name = 'content_updated_at') THEN
      ALTER TABLE listings ADD COLUMN content_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
      UPDATE listings SET content_updated_at = updated_at;   -- one-time historical approximation
    END IF;
  END $$;
  ```
  Keep `DEFAULT now()` permanently (N-1 write-compat). Run on live PG **twice** (prove idempotency).
- **Cascade DB functions.** In `cascade_animal_deactivation` / `cascade_user_deactivation` (the
  `CREATE OR REPLACE FUNCTION` bodies last touched by migration 0025), add `content_updated_at = now()`
  to the `UPDATE listings SET status='DEACTIVATED', is_active=false, updated_at=now()` statements
  (`database_schema.sql:1093,1106`). Ship via this same migration (CREATE OR REPLACE, idempotent).
- **ETag basis.** `listing.service.ts`: add `content_updated_at: Date` to the `ListingRow` type and the
  `findRow` select; change `etag()` (`:1246`) to `weakEtag(\`listing:${row.id}\`, row.content_updated_at)`.
  Leave `getAnalytics`'s ETag (`:772`) as-is.
- **Content/state writers.** Alongside each existing `updated_at: new Date()` in a content/state
  mutation (`update` :343, `submit` :457, `withdraw/deactivate` :496, `markSold` :684, and the
  moderation approve/reject/changes writes to the listing row), also set `content_updated_at` to the
  **same** `Date` instance. Do **not** add it to `captureView` (`:294`) or `recomputeMarketForSpecies`
  (`:789`), nor to the `escalated_at` write path.
- **Propagation:** `database_schema.sql` + `ZooLink_ERD.mmd` + `docs/03-architecture/data-model.md` +
  the table-count/ledger note in `ZooLink/CLAUDE.md` + `API_CONVENTIONS.md` §10 (note the listing ETag
  is derived from a dedicated content-version, not `updated_at`) + EN↔RU mirror (delegate the mechanical
  RU mirror to doc-keeper).

- **Acceptance / negative tests (backend must add):**
  1. **MANDATORY — public read does not bust the ETag / does not 412 a later PATCH.** GET an ACTIVE
     listing → capture ETag `E1`. Issue several public GETs from **distinct viewers/IPs** so
     `captureView` increments `view_count` (assert `view_count` rose). GET again → assert **ETag == E1**
     (unchanged). Then PATCH a content field with `If-Match: E1` → **200** (NOT 412). This is the
     regression gate for the whole finding.
  2. **View-flood griefing is neutralised (trash-lens).** Simulate a flood of anonymous views on a
     listing whose ETag a seller holds → the seller's subsequent `If-Match` PATCH with the pre-flood
     ETag **succeeds** (no 412 edit-lockout).
  3. **Genuine content edit still bumps + concurrency still works.** GET → `E1`; PATCH title/price with
     `If-Match: E1` → 200, returns `E2 ≠ E1`; a second PATCH with the stale `E1` → **412 STALE_RESOURCE**.
  4. **State transitions bump the validator.** submit / withdraw / mark-sold each change the ETag (a
     client holding the pre-transition ETag gets 412 on a conflicting `If-Match`).
  5. **System writes do NOT bump.** After a `view_count` increment — and, where reachable in test, an
     `escalated_at` set and a `recomputeMarketForSpecies` — assert `content_updated_at` (and the ETag)
     is unchanged.
  6. **Cascade-deactivation bumps.** Deactivating the owner/animal (cascade path) updates the listing's
     `content_updated_at` (DB-driven state change stays truthful).
  7. **Migration idempotency + N-1 write-compat.** Run 0035 twice → no error, no double-backfill drift;
     INSERT a listing **without** `content_updated_at` (simulating an N-1 pod) → succeeds via DEFAULT.
  8. **No analytics regression.** `getAnalytics.views` still reflects the `view_count` increments.

## Related Decisions

- [ADR-0018](0018-cross-aggregate-access-rule.md) / Wave-D: origin of the D1 `view_count` capture and D3
  `market` cache — both are on-row system writes this ADR excludes from the ETag basis.
- [ADR-0009](0009-mvp-vs-target-architecture.md): the worker + advisory-lock tick pattern
  (`MODERATION_ESCALATION_TICK`) that the reserved Option C off-row flush would reuse.
- [ADR-0006](0006-ai-agents-operate-platform.md): an AI operator editing a listing is exactly the actor
  the 412 edit-lockout would strand; a stable content validator is a prerequisite for agent-run editing.
- [ADR-0007](0007-orm-strategy.md): SQL-canonical schema + idempotent migration workflow this follows.

## References

- `backend/src/modules/listing/listing.service.ts` — `captureView` (:285-298), `getById` (:245-267),
  `etag()` (:1245-1246), `getAnalytics` etag (:772), content-mutation `updated_at` writes
  (:343/:457/:496/:684).
- `backend/src/lib/http/etag.util.ts` — `weakEtag` (:8), `assertIfMatch` / 412 STALE_RESOURCE (:23-37).
- `database_schema.sql` — generic `updated_at` trigger (:675-707), cascade functions (:1093,:1106),
  `escalated_at`/`moderation_enqueued_at` (:1392-1403), `view_count` (:278-311).
- `migrations/20260704_0031_listings_view_count.sql` (the counter this ADR takes off the ETag path).
- `ZooLink/AUDIT4/architect.md` (finding #1 + trash lens), `AUDIT4/backend-engineer.md`,
  `AUDIT4/data-analyst.md`.
- 🌐 RU mirror: [docsRU/04-decisions/0035-listing-view-count-off-etag-basis.md](../../docsRU/04-decisions/0035-listing-view-count-off-etag-basis.md)
