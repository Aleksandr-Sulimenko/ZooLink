# ZooLink HYPER Audit — Phase 3 · HYPER-TEST (reviewer-qa lead + backend-engineer)

**Date:** 2026-07-02 · **Branch:** `backend` (NOT pushed, NOT committed) · **Stack:** host PostgreSQL 16 +
Redis 7 (localhost, via `.env`) — both live and reachable. **Redis flushed before every run** (documented
gotcha `zoolink-e2e-host-services`: stale throttler/reveal state → false 429s). **No `src`/product code
modified; no existing test modified; nothing committed.** New proof files only.

New files (in-tree, not committed):
- `backend/test/audit2-hypertest.e2e-spec.ts` — 7 executable proofs (real HTTP stack).
- `backend/test/audit2-forward-stubs.e2e-spec.ts` — 11 `it.todo` forward stubs for the unbuilt ecosystem.

---

## Step 1 — Baseline regression (verification, no tree change)

Ran the full suite **as-shipped** (before adding any audit2 file). Real runner output:

| Suite | Claimed (b7aa6b4) | **Actual (re-run)** | Verdict |
|---|---|---|---|
| Unit (`npx jest`) | 450 | **450 passed / 40 suites** — `Time: 33.4 s` | ✅ EXACT match |
| E2E (`jest --config test/jest-e2e.json --runInBand --forceExit`) | 237 | **237 passed / 19 suites** — `Time: 26.7 s` | ✅ EXACT match |

**Zero failures, zero flakes** on this checkout. The claimed 450 / 237 are **verified real**, not asserted.
(The one `E2E.Flaky` line in output is a *deliberate* outbox-relay backoff fixture inside `outbox.e2e-spec`,
not a flake — it passes.) `npx jest` unit ran deterministically green.

Repro:
```
cd backend
redis-cli flushall
npx jest --silent                                              # → 450 passed / 40 suites
npx jest --config test/jest-e2e.json --runInBand --forceExit   # → 237 passed / 19 suites
```

---

## Step 2 — Proof tests (deliberately RED / finding-confirming GREEN)

**Assertion polarity convention** (documented inline in the spec):
- **RED** = the test asserts the *desired* behaviour; it **fails today** → the bug is real (owner rule
  "нет теста → не done": the test exists, stays red until the fix lands, then flips green).
- **GREEN=confirmed** = the test asserts the *current buggy reality*; it **passes** → the finding holds
  and is now locked so it cannot silently change.

Real runner verdicts (`test/audit2-hypertest.e2e-spec.ts`):

| # | Test | Verdict | What it proves |
|---|---|---|---|
| 1 | root-cause: `PATCH /v1/me` cannot set contactPhone/telegram/showPhone → **400** | ✓ GREEN | No DTO writer path exists for contact channels (body carries ONLY non-whitelisted props → 400 can only be `forbidNonWhitelisted`; `/me` still exposes no contact field after). |
| 2 | reality-lock: REAL registered seller listing → buyer reveal → `channels === {}` | ✓ GREEN | The dead marketplace, in one assertion — seller registered via the **real phone-OTP flow** (no fixture pre-seeds `contact_phone`). |
| 3 | **BLOCKER PROOF: a real buyer SHOULD get ≥1 usable channel** | **✕ RED (expected)** | **BLOCKER CONFIRMED.** `Object.keys(channels).length` `Expected: > 0, Received: 0`. The sole buyer↔seller path is dead for every real user. |
| 4 | hidden-cost: empty-channel reveal still INCRs Redis quota **and** writes a `contact_reveals` row | ✓ GREEN | quota key = 1 and row count = 1 despite `channels === {}` → the buyer *pays* (burns 1/10) and analytics.contactReveals is inflated by a meaningless row. |
| 5 | abuse/Sybil: account B hits pet cap (11th → **429 RATE_LIMITED**); fresh account C reveals same listing → **200** | ✓ GREEN | Reveal cap is keyed per-(market,viewer) only; a cheap new account resets the whole quota — no per-seller/per-listing/account-age cap bites. |
| 6 | abuse/flood: one user → 12 animals → 12 listings, **all 201** | ✓ GREEN | No per-user listing-creation quota — mass-dup / moderation-queue-DoS surface is open. |
| 7 | security oracle: existing non-owned animal → **403**, missing id → **404** (distinguishable) | ✓ GREEN | `animal.service.ts:168` `getById` is an **existence oracle** — violates the 404-no-leak invariant that listing/saved-search honour (findOrThrow 404 → assertCan 403). |

