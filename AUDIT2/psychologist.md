# ZooLink HYPER Audit — Phase 2 · psychologist (trust · cognitive load · ethics · anti-dark-patterns)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Role:** psychologist (paired with ux/ui)
**Method:** walked the implemented flows as a nervous first-time buyer, a seller exposing personal
contact, and an owner transferring a beloved animal; scanned every toggle/default/status/error for
dark patterns; judged the AI-moderation side for emotional handling; grounded in actual code.
Primary input = `AUDIT2/active-user.md` (Phase-1 personas & friction); consent context from
`AUDIT2/legal.md` §2/§2a.

Finding format: `[severity][criterion][psychologist] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ trust · dark-pattern · cog-load ·
emotional · ethics · consent · forward-compat.

> **Stance note (early-stage discount):** ZooLink is pre-launch; most items are RECORD — durable
> psychology/ethics knowledge for design-review, not a stop on the build. Where a pattern is a *live
> ethical defect in a default or a shipped flow* I still rank it, because a dark-pattern default is
> cheapest to fix before any user ever meets it. Where FE renders the emotion I mark
> `требует ручной проверки`. I did not modify product code or docs; this file is my sole output.

---

## 🔴 Headline psychology findings

### 1. `contact_prefs` defaults to `show_phone: true` — a pre-consent dark pattern at the exact trust-fault-line
`schema.prisma:662` and `admin-user.service.ts:36` hard-code the default
`{"show_phone": true, "show_telegram": false}`. legal flags this as ст.10.1 pre-consent (correct on
the law). I judge it as a **consent/ethics dark pattern**: the user's *phone number* — the single
most sensitive, most-abused datum in a stranger marketplace for live animals — is set to "shareable"
by a system default the user never saw, never toggled, and (finding #2) cannot even find. This is
the textbook "pre-checked box" — the pattern the operator's own consent draft Design-Rule-1 forbids
("default OFF, never pre-checked"). The privacy-sensitive channel (Telegram, a pseudonym) defaults
OFF while the *identifying* channel (phone) defaults ON — the ethics gradient is exactly inverted.
Today it is inert (phone column is null, reveal returns empty), so no phone actually leaks — which is
the *only* reason this is not a BLOCKER. But the moment contact-reveal is wired (active-user
finding #1), every seller distributes their phone without a knowing act of consent. **This must be
fixed as a default now, not retrofitted after the first leak.**

`[CRITICAL][dark-pattern][psychologist] backend/prisma/schema.prisma:662 → contact_prefs defaults show_phone:true = pre-checked distribution of the most sensitive datum (phone) the user never consented to; identifying channel defaults ON while pseudonymous (telegram) defaults OFF — inverted ethics gradient; contradicts operator's own "default-OFF, never pre-checked" rule → flip default to all-OFF; require an explicit affirmative toggle (with a plain-language "who can see this and when" line) before any channel is shareable. Inert today (phone null) so not a live leak, but fix the default before contact-reveal ships.`

### 2. No self-service way to SET contact/visibility → the one consent that matters is unreachable, and the sole conversion path dead-ends
active-user's BLOCKER #1 is a psychology finding too. `UpdateProfileDto` (`identity.dto.ts:102`)
exposes no `contact_phone`/`telegram`/`show_phone`/`show_telegram`. So the user can neither *grant*
consent (turn a channel on) nor *withhold* it meaningfully (the ON default is unreachable to flip
OFF) — consent is a phantom control. Downstream: a nervous first-time buyer signs up (a real trust
investment — hands over a phone via OTP), finds the perfect kitten, clicks "показать контакт", and
gets `channels: {}`. This is the **trust-shattering moment**: the product asked for commitment and
returned nothing. Worse, it is silent — no "this seller hasn't published a contact yet" — so it reads
as *the product is broken* or *I was tricked*. First impressions are disproportionately weighted
(primacy/negativity bias); this one impression tells the user the marketplace does not connect
humans. They leave for Avito, where the number shows. Emotionally this is the single most expensive
moment in the whole product.

`[BLOCKER][trust][psychologist] backend/src/modules/identity/dto/identity.dto.ts:102 → no self-service field to set/clear contact channels → consent toggle is unreachable AND contact-reveal returns empty channels; the buyer invests trust (OTP, a burned reveal quota) and receives nothing, silently → reads as broken/deceptive at the highest-emotion moment → expose contact + visibility on /me PATCH; until then, the empty-channel result MUST render an honest state ("seller has not published a contact"), never a blank that looks like a bug or a bait. (Root cause = active-user #1; this is its emotional cost.)`

