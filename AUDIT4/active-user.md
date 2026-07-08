# ZooLink HYPER³ Audit — Round 3 · active-user (lived-experience proxy)

**Date:** 2026-07-08 · **Branch:** `backend` @ `0fcc182` · **Method:** independent first-person re-walk of every
built flow (12 personas), grounded in code (controllers/services/DTOs/`database_schema.sql`), then diffed against
round-2 (`AUDIT3/active-user.md`) and round-1 (`AUDIT2/active-user.md`). **Four lenses per persona:** (1) honest-user
needs-first, (2) adversarial/trash, (3) **NEW win-win/strategic**, (4) would-I-return.

Finding format: `[severity][criterion][axis][state] file:line → problem → fix`.
axis ∈ same|new|trash|strat · state ∈ NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED · severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO.
strat findings carry `[NS|WW|PERSP]`.

---

## Diff scoreboard vs AUDIT3
- **FIXED-VERIFIED = 6** · **NEW = 7** · **CONFIRMED = 5** · **SEV-CHG = 1** · **REFUTED = 0**
- **The Waves A–G fix-program is real, not cosmetic.** Round-2's headline blocker (contact-reveal returns empty
  channels — the sole buyer↔seller path dead) is **genuinely closed end-to-end**, as is the zero-consumer outbox, the
  reveal dedup, favorites, and view capture. Round-3's sharpest new finding is not a dead path but a **strategic
  win-win hole: the platform's one asset — the human connection — is given away as a one-time reveal that immediately
  leaves for Telegram, with no reputation, no confirmation, and no reason to transact on-platform.** A marketplace
  cannot be an "agent-run business" (North-Star) when its core transaction is invisible to it.

---

## FIXED-VERIFIED (round-2 findings I re-walked and can now certify closed)

`[BLOCKER][dead-end][same][FIXED-VERIFIED]` **C1 contact-reveal empty channels → CLOSED.**
`identity.dto.ts:151-169` now exposes `contactPhone/contactTelegram/showPhone/showTelegram`; `profile.service.ts:61-70`
writes them (phone encrypted ADR-0019) and records the `CONTACT_DISTRIBUTION` consent transition in the same tx;
`listing.service.ts:551-562` decrypts and returns the channels behind the two-layer gate (consent AND `show_*`). A
real seller can now set a reachable contact and a real buyer can reveal it. **The core buyer↔seller path is alive.**

`[MINOR][abuse][same][FIXED-VERIFIED]` **N4 reveal dedup → CLOSED.** `listing.service.ts:572-579` returns the existing
row's channels with no quota/row/event on a repeat (viewer,listing); backed by `uq_contact_reveals_viewer_listing`
(migration 0029) with a P2002→dedup race guard (`:611`). A buyer re-viewing a contact they already unlocked is now free.

`[MAJOR][dead-path][same][FIXED-VERIFIED]` **N1 zero-consumer outbox → CLOSED.** `notification.consumer.ts` is the
first real `OUTBOX_CONSUMERS` member (worker graph only); it materializes an `IN_APP` `notification_logs` row per
recipient for `Moderation.Decided` (→ seller) and all five `OwnershipTransfer.*` events (→ the right party/org-admins,
`notification.registry.ts:55-98`), idempotent by `event.id‖recipient‖template`. A seller now gets an approve/reject
notice; a transfer recipient is now told. (**Caveat →** see WW-3: `IN_APP` only — no email/push delivery surface yet,
so a logged-out seller still learns nothing until they return; requires manual verification of any read endpoint for
these rows.)

`[CRITICAL][dead-feature][same][FIXED-VERIFIED]` **C4/S1 favorites → CLOSED.** `favorite.service.ts` ships add/list/
remove: owner is always `actor.userId` (IDOR-closed), add idempotent by `uq_favorite_user_listing`, remove is a
leak-free always-204, and add gates on `assertVisibleToActor` so a favorite can't probe another user's DRAFT. A buyer
can finally shortlist the 3 kittens they're deciding between. Built on the polymorphic OfferingRef seam (0032).

