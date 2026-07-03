# ZooLink HYPER² Audit — Round 2 · reviewer-qa (test-adequacy / masking lens, forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (NOT pushed) · **Role:** reviewer-qa (QA/control gate).
**Method (independent-first):** derived findings from source before re-reading AUDIT2. Ran the suite live
(host PG + Redis, redis flushed first). Traced the event pipeline end-to-end (writer → relay → **consumers**),
the org-membership authz primitive (writer? or fixture-only?), photo upload (real storage? or URL string?),
saved-search (matcher? or CRUD-only?), and the contact writer. Focus = **tests that give false confidence**:
a green assertion over a feature that does nothing in production.
**Finding format:** `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix/test`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO · criterion ∈ masking · coverage · negative-invariant · forward-compat · determinism.

> **Scope discipline:** No src/ or existing-test edits, no commit. This file is my only write. New probes are
> DESCRIBED (executable spec), implementation left to Phase 3 per the task.

---

## 0. Baseline — VERIFIED LIVE (not merely asserted)

| Suite | Result | Note |
|---|---|---|
| `npm test` (unit) | **450 passed / 40 suites** | GREEN. Matches the claimed 450. |
| `npm run test:e2e` | **243 passed · 1 failed · 11 todo · 255 total / 21 suites** | The 1 "failure" is the **intentional RED** `audit2-hypertest.e2e-spec.ts:211` (contact-reveal-for-a-real-seller, `RED=expected-to-fail`). Effectively GREEN. |

- `[INFO][determinism][REFUTED] task expectation "237 e2e" → the number is stale.` The prior QA-gate baseline was
  237; commit `4533e78` added `audit2-forward-stubs` (11 `it.todo`) + `audit2-hypertest` (incl. 1 RED). Live count
  is **243 pass + 1 RED + 11 todo = 255**. Baseline is honest-green; the RED is a deliberate tripwire, not a regression.

---

## A. The masking layer — tests that hide dead features (the core of this round)

The task's premise ("a green suite already hid a dead marketplace — assume it hides more") is **correct and
under-counted**. I found **four more** production-dead surfaces whose tests pass by asserting a *mechanism* or a
*write* that has no downstream effect. Ranked:

### A1 — The event pipeline has ZERO consumers: produced + marked-processed = no-op (biggest)
- `[CRITICAL][masking][NEW] src/lib/outbox/outbox.relay.ts:44 + (no provider anywhere) → grep for a provider of
  `OUTBOX_CONSUMERS` returns NOTHING in `src/` (only the token def, the `@Optional()` inject defaulting to `[]`,
  and comments). Every domain emits events (`Moderation.Decided`, `Listing.Activated`, `Moderation.Escalated`,
  `Listing.*`) but NOTHING consumes them. The relay's own unit test codifies this as correct:
  `outbox.relay.spec.ts` → "**marks events with no matching consumer as processed**" — so the dead sink is
  green-by-design.** → the "event seam" is write-only. No notification, no email, no search-index update,
  no downstream state — ever, in production.
- `[SEV-CHG][masking][CONFIRMED→downgrade] test/moderation.e2e-spec.ts:194,219 → AUDIT2 (§A) rated the
  event-emission gap "CLOSED — strong" via b7aa6b4. That is true **only for emission**: the e2e asserts a ROW
  exists in `outbox_events` (`findFirst … event_type:'Moderation.Decided'`) and the envelope shape. It never
  asserts a **side-effect**, because none exists. → I downgrade the "event seam" from *closed-strong* to
  **half-built, masked**: emission is proven, consumption is a zero-consumer sink. A future dev reading a green
  `moderation.e2e` will believe "moderation decisions notify the seller" — they do not.
- **Fix / Phase-3 test:** (a) `it.todo` — register a real `OutboxConsumer` (e.g. notification) and assert a
  side-effect (row in a `notifications` table / stub-adapter called) for `Moderation.Decided`; RED today.
  (b) Add a **relay negative**: a registered consumer that throws is retried/backed-off (unit already covers) —
  but ALSO add an e2e that a produced event with a live consumer is *acted on*, so "processed" ≠ "delivered to a
  black hole". (c) Product/architect decision (escalate): is a consumer in MVP scope, or is the outbox
  deliberately a forward-compat seam? If deliberate, the relay comment + `moderation.e2e` MUST say
  "no consumer yet — emission-only" so the green test stops implying delivery.

