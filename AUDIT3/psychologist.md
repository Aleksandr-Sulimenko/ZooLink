# ZooLink HYPER² Audit — Round 2 · psychologist (trust · cognitive load · emotional journey · ethics / anti-dark-pattern)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) · **Role:** psychologist (paired with ux/ui)
**Method:** independent re-walk of the implemented flows against *current* code — a nervous first-time buyer,
a seller exposing a personal number, an owner transferring a beloved animal, and an owner receiving an AI
moderation verdict. Scanned every default / toggle / status / error / quota for dark patterns and emotional
silence; graded the AI-moderation side for humane handling; probed the multi-market / multi-offering expansion
for choice-overload. Grounded in code, not the round-1 file (Part 2 is the deliberate cross-check).

Finding format: `[severity][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line/pattern → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ trust · dark-pattern · cog-load · emotional · ethics · consent · forward-compat.

> **Stance (early-stage discount):** pre-launch; most items are RECORD (durable design-review knowledge, not a
> build-stop). A *live ethical defect in a shipped default or flow* is still ranked — a dark-pattern default is
> cheapest to kill before the first user meets it. All end-user copy/rendering is FE-owned → `требует ручной
> проверки` where the emotion is rendered client-side. I advise/critique; I did not touch product code — this
> file is my sole output.

---

## PART 1 — Independent findings (forward-compat + ethics/trust lens)

### 🔴 1. `contact_prefs` defaults `show_phone: true` — pre-checked consent for the most sensitive datum
`schema.prisma:662` (`@default("{\"show_phone\": true, \"show_telegram\": false}")`) and
`admin-user.service.ts:36` (`DEFAULT_CONTACT_PREFS = { show_phone: true, show_telegram: false }`, re-applied on
erase-reset at `:225`) still hard-code the phone channel ON by default. This is the textbook **pre-checked box**:
the user's *phone* — the single most-abused datum in a stranger marketplace for live animals — is "shareable" by
a system default the user never saw and (finding #2) cannot flip. The ethics gradient is *inverted*: the
identifying channel (phone) defaults ON, the pseudonymous one (Telegram) defaults OFF — the exact opposite of a
privacy-respecting default, and a direct contradiction of the operator's own "default-OFF, never pre-checked"
consent rule. Inert **today** (phone is null/encrypted-empty → reveal returns nothing), which is the only reason
this is not a BLOCKER — but the day contact-reveal is wired, every seller distributes their number with no
knowing act of consent.

`[CRITICAL][consent][CONFIRMED] backend/prisma/schema.prisma:662 (+ admin-user.service.ts:36,225) → contact_prefs defaults show_phone:true = pre-checked distribution of the most sensitive datum; identifying channel ON while pseudonymous OFF (inverted gradient); violates operator's own default-OFF rule → flip default to all-OFF, require an explicit affirmative toggle + a plain-language "who sees this and when" line before any channel is shareable. Fix the default before contact-reveal ships, not after the first leak.`

### 🔴 2. No self-service way to SET contact/visibility → the one consent that matters is unreachable, and the sole conversion path dead-ends
`UpdateProfileDto` (`identity.dto.ts:102`) exposes only `fullName / cityId / email / avatarUrl /
preferredLanguage` — **no** `contactPhone / telegram / showPhone / showTelegram`. So the user can neither *grant*
consent (turn a channel on) nor *withhold* it (flip the ON default off) — consent is a phantom control. Downstream
the harm is the highest-emotion moment in the whole product: a nervous first-time buyer invests real trust (phone
OTP at signup, a burned reveal quota), finds the perfect kitten, taps "показать контакт", and receives
`channels: {}` — silently. First impressions are disproportionately weighted (primacy + negativity bias); this
one reads as *the product is broken* or *I was baited*, and they leave for Avito where the number shows.

`[BLOCKER][trust][CONFIRMED] backend/src/modules/identity/dto/identity.dto.ts:102 → no self-service field to set/clear contact channels → consent toggle unreachable AND contact-reveal returns empty; buyer invests trust and receives nothing, silently → reads as broken/deceptive at the peak-emotion moment → expose contact + per-channel visibility on /v1/me PATCH; until then the empty-channel result MUST render an honest "seller has not published a contact yet", never a blank that looks like a bug or a bait.`