`[MAJOR][needs][same][FIXED-VERIFIED]` **C6 seller `views` hard-0 → CLOSED (views half).** `listing.service.ts:279-289`
does a best-effort DB-atomic `view_count += 1` on the public detail read, deduped per (viewer|anon-IP) in a 30-min
Redis window, seller self-views excluded; `getAnalytics.views` is now real. Seller dashboard shows real traffic.
(**Caveat →** see T-2: the dedup is IP-scoped and inflatable.)

`[MAJOR][abuse][same][FIXED-VERIFIED (partial)]` **N2 photo bait-and-switch / SSRF → mitigated.**
`listing.service.ts:1066` `assertOwnMediaHost(dto.url)` now rejects any URL whose host isn't our S3/CDN allowlist
(`mediaAllowedHosts(S3_ENDPOINT, MEDIA_CDN_HOST)`), killing the "approve URL X, swap content at X" moderation bypass
and the internal-host SSRF vector. **But the UX half is now worse — see B-1.**

---

## NEW findings (round-3)

### B-1 — No real photo upload exists → own-host allowlist now BLOCKS every seller from submitting  🔴 BLOCKER
The `POST /listings/{id}/photos` endpoint takes a client-supplied `dto.url` that (correctly, N2) must point at OUR S3
host. **But there is no endpoint anywhere in the app that gets a photo INTO that S3 bucket.** `presignS3Url`
(`lib/providers/storage/sigv4.ts:51`) and the `OBJECT_STORAGE`/`S3ObjectStorage` adapter are fully built and **consumed
by zero modules** (grep: no controller/service injects them). So the only way to add a photo is a URL to a bucket the
seller has no way to write — and `submit` hard-requires ≥1 photo (`listing.service.ts:435`). **Result: a real pet owner
/ breeder / farmer with the kitten photo on their phone cannot publish a listing at all.** Round-2 rated this MAJOR
(URL-only); the N2 host-allowlist fix, shipped without the upload endpoint, has upgraded it to a hard blocker — the
allowlist makes the sole photo path a URL the user cannot produce.

`[BLOCKER][dead-end][new][NEW] backend/src/modules/listing/listing.controller.ts:195 → no presigned-upload endpoint; presignS3Url + S3ObjectStorage adapter are built but wired to nothing; the own-host allowlist now makes the only add-photo path a URL the seller cannot populate; submit requires ≥1 photo → EVERY seller is blocked from publishing → wire a POST /media/upload-url (presigned PUT) endpoint → client uploads → returns own-S3 URL that passes assertOwnMediaHost; route to backend/security.`

### B-2 — A listing can go ACTIVE with no reachable contact → dead-drop for both sides  🟠 MAJOR (needs + WW)
`submit` guards title + ≥1 photo + (sale⇒price) (`listing.service.ts:430-444`) but **not** "does the seller have any
contact channel a buyer could ever reach?" With `contact_prefs` defaulting all-off (migration 0029, correct for
ФЗ-152) and consent default-deny, a seller who never toggles `show_phone/show_telegram` publishes an ACTIVE listing
where **every** buyer reveal returns `NO_CHANNELS` (`listing.service.ts:566`). The buyer spends intent finding a
listing they can never act on; the seller gets zero leads and is never told why. This is a symmetric-loss trap created
by an otherwise-correct privacy default.

`[MAJOR][needs][new][NEW] backend/src/modules/listing/listing.service.ts:435 → submit does not verify any contact channel is reachable; all-off privacy default → an ACTIVE listing where every reveal is NO_CHANNELS → at submit, either require ≥1 contact channel enabled OR surface a blocking "your listing has no reachable contact" warning; show the seller a "0 reachable channels" banner on their own listing.`

### WW-3 — The connection is a one-way dead-drop that leaves the platform; no reputation, no confirmation, no reason to stay  🔴 CRITICAL (strat)
`[strat: WW/NS]` The entire buyer↔seller interaction is: buyer burns a reveal-quota unit → receives the seller's
phone/telegram → **the deal now happens in Telegram, invisible to ZooLink forever.** Walking it as every persona, three
compounding win-win failures:
- **Disintermediation / value leakage.** The platform's one asset is the connection; it gives it away for a one-time
  quota and retains nothing — no ongoing value, no protection, no data on the actual transaction. For a "platform
  business run by AI agents" (North-Star) this is fatal: agents cannot moderate, price, insure, or improve a
  transaction they can't see. Monetizing the reveal (the vision's lead-gen unit) taxes the one moment of value while
  providing none — that reads as **extractive**, the win-win failure mode.