### A2 — Photo "upload" is a client-supplied URL string; no storage, no validation, submit-gate trivially satisfiable
- `[MAJOR][masking][NEW] src/modules/listing/listing.service.ts:895-924 (`addPhoto`) → stores `dto.url` verbatim
  into `listing_photos.url`. There is NO file upload, NO S3/MinIO presign, NO `digital_assets` link, NO check
  the URL is a real/owned asset. `ListingPhotoCreateDto` (dto:213) only requires `@IsUrl({require_tld:false})`
  — so `http://x/anything.jpg` passes.** The e2e proves this: `listing.e2e:71` posts `http://x/${uuid}.jpg`.
- **Consequence — the L-6 submit invariant is fake protection:** `listing.service.ts:354-356` gates submission on
  `listing_photos.count() >= 1`. A seller can satisfy it by POSTing one fabricated/off-site URL. The green
  "submit requires ≥1 photo" test therefore proves a gate that any string defeats. Also an app-layer
  **arbitrary-URL / SSRF / abuse** surface (attacker-hosted or tracker URLs stored + later fetched by a client).
- `[MAJOR][coverage][NEW] test/listing.e2e-spec.ts:265 → delete-photo has a non-owner **403** negative (good),
  but **add-photo has no ownership negative** and no URL-shape/host negative.` → route the SSRF/arbitrary-URL
  angle to **security**; route real-upload design to **architect/backend**.
- **Fix / Phase-3 test:** `it.todo` (RED): "add-photo rejects a non-image / off-allowlist-host URL"; "photos
  must reference an asset the caller uploaded (presign flow), not an arbitrary URL"; "non-owner add-photo → 403".
  Until real storage lands, add an assertion that documents the gap so no one trusts the submit-gate as content proof.