Runner tail:
```
✓ AUDIT2 root-cause (GREEN=confirmed): PATCH /v1/me CANNOT set contactPhone/... (400)
✓ AUDIT2 reality-lock (GREEN=confirmed): a REAL seller listing → buyer reveal returns EMPTY channels
✕ AUDIT2 BLOCKER PROOF (RED=expected-to-fail): a real buyer SHOULD receive at least one usable channel
    expect(received).toBeGreaterThan(expected)  Expected: > 0  Received: 0
✓ AUDIT2 (GREEN=confirmed): an empty-channel reveal still INCRements the Redis quota AND inserts a contact_reveals row
✓ AUDIT2 (GREEN=abuse-confirmed): account B hits the pet cap (11th → 429); a NEW account C reveals the same listing → 200
✓ AUDIT2 (GREEN=abuse-confirmed): one user creates 12 animals → 12 listings, ALL 201 — no per-user creation quota
✓ AUDIT2 (GREEN=finding-confirmed): existing non-owned animal → 403, missing id → 404 (distinguishable = oracle)

Tests: 1 failed, 11 todo, 6 passed
```

### BLOCKER — proven, and root cause is genuinely no-DTO-path
The seller in test #2/#3 is created through the **actual `register/phone` → OTP → `verify-phone`** flow
(OTP captured via an overridden `SMS_PROVIDER` spy, exactly like `identity.e2e-spec`). That flow
(`identity.service.ts:90`) never writes `contact_phone`/`contact_telegram`, and `PATCH /v1/me`
(`UpdateProfileDto`, `identity.dto.ts:102`) rejects those props with `forbidNonWhitelisted` (test #1
verified: **400**, and I read the DTO — it exposes only `fullName/cityId/email/avatarUrl/preferredLanguage`).
So there is **no application writer or editor** for the reveal's source columns → every real reveal returns
`channels: {}`. **The dead-marketplace BLOCKER (active-user #1 / backend §1 / masking-caveat) is proven true.**
The existing green `listing-contact-sold.e2e:116` only passed because it *pre-seeds* `contact_phone` via
`prisma.users.create` — the masking finding is correct.

---

## Step 3 — Forward stubs (`it.todo`, laid ahead of the unbuilt)

`test/audit2-forward-stubs.e2e-spec.ts` → **11 todo** (all reported green as todo): polymorphic Offering
(no-animalId → 201; market_scope), find-nearby directory, reviews/reputation/verification, favorites
(OfferingRef), booking/double-book, goods_marketplace toggle default-OFF, progressive-role self-claim,
view-capture funnel. These give the ecosystem seams a target so they cannot land silently.

---

## Sanity check + net effect on the suite

Re-ran the **full e2e suite with the new files present** (isolation check):
```
Test Suites: 1 failed, 20 passed, 21 total
Tests:       1 failed, 11 todo, 243 passed, 255 total
```
All **20 original e2e suites remain green** (243 = original 237 + 6 new GREEN). The single failure is the
**intended BLOCKER-RED** (#3). No cross-contamination; audit2 fixtures use a random suffix and self-clean in
`afterAll`. Unit suite unaffected (450).

Repro for the proofs:
```
cd backend && redis-cli flushall
npx jest --config test/jest-e2e.json --runInBand --forceExit \
  test/audit2-hypertest.e2e-spec.ts test/audit2-forward-stubs.e2e-spec.ts --verbose
```

---

## Verdict

- Baseline **450 unit / 237 e2e** = **verified real & green** (exact match to claim).
- **BLOCKER (dead marketplace) = PROVEN** via a real-registration path (RED test #3), with root cause
  (no DTO writer) confirmed (GREEN #1) and reality locked (GREEN #2).
- **All 4 abuse/security findings reproduced GREEN** (hidden-cost quota burn, Sybil reveal reset, listing
  flood, animal existence-oracle 403-vs-404). **None was found wrong** — every confirmed finding held.
- Forward stubs laid for the 11 unbuilt surfaces.

**No product code changed. Nothing committed** (owner commits on explicit request).
Recommended commit (on owner's word): `test(backend): AUDIT2 phase-3 hyper-test proofs (BLOCKER RED + abuse/oracle GREEN + forward stubs)`.