- **No reputation primitive at all.** The brief's flows name "leave a review"; there is **no review/rating table,
  service, or endpoint** anywhere. Without it the information is fully asymmetric: the buyer bears 100% of scam risk
  with nothing to judge a stranger by, and an honest breeder cannot differentiate from a fraudster. This is the single
  biggest reason a user picks Avito over ZooLink today (Avito at least shows profile age / other ads).
- **No two-sided confirmation.** `mark-sold` is seller-self-reported with no buyer counter-confirm → no proof a real
  deal happened → no GMV signal, no completion metric, no reputation event to hang a rating on.

`[CRITICAL][strat][strat][NEW][WW/NS] backend/src/modules/listing/listing.service.ts:518 (reveal) + (no review/message module) → the connection is a one-way off-platform dead-drop with no reputation, inquiry, or confirmation loop → the platform captures none of the value it creates and cannot become agent-run → land a MVP trust loop: (a) a lightweight in-app inquiry/message before contact leaves, (b) a two-sided review after mark-sold, (c) buyer confirmation of mark-sold; escalate to architect (ADR) + growth + finance.`

### WW-4 — Every interaction is funnelled through the monetizable reveal; no free "ask a question" tier  🟠 MAJOR (strat)
`[strat: WW]` The only way a buyer can contact a seller is the quota-gated `contact-reveal`. Favoriting is free (good)
but silent — the seller never sees it. So to ask one question ("is she still available? vaccinated?") a buyer must
consume a reveal unit. Routing *every* interaction — including low-commitment questions — through the one billable
choke-point is a latent dark-pattern (psychologist/anti-dark-pattern guardrail): it manufactures scarcity on ordinary
conversation. Win-win design reserves the paid/limited reveal for genuine intent and gives a free low-commitment tier
(inquiry/follow) that also produces the engagement signal the platform actually needs.

`[MAJOR][strat][strat][NEW][WW] backend/src/modules/listing/listing.controller.ts:142 → the sole buyer→seller primitive is the quota-gated reveal; no free inquiry → ordinary questions are taxed → add a free, rate-limited "inquiry" primitive distinct from contact-reveal; keep reveal for intent; consult psychologist.`

### WW-5 — Livestock reveal cap (5/h) pinches the highest-value, highest-intent user  🟡 MINOR (strat)
`[strat: WW]` `listing.service.ts:634` sets livestock reveal limit 5/h vs pet 10/h. The abuse-prevention rationale is
inverted against value: a farmer sourcing 20 head of cattle or comparing breeding bulls across many sellers is the
platform's highest-value buyer, and hits the *lower* cap first. The friction lands on the wrong side. Consider a
per-market cap tuned to legitimate high-intent livestock behaviour (or a verified-farmer higher tier), not a flat
"livestock = rarer = lower".

`[MINOR][strat][strat][NEW][WW] backend/src/modules/listing/listing.service.ts:634 → livestock reveal cap (5/h) < pet (10/h) pinches the highest-value buyer → raise/segment the livestock cap for verified/high-intent farmers; validate against real livestock sourcing behaviour with growth/data-analyst.`

### T-2 — View-count is IP-dedup only → inflatable for self-ranking or competitor skew  🟡 MINOR (trash → security/data-analyst)
`captureView` dedups per (authenticated viewer | anon-IP) in a 30-min Redis window (`listing.service.ts:279-289`). An
actor rotating IPs (or a small botnet / logged-out requests) inflates any listing's `view_count`. Since `view_count`
feeds seller analytics now and is a candidate ranking/North-Star signal later, a seller can inflate their own listing's
views to appear popular, or skew a competitor's analytics. Best-effort capture is the right call for a funnel-top
metric, but the number must be treated as untrusted for ranking/billing.