### A3 — Org-admin authorization is unreachable in production: no writer for organizations/organization_users
- `[MAJOR][masking][NEW] src/lib/org/org-membership.service.ts (isOrgAdmin / orgAdminIds) → grep for any WRITER
  of `organizations.create/update` or `organization_users.create/*` across `src/` returns NOTHING (only the
  seed/erase paths NULLing columns). There is no endpoint to create an org or add a member.** So for any
  real registered user, `isOrgAdmin` can NEVER be true — every org-scoped authz branch in animal / transfer /
  listing / moderation is **dead code in production**.
- `[MAJOR][masking][CONFIRMED] org-membership.service.spec.ts + test/transfer.e2e-spec.ts:145,353-355 → the unit
  spec MOCKS prisma; the only e2e that exercises org paths (`transfer.e2e`) SEEDS `organizations.create` +
  `organization_users.create` **directly via prisma** (fixture bypass of the missing writer).** → the green org
  tests prove the WHERE-clause and the transfer-from-org mechanic, but hide that no user can ever reach these
  paths through the API. Same failure class as the contact-fixture that hid the dead marketplace.
- **Fix / Phase-3 test:** `it.todo` (RED): "a user with no org membership gets 403 on every org-scoped action
  reached via the public API" (documents unreachability); and the forward stub "POST /v1/organizations →
  create + add-member seam" so the writer has a target. Escalate to **architect**: is B2B/org a Phase-2 seam
  (then label it) or an MVP gap? Either way the fixture-seeded green tests must not imply a live feature.

### A4 — Saved searches are stored but never matched: no matcher, no notification
- `[MAJOR][masking][NEW] src/modules/saved-search/saved-search.service.ts (create/list/delete only) → grep shows
  `saved_searches` is READ nowhere outside its own CRUD module; the scheduler (`src/lib/scheduler/`) has only
  retention-expire + moderation-escalation jobs — NO saved-search matcher.** → a saved search does nothing:
  no new-listing match, no alert. `saved-search.e2e` proves own-scoped CRUD + IDOR (genuinely good, keep it),
  but the feature's *purpose* (notify me when a matching listing appears) is unbuilt and untested-as-unbuilt.
- **Fix / Phase-3 test:** `it.todo` (RED): "a new ACTIVE listing matching a saved search produces a
  match/notification for the owner" (depends on A1's consumer). Reuse `listing-search.e2e` fixtures.

### A5 — Contact writer gap (the original masking case) — CONFIRMED, and now correctly RED-locked
- `[CRITICAL][masking][CONFIRMED] src/modules/identity/dto/identity.dto.ts:102 (UpdateProfileDto) + identity.service
  → no contactPhone/contactTelegram/visibility field; only `admin-user.service.ts:223` NULLs them on erase.
  Reveal returns `channels:{}` for every real user.** Round-1 (`4533e78`) **already added the RED tripwire**
  `audit2-hypertest.e2e-spec.ts:211` (fails today, flips green when a `/me` writer lands) — this is the correct
  pattern; no further action beyond building the writer (backend) + `PATCH /v1/me` whitelist negative.

---

## B. Invariants "proven by code" with no explicit negative test (spot audit)

AUDIT2's census is largely accurate; I add the ones the masking sweep surfaced:

- `[MAJOR][negative-invariant][NEW] listing.service.ts:354 (L-6 ≥1 photo submit-gate) → covered as a happy/positive
  count, but there is no test that the gate rejects an EMPTY photo set with the right code AND no test that it
  can't be gamed by a bogus URL (see A2). Add both.`
- `[MINOR][negative-invariant][CONFIRMED] outbox.relay.spec.ts → dead-letter at MAX_ATTEMPTS and backoff-below-cap
  are covered (good). Missing: an e2e that a consumer's side-effect is *idempotent* under a re-delivered event
  (at-least-once semantics). Add when a consumer exists (blocked by A1).`
- `[INFO][negative-invariant][CONFIRMED] org-membership WHERE-clause (role_in_org=OWNER AND status=ACTIVE) has unit
  negatives (non-owner, suspended) — good — but only against mocks; no live-PG negative because there is no writer (A3).`

---

## C. Surfaces with NO negative test (coverage census delta vs AUDIT2)

AUDIT2 §D listed identity `/me` DTO, listing WRITE_ROLES, listing quota, analytics views. Confirmed. **Add:**

| Surface | State | Test today | Verdict |
|---|---|---|---|
| Outbox **consumer** / delivery side-effect | zero consumers (A1) | production-only assertion | ❌ GAP (masked) — **NEW** |
| Photo real upload + URL validation + add-ownership (A2) | URL-string stub | happy-path only | ❌ GAP (masked) — **NEW** |
| Org create / add-member writer (A3) | no writer | fixture-seeded | ❌ GAP (masked) — **NEW** |
| Saved-search matcher/notification (A4) | no matcher | CRUD-only | ❌ GAP (masked) — **NEW** |
| Notification delivery (any channel) | none (email adapter used only for OTP/recovery) | none | ❌ GAP — **NEW** |
| `/me` PATCH whitelist (contactPhone rejected) | RED tripwire exists (A5) | `audit2-hypertest` RED | 🟡 LOCKED-RED — CONFIRMED |

---

## D. Diff vs AUDIT2/reviewer-qa.md (the 23-case plan)

**CONFIRMED (unchanged, still valid):**
- Contact-writer BLOCKER (#1) + `/me` DTO gap — CONFIRMED; round-1's RED test is the correct closure pattern.
- Migration integrity gated (ci.yml `migration-drift`, replay×2 + DDL diff) — CONFIRMED (not re-run; the CI job
  logic is as described). Residual: seed-migration row-level idempotency only `требует ручной проверки`.
- WRITE_ROLES no role-matrix negative; listing-flood no quota; VET/GROOMER 403; self-role-upgrade; EXPIRED
  edit-gate; species-less `animalId`; analytics views=0 — all CONFIRMED as real gaps.
- Forward stubs (Offering/find-nearby/reviews/favorites/booking/goods/view-capture/progressive-role) — CONFIRMED
  present as `it.todo` in `audit2-forward-stubs.e2e-spec.ts` (round-1 built them; good).

**NEW (not in AUDIT2 — the masking sweep's yield):**
- A1 outbox zero-consumer dead pipeline (CRITICAL) — the highest-value miss.
- A2 photo upload = URL-string stub; submit-gate gameable; SSRF/arbitrary-URL (MAJOR).
- A3 org-admin authz unreachable in prod (no writer; fixture-only tests) (MAJOR).
- A4 saved-search stored-but-never-matched; no matcher/notification (MAJOR).
- Notification delivery entirely absent (MAJOR, ties A1/A4).

**SEV-CHG:**
- Event-seam: AUDIT2 "CLOSED — strong" → **downgraded to half-built/masked** (emission proven, consumption a
  zero-consumer sink). Not a contradiction of their emission claim — a correction of the confidence it conveys.

**REFUTED:**
- Baseline "237 e2e" — REFUTED as stale; live is 243+1RED+11todo=255. (Minor, but the task's own expected number.)
- Nothing else in AUDIT2 is refuted; its plan is sound, it just stopped at the emission boundary and did not
  trace consumers / writers, which is where the masking lives.

---

## E. Executable Phase-3 probe plan (delta only — additive to AUDIT2's 23 cases)

All e2e drive the real HTTP stack (host PG + Redis), redis-flush + throttle-reset first, self-cleanup of
`outbox_events`. RED = expected-to-fail-today (locks a known-dead feature so it can't silently "pass").

**M — Masking closers (this round's core):**
- **M-1 (A1, RED) Event consumed, not just emitted** — register a stub `OutboxConsumer` for `Moderation.Decided`;
  APPROVE a listing; run the relay tick; assert the stub was invoked AND a durable side-effect recorded. Today: RED
  (no consumer). Locks the dead pipeline. *(escalate scope Q to architect first.)*
- **M-2 (A1) Relay does not silently swallow** — assert that an event with NO consumer is logged/marked in a way
  distinguishable from "delivered" (today `processed_at` is set identically for both) → add a `no_consumer` marker
  or metric so "processed" can't masquerade as "delivered".
- **M-3 (A2, RED) Photo URL validation** — `POST /listings/:id/photos` with a non-image / off-allowlist-host URL →
  expect 422/400. Today: 201 (any URL accepted). RED.
- **M-4 (A2) Photo add ownership** — non-owner `POST …/photos` → 403 (mirror the existing delete-403).
- **M-5 (A2, RED) Submit-gate is real content** — assert a listing cannot reach PENDING_MODERATION with only a
  fabricated URL "photo" once real-asset linkage lands. Today: passes with bogus URL → RED.
- **M-6 (A3, RED) Org authz reachable** — via PUBLIC API only (no direct prisma seed), attempt any org-scoped
  action → assert reachable path exists. Today: no writer → RED/`it.todo` for `POST /v1/organizations`.
- **M-7 (A3) Org authz denies non-member** — with a fixture org, a non-member user → 403 on org-scoped action
  (keeps the WHERE-clause honest at the HTTP layer, not just mocked).
- **M-8 (A4, RED) Saved-search match** — create a saved search; publish a matching ACTIVE listing; assert a
  match/notification for the owner. Today: no matcher → RED. (depends on M-1 consumer.)
- **M-9 (B) Submit-gate empty-set negative** — 0 photos → 422 `VALIDATION_ERROR` (explicit negative for L-6).

**Carry-forward:** AUDIT2's P0-1..3 (regression + migration-drift + seed×2), P1-1..11, P2-1..7, P3-1..2 remain
valid and are not restated here. This delta adds **9 masking-closers**; combined plan = **32 cases**.

---

## F. Verdict

- **DoD/gate status:** the suite is honest-green (450 unit / 243 e2e + 1 deliberate RED + 11 todo) and migration
  integrity is CI-gated. **But four production-dead surfaces (events/photos/org/saved-search) are masked by
  mechanism-only or fixture-seeded green tests** — the same failure class that hid the dead marketplace. None is a
  *regression*; each is a *false-confidence* gap. Round-1 correctly RED-locked the contact case; the analogous
  RED locks (M-1/M-3/M-6/M-8) are not yet laid.
- **Escalate to architect (scope, not review):** are outbox-consumer / org-B2B / saved-search-matcher /
  real-photo-upload MVP or Phase-2 seams? Whichever — the green tests and code comments must **say "seam,
  emission/CRUD-only, no downstream yet"** so no one trusts them as working features. Route photo arbitrary-URL/SSRF
  to **security**; contact/`/me` writer + real upload to **backend**.

*`требует ручной проверки`:* (a) whether a consumer is intended in MVP (architect); (b) seed-migration row-level
idempotency (CI diffs DDL only); (c) I did not re-run the CI `migration-drift` job locally — its logic is as AUDIT2
described. No code/doc/test edits, no commit.
