# ZooLink HYPER² Audit — Round 3 · backend-engineer (forward-compat / anti-rewrite, code lens)

**Date:** 2026-07-02 · **Branch:** `backend` @ `4533e78` (not pushed) · **Mode:** Research & Hardening (audit only; no src/docs/schema modified).
**Method:** independent pass FIRST (did not re-read round-2 while investigating), then diffed against `AUDIT2/backend-engineer.md`.
Walked every table's writer path, the outbox consumer registration, the notification/upload/org/saved-search/photo pipelines, the ADR-0018 `marketOf` raw joins, and the ADR-0014/0015/0016 form-now seams (`market_scope`/`monetization_type`/offering/`roles[]`).

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / MAJOR / MINOR / INFO. Criterion ∈ correctness · forward-compat · abuse · integrity · maintainability · security.

---

## 0. Dead-feature census (the hot-spot: "form-in-schema, no user-reachable behavior, hidden behind green fixtures")

I checked **every** table for a real writer. contact_reveals was NOT unique — the same "read-side wired, write-side absent" pattern recurs across the codebase:

| Table / pipeline | Read/authz/form present | Writer present | Verdict |
|---|---|---|---|
| `contact_phone`/`contact_telegram` (contact-reveal) | reveal reads + decrypts | **none** (only erase nulls) | 🔴 DEAD (round-2 BLOCKER) |
| `organizations` / `organization_users` / `branches` | org-admin authz reads (`org-membership.service`, `ability.factory`), org-scoped animal/listing paths | **none** — no create-org, no add-member endpoint | 🔴 DEAD (NEW) |
| `notification_templates` / `notification_logs` / `notification_suppressions` | templates seeded; logs nulled on erase | **no sender** — `notification_logs` only ever `updateMany`→null | 🔴 DEAD (NEW) |
| outbox consumers (`OUTBOX_CONSUMERS`) | relay dispatches | **zero consumers registered** → all events marked-processed | 🔴 DEAD PIPELINE (NEW breadth / SEV-CHG) |
| `favorites` | schema table + CASL `Favorite` ability | **no controller/service/writer** | 🔴 DEAD (NEW) |
| `saved_searches` | create/list/delete CRUD | **no matcher/notifier** (the value behavior) | 🟡 form-only (CONFIRMED) |
| S3/MinIO object storage | adapter provisioned+exported | **never injected**; photos/avatars = raw client URL strings | 🔴 DEAD UPLOAD PATH (NEW) |
| `digital_assets` (NFT) | CASL subject only | none | 🟢 Phase-2 gated (expected) |
| `payment_transactions` / `refunds` | schema + money form | none | 🟢 `payments` toggle off, Phase-2 (expected) |
| `conversations` / `messages` (chat) | error-string refs only | none | 🟢 ADR-0005 no-chat, Phase-2 (expected) |
| `health_certifications` / `genetic_markers` | admin reference-data CRUD | admin only | 🟢 A3 breeding dict form-now (expected) |

The four in **bold-red that are NOT явно Phase-2-gated** (org onboarding, notification, outbox-consumers, favorites, upload) are the genuine "green-fixture" traps — each ships schema + read-side/authz but has no path a real user can trigger, so tests pass while the feature does nothing.

---

## 1. contact-reveal BLOCKER — CONFIRMED (unchanged from round-2)

`[BLOCKER][correctness][CONFIRMED] backend/src/modules/identity/dto/identity.dto.ts:~102 + profile.service.ts:44 → contact_phone/contact_telegram/contact_prefs have NO user-reachable writer (grep: written only at admin-user.service.ts:223-225 and retention.service.ts as erase/reset to null/default) and NO DTO field; UpdateProfileDto still exposes only fullName/cityId/email/avatarUrl/preferredLanguage → contact-reveal (listing.service.ts:455) always resolves channels:{} for every real seller → add contactPhone/contactTelegram/showPhone/showTelegram to UpdateProfileDto + updateMe (encrypt phone via crypto.encrypt, mirror the email seam); optionally seed contact_phone from the verified E.164 in verifyPhone. Doc-first: amend spec 01 + identity/listings OpenAPI.`

