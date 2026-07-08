# ZooLink HYPER³ Audit — Round 3 · reviewer-qa (masking-hunt / migration-replay / N-1 lens)

**Date:** 2026-07-08 · **Branch:** `backend` · **HEAD:** `0fcc182` · **Role:** reviewer-qa (control gate).
**Method (independent-first):** re-derived from source, then DIFFed vs `AUDIT3/reviewer-qa.md` + `AUDIT2/reviewer-qa.md`.
Traced every AUDIT3 masked surface to its current state (writer/consumer/heal), REDID the dead-table
grep sweep (the contact_reveals failure-class), reasoned the migration replay + N-1 upgrade path against the
CI `migration-drift` gate, and triaged the 9 `it.todo`.
**Baseline (given, not re-run per task discipline):** 610 unit GREEN this session; e2e re-running on the shared
box. Numbers below are reasoned from source, not from a fresh suite run.
**Finding format:** `[sev][criterion][axis][state] file:line → problem → fix`.
sev ∈ BLOCKER/MAJOR/MINOR/NIT · axis ∈ same|new(masking)|trash|strat · state ∈ NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED.

> **Scope discipline:** no src/test edits, no commit. New probes are DESIGNED as executable specs for Phase-3.

---

## 0. Headline

The Wave A–G fix-program **genuinely closed the two biggest AUDIT3 masks** — the zero-consumer event pipeline
(A1) and the contact-writer dead-marketplace (A5) are now real and, for the parts that matter, well-tested. But
the fix-wave **created a new masking layer of its own**: green tests that assert a *mechanism* or *fixture-written
state* instead of the production write/heal path, and a migration-drift gate that runs entirely on **empty
tables** — so every backfill-then-`SET NOT NULL` migration is proven only in the one scenario (0 rows) where the
backfill is a no-op. That is the N-1 shallowness. Ranked findings follow.

---

## A. FIXED-VERIFIED (AUDIT3 masks that the fix-wave genuinely closed)

- `[MAJOR][new][FIXED-VERIFIED]` **A1 zero-consumer pipeline** — `src/modules/notification/notification.consumer.ts`
  + `notification.module.ts:23` register the first real `OUTBOX_CONSUMERS` provider (worker graph only). Producer↔consumer
  **shape parity confirmed by read**: `moderation.service.ts:426` emits `{entityId,sellerId,decision,reason}` and the
  registry (`notification.registry.ts:55`) consumes exactly those; `transfer.service.ts:651` emits
  `{transferId,animalId,fromUserId,fromOrganizationId,toUserId,toOrganizationId}` matching the registry routes. The e2e
  `notification-consumer.e2e-spec.ts:105` (INV-1 relay path) drives **produce → relay.tick() → notification_logs row**, so
  the relay dispatch itself is proven, not just `consumer.handle()`. AUDIT3's CRITICAL is retired.
- `[MAJOR][new][FIXED-VERIFIED]` **A5 contact writer / dead marketplace** — `identity/profile.service.ts:61` now writes
  `contact_phone`(encrypted)/`contact_telegram`/`contact_prefs`; the AUDIT3 RED tripwire flipped GREEN
  (`audit2-hypertest.e2e-spec.ts:216` "was RED, now GREEN"). Reveal returns a usable channel; consent recorded (ADR-0020).
- `[MINOR][same][FIXED-VERIFIED]` **user_roles dormancy** — `user-roles-junction.spec.ts` is an *exemplary* anti-mask:
  it statically scans all `.ts` for `.user_roles.*` access and asserts the only method is `createMany` (write-only), plus a
  RolesGuard unit proving authz reads JWT `role` only. `admin/user-roles.controller.ts` lists roles from `users.role`, never
  the junction. Dormancy REALLY grants nothing. (One hole — see D2.)
- `[MINOR][same][FIXED-VERIFIED]` **cascade is_active drift** — migration 0025 + `listing-cascade.e2e-spec.ts:152`
  prove the DEACTIVATED cascade now also clears `is_active`. (Stale comment — see NITs.)

---

## B. NEW masking findings (the fix-wave's own false-confidence layer) — REDO of the contact_reveals hunt

