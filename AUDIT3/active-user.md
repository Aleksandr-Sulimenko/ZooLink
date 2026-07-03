# ZooLink HYPER² Audit — Round 2 · active-user (lived-experience proxy)

**Date:** 2026-07-02 · **Branch:** `backend` @ `4533e78` (not pushed) · **Method:** independent re-walk of every
built flow first-person (12 personas), grounded in code (controllers/services/DTOs/schema), then reconciled against
round-1 (`AUDIT2/active-user.md`) **only after** forming my own view. Main lens: **forward-compat / anti-rewrite** +
the round-2 hot-spot **"dead features behind green fixtures"** (form in schema, no writer/behaviour).

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO.

---

## Diff scoreboard
- **#NEW = 5** · **#CONFIRMED = 6** · **#REFUTED = 0** · **#SEV-CHG = 3**
- Sharpest thing round-1 missed: **the outbox relay has ZERO consumers** — every domain event round-1 celebrated as
  "now built" (`Listing.Sold`, `ContactReveal.Created`, `Moderation.*`, `Animal.OwnershipTransferred`) is produced,
  then silently **marked processed with no side effect**. The entire notification layer is a dead path hidden behind
  green enqueue-tests. Combined with round-1's empty-channels blocker, **both halves of "connect two humans" — reveal
  AND notify — are hollow.**

---

## NEW findings (round-1 missed)

### N1 — Outbox has ZERO consumers: every event is produced then dropped  🔴
`backend/src/lib/outbox/outbox.relay.ts:44` injects consumers as `@Optional() ... = []`; nothing in the repo registers
`OUTBOX_CONSUMERS` (grep: only the token definition + the relay itself). So `dispatch()` finds `matched.length === 0`
for **every** event and takes the `:116` branch — `"No consumer ... marked processed"` — writing `processed_at` with no
effect. Producers exist and fire in-transaction (contact-reveal, mark-sold, moderation, transfer), and the event-seam
tests assert the row lands in `outbox_events` — all green. But **nothing consumes them**. `notification_logs`,
`notification_suppressions`, `notification_templates` have **no producer at all** (grep: 0 creates).

Persona impact: a seller submits a listing and waits — **no notification on APPROVE/REJECT/escalate**, must poll the
API manually. The ownership-transfer recipient is **never told** a transfer is pending (INV-4 PENDING row sits unseen).
Saved-search "new-match alerts" (Фаза 2, documented) are moot — but the moderation-result and transfer notices are
core-flow feedback, not Phase 2.

`[MAJOR][dead-path][NEW] backend/src/lib/outbox/outbox.relay.ts:116 → outbox relay has zero registered consumers; every event (Listing.Sold, ContactReveal.Created, Moderation.*, Animal.OwnershipTransferred) is marked processed with no side effect; notification_logs/suppressions/templates have no producer → seller gets no approve/reject feedback, transfer recipient never notified → build a NotificationConsumer (moderation-decision + transfer-pending) registered under OUTBOX_CONSUMERS; assert delivery, not just enqueue, in tests.`

### N2 — Photo "upload" is an arbitrary external URL → moderate-then-swap + latent SSRF  🔴 (→ security)
`addPhoto` stores a client-supplied `dto.url` string (`backend/src/modules/listing/listing.service.ts:906`); the DTO
validates it as `@IsUrl({ require_tld: false })`, `@MaxLength(2048)` only — **no host allowlist, no upload pipeline**
(`backend/src/modules/listing/dto/listing.dto.ts:213-217`). The `S3ObjectStorage` adapter is wired as "always live"
(`providers.module.ts:71`) but **no endpoint uses it**, and `digital_assets` has 0 writers. Consequences:
- **Bait-and-switch:** a moderator approves a listing showing image URL X; the seller changes the externally-hosted
  content at X to scam/illegal imagery **after** approval — moderation is bypassed because the image is mutable and off-platform.
- `require_tld: false` permits internal hosts (`http://minio:9000/...`, link-local) → **latent SSRF** the moment any
  server-side fetch/thumbnail/preview is added.
- Malicious/tracking images served straight to clients; no content-type or size guarantee.
- **UX reality:** a real pet owner/breeder has the kitten photo on their phone, not at a public URL — there is **no way
  to actually add a photo**, yet `submit` requires ≥1 (`listing.service.ts:349`). Every seller is blocked.

`[MAJOR][abuse][NEW] backend/src/modules/listing/dto/listing.dto.ts:213 → listing photo is an arbitrary external URL (no host allowlist, require_tld:false), no real upload; S3 adapter live but unwired, digital_assets dead → moderate-then-swap bait-and-switch + latent SSRF + no real upload path (submit needs a photo) → build presigned S3 upload → own-bucket URL only; restrict stored url host to our bucket; route to security.`