`[MINOR][robustness][CONFIRMED] backend/src/modules/listing/listing.service.ts:455-492 → enforceRevealRateLimit consumes quota + a contact_reveals row + ContactReveal.Created are written even when channels resolves empty → burns quota and inflates analytics.contactReveals with meaningless reveals → after the BLOCKER fix, short-circuit to 422 CONTACT_UNAVAILABLE before INCR/insert when no channel is enabled+populated.`

---

## 2. NEW dead-feature findings (round-2 did not enumerate these)

`[MAJOR][forward-compat][NEW] backend/src/lib/org/org-membership.service.ts:19-33 (+ ability.factory.ts organization_users reads) → organizations/organization_users/branches have a fully wired READ/authz side (org-admin can manage org-scoped animals & listings) but ZERO writer anywhere (grep: no organizations.create / organization_users.create/upsert / branches.create in any module) → the entire B2B org onboarding is a dead feature; org-scoped animals/listings can only exist by direct DB insert. This is the EXACT contact_reveals anti-pattern (read wired, write absent) and it silently orphans real authz code. Fix: build the org-onboarding slice (create-org + add/remove-member with the actor-as-principal + audit seam) OR, if deferred, mark it explicitly Phase-2 in the spec so the orphaned authz is a documented hook, not a hidden gap. Escalate sequencing to architect.`

`[MAJOR][integrity][NEW] backend/src/lib/scheduler/retention.service.ts:141 + admin-user.service.ts:235 → notification_logs is only ever updateMany→null (erase); notification_templates is seeded; there is NO sender anywhere (no notification_logs.create). The notification domain is dead: moderation approval seller-notification, escalation fan-out, contact-reveal, saved-search alerts all have nowhere to emit. moderation.service.ts:415-421 documents "the seller-notification is the outbox consumer's job" but no such consumer exists (see §3). → Either ship a NotificationConsumer that writes notification_logs (respecting notification_suppressions + notification_prefs), or mark notifications explicitly Phase-2. As-is, every "user will be notified" guarantee across the codebase is silently false.`

`[MAJOR][security][NEW] backend/src/modules/listing/listing.service.ts:906 + dto/listing.dto.ts:213-217 (@IsUrl({require_tld:false})) + providers.module.ts:66-71 → the S3/MinIO ObjectStorage adapter is constructed and exported but injected by NO service (grep: OBJECT_STORAGE consumed nowhere outside providers.module) → there is no presign/upload endpoint; addPhoto and avatarUrl accept an arbitrary client-supplied URL string (require_tld:false permits http://localhost, http://169.254.169.254/… i.e. SSRF-shaped values, private hosts, non-image content) stored raw and served to the public. No content-type/size check, no EXIF strip, no same-bucket enforcement → stored-content abuse + SSRF surface AND a dead upload pipeline. Fix: add a presigned-upload/confirm flow through OBJECT_STORAGE, restrict photo/avatar URLs to our storage origin (allowlist host), and add content-type/size/EXIF handling on ingest. Route the threat model to security.`

`[MAJOR][forward-compat][NEW] backend/src/lib/auth/ability.factory.ts:27,75 → CASL grants `manage Favorite {user_id:uid}` but there is NO favorites controller/service/writer (find -iname favorit* = none; grep favorites = ability.factory only) → favorites/wishlist is a schema+authz form with no behavior. Fix: implement the favorites slice (add/remove/list) or mark it Phase-2 so the CASL subject is a documented hook.`

`[INFO][forward-compat][NEW] backend/src/modules/saved-search/saved-search.service.ts → saved_searches has create/list/delete only, no matcher/notifier that runs a saved search against newly-ACTIVE listings → the value behavior (alerts) is absent; consistent with the dead notification pipeline. Non-blocking (round-1 shipped CRUD deliberately), but note it depends on §2 notification being built.`

---

## 3. Outbox pipeline — CONFIRMED + SEV-CHG (round-2 §3 was scoped to one comment; the reality is broader)