### 🟠 3. Reveal quota is consumed BEFORE the (currently always-empty) result — hidden-cost, and a phantom "reveal" is recorded
`listing.service.ts:457` calls `enforceRevealRateLimit` which at `:512` does `redis.incr(key)` — it **consumes**
the per-hour quota (10 pet / 5 livestock) *before* the seller is fetched (`:459`) and channels are built
(`:469-476`). Because no seller can publish a phone (finding #2) and phone decrypts to empty, channels resolve
`{}` on **every** reveal today — so the buyer spends a scarce reveal and gets nothing, with no pre-warning and no
refund. Worse, the `$transaction` at `:479` still writes a `contact_reveals` row and emits `ContactReveal.Created`
for an empty reveal — a phantom event that pollutes any future "leads"/analytics signal and misrepresents what
happened. This is a **hidden-cost / unearned-loss** pattern; loss aversion makes the wasted quota feel like a
penalty and erodes trust in the metering system itself.

`[MAJOR][dark-pattern][CONFIRMED] backend/src/modules/listing/listing.service.ts:457,509-528 → quota is incr'd before channels are computed; every reveal today resolves {} yet still burns quota AND writes a contact_reveals row + ContactReveal.Created event → hidden-cost + phantom-lead → do not decrement quota (and do not record a reveal) when channels resolve empty; show "this seller has no contact published — revealing won't cost you" before the tap. Route rate-limit fairness to security.`

### 🟠 4. Emotional silence on the two heaviest acts — transfer & moderation outcome — no notification domain
`backend/src/modules/` contains no notification module (confirmed: `admin, animal, auth, identity, listing,
moderation, saved-search`). Two emotionally weighty, time-boxed acts happen in total silence:
- **Ownership transfer** (`transfer.service.ts`): psychologically *sound at its core* — two-sided consent
  (recipient must `accept` at `:161`), a 72h expiry (`:24`), initiator `cancel` — this respects the gravity of
  handing over a living creature. But expiry is **lazy-on-read** (`:156` `expireIfDue`, no worker, comment
  `:24`) *and* there is no notification: the recipient is never told a PENDING transfer awaits, the initiator is
  never told it was accepted / declined / expired, and the 72h clock can silently run out with neither party
  pinged. The handover — the moment that most needs closure and reassurance — has no acknowledgement channel.
- **Moderation reject**: a machine or human rejecting a beloved animal's listing (`moderation.service`) reaches
  the owner through no channel; combined with no notification, a REJECT may never arrive at all.

`[MAJOR][emotional][CONFIRMED] backend/src/modules/animal/transfer.service.ts:24,156,161 (no notification module) → two-sided-consent + 72h transfer is well-designed, but with lazy-only expiry and zero notification the recipient never learns a PENDING transfer waits and the initiator never learns the outcome; an emotionally heavy, time-boxed handover expires in silence → when notification ships, transfer state-changes (pending/accepted/declined/expiring/expired) + moderation REJECT are P0 emotional touchpoints — confirm each with a clear, warm status. RECORD — gated on notification module.`

### 🟠 5. Zero earned-trust signal on a stranger-to-stranger LIVE-animal purchase — first-impression debt
No reviews, no ratings, no verified-seller badge, no reputation primitive exists in any module (grep: only
`listing.service` / moderation report reference the words). The highest-anxiety purchase in the catalog — a living
creature from a stranger — carries no reassurance a buyer can read *before* committing. **Partial credit (see
SEV-CHG in Part 2):** a buyer-facing *content-report* affordance does now exist (`content-report.controller.ts:42`,
reporter derived from the actor, any authenticated user can file). That covers "flag a bad listing" but not the
*positive* trust signals (who is this seller, have others dealt with them safely) that actually convert a nervous
buyer. Every persona meeting the product now learns "ZooLink has no trust signals" — an expensive prior to
overturn later (see forward-compat #7).

`[MAJOR][trust][CONFIRMED] backend/src/modules/ (listing/identity) → no reviews / ratings / verified-seller badge / reputation primitive on a stranger live-animal deal (a buyer-facing report affordance now exists, but no positive trust signal) → land verification-badge + proof-of-transaction reviews as SHARED primitives early (ADR-E seam, ADR-0016 tiers); reserve a buyer-side "meet safely" guidance surface. RECORD — Part-B sequencing.`

### 🟡 6. Cognitive load compounds as markets × offerings multiply — choice overload is the forward-compat risk
Today the surface is small, but the expansion vision (multi-market pet/livestock × multi-offering
animals/goods/services/expertise) will multiply, on the *same* screens, the number of decisions a stressed or
low-numeracy user faces: which market, which offering type, which of six+ listing statuses, which of seven roles
(`identity.dto.ts:15` — `USER / MODERATOR / ADMIN / BREEDER / FARMER / VETERINARIAN / GROOMER`, admin-granted
only). Hick's law (decision time grows with option count) and choice-overload (Iyengar) predict abandonment and
regret when a family shopping for a kitten is shown the same dense chooser as a farmer sourcing livestock — the
two mental models (emotional/identity vs economic/ROI, ADR-0002) must **not** be blurred into one flat menu. The
architectural seam (polymorphic Offering + `market_scope`) is right; the *psychological* risk is a single
undifferentiated entry point that forces every user to mentally filter out the 80% not meant for them.

`[MINOR][cog-load][NEW] backend/src/modules/listing/dto (+ identity roles) & future Offering seam → as market × offering types grow, one flat chooser forces stressed users to filter out most options (Hick's law / choice overload) and blurs the two distinct mental models (ADR-0002) → reserve an audience-first entry (pick pet vs livestock, then a scoped, progressively-disclosed offering set) so each user only ever sees their own decision space; never a single dense multi-market menu. RECORD — forward-compat, pairs with ux IA.`

### 🟡 7. Trust is correctly designed as ONE cross-cutting layer — the risk is timing, not fragmentation
future-features §C/§F name trust as a shared layer (risk-proportional verification badges, proof-of-transaction
reviews, geo-privacy/coarsened location, single provider profile, progressive just-in-time roles) over the
polymorphic Offering seam — a genuinely coherent plan that avoids per-vertical trust drift. The danger is that
*none* of these primitives exist in code yet, so early users learn a trustless product, and per-vertical signals
could still creep in if each Offering type ships its own ad-hoc cues. Earliest-to-land, because they anchor the
layer and are cheap-as-seams: (1) verification badge as a first-class, server-derived, never-client-asserted
provider attribute (ADR-0016 tiers); (2) reviews keyed to proof-of-transaction (ADR-E); (3) geo-privacy
coarse-by-default (precise address only post-booking — reserve the posture now so the ecosystem never ships
precise-by-default and has to walk it back, the same error class as show_phone:true).

`[MAJOR][forward-compat][CONFIRMED] docsRU/01-discovery/future-features.md (§C/§F) → trust designed as one shared layer (good) but zero primitives in code → first-impression debt + creep risk → land verification-badge + proof-of-transaction-reviews + geo-privacy-default as SHARED primitives over the Offering seam, never per-vertical. RECORD — Part-B.`

### 🟢 8. Bright spots (unchanged, still sound)
- **AI-decision transparency (ADR-0011):** `moderation.dto.ts:225-228` still carries `decidedByAgent /
  decidedBy / isHumanOverride / supersedesDecisionId`; the contract *can* tell an owner "decided automatically"
  and show a human override. Ethically sound seam. Gap unchanged: whether the owner *sees* "решение принято
  автоматически — запросить проверку человеком" + an appeal affordance is FE copy (`требует ручной проверки`),
  and with no notification a REJECT may never arrive.
  `[INFO][ethics][CONFIRMED] moderation.dto.ts:225 → AI-decision transparency correctly plumbed → ensure FE renders "decided automatically + request human review" on any AGENT REJECT and that it is delivered (needs notification). RECORD.`
- **Two-sided transfer consent + 72h graceful back-out** — psychologically right (see finding #4 for the silence caveat).
- **Self-service exit now exists** — see SEV-CHG in Part 2 (round-1's roach-motel is resolved).

---

## PART 2 — Cross-check vs `AUDIT2/psychologist.md` (round-1)

| # | Round-1 finding | Round-2 verdict | Evidence |
|---|---|---|---|
| 1 | `contact_prefs show_phone:true` pre-consent default (CRITICAL) | **CONFIRMED** | `schema.prisma:662`, `admin-user.service.ts:36,225` unchanged |
| 2 | UpdateProfileDto exposes no contact/visibility fields → consent unreachable + empty dead-end (BLOCKER) | **CONFIRMED** | `identity.dto.ts:102` still only fullName/cityId/email/avatarUrl/preferredLanguage |
| 3 | Reveal quota burned before empty result (MAJOR) | **CONFIRMED (reinforced)** | `listing.service.ts:512` incr before channels `:469-476`; a phantom `contact_reveals` row + event is also written for empty reveals |
| — | Silent transfer + moderation outcome, no notification module (MAJOR) | **CONFIRMED (reinforced)** | no notification module in `modules/`; transfer expiry is lazy-only (`transfer.service.ts:24,156`) → doubly silent |
| — | No reviews / verification / badge on stranger live-animal deal (MAJOR) | **CONFIRMED, sub-claim SEV-CHG** | no reputation primitive; but buyer-facing report **does** exist (`content-report.controller.ts:42`) — see below |
| — | Status vocabulary system-shaped (MINOR, cog-load) | **CONFIRMED** | `listing.dto.ts` enum unchanged; FE mapping still owed |
| — | AI-decision transparency plumbed (INFO, bright spot) | **CONFIRMED** | `moderation.dto.ts:225-228` intact |
| — | Trust-layer forward-compat: coherent, timing risk (MAJOR) | **CONFIRMED** | no primitives in code yet |
| — | Geo-privacy coarse-by-default not seamed (MAJOR) | **CONFIRMED** | still not seamed (`требует ручной проверки` on listing geo) |
| — | **No self-service exit = roach-motel** (MAJOR) | **REFUTED** | `me.controller.ts:63` `@Post('erase')` → `eraseMe` **now exists**, plus deactivate + `reactivate` (grace) at `:55-67`. Self-service exit is real; TP-6 now PASSES. Psychologically strong: deactivate→grace→reactivate→erase is an *undo-able* exit that reduces regret/loss-aversion and satisfies "revoke consent as easily as grant". |
| — | "No buyer-facing report affordance" (sub-claim inside the trust-journey MAJOR) | **SEV-CHG (down)** | `content-report.controller.ts:42` — any authenticated actor can file a report, reporter derived from actor; the *report* affordance exists (positive trust signals still absent) |
| — | Choice-overload as markets × offerings expand | **NEW** | Part-1 finding #6 |

**Diff counter:** NEW = 2 · CONFIRMED = 8 · REFUTED = 1 · SEV-CHG = 1

---

## Trust & ethics probes (delta from round-1's TP-1..TP-10)
- **TP-1** (no pre-checked consent default) — still **FAILS** (finding #1).
- **TP-2** (consent control reachable on /me PATCH) — still **FAILS** (finding #2).
- **TP-3** (empty-state honest + quota not decremented on empty) — still **FAILS** (finding #3); add: no phantom `contact_reveals` row/event on empty.
- **TP-4** (no raw status/error to user) — `требует ручной проверки` (FE).
- **TP-5** (AI-decision disclosed + appeal) — seam PASSES; rendering `требует ручной проверки`.
- **TP-6** (self-service exit exists) — now **PASSES** (`me.controller.ts:63`). Round-1 roach-motel resolved.
- **TP-7..TP-10** (reviews proof-of-transaction / badge derived / geo coarse-by-default / honest subscription) — future guards, all still un-landed; carry forward.

---

## Summary
- **Top live ethics/dark-pattern risks (unchanged):** (1) `show_phone:true` pre-checked default (CRITICAL,
  inverted gradient — fix the default now); (2) consent control unreachable + silent empty-channel dead-end
  (BLOCKER, peak-emotion trust break); (3) reveal quota + a phantom reveal-record burned before an always-empty
  result (MAJOR, hidden-cost).
- **Emotional silence:** transfer (lazy-expiry + no notification) and moderation REJECT reach the owner through
  no channel — the two heaviest acts happen unacknowledged. RECORD, gated on a notification module.
- **Improvements since round-1:** self-service exit (`eraseMe` + deactivate/reactivate-grace) **resolves the
  roach-motel** — a psychologically strong, undo-able exit; and a buyer-facing content-report affordance exists.
- **Forward-compat:** trust is designed as one shared layer (good); the risk is timing (first-impression debt)
  and, newly, choice-overload as market × offering types multiply — reserve an audience-first, progressively-
  disclosed entry so neither mental model is blurred.
- **Bright spots:** AI-decision transparency (ADR-0011), two-sided transfer consent, and the graceful exit.

*Scope note:* all end-user copy/rendering (status labels, error text, AI-decision disclosure, empty-state) is
FE-owned → `требует ручной проверки` where noted. No product code or docs modified; this file is my sole output.
