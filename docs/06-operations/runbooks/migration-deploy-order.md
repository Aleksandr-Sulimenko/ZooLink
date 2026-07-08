# Runbook — Migration & deploy order (N-1 rolling-deploy safety)

> **Status:** Active (AUDIT4 P1-5). **Scope:** the order in which a schema migration and a code release
> are applied so that an **N-1 (old) pod still serving traffic while the new schema is live** does not
> break. Owner: devops + backend-engineer. RU mirror: [`docsRU/06-operations/runbooks/migration-deploy-order.md`](../../../docsRU/06-operations/runbooks/migration-deploy-order.md).

## WHAT
A single, authoritative rule for **when** a migration may be applied *in place* (while the app serves)
versus **stop-the-world** (app stopped, or a two-phase expand→contract), plus a per-migration N-1-safety
classification and the CI expectation that guards it. Migrations live in `ZooLink/migrations/` and are
**never** run by Prisma Migrate (ADR-0007) — prod today applies `database_schema.sql` at provision time,
so this runbook governs the moment prod moves to **migrate-in-place-while-serving**.

## WHY
Idempotency (replay×2 on the head schema) is already CI-proven and clean. The **untested axis is N-1**:
during a rolling deploy there is a window where the new schema is applied but old pods still run old code.
Three shipped migrations break that window (AUDIT4 devops/reviewer-qa/architect, ⇊converged):

- **0033** `listings.market VARCHAR(9) NOT NULL` (no DEFAULT) — an old pod INSERTing a listing without
  `market` → `NOT NULL violation (23502) → 500` on **every** create.
- **0028** `users.email` → AES-`enc:v1:` ciphertext + `email_bidx` (backfill encrypts existing rows) —
  old code does `WHERE email = $plaintext` → matches **no** user → login/recovery break in the window.
- **0029** `UNIQUE(viewer_id, listing_id)` on `contact_reveals` — an old-code repeat reveal that was
  previously allowed → `23505 → 500` on that one endpoint (degrades one path, not core).

Under today's `docker compose` **stop-the-world recreate** (provision applies schema, then api/worker
start fresh) the N-1 window does not exist, so these are latent. They become a **data/auth incident** the
first time an operator does a live in-place migration. Cheap to prevent now, expensive to discover later.

## WHY-BETTER-for-the-whole-project
- **Expand → migrate → contract** is the industry-standard zero-downtime pattern; codifying it as the
  house rule means every future migration is authored against a known contract, not improvised at deploy.
- It makes the **derived-value** case explicit: `listings.market` is DERIVED from the animal's species
  (ADR-0002), so **no neutral default is correct** — an arbitrary `DEFAULT 'pet'` would silently mislabel
  livestock listings created by N-1 pods and **breach market separation** (worse than a clean 500). So the
  fix for 0033 is deliberately **order-based, not DDL** (contrast 0031 `view_count DEFAULT 0` / 0035
  `content_updated_at DEFAULT now()`, where a neutral default IS correct and IS used for N-1 write-compat).
- It gives the AI-operator ops layer (ADR-0006) a deterministic, machine-checkable pre-deploy gate.

## The rule — expand · migrate · deploy · contract

1. **Expand (backward-compatible schema first).** Add columns **nullable or with a correct neutral
   DEFAULT**; add new tables/indexes; widen types. Never add a `NOT NULL`-without-default column, never
   drop/rename a column or narrow a type, never add a UNIQUE that old writes can violate — while old code
   still runs.
2. **Migrate (apply the expand migration in place).** Safe because old code is unaffected.
3. **Deploy (roll the new code).** New code writes the new columns / uses the new lookups.
4. **Contract (only after all old pods are gone).** In a *later* release: `SET NOT NULL`, drop the
   temporary DEFAULT, drop old columns, add the tightening UNIQUE. Never in the same release as expand.

If a migration cannot be made expand-safe (a correct neutral default is impossible, e.g. a **derived**
value), it is **stop-the-world**: stop the app (or drain to zero old pods) *before* applying it.

## Per-migration N-1 classification (authoritative)

| Migration | N-1 verdict | Deploy handling |
|---|---|---|
| **0033** `listings.market NOT NULL` (derived, no correct default) | **UNSAFE** | **Stop-the-world** — stop app before migrate (a `DEFAULT` would breach ADR-0002 market separation, so DDL cannot fix it; the correct value only exists in new code). |
| **0028** email→ciphertext + bidx | **UNSAFE** | **Stop-the-world**, or a Phase-2 **dual-read expand** window (keep plaintext lookup path alive until all old pods drain) before contracting. |
| **0029** `contact_reveals UNIQUE(viewer,listing)` | **friction (MINOR)** | Degrades one endpoint only; tolerate for a brief window, or stop-the-world with the others. |
| 0031 `view_count NOT NULL DEFAULT 0` | **SAFE** | In-place — old INSERTs succeed via the default. |
| 0035 `content_updated_at NOT NULL DEFAULT now()` | **SAFE** | In-place — `DEFAULT now()` is a correct neutral default, retained permanently for N-1 write-compat. |
| 0036 `consents.seq GENERATED ALWAYS AS IDENTITY` | **SAFE** | In-place — DB-assigned, never app-written; old INSERTs omit it and succeed. |
| 0034 `user_roles` junction (dormant) + backfill | **SAFE** | In-place — additive table, no code reads it. |
| 0023 ownership-transfer trigger → GUC-gated | **SAFE** | In-place — old code never sets the GUC → prior behaviour preserved. |
| 0016 / 0026 principal_type CHECK reconcile | **SAFE** | In-place — constraint-name only, values unchanged. |

**Default classification for a NEW migration:** SAFE only if it is purely additive with a correct neutral
default (or a new table/index no old code touches). Anything with `SET NOT NULL`, a backfill-then-constrain,
a type narrowing, a drop/rename, or a tightening UNIQUE is **UNSAFE → stop-the-world** unless authored as a
two-release expand→contract.

## CI expectation
- **Present today (blocking):** the `migration-drift` job replays every migration **twice on the head
  schema** and DDL-diffs → proves *idempotency* + *schema convergence*. It runs on **empty tables**, so it
  does **not** prove backfill correctness or the N-1 upgrade path.
- **Required (recommended, AUDIT4 P1-5/B1 — devops + reviewer-qa):** add a `migration-upgrade` (a.k.a.
  `migration-replay-with-data`) job that provisions the schema **at N-1**, seeds representative rows
  (listings without `market`, users with plaintext email, duplicate `contact_reveals`), applies **only the
  newest migration**, and asserts (a) it succeeds, (b) every backfilled column is non-NULL **and correct**,
  (c) a re-run is a no-op. This is the true N-1 test; it is the cheapest-now / dearest-later guard.

## Operator checklist (before applying a migration in prod)
1. Read the new migration's N-1 classification (add a `-- N-1:` line in the migration header, as 0035/0036 do).
2. **SAFE** → apply in place, then roll code.
3. **UNSAFE** → announce a maintenance window / drain old pods to zero **first**, apply, then roll code
   (or run the two-release expand→contract if downtime is unacceptable).
4. Never apply an UNSAFE migration while old pods serve. Never add an arbitrary DEFAULT to a **derived**
   column to "make it safe" — that trades a clean 500 for silent data corruption.

## Related
- [Deployment (MVP)](../deployment-mvp.md) · [Deployment](../deployment.md) · [Monitoring](../monitoring.md)
- ADR-0007 (SQL-canonical schema + Prisma introspect) · ADR-0002 (market separation) · ADR-0017 (RF residency)
- Migration ledger: `ZooLink/CLAUDE.md`.