### B1 — Migration-drift gate runs on EMPTY tables → every backfill migration's data path is untested (headline)
- `[MAJOR][new][NEW]` `.github/workflows/ci.yml:107` (`migration-drift`) replays `migrations/*.sql` twice on a **fresh
  canonical schema with no rows**, then DDL-diffs. This proves *idempotency of DDL* and *schema convergence* — real value —
  but migrations **0028** (PII backfill + `SET NOT NULL` email_bidx path), **0032** (`favorites.offering_id` backfill from
  `listing_id` then NOT NULL), and **0033** (`listings.market` backfill from `animals⋈species` then `SET NOT NULL`) all
  contain a *backfill-then-constrain* step whose failure mode (a row the backfill misses → `SET NOT NULL` aborts, or a
  wrong-value backfill) can **only** surface against real rows. On an empty DB the backfill is a no-op and the constraint
  always succeeds → the gate is green regardless of backfill correctness.
- **Why it matters at N-1:** prod applies `database_schema.sql` only (compose provision; migrations never run in prod today),
  so pre-launch this is latent. The moment there is production data and a real 0035+ upgrade, an N-1 migration validated only
  on empty tables is the classic "green in CI, corrupts on upgrade" trap.
- **Fix / Phase-3 probe (P0):** add a `migration-replay-with-data` CI leg — provision schema *at N-1*, seed representative rows
  (listings without market, favorites, users with plaintext email), apply **only** the newest migration, assert
  (a) it succeeds, (b) every backfilled column is non-NULL and correct, (c) re-running it is a no-op. This is the true N-1 test.

### B2 — user_roles write-only guard misses raw-SQL reads
- `[MINOR][new][NEW]` `identity/user-roles-junction.spec.ts:63` scans for `\.user_roles\.(\w+)` — i.e. **Prisma access only**.
  A `$queryRaw\`… FROM user_roles\`` or Kysely read (the codebase uses raw SQL heavily — consumer, market, escalation) would
  read the junction and break dormancy **while the test stays green**. The guard proves what it scans, not what it claims.
- **Fix:** extend the scan to also fail on `/from\s+user_roles/i` and `/join\s+user_roles/i` in `$queryRaw`/`sql\`` bodies.

### B3 — consents append-only is ASSUMED, never PROVEN (no adversarial negative test)
- `[MAJOR][new][NEW]` The immutability trigger `trg_consents_immutable` exists (migration 0029), but **every** test that
  touches consents only *disables* it for cleanup (`listing-contact-sold.e2e-spec.ts:155`, `audit2-hypertest.e2e-spec.ts:186`
  — `ALTER TABLE consents DISABLE TRIGGER`). **No test asserts that an UPDATE or DELETE against consents is rejected.** The
  append-only invariant — a ФЗ-152 consent-audit guarantee — has zero negative coverage; the team demonstrably knows the
  trigger is there (they disable it) yet never proves it fires.
- **Fix / Phase-3 probe (P1, RED-if-broken):** with the trigger ENABLED, `prisma.consents.update(...)` and `.delete(...)` on an
  existing row → expect a DB raise (P0001/append-only). Mirror for the other `trg_block_modify_append_only` users
  (audit_log, moderation_decisions) — same pattern likely repeats.

### B4 — Derived-market recompute HEAL is mock-only + fixture-bypassed (drift-healer never proven to heal)
- `[MAJOR][new][NEW]` The `listings.market` cache (migration 0033) has three paths: create-time write, admin-correction
  **recompute**, and read. Coverage: the **read** is proven (`listing-search.e2e-spec.ts:147` D8 forces a species/cache
  disagreement). The **recompute heal** is only `reference-data.service.spec.ts:258` which **mocks**
  `recomputeMarketForSpecies` and asserts it was *called* — never that it updates rows. The **create-time write** is
  fixture-bypassed: `listing-search.e2e-spec.ts:63` writes `market:` directly instead of exercising the create path that
  derives it via `AnimalService.getOwnedAnimalForActor`. So the only thing that keeps the cache from drifting — the recompute
  — is never proven end-to-end. *(No e2e patches a species market then asserts listing rows flipped — grep-confirmed absent;
  requires manual confirmation.)*
- **Fix / Phase-3 probe (P1):** e2e — seed ACTIVE listing (cached market='pet') → admin `PATCH species.market='livestock'`
  → assert the listing's `market` column flipped to 'livestock' AND it now appears under the livestock market filter.