`[MINOR][abuse][trash][NEW] backend/src/modules/listing/listing.service.ts:288 → view_count deduped only per IP/30min → inflatable by IP rotation for self-ranking or competitor skew → keep as a soft funnel metric; never rank/bill on raw view_count without bot-filtering; route to security/data-analyst.`

### T-3 — Cross-account Sybil still inflates the reveal/lead unit (dedup is per-viewer only)  🟡 MINOR (trash → security/finance)
The N4 dedup closes *same-viewer* re-reveal, but N distinct accounts each revealing once still produce N leads / consume
N quota. If lead-gen billing charges the seller per reveal (the vision's unit), a competitor spins up Sybils to burn a
seller's lead budget or fake "N interested people". Registration friction is the only current barrier (requires manual
verification of email/phone-verification strength at signup).

`[MINOR][abuse][trash][CONFIRMED-from-round1] backend/src/modules/listing/listing.service.ts:588 → per-viewer dedup doesn't stop multi-account Sybil reveal/lead inflation → before enabling per-reveal seller billing, add Sybil-resistance (verified contact at signup, device/velocity signals); route to security/finance.`

### T-4 — Consent withdrawal can't retract already-distributed contact (inherent, but undocumented to the user)  🟡 MINOR (trash → legal)
A seller toggles `show_phone` on (grant), buyers reveal and now hold the phone, seller toggles off (recorded as a ст.9
ч.2 withdrawal, `profile.service.ts:85`). The withdrawal is correctly logged but **cannot un-distribute** data already
revealed. That's inherent to any contact exchange, but the ФЗ-152 promise "you can withdraw" over-implies retraction.
The UI/consent text must set the expectation that withdrawal stops *future* distribution only.

`[MINOR][legal][trash][NEW] backend/src/modules/identity/profile.service.ts:85 → withdrawal stops future reveals but past reveals already hold the contact → consent copy must state "withdrawal prevents new disclosures; it cannot recall already-shared contacts"; route to legal.`

---

## CONFIRMED (round-2 findings still open at 0fcc182)

`[MAJOR][forward-compat][same][CONFIRMED]` **C2 animal-bound listing blocks all service/goods offerings.**
`listings.animal_id NOT NULL` (`database_schema.sql:240`) and `ListingCreateDto.animalId!` is mandatory
(`listing.dto.ts:49`). The D8 win (discovery reads the cached `l.market`, species-JOIN gone, `listing.service.ts:889`)
broke the market-derivation *cycle* but **not** the animal coupling. A vet, groomer, walker, sitter, cynologist has no
`ServiceOffering`; a goods seller has no `ProductOffering` — they'd have to invent a fake "animal" to list a service.
Every non-animal-selling persona still has **no offering surface**.
→ *fix:* land the polymorphic Offering (ADR-A) before provider/goods work; make `animal_id` nullable behind an
offering-type discriminator.