`[MAJOR][integrity][SEV-CHG] backend/src/lib/outbox/outbox.relay.ts:44,104-118 → OUTBOX_CONSUMERS is @Optional() default [] and grep confirms ZERO consumers registered anywhere (no `implements OutboxConsumer`, no provide:OUTBOX_CONSUMERS) → EVERY domain event (Moderation.Decided, Listing.Activated, Listing.Sold, ContactReveal.Created, Moderation.Escalated) is claimed, matched against nothing, and stamped processed_at=now() (relay.ts:112-118). claim() filters `processed_at IS NULL`, so a consumer registered LATER can never replay these rows → the moderation.service.ts:418-421 claim that this is "the deliberate START of analytics history capture" is FALSE: rows are terminal, not replayable, and no analytics/notification sink exists. Round-2 rated this SHOULD-FIX for one comment; the accurate severity is MAJOR because the ENTIRE event pipeline is inert (this is why notifications §2 and analytics.views are dead). Fix (escalate to architect, matches the noted follow-up): register a durable analytics-sink consumer that always consumes (so history is real), OR change relay policy to PARK no-consumer events (leave processed_at NULL / a separate `parked_at`) so a future consumer replays them. Align the moderation comment with whichever is chosen. Doc-vs-code drift on a "nothing dropped / history captured" guarantee.`

---

## 4. ADR-0018 marketOf / raw animal joins — CONFIRMED + EXPANDED

`[MAJOR][forward-compat][CONFIRMED] listing.service.ts:626-628 & moderation.service.ts:577-579 (marketOf, verbatim duplicate) + listing.service.ts:728 (search JOIN animals) + moderation.service.ts:190 (queue CTE JOIN animals) → market derivation + discovery + moderation queue read animals⋈species directly via $queryRaw, bypassing AnimalService, while create() correctly routes through animals.getOwnedAnimalForActor (:146) — the ADR-0004/0018 rule is applied inconsistently → when the animal aggregate's ownership/soft-delete/market rules evolve, these raw joins silently drift. Fix: add a single AnimalService.marketOf(animalId) (or an Offering read-model) and call it from both services; delete the two private copies.`

`[MAJOR][forward-compat][NEW-within-ADR-0018] backend/src/modules/moderation/moderation.service.ts:214-216 (getReviewListing) → additionally raw-reads the animal aggregate via prisma.animals.findUnique directly (no ownership/soft-delete rules), a fourth bypass of AnimalService not called out in round-2 → fold into the AnimalService read-model extraction above.`

`[MINOR][maintainability][CONFIRMED] marketOf duplicated verbatim across listing.service.ts:626 and moderation.service.ts:577, both hardcoding pet/livestock literals → single-source it; this also de-risks the ADR-0015 market_scope rollout (two+ divergence points today).`

---

## 5. ADR-0014/0015/0016 form-now seams — CONFIRMED (grep = 0)

`[MAJOR][forward-compat][CONFIRMED] grep market_scope / monetization_type / offering* = 0 in BOTH backend/src AND database_schema.sql → ADR-0014 (monetization_type), ADR-0015 (market_scope ∈ pet|livestock|both for species-less offerings), and the OfferingRef supertype are Accepted ADRs with ZERO implementation (not even a schema column/form). listing is hard-bound to an animal (getOwnedAnimalForActor mandatory; market DERIVED from species everywhere) → ServiceOffering/ProductOffering (species-less) cannot be represented or discovered, and the shared read paths (contact-reveal, moderation queue+CTE, saved-search, analytics) all hardcode listings⋈animals⋈species → generalising to (offering_type, offering_id) is a moderate rewrite of those read paths. Per ADR-0014 subtype tables land when their side ships, BUT market_scope + the offering key + an Offering read-model must land FIRST (before the §4 AnimalService.marketOf refactor is wasted). Escalate sequencing to architect.`

`[INFO][forward-compat][CONFIRMED] backend/src/modules/identity/dto/identity.dto.ts (SetRoleDto single role, ADMIN-only) → ADR-0016 Provider (provider_kind ∈ ORG/INDIVIDUAL/AGENT) + progressive roles[] need a many-roles seam; grep roles[] = 0 (only role query params) → reserve the roles[] shape when ADR-0016 is authored. Not a code bug today.`

---

## 6. Robustness OK (re-verified — do NOT "fix") — CONFIRMED