### 3. Reveal quota is burned BEFORE the empty result — the user pays for nothing, unwarned
`listing.service.ts:457` enforces the per-hour reveal rate-limit *before* building `channels`
(`:459-476`), and channels can legitimately be empty. So a buyer spends one of their 10 (pet) / 5
(livestock) reveals and receives `{}` — no refund of the quota, no pre-warning that this seller has
no contact. That is a **hidden-cost pattern**: a scarce resource is consumed with no disclosed value
delivered. Even once contacts populate, a mistaken or exploratory click costs real quota. Behavioral
fairness (loss aversion) makes an unearned loss feel like a penalty and erodes trust in the metering
system itself.

`[MAJOR][dark-pattern][psychologist] backend/src/modules/listing/listing.service.ts:457 → reveal quota is consumed before the (possibly empty) channels are computed; user pays a scarce reveal and may get {} with no warning or refund → hidden-cost / unearned-loss pattern → do not decrement quota when channels resolve empty; and/or show "this seller has no contact published — revealing will not cost you" before the click. Route rate-limit fairness to security.`

---

## Trust journey — where trust builds vs breaks (per the three anxious actors)

- **Nervous first-time buyer.** *Builds:* public browse without forced signup (`listing.controller.ts:57,85`)
  — good, low-commitment first touch respects autonomy. *Breaks:* zero trust signal on a live-animal
  purchase from a stranger — no reviews, no verified-seller badge, no "safe deal" guidance, no
  buyer-facing report affordance (content-report is moderator-shaped). Then the empty-channel
  dead-end (finding #2) shatters what little trust formed. Net: trust is built cheaply and then
  destroyed at the conversion moment — the worst possible ordering.
  `[MAJOR][trust][psychologist] whole repo (listing/identity modules) → no reviews, no seller verification badge, no buyer-facing "report this listing / meet safely" affordance on a stranger-to-stranger live-animal deal → the highest-anxiety purchase in the catalog carries zero reassurance → reserve a proof-of-transaction reviews seam + risk-proportional verification badge + a buyer-side report/safety surface (form-now per future-features §C; ADR-E). RECORD — design-review + Part-B.`

- **Seller exposing personal contact.** *Builds:* nothing yet — they cannot even set the contact
  (finding #2), so no informed exposure decision is offered. *Breaks:* the pre-consent default
  (finding #1) means the *system* decides their phone is public, not them — the opposite of the
  control a person needs before exposing a personal number to strangers. Sybil-resettable reveal caps
  (active-user, security) mean a seller's phone, once live, can be scraped across throwaway accounts —
  a latent trust bomb.

- **Owner transferring a beloved animal.** *Builds:* the transfer flow is psychologically sound at
  its core — it is **two-sided consent**: PENDING → the recipient must explicitly `accept`
  (`transfer.service.ts:161,187`), no unilateral push of an animal onto someone; a 72h expiry
  (`:23`) and initiator `cancel` (`:274`) give a graceful back-out. This respects the gravity of
  handing over a living creature. *Breaks:* **there is no notification module** (confirmed:
  `backend/src/modules/` has none) — so the recipient is never told a transfer is waiting, and the
  initiator is never told it was accepted/declined/expired. An emotionally weighty, time-boxed act
  (72h) happens in total silence; the animal's handover — the moment that most needs closure and
  reassurance — has no acknowledgement channel. The same silence hits the moderation outcome
  (below).
  `[MAJOR][emotional][psychologist] backend/src/modules/animal/transfer.service.ts:122 → transfer is correctly two-sided-consent + 72h expiry, but with no notification module the recipient never learns a PENDING transfer awaits and the initiator never learns the outcome; a 72h-boxed, emotionally heavy handover of a living animal happens in silence and can silently expire → when notification ships, transfer state-changes (pending/accepted/declined/expiring/expired) are P0 emotional touchpoints — confirm each with a clear, warm status. RECORD — gated on notification module.`

---

## Cognitive load — is the vocabulary human-legible or system-shaped?

- **Status vocabulary** (`listing.dto.ts:40`): `DRAFT | PENDING_MODERATION | ACTIVE | EXPIRED | SOLD
  | DEACTIVATED`. Six states, SCREAMING_SNAKE, system-shaped. `PENDING_MODERATION` vs `DEACTIVATED`
  vs `EXPIRED` are engineer words; a seller (esp. an elderly farmer, low-numeracy per the a11y
  brief) must learn a state machine to understand "why can't buyers see my post?". Miller's limit is
  fine (6 ≤ 7) but the *labels* are the load, not the count. These are wire enums — acceptable in the
  API — but FE MUST map each to a plain-language, reassuring human phrase + a "what to do next" hint,
  never surface the raw token. `требует ручной проверки` on FE copy.
  `[MINOR][cog-load][psychologist] backend/src/modules/listing/dto/listing.dto.ts:40 → status enum is system-shaped (PENDING_MODERATION/DEACTIVATED/EXPIRED) — engineer vocabulary a stressed/low-literacy seller must decode → keep the wire enum but require FE to render a plain-language label + next-action for each state ("На проверке — обычно до X часов", "Срок истёк — обновить?"); never show the raw token. FE copy = требует ручной проверки.`

- **Error messages** (`listing.service.ts:133-545`): codes are clean (`LISTING_NOT_EDITABLE`,
  `LISTING_NOT_DRAFT`, `INVALID_STATE`, `SELF_REVEAL`); messages are English, terse, system-framed
  ("A EXPIRED listing cannot be edited"). Good for developers; these are not end-user copy. The
  human at the other end is often mid-task and mildly anxious — errors need to say *what happened,
  why, and what to do*, in RU, warmly. This is a FE/i18n contract, not a backend defect — flag for
  design-review so raw messages never reach users. `требует ручной проверки`.

- **Role model** (`identity.dto.ts:15`, active-user #2/#3): registering as `USER` with no
  self-service upgrade, six personas with no role at all — this is *conceptual* cognitive load
  (users cannot locate themselves in the product's mental model) on top of the functional gap
  active-user already ranked. Deferring to active-user's CRITICAL; my note is that a role a user
  cannot claim is worse than no role — it invites a dead sign-up and the self-blame that follows
  ("I must be doing it wrong"). Keep the enum honest: hide roles that can do nothing.

---

## Ethics of the AI side (agent-as-principal moderation/expertise, ADR-0011)

**Verdict: structurally well-handled — this is a bright spot.** The owner-facing result carries
`decidedByAgent: boolean` and `decidedBy: ActorView` (`moderation.dto.ts:225-226`, dupl.
`OwnerModerationResultView`), plus `isHumanOverride` and `supersedesDecisionId`. So the contract
*can* tell a user "this was decided by an automated moderator" and show when a human overrode it —
the transparency ADR-0011 promises is genuinely plumbed, and AGENT decisioning is gated OFF in MVP
(`moderation.service.ts:44-45,286`, 403 until toggle). Ethically sound seams. **Two psychology
gaps to record:**
1. **The emotional framing is not guaranteed to surface.** `decidedByAgent` is a boolean in a DTO;
   whether the *user actually sees* "решение принято автоматически, вы можете запросить проверку
   человеком" is FE copy — and a REJECT decided by a machine on someone's beloved animal's listing
   is a high-affect moment that needs disclosure + a visible human-appeal path, not a silent flag.
   `требует ручной проверки` on FE; and there is no notification (above), so the reject may never
   reach the owner at all.
2. **Human-override on document issue (consultation/expertise).** future-features §C mandates an
   obligatory human-override on AI document release; that module is unbuilt, but the moderation
   `isHumanOverride` seam is the right pattern to carry forward. RECORD.

`[INFO][ethics][psychologist] backend/src/modules/moderation/dto/moderation.dto.ts:225 → AI-decision transparency (decidedByAgent/decidedBy/isHumanOverride) and the agent_moderation OFF-gate are correctly plumbed (ADR-0011 honoured) → ensure FE actually renders "decided automatically + request human review" on any AGENT REJECT (a high-affect moment on a beloved animal), and that it is delivered (needs notification). Carry the isHumanOverride pattern to the future AI-document-release override (future-features §C). RECORD — FE copy = требует ручной проверки.`

---

## Roach-motel / exit-integrity

**No self-service account deletion or data erasure exists.** Erase is ADMIN-only
(`admin-user.controller.ts:42` `POST :userId/erase`); a user cannot delete their own account or data
from any self-service surface. Combined with the OTP phone the user hands over at signup, this is a
**roach-motel**: easy to get in (phone OTP), no way out without an admin. Beyond the ФЗ-152
right-to-erasure angle legal owns, the *psychology* is: knowing you can leave is a precondition of
trusting enough to join. An easy, self-service exit paradoxically *increases* retention trust. This
is also the honest mirror of the withdrawal-of-consent duty (consent must be as easy to revoke as to
grant).

`[MAJOR][dark-pattern][psychologist] backend/src/modules/identity/admin-user.controller.ts:42 → erase/delete is ADMIN-only; no self-service account/data deletion → roach-motel (easy phone-OTP entry, no user-initiated exit); withdrawing consent is not as easy as granting it → add a self-service "delete my account / erase my data" path (ties to legal's ФЗ-152 erasure + consent-withdrawal-log seam). RECORD (non-blocking) — pairs with legal §2.`

---

## FORWARD-COMPAT — is a coherent TRUST LAYER reserved, or will trust fragment per vertical?

**Verdict: the *architecture* reserves it well; the *trust primitives themselves* are not yet
seamed, and that is the real risk.** future-features §C+§F correctly name trust as a cross-cutting
layer and list the right primitives to reserve form-now: risk-proportional verification badges
(§C-trust bullet 1), proof-of-transaction reviews (bullet 4), geo-privacy / coarsened location
(bullet 6), "continue where you left off" / seamless cross-vertical transitions (§C-comfort), single
provider profile with reviews+verification+hours (§C-comfort bullet 3), progressive just-in-time
roles (§C bullet 1). §F puts the polymorphic Offering key + reserved Reviews/Reputation seam +
multi-role model in the "form-now" column. **This is a genuinely coherent plan — the trust layer is
designed as one layer, not per-vertical.** The danger is timing: today *none* of these primitives
exist in code (active-user confirmed: no reviews, no verification, no favorites, no
notification, single-role, no geo-privacy toggle), and the current build is teaching users a
*trustless* experience. The psychological risk is not fragmentation-by-design (the design avoids it)
but **the first-impression debt**: every persona meeting the product now learns "ZooLink has no
trust signals," and that prior is expensive to overturn later. Concretely, three trust primitives
should move earliest because they anchor the whole layer and are cheap-as-seams:
1. **Verification badge as a first-class provider attribute** (proportional to risk — derived, never
   client-asserted; ADR-0016 already models the tiers) — so trust is *visible* the day the first
   provider lists.
2. **Reviews keyed to proof-of-transaction** over provider+offering (ADR-E seam) — reputation is the
   only thing that makes a breeder/vet/boarder prefer ZooLink to a Telegram chat (active-user).
3. **Geo-privacy default** (coarsened location; precise address only after confirmed booking) —
   reserve the *coarse-by-default* posture now so the ecosystem never ships precise-by-default and
   has to walk it back (the same class of error as the show_phone:true default).

`[MAJOR][forward-compat][psychologist] docsRU/01-discovery/future-features.md:171 → trust is correctly designed as ONE cross-cutting layer (verification badges, proof-of-transaction reviews, geo-privacy, "continue where you left off") and §F reserves the seams; but zero trust primitives exist in code today, so early users learn a trustless product (expensive first-impression debt), and per-vertical trust could still creep in if each Offering type ships its own ad-hoc signals → hold the single-trust-layer discipline: land verification-badge + proof-of-transaction-reviews + geo-privacy-default as SHARED primitives over the polymorphic Offering seam, never per-vertical. RECORD (non-blocking) — Part-B sequencing.`

`[MAJOR][forward-compat][psychologist] docsRU/01-discovery/future-features.md:179 → geo-privacy (coarsened location, precise address only post-booking) is named but not seamed; the current listing carries optional precise lat/lng with no coarse-by-default posture → reserve coarse-by-default geo now so the ecosystem never ships precise-by-default (same error class as show_phone:true); precise reveal gated on confirmed booking. RECORD — pairs with security geo-privacy + legal ФЗ-152.`

---

## Trust & ethics probes  (assertable checks for Phase-3 / design-review)

Concrete, checkable assertions. Mix of **today** (a defect assertable against current code) and
**future** (guard the trust primitive before its vertical ships).

**TP-1 (today) — no pre-checked consent default.** Assert `users.contact_prefs` DB default is
all-OFF (`{"show_phone": false, "show_telegram": false}`), and that no channel is `true` unless the
user performed an explicit affirmative toggle recorded with a timestamp. (Grep-gate: schema default
must not contain `"show_phone": true`.) — enforces finding #1.

**TP-2 (today) — consent control is reachable.** Assert the self-service profile update surface
(`/v1/me` PATCH) exposes fields to set/clear each contact channel's visibility. If absent ⇒ fail
(consent is a phantom control). — enforces finding #2.

**TP-3 (today) — empty-state is honest, not misleading.** Assert that when contact-reveal resolves
`channels: {}` the response is distinguishable from an error and carries a machine-readable "no
contact published" signal (not a bare `{}` that FE could render as a bug or a bait). And assert the
reveal quota is **not** decremented when channels resolve empty. — enforces finding #3.

**TP-4 (today) — no raw system status/error reaches the user.** Assert (FE contract / snapshot) that
every `ListingStatus` token and every service error `code`/`message` is mapped to a plain-language RU
string before display; no raw `PENDING_MODERATION` / `LISTING_NOT_EDITABLE` string appears in
user-visible copy. — `требует ручной проверки` (FE).

**TP-5 (today) — AI-decision is disclosed.** Assert that any moderation result with
`decidedByAgent === true` is rendered to the owner with an explicit "decided automatically" statement
AND a visible "request human review" affordance; assert `agent_moderation` toggle is OFF in MVP so no
AGENT decision ships un-gated. — enforces the ADR-0011 emotional-handling gap.

**TP-6 (today) — self-service exit exists (or is honestly absent).** Assert there is a user-initiated
account-delete/erase path; if only the ADMIN erase exists, flag as roach-motel + consent-withdrawal
gap. — enforces the roach-motel finding.

**TP-7 (future, reviews) — reviews require proof-of-transaction.** Assert no review/rating row can be
created without a linked completed transaction (sale/booking/order); anonymous or unlinked reviews
are rejected (anti-накрутка, and the trust signal must be earned to be believed). — guards ADR-E.

**TP-8 (future, verification) — badge is derived, proportional, never self-asserted.** Assert a
verification badge is set only from a server-side verification record at the risk-appropriate tier
(vet/pharmacy = licence; groomer/walker = identity+phone), never from a client-supplied flag. —
guards future-features §C trust bullet 1 + ADR-0016.

**TP-9 (future, geo-privacy) — coarse-by-default.** Assert provider/listing location is exposed
coarsened (geohash/radius) by default and precise address is released only after a confirmed booking.
— guards finding forward-compat #2.

**TP-10 (future, forced-continuity) — subscription is honest.** When the corn/feed reorder /
subscription retention engine ships (future-features §A goods), assert: no auto-renew is enabled by
default without explicit opt-in; cancellation is as easy as signup (symmetric, no roach-motel, no
confirm-shaming copy on the cancel path); a clear pre-charge reminder is sent. — guards the #1 LTV
driver against the classic forced-continuity dark pattern before it exists.

---

## Summary
- **Top dark-patterns/ethics risks:** (1) `contact_prefs` `show_phone:true` pre-consent default
  (CRITICAL — inverted ethics gradient, fix the default now); (2) consent control unreachable +
  empty-channel dead-end is silent/deceptive (BLOCKER emotional cost of active-user #1); (3) reveal
  quota burned before empty result = hidden-cost (MAJOR); (4) no self-service exit = roach-motel
  (MAJOR).
- **Trust-break moments:** the empty contact-reveal (shatters trust at the conversion peak); silent
  transfer/moderation outcomes (no notification module) on emotionally weighty acts; zero trust
  signal on a stranger live-animal purchase.
- **Forward-compat trust-layer verdict:** the plan is **coherent — trust is designed as ONE
  cross-cutting layer, not per-vertical** (good); the real risk is timing — no trust primitive
  exists yet, so early users learn a trustless product (first-impression debt). Land
  verification-badge + proof-of-transaction-reviews + geo-privacy-default as SHARED primitives over
  the polymorphic Offering seam.
- **Bright spot:** AI-decision transparency (ADR-0011) and two-sided transfer consent are
  structurally sound.
- **Probes produced: 10** (TP-1..TP-10; 6 assertable today, 4 guard future trust primitives).

*Scope note:* all end-user-visible copy (status labels, error text, AI-decision disclosure,
empty-state rendering) is FE-owned → `требует ручной проверки` where noted. No product code or docs
modified; this file is my sole output.
</content>
</invoke>