`[CRITICAL][forward-compat][same][CONFIRMED]` **C3 single scalar role → no multi-role, no self-declared vertical.**
`users.role VARCHAR(20)` scalar with verticals baked into the CHECK; the 0034 `user_roles` junction shipped but is
**DORMANT** (no authz reads it) and its only writer is the **ADMIN-only** `AdminUserService.setRole`
(`user-roles.controller.ts:15 @Roles('ADMIN')`). So a breeder-who-is-also-a-vet still can't hold both, and no persona
can self-declare FARMER/GROOMER/etc. The *form* is now reserved (SEV unchanged — the seam exists but the user-facing
capability doesn't).
→ *fix:* add a self-claim path for vertical identities + make authz read the junction; split platform-role from
vertical-identity.

`[MAJOR][half-built][same][CONFIRMED]` **N3 organization domain — dangling authz, no create path.** Still no
org/branch/member *writer* or controller (only `lib/org/org-membership.service` reads membership for authz).
`listings.organization_id`/`branch_id` are first-class and animal/listing authz keys on membership that **can never be
created via the API**. A shelter/kennel/farm cannot get an org account; org-owned listings/animals are unreachable.
→ *fix:* build the Organization create + member-add slice, or explicitly gate the org-authz branches until it lands.

`[MAJOR][abuse][same][CONFIRMED]` **C5 no per-user listing quota.** No active-listing cap or creation throttle
(`listing.controller.ts:70 @Post()`, no `@Throttle`); only `uq_active_listing_per_type` (one-per-type-per-animal) +
10-photo cap. Create N animals → N listings → flood a breed/city and the moderation queue.
→ *fix:* per-user active-listing cap + creation throttle; route to security.

`[MINOR][forward-compat][same][CONFIRMED]` **N5 `cities` has no lat/lng.** Still coordinate-less
(`database_schema.sql`), so a city-centroid "рядом со мной" / provider service-area geo-anchor (future-features §160)
can't be built on it. Cheap now, retrofit touches seed + every reference.
→ *fix:* add `cities.lat/lng` as a form-now seed seam.

---

## SEV-CHG
- **B-1 (was N2 photo, MAJOR) → BLOCKER.** The N2 security fix (own-host allowlist) shipped *without* the upload
  endpoint, converting "URL-only, ugly" into "no producible photo path → every seller blocked at submit."

---

## Adversarial / trash summary (routed)
| Vector | Status | Route |
|---|---|---|
| Photo bait-and-switch / SSRF | **mitigated** (own-host allowlist) | security ✓ |
| Claim-code brute force | **infeasible** (80-bit, single-use atomic GETDEL, uniform 422 miss) — verify redeem endpoint is throttled | security (manual) |
| Content-report abuse | **well-guarded** (throttled, server-derived reporter, `uq_open_report_per_reporter_entity`, no self-report leak) | — |
| Contact-reveal re-charge (same viewer) | **closed** (N4 dedup) | — |
| View-count inflation (IP rotation) | **open** (T-2) | security / data-analyst |
| Sybil reveal/lead inflation | **open** (T-3) | security / finance |
| Listing flood (no quota) | **open** (C5) | security |
| Consent-withdrawal retraction gap | **inherent** (T-4) | legal |
| Market-separation via free-text (list livestock under a pet species) | **moderation-dependent** — market tag is structural (species) but title/desc is free-text; only moderation catches a mismatched-content listing | moderation / manual |
| Favorite-count inflation | **low** — favorite count not currently exposed for ranking/analytics | note |
| IDOR (DRAFT listing/animal/analytics/favorite cross-user) | **holds** — favorites always own-scoped, reveal 404-no-leak, report reporter-derived; I could not break it | certified |

---

## Needs-coverage map (persona → real need → surface → status → what would close it)
| Persona | Real underlying need | Built surface | Status | What would close it |
|---|---|---|---|---|
| Pet owner / first-time buyer | Find + safely judge + contact a specific animal | discovery + favorites + reveal | **PARTIAL** | reputation (WW-3), photos to look at (B-1), free inquiry (WW-4) |
| Pet seller / breeder | Publish, get reachable leads, build a name | create/submit/reveal/analytics | **PARTIAL→GAP** | real photo upload (B-1), contact-reachability guard (B-2), reviews (WW-3), org/kennel account (N3) |
| Livestock farmer (buyer) | Source many head, compare sellers | discovery + reveal (5/h) | **PARTIAL** | higher/verified reveal cap (WW-5), reputation (WW-3) |
| Livestock farmer (seller) | List stock, prove legitimacy | create + reveal | **PARTIAL** | self-declare FARMER (C3), org/farm account (N3), reviews (WW-3) |
| Veterinarian | Offer services to owners | — | **GAP** | ServiceOffering (C2) + self-declared role (C3) |
| Cynologist / trainer | Offer training | — | **GAP** | ServiceOffering (C2) + role (C3) |
| Groomer | Advertise grooming, take bookings | — | **GAP** | ServiceOffering + booking (C2) |
| Dog-walker | Offer walks near me | — | **GAP** | ServiceOffering + geo service-area (C2/N5) |
| Sitter / boarding host | Offer boarding, get trust | — | **GAP** | ServiceOffering + reviews + role (C2/C3/WW-3) |
| Shelter | List animals for adoption at scale, as an org | listings (as a USER) | **PARTIAL→GAP** | org account (N3), bulk/adoption listing type |
| Goods seller (feed/accessories) | Sell products | — | **GAP** | ProductOffering (C2) + goods_marketplace toggle (0027, off) |
| Seasoned seller | Reputation portability, low-friction relist | create + analytics | **PARTIAL** | reviews/reputation (WW-3), listing quota fairness (C5) |
| Multi-role human (breeder+vet+owner) | Hold several identities | user_roles junction (DORMANT) | **GAP** | active multi-role + self-claim (C3) |

---

## Per-persona would-I-return verdicts (round-3)
- **Pet owner / first-time buyer:** 🟡 **Maybe** — I can now favorite and (if the seller enabled a channel) actually
  reach them, a real improvement. But with no photos to look at (B-1), no seller reputation to trust a stranger
  (WW-3), and no way to ask one question without burning a reveal (WW-4), I'd still cross-check on Avito.
- **Pet seller / breeder:** ❌ **No** — I literally cannot upload the kitten's photo (B-1), so I can't publish. Even
  if I could, no kennel account (N3), no reviews to build a name (WW-3).
- **Livestock farmer:** 🟡 **Maybe (buyer)** / ❌ **No (seller)** — sourcing works but the 5/h cap pinches (WW-5) and
  I can't prove I'm a real farm (C3/N3).
- **Vet / cynologist / groomer / walker / sitter:** ❌ **No** — still no offering surface at all (C2). Dead account.
- **Shelter:** ❌ **No** — no org account; listing dozens of animals as a single personal USER with no bulk tools.
- **Goods seller:** ❌ **No** — no product surface (C2, toggle off).
- **Multi-role human:** ❌ **No** — junction is dormant; I'm forced into one identity (C3).

**Headline verdict:** the core pet buyer↔seller loop went from *dead* (round-2) to *alive but thin*. The blocker is no
longer plumbing — it's (a) B-1: no one can add a photo, so no one can actually publish, and (b) WW-3: nothing keeps the
transaction, the trust, or the value on the platform. Fix B-1 and the marketplace is demoable; without a reputation +
on-platform reason-to-stay it can't retain against Avito or become the agent-run business the North-Star needs.

---

## Needs-driven test scenarios (for reviewer-qa / backend / security)
1. **[B-1] Real upload.** As a seller with a local file, find an endpoint to upload it → none; try `POST /photos` with
   an own-S3 URL you can't actually write → dead end; `submit` 422 "photo required". Confirms every seller blocked.
2. **[B-2] Dead-drop listing.** Create+submit a listing without ever enabling a contact channel → it reaches ACTIVE;
   a buyer reveals → `NO_CHANNELS`, quota untouched (good) but listing is un-actionable and seller is never warned.
3. **[WW-3] Off-platform leakage.** Reveal → get phone → mark-sold self-reported; assert no buyer confirmation, no
   review surface, no transaction record beyond `contact_reveals`. Confirms the platform sees none of the deal.
4. **[T-2] View inflation.** Hit `GET /listings/{id}` from N IPs → `view_count` climbs past the 30-min dedup. Assert
   analytics/ranking must not trust it raw.
5. **[T-3] Sybil leads.** N accounts each reveal listing X once → N `contact_reveals` rows / N leads for one buyer-set.
6. **[C5] Listing flood.** One user → 50 animals → 50 listings, all succeed (no cap).
7. **[C2] Species-less offering.** `POST /listings` without `animalId` → 400. Confirms animal-bound coupling; no vet
   service can be listed.
8. **[N3] Org account.** As a shelter, POST to create an organization → no route (404); confirm an org-owned listing is
   unreachable because no org can be created.
9. **[N1 positive] Notification delivered.** Seller submits → moderator APPROVE → assert an `IN_APP` `notification_logs`
   row lands for the seller (idempotent on redelivery). Then confirm there is **no** email/push read surface yet (WW-3
   caveat).
10. **[IDOR guard, positive]** Cross-user GET of DRAFT listing/animal/analytics/favorite → 404/no-leak throughout;
    favorite another user's DRAFT → 404. Certifies the IDOR posture I could not break.

---
*Scope note:* backend contracts + code only; frontend wiring and any email/push read surface = требует ручной проверки.
I modified no product code or docs; this file is my sole output.