- **TOCTOU single-winner** — guarded `updateMany` with `count===1` as the first in-tx write across submit/withdraw/markSold/editActiveAndReenqueue/claim/action; loser rolls back before any audit/decision/outbox row. Uniform and correct.
- **Idempotency in-flight lock** — SET NX reservation → 409 IDEMPOTENCY_KEY_IN_PROGRESS + Retry-After; completed replay returns stored response. Correct.
- **Transaction atomicity** — reveal row + event, moderation flip + decision + audit + events, markSold flip + audit + event each in one tx. Correct.
- **Event envelope** — schemaVersion + market + occurredAt on every emitted event (they just have no consumer — §3).
- **IDOR posture** — 404-no-leak, own-scope AND-intersect holds.
- **PII crypto seam** — email encrypt+blind-index; contact_phone seam-ready (its writer is the §1 gap, not the crypto).

## 7. Round-2 findings re-verified as still-valid (no change)
- `[MAJOR][abuse]` no per-user listing-creation quota (grep quota = contact-reveal only) — **CONFIRMED**.
- `[MAJOR][abuse]` reveal rate-limit key `contact-reveal:${market}:${viewerId}` is per-(market,viewer) only → Sybil reset; no per-seller/per-listing/account-age dimension — **CONFIRMED** (moot until §1 BLOCKER fixed; fix both together).
- `[MINOR][performance]` getQueue re-runs the base CTE 4× per request — **CONFIRMED** (acceptable MVP).
- `[INFO][correctness]` toQueueItem hardcodes assignedTo principalType 'HUMAN' (moderation.service.ts:602) — **CONFIRMED** (mislabels an AGENT claimant under the agent_moderation toggle).

## REFUTED / corrected
- None of round-2's findings are refuted. Round-2's outbox item is upgraded (SEV-CHG) and its scope corrected — the problem is the whole pipeline, not one comment.

---

## 8. Test probes (negative-invariants for the NEW findings)

**Org onboarding dead-feature (§2)**
- P1. Attempt to create an org via any endpoint → **no route exists (404)**; then set an animal's `organization_id` (only possible via DB) → org-admin authz in ability.factory has no user path to become an org-admin → proves the read-authz is orphaned. Post-fix: create-org → creator becomes org-admin → can manage org animals.

**Notification dead-pipeline (§2 + §3)**
- P2. Approve a submitted listing (moderator) → assert an `outbox_events` row for `Listing.Activated` exists but **`notification_logs` has zero new rows** and the outbox row is `processed_at IS NOT NULL` with no consumer → documents the inert pipeline. Post-fix: a `notification_logs` row (or a parked outbox row) exists.
- P3. Register a NotificationConsumer AFTER an event was already processed → assert it receives **nothing** (replay impossible because `processed_at` is set) → proves the §3 "history capture" claim is false under current policy.

**Photo/avatar URL abuse (§2 security)**
- P4. `POST /v1/listings/{id}/photos` with `{url:"http://169.254.169.254/latest/meta-data"}` and with `{url:"http://localhost:9000/other-bucket/x"}` → **accepted 201 today** (require_tld:false + no origin allowlist) → asserts the SSRF/stored-content surface. Post-fix: **422** unless the URL is our storage origin.
- P5. `PATCH /v1/me` avatarUrl with a non-image, non-storage URL → accepted today → same assertion.

**Favorites dead-feature (§4)**
- P6. Any favorites endpoint → **404 (no route)** while CASL `Favorite` ability exists → proves the orphaned subject.

**ADR-0018 drift probe (§4)**
- P7. Soft-delete/mutate an animal that has an ACTIVE listing, then hit the moderation queue / marketOf / getReviewListing → confirm the direct animals⋈species raw joins behave identically to AnimalService's rules (drift probe).

**Form-now coupling (§5)**
- P8. `POST /v1/listings` without `animalId` → **400/422** (animal-bound) → proves species-less offerings need market_scope/offering key before they can exist.

---

*Scope note:* backend contract + code only. Live-PG migration idempotency re-runs and frontend wiring are `требует ручной проверки` for a later phase. I modified no code/docs/schema — this file is my only output. Org-onboarding sequencing, the outbox no-consumer policy, and the ADR-0014/0015 read-model refactor order are architect decisions.