### N3 — Organization domain: fully contracted, authz already depends on it, but no writer exists (dangling authz)
Spec 11 fully defines `OrganizationCreateDTO`, member endpoints, and RBAC (R6 "cannot create org without OWNER/ADMIN").
Animal and listing **read/authz paths already depend on org membership** — `organization_users` is queried so an
org-admin can mutate org-owned animals/listings, and `listings.organization_id`/`branch_id` are first-class. But there
is **no organization/branch/org_user writer, no controller, no registered module** (grep: 0 org creates; no
`OrganizationModule` in `app.module.ts`). So a shelter/kennel/farm **cannot create an org account**, and org-owned
listings/animals are **unreachable via the API** — the authz branches point at objects that can never exist. This is
worse than a clean deferral: it is a half-built feature with dangling authz.

`[MAJOR][half-built][NEW] backend/src/modules/ (no organization module) → spec 11 contracts org create/members and animal/listing authz already keys on organization_users membership, but there is no org/branch/member writer or controller → shelters/kennels/farms cannot get an org account; org-owned listings/animals unreachable → build the Organization slice (create + member-add) or explicitly gate the org-authz branches until it lands.`

### N4 — Contact-reveal has no dedup: same viewer re-reveals, re-charged + inflates analytics (→ security/finance)
`revealContact` inserts a fresh `contact_reveals` row on every call with no `UNIQUE(viewer_id, listing_id)` and no
"already revealed?" check (`backend/src/modules/listing/listing.service.ts:479-482`). A buyer who revealed a contact,
closed the tab, and returns must **spend another quota unit to re-see a contact they already unlocked** (fairness +
friction). And `getAnalytics` counts raw rows (`:604`), so one buyer clicking N times (within the hourly cap) shows the
seller "N interested people" and, once **lead-gen billing** is the reveal count (the vision's monetization unit), the
billable metric is trivially self-inflated. Distinct from round-1's cross-account Sybil.

`[MINOR][abuse][NEW] backend/src/modules/listing/listing.service.ts:479 → no UNIQUE(viewer,listing)/dedup on contact_reveals → same viewer re-reveals re-charge quota and inflate contactReveals (the lead-gen billing unit) → dedup: return the existing reveal free within a window; make analytics count DISTINCT viewers; route to security/finance.`

### N5 — `cities` has no lat/lng → no geo-anchor for find-nearby / service-area
`cities` is `(id, name_localized, sort_order, …)` with **no coordinates** (`database_schema.sql`). `listings` carry
lat/lng (good), but the ecosystem's "first-class geo-anchor" for provider **service-area** and city-centroid "рядом со
мной" (future-features §160,210) cannot be built on a coordinate-less city table. Cheap to add now, retrofit touches
seed + every city reference.

`[MINOR][forward-compat][NEW] database_schema.sql (cities) → cities has no lat/lng; find-nearby/service-area geo-anchor (future-features §160) cannot centroid off a city → add cities.lat/lng (form-now seed seam) — требует ручной проверки of geo-search spec 07 intent.`

---

## CONFIRMED findings (independently reproduced round-1)

### C1 — Contact-reveal returns EMPTY channels — sole buyer↔seller path is dead  🔴 BLOCKER
Re-verified at `4533e78`: the ONLY writers of `contact_phone`/`contact_telegram`/`contact_prefs` are erase
(`admin-user.service.ts:223`) and retention (`retention.service.ts:130`), which null/default them. `UpdateProfileDto`
(`identity.dto.ts:102`) exposes fullName/cityId/email/avatarUrl/language — **no contact fields**; registration never
sets them. So `contact_phone` is null → `crypto.decrypt(null)` yields nothing, and `contact_prefs` is unset → falsy →
`channels = {}`, while the buyer's quota is consumed. Still true.

`[BLOCKER][dead-end][CONFIRMED] backend/src/modules/listing/listing.service.ts:459 → reveal reads contact fields that no happy-path writer sets (/me PATCH DTO identity.dto.ts:102 lacks them; registration omits them) → every reveal returns empty channels → add contact_phone/telegram + show_phone/telegram to /me PATCH; default contact_prefs on user create; consider capturing verified login phone into contact_phone.`

### C2 — Animal-bound listing + species-derived market blocks all species-less offerings
`listings.animal_id NOT NULL`; `listDiscovery` **mandatorily** `JOIN animals a ON a.id = l.animal_id JOIN species s`
and filters `s.market` (`listing.service.ts:726-730`). A ServiceOffering/ProductOffering has no species row → the join
structurally **excludes** it. The doc's stated goal is "discovery & moderation built once, polymorphically, for all
offering types" (future-features §160) — the current discovery is animal-only and needs a parallel path/rewrite. I add:
`moderation_decisions`/`content_reports` **are** polymorphic (entity_type+entity_id) done right, but `favorites` and
`conversations` are hard-FK'd to `listings.id` — the seam is reserved inconsistently.

`[MAJOR][forward-compat][CONFIRMED] backend/src/modules/listing/listing.service.ts:726 → discovery hard-JOINs animal→species→market; favorites/conversations hard-FK listings → species-less offerings can't be listed/favorited/searched → land ADR-A (polymorphic Offering key) + ADR-B (market_scope tag) before provider/goods work; make favorites polymorphic (target_type,target_id) now.`

### C3 — Single scalar `users.role` + ADMIN-only change blocks multi-role & progressive onboarding
`users.role VARCHAR(20)` is single-valued with vertical identities **baked into the CHECK**
(`USER,MODERATOR,ADMIN,BREEDER,FARMER,VETERINARIAN,GROOMER`, `database_schema.sql:115`); role change is ADMIN-only
(`admin-user.controller.ts:21`), registration hard-codes USER. This **conflates platform-role (USER/MOD/ADMIN) with
vertical-identity (BREEDER/VET/…)** and cannot hold two at once — a breeder who is also a vet, an owner who grooms.
Adding SERVICE_PROVIDER/SITTER/WALKER/SHELTER/GOODS_SELLER keeps extending a scalar and stays single-valued → a
`user_roles` join-table rewrite later. The doc lists "multi-role account + progressive onboarding" as a **form-now**
seam (§210). Not reserved.

`[CRITICAL][forward-compat][CONFIRMED] database_schema.sql:115 + admin-user.controller.ts:21 → single scalar role (vertical identities in a CHECK) + ADMIN-only change → no multi-role, no self-service/progressive roles (future-features §167,210) → introduce a roles[] / user_roles seam + a self-claim path now, split platform-role from vertical-identity.`

### C4 — Favorites is MVP-promised but unbuilt; a CASL hook makes it look wired  🔴 (SEV up — see S1)
Roadmap §130: "basic favorites & saved searches ship in **MVP**". But there is **no favorites controller/service/writer**
— only a CASL subject `'Favorite'` with `can('manage','Favorite',{user_id})` (`ability.factory.ts:75`) that makes it
look plumbed. `favorites.listing_id NOT NULL REFERENCES listings` is also non-polymorphic (C2). A buyer cannot shortlist
the 3 kittens they are deciding between.

`[CRITICAL][dead-feature][CONFIRMED] backend/src/lib/auth/ability.factory.ts:75 → 'Favorite' authz exists but no favorites endpoint/writer; favorites is MVP scope (roadmap §130) → build the favorites slice with a polymorphic target (OfferingRef) from the start.`

### C5 — No per-user listing-creation quota → flood/dup abuse (→ security)
Confirmed no per-user active-listing cap or creation rate-limit anywhere (only `uq_active_listing` one-per-type-per-animal
+ 10-photo cap). Create N animals → N listings → flood a breed/city. Concur with round-1.

`[MAJOR][abuse][CONFIRMED] backend/src/modules/listing/listing.service.ts (create) → no per-user listing quota/rate-limit → mass near-dup flooding → add per-user active-listing cap + creation throttle; route to security.`

### C6 — Seller analytics blank: `views` hard-0 + reveals empty
`analytics.views` is hard-coded 0 (no capture source, GAP-TRACE-006, `listing.dto.ts:420`) and `contactReveals`,
though sourced, reflects reveals that return empty channels (C1). Seller dashboard is effectively blank.

`[MAJOR][needs][CONFIRMED] backend/src/modules/listing/dto/listing.dto.ts:420 → views always 0, no capture source; reveals hollow (C1) → instrument coarse view capture or drop the field until sourced; irrecoverable history argues for capturing now (North-star частота×широта).`

---

## REFUTED / stale
None of round-1 is refuted. Its baseline correction (contact-reveal, mark-sold, retention/expire scheduler, and the
`Listing.Sold`/`ContactReveal.Created` **events** are now built) is accurate as far as it goes — see SEV-CHG S3 for the
important reframing (events are producer-only).

## SEV-CHG (severity / interpretation re-scored)
- **S1 — favorites MAJOR → CRITICAL.** Round-1 rated it MAJOR dead-end; it is **MVP-scoped** (roadmap §130), so a
  promised MVP feature is missing → CRITICAL. (C4)
- **S2 — organization "not built (vision only)" → half-built with dangling authz.** Round-1 treated orgs as a clean
  future deferral; in reality animal/listing authz **already depends** on org membership that can never be created →
  more severe than a deferral. (N3)
- **S3 — "Listing.Sold / ContactReveal.Created events now built" (round-1 win) → producer-only, zero consumers.**
  Round-1 listed these events as a completed win. They are enqueued but **never consumed** (N1) — a partial-refute of
  "built": the form exists, the behaviour does not.

---

## Per-persona would-I-return verdicts (round-2, forward-compat lens)
- **Pet owner / first-time buyer:** ❌ can't add a photo (URL-only), can't favorite, reveal returns nothing, no
  approve/reject notification. → Avito.
- **Breeder / seasoned seller:** ❌ no real photo upload, no kennel/org account, no approval notification, no reputation,
  blank analytics.
- **Farmer:** ❌ can't self-declare FARMER, no price-terms, no org, no notify.
- **Vet / groomer:** ❌ role exists but excluded from listing writes, no ServiceOffering — dead account.
- **Cynologist / walker / sitter/boarding / shelter / goods-seller:** ❌ N/A — no role, no offering surface; single-role
  scalar + animal-bound listing block them structurally.
- **Multi-role human (breeder+vet+owner):** ❌ single scalar role forces one identity.

## Dead-feature ledger (form in schema, no writer/behaviour — the round-2 hot-spot)
| Table/seam | Form | Writer/behaviour | Verdict |
|---|---|---|---|
| `favorites` | ✅ + CASL hook | ❌ no endpoint | **Dead, MVP-promised (C4/S1)** |
| `organizations`/`branches`/`organization_users` | ✅ + authz deps | ❌ no writer/controller | **Half-built, dangling authz (N3)** |
| `notification_logs`/`_suppressions`/`_templates` | ✅ | ❌ no producer | **Dead (N1)** |
| outbox events (all types) | ✅ producers | ❌ 0 consumers | **Dropped (N1)** |
| `digital_assets` + S3 adapter | ✅ "always live" | ❌ unwired; photos URL-only | **Dead wiring (N2)** |
| `conversations`/`messages` | ✅ | ❌ no module | Future form (contact = reveal); repeats non-polymorphic FK |
| `payment_transactions`/`refunds` | ✅ | ❌ (toggle off) | Documented deferral — OK |
| `contact_reveals` | ✅ | ✅ (fix-wave landed) | **Now live** — but no dedup (N4) |

---

## Needs-driven test scenarios (for reviewer-qa / backend / security)
1. **[N1 repro] Event delivery.** Seller submits → moderator APPROVE. Assert a notification/side-effect is produced for
   the seller. *Predicted:* outbox row `processed_at` set, **no notification** → fails. Variant: initiate an ownership
   transfer; assert recipient is notified → fails.
2. **[N2 security] Photo bait-and-switch.** Create listing with `photos:[{url:"http://evil/x.jpg"}]`; moderator approves;
   change content at that URL. Assert moderation still governs the shown image → fails (external mutable). Variant:
   `url:"http://minio:9000/..."` accepted (require_tld:false) → confirms internal-host acceptance.
3. **[N2 UX] Real upload.** As a seller with a local photo, find an upload endpoint → none; submit requires ≥1 photo →
   seller blocked.
4. **[N3] Org account.** As a shelter, `POST` to create an organization → no route (404). Then confirm an org-owned
   listing/animal is unreachable because no org can be created.
5. **[N4] Reveal dedup.** Buyer reveals listing X twice → two `contact_reveals` rows, quota decremented twice, analytics
   count = 2 for one viewer → assert desired dedup / DISTINCT.
6. **[C1] Reveal returns a contact.** Full happy path → `channels: {}` (fails). Confirm no /me field can set contacts.
7. **[C2 fwd] Species-less offering.** `POST /listings` without `animalId` → 400. Confirms animal-bound coupling.
8. **[C3 fwd] Multi-role.** Promote a user to BREEDER then VETERINARIAN → single scalar overwrites; cannot hold both.
9. **[C5 abuse] Listing flood.** One user → 50 animals → 50 listings, all succeed (no cap).
10. **[IDOR guard, positive]** Cross-user GET of DRAFT listing / animal / analytics → 404 no-leak throughout (certifies
    the IDOR posture I could not break; round-1 concurs).

---
*Scope note:* backend contracts + code only; frontend wiring = требует ручной проверки. I modified no product code or
docs; this file is my sole output.
