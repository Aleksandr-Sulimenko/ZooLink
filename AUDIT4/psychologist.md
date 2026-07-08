# ZooLink HYPER³ Audit — Round-4 · psychologist (trust · cognitive load · emotional journey · ethics/anti-dark-pattern · WIN-WIN lead)

**Date:** 2026-07-08 · **Branch:** `backend` HEAD `0fcc182` · **Role:** psychologist (paired with ux/ui), **leading the win-win / anti-dark-pattern strategic verdict.**
**Method:** independent re-walk of the *now-LIVE* marketplace flows (contact-exchange, consent, notifications, transfer, moderation) against current code — a nervous first-time buyer, a seller publishing a personal number, an owner handing over a beloved animal, an owner receiving an AI/human verdict. Every built mechanic and every reserved monetization toggle put through the **WIN-WIN lens** (does it create value for BOTH sides, or extract from one?). Grounded in code, reconciled against `AUDIT3/psychologist.md` (round-2) and `AUDIT2/psychologist.md` (round-1).

**Finding format:** `[severity][criterion][axis: same|new|trash|strat][NEW|CONFIRMED|REFUTED|SEV-CHG|FIXED-VERIFIED] file:line → problem → fix`.
Severity ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO. Criterion ∈ trust · dark-pattern · cog-load · emotional · ethics · consent · win-win · forward-compat. Strategic findings carry `[WW|PERSP]`.

> **Stance:** advisory only — I did not build, run tests, commit, or touch src. All end-user copy/rendering is FE-owned → `требует ручной проверки` where the emotion is rendered client-side. Monetization is **owner-deferred (soft-start)**; the toggle verdicts below are RECORD/forward-looking, ranking the *psychological/emotional* extraction risk each will carry when it flips on — a win-win FAILURE is weighted like a bug, not a nice-to-have.

---

## HEADLINE — WIN-WIN VERDICT (`[WW]`)

**The three round-2 dark-pattern defects are all FIXED-VERIFIED, and they were fixed the *right* way — toward symmetry, not toward a softer extraction.** The default-deny consent gate, the "no charge for an empty/duplicate reveal" billing-unit fix, and the purely-transactional notification layer make the *built* surface one of the cleanest win-win marketplaces I have audited: today **no live mechanic extracts from either side.**

**The risk has moved from what is built to what is reserved.** Of the six reserved revenue toggles (all off/0%, form-now), **two are EXTRACTIVE-by-default the day they flip and must be re-shaped now** — `vet_leadgen` (exploits a pet owner at peak health-anxiety/grief) and `boosted_listings` (pay-to-win ranking on a *living-animal* impulse purchase) — and two more (`payments` on the only contact path, `goods_marketplace` subscriptions) are RISKY at a specific seam. The soft-start philosophy is the owner's protection here; my job is to name the exact seam where each toggle would flip HEALTHY→EXTRACTIVE so the *form* reserved now already forbids it.

### Win-win verdict table