### B5 — Notification org fan-out + transfer producer proven only via fabricated envelopes
- `[MINOR][new][NEW]` `notification-consumer.e2e-spec.ts` proves the relay dispatch for **Moderation.Decided** only (INV-1);
  all transfer cases (1b/2/4/org-fanout/expired) call `consumer.handle()` with **hand-built** `OutboxEvent`s. Combined with
  A3 (no org writer, below), the org fan-out branch (`registry userOrOrgAdmins`) is *doubly* unreachable in prod: no user can
  create an org, and no integration test drives a real `transfer.service` → relay → org-admin notification. The producer field
  names are verified only by my read, not by a test — a rename would keep these green while prod produces zero recipients.
- **Fix:** one e2e that calls the real `transfer.service.initiate(toUserId)` → `relay.tick()` → asserts the recipient's row.

### B6 — Photo submit-gate still gameable (SEV-CHG down from AUDIT3 MAJOR)
- `[MINOR][new][SEV-CHG]` `listing.service.ts:1066` now calls `assertOwnMediaHost(dto.url)` (S3/MinIO host allowlist) — the
  AUDIT3 SSRF/arbitrary-host angle is **closed**. But it is still a client-supplied URL string: no real upload, no
  `digital_assets` linkage, no proof the object exists or is an image. The L-6 "≥1 photo" submit-gate
  (`listing.service.ts:435`) is still satisfiable by any well-formed allowlisted-host URL. Downgrade MAJOR→MINOR; the
  content-proof gap persists as a forward-compat item.

### B7 — "assert-the-bug" green tests (inverted tripwires)
- `[NIT][trash][NEW]` `audit2-hypertest.e2e-spec.ts:289` (`expect(created).toBe(12)` — listing flood, no quota) and `:248`
  (Sybil cap) assert the **vulnerability persists** as GREEN. This documents the gap but: (a) a reader scanning green sees
  "listing flood" passing and may assume it's *covered*; (b) when the quota is finally added, these tests break and force an
  edit — the opposite of a RED that guides toward the fix. Prefer `it.todo`/RED asserting the DESIRED 429.

---

## C. CONFIRMED-still-open from AUDIT3 (honestly deferred, not regressions)

- `[MINOR][same][CONFIRMED]` **A3 org writer absent** — grep for any `organizations.create`/`organization_users.create` in
  `src/` (non-seed, non-test) returns NOTHING. Org-scoped authz + the notification org fan-out remain unreachable via the
  public API; the only exercise is fixture-seeded (`transfer.e2e`, `notification-consumer.e2e:92`). Phase-2 B2B seam — label it.
- `[MINOR][same][CONFIRMED]` **A4 saved-search matcher absent** — `saved_searches` is read nowhere outside its own CRUD module;
  no scheduler job matches new listings. A saved search still does nothing. Phase-2.
- `[MINOR][new][NEW]` **digital_assets is a fully dead table** — ZERO references in `src/` AND `test/` (grep-confirmed). The NFT-hook
  seam (migration 0002/0013) has no writer, no reader, and no test asserting its dormancy. Add a dormancy note or a
  write-only/dead assertion so it's an intentional seam, not an accident.
- `[INFO][same][CONFIRMED]` **service_credentials** — `lib/auth/agent-service-token.authenticator.ts:25` is a stub with a
  "Future (P-A)" comment; no verify path. Agent-service-auth is a form-only seam (as designed, migration 0017 "not seeded MVP").

---

## D. Masking-hunt table (green test → what it fails to prove → the negative/concurrency test that would prove it)

| Green test | Asserts | Fails to prove | Test that would prove it |
|---|---|---|---|
| `migration-drift` CI (ci.yml:107) | DDL idempotent + schema converges | backfill correctness on real rows (0028/0032/0033) | **N-1 replay-with-data**: schema@N-1 + seed rows → apply newest → assert backfilled cols correct + non-NULL + re-run no-op |
| consents cleanup (disable trigger) | tests can clean up | that UPDATE/DELETE is *rejected* | trigger ENABLED → `consents.update/delete` → expect DB raise (append-only) |
| `reference-data.service.spec:258` | recompute is *called* (mock) | that listings.market rows actually flip | e2e: PATCH species.market → assert listing.market column flipped |
| `listing-search.e2e:63` (market written) | read follows l.market | create path *derives* market correctly | create listing via API → assert market derived from species, not fixture |
| `notification-consumer` transfer cases | consumer.handle maps envelopes | real transfer producer→relay→notify wiring | e2e: transfer.service.initiate → relay.tick → recipient row |
| `user-roles-junction.spec:63` | no Prisma read of junction | no *raw-SQL* read of junction | extend scan to `FROM/JOIN user_roles` in `$queryRaw` |
| `audit2-hypertest:289` flood | 12 created (no quota) — as GREEN | that a quota SHOULD exist | RED/it.todo asserting 429 after threshold |
| photo submit-gate | ≥1 photo present | photo is a real owned image asset | asset-linkage check + "bogus URL cannot satisfy submit" |

---

## E. `it.todo` triage (9 remaining, all in `audit2-forward-stubs.e2e-spec.ts`)

**Honestly deferred (need an unbuilt module/ADR — correct to leave as todo):**
- `:142/:143` Offering species-less + market_scope — needs ADR-0014/0015 polymorphic Offering (only the `offering_id` *seam*
  exists, migration 0032). Deferred.
- `:146` find-nearby provider directory — needs a provider entity + endpoint (listing geo exists; provider dir does not). Deferred.
- `:149/:150` reviews (post-transaction, one-per-pair) — no reviews table/module. Deferred.
- `:151` verification badge — no verification module. Deferred.
- `:154` booking / ServiceOffering — no booking module. Deferred.
- `:160` progressive-role self-claim — ADR-0022 defers the self-service seam; dormancy already proven. Deferred.

**Buildable-now (partially) — 1:**
- `:157` goods_marketplace toggle — the toggle ROW exists (migration 0027, default OFF). The **"defaults OFF + no code reads
  it" dormancy half is buildable now** as a static-scan/read test, exactly like the user_roles junction spec. The "flip-on
  path exercised" half is not (no goods-listing consumer). **Recommend:** split it — build the dormancy assertion now, keep
  the flip-on as todo. This is the one todo currently under-built relative to what's testable.

**Triage headline:** 8 of 9 are honestly deferred behind genuinely-unbuilt modules; 1 (goods toggle) has a buildable
dormancy-proof half being left as a full todo.

---

## F. `[PERSP]` Strategic — verification debt that will hurt most at Phase-2 / monetization / scale

1. **Migrations are prod-decorative today; the N-1-with-data gate is the cheapest-now, dearest-later fix (B1).** The instant
   there is real data, every backfill migration is an unproven upgrade. Build the replay-with-data leg *before* first prod
   data exists — after, a bad 0035 is a data-loss incident, not a red build.
2. **Fixture-bypass of writers is the recurring failure-class** (contact_reveals → market → org). As Phase-2 adds
   Offering/reviews/booking, each will tempt a `prisma.create({...})` fixture that hides a broken create-path. Pull forward a
   test convention: **e2e drives the public API writer; direct-prisma is cleanup-only.** Codify it so reviewers catch it.
3. **Append-only / immutability triggers (consents, audit_log, moderation_decisions) protect the ФЗ-152 + moderation-audit
   story monetization & legal depend on — and none has a "reject the mutation" negative (B3).** Cheap to add now; expensive to
   discover missing during a compliance review.
4. **The event pipeline is now load-bearing (notifications) but has ONE proven relay-dispatch path (Moderation.Decided).**
   Before monetization adds payment/payout events, add a generic "produce real event via service → relay → side-effect"
   harness so new producers can't ship with a silent shape-mismatch (B5).

---

## G. Verdict & `требует ручной проверки`

- **DoD/gate status:** the two headline AUDIT3 masks (events, contacts) are FIXED-VERIFIED; dormancy of user_roles is
  exemplary. **Not a regression anywhere.** But the fix-wave introduced a fresh false-confidence layer — the empty-table
  migration gate (B1), the unproven consents-immutability (B3) and market-recompute heal (B4), and the raw-SQL hole in the
  dormancy scan (B2). None blocks the current honest-green baseline; each is a *pull-forward-now, cheaper-than-after-rewrite*
  test to lay before Phase-2 data exists.
- **Manual verification needed:** (a) I did not run the suite (shared box) — numbers are the orchestrator's; (b) confirm no
  e2e outside my greps exercises the market-recompute heal or a consents-mutation rejection; (c) confirm the CI
  `migration-drift` job wording matches ci.yml:107 as read (it does at this HEAD). No code/test/doc edits, no commit.