| Mechanic / Toggle | State | Verdict | Why (psychology/emotional lens) | Fix that restores symmetry |
|---|---|---|---|---|
| **Contact-reveal (billing-unit)** | LIVE | **HEALTHY** | Buyer gets a contact only when the seller consented *and* published; empty (`NO_CHANNELS`) and repeat reveals are **free** (no quota, no row, no event, `listing.service.ts:566-579`). No hidden cost, no loss-aversion penalty. | Keep the "never charge for NO_CHANNELS/dedup" invariant when `payments` flips (see PERSP-1). |
| **Consent-gated phone reveal** | LIVE | **HEALTHY** | Default-deny (`schema.prisma:671` all-OFF), explicit affirmative opt-in, withdrawal recorded in the **same tx** as toggling off (`profile.service.ts:86-93`) → revoke is as easy as grant. Textbook consent symmetry. | None. This is the model to copy for all future consent (marketing/analytics reserved rows). |
| **Reveal quota (10 pet / 5 livestock /h)** | LIVE | **HEALTHY** | Not extraction — an anti-scrape *fairness* cap that protects the seller's number from harvest across a session. Consumed only on a first resolvable reveal. | Keep it a security cap, never repurpose as a paywall lever (that would flip it EXTRACTIVE). |
| **Ownership transfer** | LIVE | **HEALTHY** | Two-sided consent, 72h graceful expiry, initiator cancel, and now full lifecycle notifications to *both* parties. Respects the gravity of handing over a living creature. | Close the lazy-expiry notification gap (F4 below). |
| **Notifications / nudges** | LIVE | **HEALTHY (exemplary)** | Transactional-ONLY (`notification.consumer.ts:22-26`): moderation outcome + transfer lifecycle. Never reads `notification_prefs` *for lawful transactional* (ФЗ-38), forward-only replay so no stale spam, **no engagement-bait, no marketing, no re-engagement FOMO.** | None. When a marketing channel is ever added it MUST be a separate, opt-in, prefs-respecting path — never smuggled through this transactional lane. |
| **Self-service exit (deactivate→grace→erase)** | LIVE | **HEALTHY** | Undo-able exit (`profile.service.ts:116-171`) — knowing you can leave is a precondition of trusting enough to join; round-1 roach-motel stays resolved. | None. |
| **`payments`** | reserved/off | **RISKY** (seam-specific) | Neutral infra today. Flips EXTRACTIVE only if it paywalls the *only* path to a seller who *wants* to be contacted — charging a nervous buyer at the "perfect kitten" peak-emotion moment to complete a match both sides already want extracts from both. | Never gate the *first* contact behind a fee; monetize seller tooling/volume, not the buyer's access to a consenting seller. Preserve the empty/dedup-is-free invariant. → PERSP-1. |
| **`boosted_listings`** | reserved/off | **RISKY** | Pay-to-win search ranking on a **living-animal impulse purchase**: (a) asymmetric across sellers (ad-spend beats welfare/fit), (b) degrades buyer trust when the top result is bought, not best-matched, (c) can push impulse acquisition of a creature. Sharper in **pet** (emotional) than **livestock** (economic/ROI). | Label boosted clearly ("продвигается"), cap boost density, rank primarily by relevance/fit, and **never let boost override a safety/verification signal**. → F5. |
| **`premium_profiles`** | reserved/off | **RISKY at the trust-cue boundary** | Seller analytics + extended gallery = HEALTHY (seller value, no buyer harm). Becomes EXTRACTIVE the moment "premium" buys a *trust cue* a buyer reads as credibility (asymmetric information — buyer can't tell "paid" from "trustworthy"). | Premium may buy tooling/visibility, **never a verification/trust badge**. Trust must stay earned/derived (TP-8). → F6. |
| **`vet_leadgen`** | reserved/off | **EXTRACTIVE** (as-conceived) | Routes a pet owner in a health-anxiety or **grief** moment (max persuadability, min scrutiny) to whoever *paid most*, not who is nearest/best. Textbook exploitation of emotional stakes. | Rank vets by fit/proximity/rating, disclose any sponsorship, and **never inject a paid vet promotion into an emergency/grief flow**. Without these it must not ship. → F7. |
| **`service_marketplace`** | reserved/off | **HEALTHY (conditional)** | Real two-sided value (vets/trainers/transport) — *if* the shared trust layer (proof-of-transaction reviews, derived verification) lands first. Without it, a trustless lead-dump. | Gate `service_marketplace` behind the reviews+verification primitives (F2). |
| **`goods_marketplace`** | reserved/off | **RISKY at subscription** | Feed/accessory reorder is the classic **forced-continuity** surface. | Opt-in auto-renew (never pre-checked), cancel as easy as signup, pre-charge reminder, no confirm-shaming on cancel (TP-10). → PERSP-2. |
| **`digital_assets` (NFT)** | reserved/off | **RISKY / ethics-flag** | Tokenizing a *living being's* identity risks commodifying a creature into a tradable asset — an emotional/ethical hazard distinct from goods. | Before any behavior, route through an ethics review; never let a live animal's welfare be subordinate to its token's tradability. → PERSP-3. |

---

## PART 1 — DIFF reconciliation vs AUDIT3 (round-2) / AUDIT2 (round-1)

### F1. `contact_prefs` pre-checked `show_phone:true` default — **FIXED-VERIFIED**
`[CRITICAL→resolved][consent][same][FIXED-VERIFIED]` `schema.prisma:671` now `{"show_phone": false, "show_telegram": false}`; `DEFAULT_CONTACT_PREFS` all-OFF in `admin-user.service.ts:36` **and** `retention.service.ts:14`; erase-reset leaves distribution OFF (`admin-user.service.spec.ts:213`). The inverted ethics gradient is gone — no channel is shareable without an affirmative act. **Round-2's #1 CRITICAL is closed at the default.** ✅

### F2. Consent control unreachable + silent empty dead-end — **FIXED-VERIFIED**
`[BLOCKER→resolved][trust][same][FIXED-VERIFIED]` `UpdateProfileDto` now exposes `contactPhone / contactTelegram / showPhone / showTelegram`; `profile.service.ts:61-93` writes them and records the `CONTACT_DISTRIBUTION` consent transition (grant on any-channel-on, **withdrawal** on all-off) in the same tx. The reveal returns a distinct `status:'NO_CHANNELS'` (`listing.service.ts:569`) instead of a bare `{}` — the empty state is now machine-honest, not a bait-shaped blank. **Round-2's #2 BLOCKER is closed.** ✅ *(FE still owes the warm human copy for `NO_CHANNELS` — `требует ручной проверки`.)*

### F3. Reveal quota burned before empty + phantom lead — **FIXED-VERIFIED**
`[MAJOR→resolved][dark-pattern][same][FIXED-VERIFIED]` `listing.service.ts:553-579`: channels computed FIRST; `NO_CHANNELS` burns **no quota, no `contact_reveals` row, no event**; a dedup re-reveal of the same `(viewer,listing)` returns the existing channels free. The hidden-cost / unearned-loss pattern is eliminated. **Round-2's #3 MAJOR is closed.** ✅

### F4. Emotional silence on transfer & moderation — **FIXED-VERIFIED (with one residual, SEV-CHG down)**
`[MAJOR→MINOR][emotional][same][SEV-CHG]` A real notification layer now exists (`notification.consumer.ts`, IN_APP). `Moderation.Decided`→seller (approved/rejected/changes) and the full transfer lifecycle (`Initiated`/`Accepted`/`Declined`/`Cancelled`→the other party; `Expired`→both) are wired (`notification.registry.ts:53-105`). The two heaviest acts are no longer silent. **Residual:** `OwnershipTransfer.Expired` is emitted only inside `expireIfDue`, which is **lazy-on-read** (`transfer.service.ts:31,230,511`; no worker in MVP). If neither party opens the transfer after the 72h lapse, the expiry event — and its "your transfer lapsed" notification to both — never fires. An emotionally-boxed handover can still *quietly* run out. `listing.service.ts` / `transfer.service.ts:511` → a beloved animal's transfer can lapse unacknowledged if no read triggers expiry → add a lightweight expiry sweep (or emit on the escalation tick) so the lapse notification is guaranteed, not read-contingent. RECORD — gated on a scheduler.

### F5. No positive trust signal on a stranger live-animal deal — **CONFIRMED**
`[MAJOR][trust][same][CONFIRMED]` grep confirms **no reviews / ratings / verified-seller badge / reputation primitive** in any module (only moderation's "review" word + the buyer-facing content-report). The highest-anxiety purchase in the catalog still carries zero reassurance a buyer can read *before* committing. Every persona still meets a trustless product — a first-impression prior that is expensive to overturn later, and the precondition that makes `service_marketplace` and `premium_profiles` safe. → land verification-badge (derived, never client-asserted) + proof-of-transaction reviews as SHARED primitives over the Offering seam. RECORD.

### F6. AI-decision transparency (ADR-0011) — **CONFIRMED (bright spot)**
`[INFO][ethics][same][CONFIRMED]` `moderation.dto.ts:219-221` still carries `decidedBy / decidedByAgent / isHumanOverride`; `moderation.service.ts:289` keeps AGENT decisioning gated OFF (`agent_moderation`, 403 in MVP). The contract can honestly tell an owner "decided automatically" and show a human override, and no un-gated machine verdict ships. Gap unchanged: whether the owner *sees* "решение принято автоматически — запросить проверку человеком" + an appeal affordance is FE copy (`требует ручной проверки`); now at least a REJECT is *delivered* (F4). RECORD.

### F7. Geo-privacy: precise coordinates exposed to any viewer — **CONFIRMED (severity emphasis up at scale)**
`[MAJOR][trust][same][CONFIRMED]` `toView` maps raw `lat/lng` onto the public `ListingView` (`listing.dto.ts:367-368`, `listing.service.ts:202-203`) with no coarse-by-default posture — an **anonymous** reader can read the precise location tied to a live animal and its owner. Combined with contact-reveal, this is a physical-safety vector (theft of high-value livestock/pets, stalking a seller) that *bites worst at scale*, not in a small beta. → reserve coarse-by-default geo now (geohash/radius public; precise only post-confirmed-contact), same error class as the show_phone:true default that was rightly killed. RECORD → PERSP.

### F8. Choice-overload as markets × offerings multiply — **CONFIRMED**
`[MINOR][cog-load][same][CONFIRMED]` Surface is still small and calm today; the favorites module (mig 0032) added is benign. The forward risk is unchanged: one flat entry point across pet/livestock × animals/goods/services/expertise forces a stressed or low-numeracy user (elderly farmer, grieving owner) to mentally filter out the 80% not meant for them (Hick's law / choice overload), and blurs the two mental models ADR-0002 keeps separate. → reserve an audience-first entry (pet vs livestock → scoped, progressively-disclosed offerings). RECORD — pairs with ux IA.

### F9. `view_count` as latent social-proof pressure — **NEW**
`[INFO][dark-pattern][new][NEW]` mig 0031 added `listings.view_count` (analytics, deduped, best-effort). Healthy as a metric. The *psychological* watch-item: if FE ever renders it as "47 человек смотрят это" it becomes manufactured scarcity/FOMO on a living-animal impulse buy — the mildest cousin of the boosted-listing risk. → keep `view_count` a seller-analytics / ops signal; do NOT surface a live viewer count as buyer-facing urgency copy. RECORD — FE guard, `требует ручной проверки`.

**Diff counter:** FIXED-VERIFIED = 4 (F1,F2,F3,F4-core) · SEV-CHG = 1 (F4 residual) · CONFIRMED = 4 (F5,F6,F7,F8) · NEW = 1 (F9) · REFUTED = 0.

---

## PART 2 — STRATEGIC PULL-FORWARD (`[PERSP]`) — trust/ethics debt that bites at monetization-on or scale

- **PERSP-1 — Reveal-billing must never charge for a match both sides want.** `[WW|PERSP][MAJOR][win-win]` When `payments`/`boosted` flip, the emotional peak (buyer found *the* animal) is the moment of maximum willingness-to-pay AND maximum vulnerability. The current billing-unit is clean (empty/dedup free). Pull-forward: pin as an invariant *now* that the buyer's **first** contact with a consenting seller is never the paywalled unit — monetize seller volume/tooling, not buyer access. Charging a nervous buyer to reach a seller who published a number = extracting from both sides of a would-be free match = win-win FAILURE.

- **PERSP-2 — Forced-continuity guard before goods subscriptions exist.** `[WW|PERSP][MAJOR][dark-pattern]` `goods_marketplace` is the #1 LTV surface AND the #1 dark-pattern surface (auto-renew corn/feed). Reserve the honest-subscription form now: opt-in auto-renew (never pre-checked), symmetric cancel, pre-charge reminder, no confirm-shaming — same discipline that killed show_phone:true, applied before the pattern can exist.

- **PERSP-3 — Two toggles are EXTRACTIVE-by-conception; re-shape the *form* now.** `[WW|PERSP][MAJOR][win-win]` `vet_leadgen` (grief/anxiety exploitation) and `boosted_listings` (pay-to-win on a living creature) don't need pricing to be dangerous — their *default shape* extracts. Cheapest to fix as a reserved seam: bake "rank by fit not bid + disclose sponsorship + never inject into emergency/grief flows" into `vet_leadgen`, and "labelled, density-capped, relevance-primary, never overrides a safety signal" into `boosted_listings`, before either has behavior. This is the finding to weight like a bug.

- **PERSP-4 — Trust primitives are the gate, not a feature.** `[WW|PERSP][MAJOR][trust]` `service_marketplace` and `premium_profiles` are only win-win *after* proof-of-transaction reviews + derived verification exist (F5). Sequence them so trust lands before the verticals that depend on it — otherwise early users learn a trustless product and later paid trust-cues (premium badge) fill the vacuum as *fake* trust (asymmetric information). Land the shared trust layer first.

---

## Trust & ethics probes — round-4 delta (TP-1..TP-10 from round-1/2)
- **TP-1** (no pre-checked consent default) — now **PASSES** (F1).
- **TP-2** (consent control reachable on /me PATCH) — now **PASSES** (F2).
- **TP-3** (empty-state honest + quota not decremented on empty + no phantom row/event) — now **PASSES** (F3).
- **TP-4** (no raw status/error to user) — FE, `требует ручной проверки`.
- **TP-5** (AI-decision disclosed + appeal + delivered) — seam PASSES + now delivered (F4/F6); rendering `требует ручной проверки`.
- **TP-6** (self-service exit) — still **PASSES**.
- **TP-7** (reviews require proof-of-transaction) — still un-landed; carry forward (F5, PERSP-4).
- **TP-8** (badge derived, never self-asserted) — un-landed; guards `premium_profiles` trust-cue boundary (F6-verdict).
- **TP-9** (geo coarse-by-default) — still **FAILS** (F7) — precise lat/lng to anonymous viewers.
- **TP-10** (subscription honest / no forced-continuity) — future guard for `goods_marketplace` (PERSP-2).

---

## Summary
- **Win-win headline:** the built marketplace is **clean — no live mechanic extracts from either side**; round-2's three dark-pattern defects are FIXED-VERIFIED *toward symmetry*. Risk has moved to the reserved toggles: **`vet_leadgen` = EXTRACTIVE**, **`boosted_listings` = RISKY (pay-to-win on a living creature)**, `payments`/`premium_profiles`/`goods_marketplace` = RISKY at a named seam; `service_marketplace` = HEALTHY-conditional on trust primitives.
- **Top manipulation risks (pull forward now, weight like bugs):** exploiting grief/health-anxiety in vet lead routing; impulse-acquisition pressure from paid ranking + any buyer-facing viewer-count urgency (F9); forced-continuity in goods subscriptions.
- **Top trust gaps:** zero positive trust signal on a stranger live-animal deal (F5); precise geo exposed to anonymous viewers (F7); lazy-only transfer-expiry notification (F4 residual).
- **Bright spots:** default-deny consent + symmetric withdrawal; billing-unit integrity (free empty/dedup reveals); purely-transactional, no-engagement-bait notifications; undo-able self-service exit; AI-decision transparency.

*Scope note:* all end-user copy/rendering is FE-owned → `требует ручной проверки` where noted. No product code, docs, or schema modified; this file is my sole output.
