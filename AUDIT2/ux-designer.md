# ZooLink HYPER Audit — Phase 2 · ux-designer (UX / flow correctness under forward-compat)

**Date:** 2026-07-02 · **Branch:** `backend` (not pushed) · **Method:** re-walked the three prior
doc↔spec CRITICALs against the 2026-07-01 alignment wave (commit `f679f4b`), mapped implemented-but-
undocumented journeys, promoted Phase-1 (`active-user`) friction into UX defects, checked the
accessibility norm + WCAG 2.1 AA coverage, and stress-tested the comfort apex-BR
(`future-features.md:145-227` §C) as reserved *UX structure*. Grounded in real docs/state-machines/
code, not the stale 2026-06-30 audit.

Finding format: `[severity][criterion][ux] file:line → problem → fix`.
Severity ∈ BLOCKER / CRITICAL / MAJOR / MINOR / INFO. Criterion ∈ doc-spec · journey · friction ·
dead-end · trust · a11y · forward-compat · consistency.

> **Reality baseline (verified):** the 2026-07-01 wave rewrote `docs/05-ui-ux/user-flows.md` (change
> note lines 170-173) and `docs/02-requirements/nfr/accessibility.md` (line 4). I judged fix-status
> against `listing_state_machine.md`, `user_state_machine.md`, `ownership_transfer_state_machine.md`,
> and the `active-user` Phase-1 code baseline (`AUDIT2/active-user.md`).

---

## 0. Verdict summary

- **Doc↔spec CRITICAL #1 (binary moderation vs 3-valued / no hard-REJECT):** ✅ **FIXED.**
- **Doc↔spec CRITICAL #2 (non-existent `COMPLETED` state):** ✅ **FIXED.**
- **Doc↔spec CRITICAL #3 ("DEACTIVATED reactivatable" vs terminal+anonymization):** ⚠️ **PARTIALLY
  FIXED** — fixed for the *listing* DEACTIVATED (now terminal); the *account* DEACTIVATED claim
  (`user-flows.md:29` "can be reactivated later") **still contradicts** `user_state_machine.md`
  (terminal + anonymize). The change note (line 173) knowingly deferred it — so it is a **known
  residual MAJOR**, not stale-unnoticed.
- **Accessibility norm (381-ФЗ → 181-ФЗ/419-ФЗ):** ✅ **FIXED** (line 4 + references line 352).
- **Comfort apex-BR reserved as UX structure?** ❌ **NO** — `user-flows.md` is still single-market,
  animal-listing-shaped; none of the 7 comfort pillars are reserved as flow structure. Building
  services/goods later is a **flow-doc redesign**, not an extension.

---

## 1. The three doc↔spec CRITICALs — fix-status confirmation

### ✅ #1 — Moderation is now the canonical 3-valued decision (FIXED)
`user-flows.md:89-92` + `:158` now encode Approve→ACTIVE / **Request changes→DRAFT
(CHANGES_REQUESTED)** / **hard-Reject→DEACTIVATED terminal (REJECTED)**, matching
`listing_state_machine.md:57-59,83-86` exactly. The old binary "Approve / Reject-to-DRAFT" is gone.
SLA is now honestly marked **TBD** with escalate-stays-PENDING (`user-flows.md:95-96` ↔ SM `:60,87`).

`[INFO][doc-spec][ux] docs/05-ui-ux/user-flows.md:89 → 3-valued moderation now matches listing_state_machine.md:57-59 → CRITICAL resolved; no action. (RU mirror docsRU/05-ui-ux/user-flows.md — verify parity, требует ручной проверки.)`

### ✅ #2 — `COMPLETED` replaced by `SOLD`, owner-only (FIXED)
`user-flows.md:143` now = "only the listing owner (seller) can mark the listing as `SOLD`", matching
`listing_state_machine.md:26,62` and `database_schema.sql` (enum has `SOLD`, never `COMPLETED`). The
non-existent `COMPLETED` state the audit flagged is gone from the UX doc. Ownership-transfer is
correctly decoupled from SOLD (line 143 ↔ ADR-0013).

`[INFO][doc-spec][ux] docs/05-ui-ux/user-flows.md:143 → SOLD (owner-only) replaces phantom COMPLETED → CRITICAL resolved; no action.`

### ⚠️ #3 — "DEACTIVATED reactivatable": listing FIXED, account RESIDUAL
- **Listing** DEACTIVATED is now correctly **terminal** (`user-flows.md:92`; SM `:47,81-82`
  "Terminal states: EXPIRED, SOLD, DEACTIVATED"). ✅
- **Account/user** DEACTIVATED is **still described as reversible**: `user-flows.md:29` "There is an
  option to deactivate the account …; **it can be reactivated later**." This **directly contradicts**
  `user_state_machine.md:35,52,63` where `ACTIVE→DEACTIVATED` action = "**Anonymize personal data per
  GDPR; revoke all access tokens**" and "**From DEACTIVATED, no transitions are possible**". You
  cannot reactivate an anonymized, terminal account. The wave's change-note (line 173) explicitly
  left "the reversibility of a user/account DEACTIVATED state" as an open owner/architect decision —
  so the UX doc still teaches a behaviour the state machine forbids.

`[MAJOR][doc-spec][ux] docs/05-ui-ux/user-flows.md:29 → account deactivate "can be reactivated later" contradicts user_state_machine.md:35,52,63 (DEACTIVATED = anonymize + terminal, no transitions) → either (a) reword to "deactivation is permanent + anonymizing; use a separate SUSPEND for a reversible hide", or (b) if a reversible hide IS wanted, that is a new PAUSED/SUSPENDED state the SM lacks → escalate to architect (ADR) before documenting a reactivate path. Do NOT teach reactivation while the SM anonymizes.`

`[MINOR][doc-spec][ux] docs/05-ui-ux/user-flows.md:46-47 → animal "deactivate/reactivate" flow — verify against the animal state machine's DEACTIVATED semantics (cascade at listing_state_machine.md:105 forces listings→DEACTIVATED on animal-deactivate; if animal DEACTIVATED is terminal, "reactivate to create new listings" is also inconsistent) → требует ручной проверки against docs/specs/statemachines/animal_*.`

---

## 2. Missing journeys — implemented (or spec'd) but no documented flow

`user-flows.md` covers register / profile / animal / create-listing / moderation / search / contact /
analytics / moderator-admin (§1-9). It documents **none** of the following, though the modules/specs
exist. A UX flow doc that omits a live surface leaves FE + QA building blind.

### 2.1 Ownership-transfer — IMPLEMENTED, zero user-flow
Module built (`animal +transfer`, per active-user baseline; ADR-0013 Accepted;
`ownership_transfer_state_machine.md` MVP = `PENDING → COMPLETED` on accept / `PENDING → CANCELLED`
on decline/cancel/expiry). `user-flows.md:143` only *mentions* transfer in one clause of the SOLD
step — there is **no journey** for the initiator (start transfer → name recipient → await),
the recipient (notification → accept/decline screen → confirmation), the **expiry** empty/timeout
state, or the "no other active PENDING for this animal" guard (SM `:55`).

`[CRITICAL][journey][ux] docs/05-ui-ux/user-flows.md (no §) → ownership-transfer is built + has a state machine (ownership_transfer_state_machine.md:18-21) but no documented flow (initiator start, recipient accept/decline, pending/expiry/cancelled states) → add a "Transferring ownership of an animal" flow with all four states (PENDING/COMPLETED/CANCELLED + expiry) and the recipient accept/decline screen; mark the Phase-2 verification superset (IN_PROGRESS/FAILED, SM:29-36) as gated/future so FE reserves the shape.`

### 2.2 Saved-search — IMPLEMENTED, zero user-flow
`saved-search` module is built (controller + delete-404-no-leak, per active-user `:175,185`; Slice 3).
`user-flows.md` §6 (search) never mentions saving a search, listing saved searches, deleting one,
or the (future) new-match notification loop — a core **retention** surface (role-def §7) is
undocumented.

`[MAJOR][journey][ux] docs/05-ui-ux/user-flows.md §6 → saved-search is implemented but has no flow (save from results, manage list, delete, future new-match alert) → add a saved-search sub-flow under §6; call out that the stored payload is a raw query today and should carry an offering_type key for polymorphic discovery later (future-features.md:210, §4).`

### 2.3 Favorites/shortlist — NOT built, no flow, and it is the buyer's #1 unmet need
`favorites-api.yaml` is vision-only (no controller — active-user `:171`). A buyer deciding between 3
kittens cannot shortlist specific listings (saved-search is a *query*, not a pinned set). This is a
concrete buyer JTBD gap (role-def §7 favorites) with no reserved UX seam.

`[MAJOR][dead-end][ux] docs/05-ui-ux/user-flows.md (no §) + favorites-api.yaml (no controller) → buyers cannot shortlist specific listings/animals; no favorites flow or empty-state designed → confirm favorites is a planned slice; design the flow now against the polymorphic OfferingRef{type,id} seam (future-features.md:210) so it isn't rebuilt when discovery goes multi-offering.`

### 2.4 EXPIRED → renew/repost — SM says it exists, code + flow disagree
`listing_state_machine.md:29,67,99` documents `EXPIRED → DRAFT` renew (re-enters moderation), but
active-user (`:158,174`) found the **code** gates editing to DRAFT/ACTIVE (`listing.service.ts:224`)
so EXPIRED is a dead terminal in practice, and `user-flows.md` documents **no** renew journey. Doc
(SM) ↔ code ↔ flow three-way drift on a seasoned-seller retention path.

`[MAJOR][journey][ux] docs/05-ui-ux/user-flows.md §4 → EXPIRED→DRAFT renew exists in listing_state_machine.md:29,67 but no flow is documented and active-user found code doesn't implement it (listing.service.ts:224) → design the renew/repost flow (EXPIRED → "renew" → DRAFT → resubmit) OR, if renew is deferred, mark EXPIRED terminal in the SM to stop the drift → reconcile with backend-engineer.`

### 2.5 Content-report from the buyer flow — no trust affordance in the journey
`content-report` exists but is moderator-oriented (active-user `:77,172`). §6.3 listing page has no
"report this listing" affordance and no post-report confirmation/empty-state for the buyer.

`[MAJOR][trust][ux] docs/05-ui-ux/user-flows.md:124 (§6.3 listing page) → no buyer-facing "report listing / flag scam" affordance though content-report is built → add a report entry point + confirmation state to the listing-view flow; part of the trust layer every persona asked for (active-user trust findings).`

---

## 3. Phase-1 friction promoted to UX defects

These re-frame `AUDIT2/active-user.md` unmet needs as **flow/state** defects the UX doc must own.

### 3.1 Contact-reveal is a dead-end UX (the sole conversion path returns nothing)
`user-flows.md:135,141` correctly documents the "empty result if the seller enabled no channels"
case — but active-user (`#1`, `:24-41`) proves **every** real user hits it: no registration path and
no `/me` PATCH field ever sets `contact_phone`/`contact_telegram`/`contact_prefs`, so `channels = {}`
100% of the time while the buyer's reveal quota is burned. The UX doc describes the empty-channel
*state* but there is **no flow to populate contacts** and **no guard** stopping a quota-consuming
reveal that can only return empty.

`[BLOCKER][dead-end][ux] docs/05-ui-ux/user-flows.md:25 (§2 profile) → no flow/step to set contact_phone/telegram/visibility (contact_prefs); §6.3 reveal therefore always returns empty channels yet still spends the buyer's 10/h (pet) or 5/h (livestock) quota → the sole buyer↔seller journey dead-ends → (UX) add a "contact & visibility" step to profile-management flow (which channels to expose, show_phone/show_telegram) and pre-populate phone from the verified login; (UX) do not consume reveal quota when a seller has zero enabled channels — surface "seller left no contact" as a distinct, non-charged empty-state. Root fix is backend (active-user #1); UX must document the contact-setup journey and the no-charge empty-state.`

### 3.2 No progressive / just-in-time role acquisition flow
Everyone registers `role: USER`; the only upgrade is ADMIN-only (`admin-user.controller.ts:21`,
active-user `#3`). `user-flows.md` §2 (profile) documents **no** self-service role-request/claim
journey — directly missing the apex "прогрессивные just-in-time роли" pillar
(`future-features.md:167`). A breeder/farmer/vet signs up and is silently stuck as a plain user.

`[CRITICAL][forward-compat][ux] docs/05-ui-ux/user-flows.md:25 (§2) → no progressive role-acquisition flow; role change is ADMIN-only, register hard-codes USER → breeder/farmer/provider personas cannot self-declare, blocking the comfort apex-BR "one account, just-in-time roles" (future-features.md:167,210) → design a self-service role-claim seam now: role activated on first role-gated action (e.g. "I want to offer a service" → claim provider role → verification proportional to risk, future-features.md:174), no re-registration. Escalate the multi-role model (roles[]) to architect (ADR-C).`

### 3.3 No empty-state design for zero-results / zero-channels / zero-leads
Role-def §3 mandates every screen state: default/empty/loading/error/success/permission-denied.
`user-flows.md` §6.2 (search results) and §8.1 (owner analytics) document **only the happy path** —
no empty-state for a zero-result search ("грумер рядом: 0 результатов" — the growth top-risk,
`future-features.md:199`), no zero-channels contact result (see 3.1), no zero-leads/zero-views
analytics dashboard (active-user `#matured-seller`: `views` hard-0, `contactReveals` effectively 0).

`[MAJOR][friction][ux] docs/05-ui-ux/user-flows.md:114 (§6.2) & :146 (§8.1) → no empty/error/loading states documented (zero-result search, zero-channel reveal, blank analytics dashboard) despite role-def §3 requiring them → specify every screen state; especially a helpful zero-result search empty-state (broaden radius / clear filters / save-this-search CTA) since thin supply is the #1 growth risk (future-features.md:199), and an honest empty analytics state until views/reveals are instrumented.`

---

## 4. Accessibility

### ✅ Norm corrected (FIXED)
`accessibility.md:4` now cites **181-ФЗ (+419-ФЗ)** and ГОСТ Р 52872-2019, with the wrong 381-ФЗ
(retail-trade) removed and a clean WHAT/WHY/WHY-BETTER note (line 5) + references (line 352). The
audit CRITICAL is resolved.

`[INFO][a11y][ux] docs/02-requirements/nfr/accessibility.md:4 → norm 381→181-ФЗ/419-ФЗ corrected → resolved; no action.`

### WCAG 2.1 AA coverage — solid, two small gaps
The doc comprehensively covers POUR / WCAG 2.1 AA (contrast 4.5:1, keyboard, focus, 44×44 targets,
320px reflow, semantic HTML, ARIA, forms, screen-reader test plan, phased roadmap) — a strong
frontend-DoD anchor (line 7-14). Minor completeness notes:

`[MINOR][a11y][ux] docs/02-requirements/nfr/accessibility.md:180,194 → touch-target min stated as 44×44 (WCAG 2.1 AA "Target Size (Enhanced)" 2.5.5 is AAA; the AA baseline 2.5.8 in WCAG 2.2 is 24×24) → 44×44 is a good bar; just note it's above the 2.1 AA floor so it isn't mistaken for the minimum, and decide whether the target is 2.1 or 2.2 (role-def says 2.1 AA).`

`[MINOR][a11y][ux] docs/02-requirements/nfr/accessibility.md:32 → target is WCAG 2.1 AA; no explicit stance on 2.2 additions (Focus Not Obscured 2.4.11, Dragging Movements 2.5.7, Consistent Help 3.2.6) → acceptable for MVP baseline; note 2.2 as a Phase-2/3 roadmap item so it isn't silently dropped.`

`[INFO][a11y][ux] docs/02-requirements/nfr/accessibility.md:7-14 → a11y correctly deferred to frontend-DoD (no backend surface) with a traceable marker → good practice; ensure the map lands in the frontend phase's DoD file when it exists.`

---

## 5. FORWARD-COMPAT (main) — comfort apex-BR reserved as UX structure? ❌ NO

The owner's apex-BR (`future-features.md:150,166-171` §C) is *«всё для питомца, рядом, на всю жизнь —
один поиск, один профиль, один мессенджер»*, realized via 7 UX pillars. Checked each against the
**current flow doc** to see whether services/goods can be added later **without a flow redesign**:

| # | Comfort pillar (future-features §C) | Reserved as UX structure today? | Evidence |
|---|---|---|---|
| 1 | One account, **progressive just-in-time roles** | ❌ No | `user-flows.md` §2 has no role-claim flow; single ADMIN-set role (§3.2 above; `:167`) |
| 2 | **Find-nearby as primary entry** (shortest time-to-value) | ❌ No | §6 search is a filter-form (species/breed/radius) first, not a map/near-me-first entry (`:168`) |
| 3 | **Unified provider/org profile** (services+goods+listings+reviews+verification+hours) | ❌ No | No provider-profile concept anywhere in the flow doc; only per-listing seller contact (`:169`) |
| 4 | **Booking lifecycle** (заявка→подтверждено→выполнено→отзыв + reminders) | ❌ No (correctly Phase-2, but no seam noted) | No booking flow or reserved status vocabulary; deferred behind toggle (`:170,213`) |
| 5 | **"Continue where you left off"** (seamless cross-vertical) | ❌ No | No cross-vertical/resume concept in any flow (`:171`) |
| 6 | **Trust as a cross-cutting layer** (reviews, verification badges) | ⚠️ Partial | §6.2 shows a "Verified Breeder"/"Vaccinated" badge but no review/verification *flow* (`:172-177`) |
| 7 | **Accessibility (WCAG 2.1 AA) + RU/EN localization** as comfort | ✅ Yes | `accessibility.md` thorough; localization noted in role-def §10 (§4 above) |

**Structural blocker (matches active-user fwd-compat #1):** every listing requires an owned animal
and market is species-derived (`listing.service.ts:146`, `marketOf`). The **flow doc inherits this
coupling** — "Create a listing" (§4) always starts from "pick one of your animals" (`user-flows.md:53`).
A groomer/walker/vet/goods-seller has no animal, so the *entry point of the core creation journey is
wrong for every non-animal offering*. Adding services/goods later is therefore **not** a flow
extension — it requires redesigning the create-offering entry, the search entry (find-nearby-first),
and adding a provider profile + booking lifecycle. The `future-features.md:209` "форма-сейчас" seams
(polymorphic offering key, market_scope, geo-anchor, reserved provider/review seam, multi-role model)
are **architecturally reserved in docs but NOT reflected as UX structure in `user-flows.md`.**

`[CRITICAL][forward-compat][ux] docs/05-ui-ux/user-flows.md:49-53 (§4 create-listing) → the core creation journey is animal-first (pick an owned animal); search (§6) is filter-form-first not find-nearby-first; no provider profile, booking, or resume seam → the comfort apex-BR (future-features.md:166-171) is NOT reserved as UX structure, so adding services/goods later is a flow redesign not an extension → reserve the UX skeleton now: (a) generalize "create listing" → "create offering" with offering-type chosen up front (animal | service | goods | consultation) so the animal-pick becomes one branch; (b) add a find-nearby/map entry as the primary discovery surface (geo-search-service.md exists); (c) stub a unified provider-profile IA; (d) reserve a booking-lifecycle status vocabulary (gated). Sequence behind architect ADR-A/B/C; this is IA/flow reservation, not building the modules.`

`[MAJOR][forward-compat][ux] docs/05-ui-ux/user-flows.md §4 → "Create a listing" title + animal-pick step bake the animal-marketplace mental model into the IA → rename/re-frame toward "offering" now (cheap as words) so FE navigation/labels don't harden around animal-only, per future-features.md:209 "форма-сейчас vs anti-rewrite".`

`[INFO][forward-compat][ux] docs/05-ui-ux/user-flows.md §6 → saved-search/favorites store no offering_type → when discovery goes polymorphic (future-features.md:160,210) these need the offering key; reserve it in the flow now (see 2.2/2.3).`

---

## 6. Consolidated findings (severity-ordered)

- `[BLOCKER][dead-end][ux] docs/05-ui-ux/user-flows.md:25 → no contact-setup journey; reveal always returns empty channels yet spends buyer quota → add profile contact+visibility step + no-charge empty-state (§3.1).`
- `[CRITICAL][journey][ux] docs/05-ui-ux/user-flows.md (no §) → ownership-transfer built (ownership_transfer_state_machine.md:18-21) but undocumented → add initiator/recipient/expiry flow (§2.1).`
- `[CRITICAL][forward-compat][ux] docs/05-ui-ux/user-flows.md:25 (§2) → no progressive just-in-time role flow (future-features.md:167) → design self-service role-claim seam (§3.2).`
- `[CRITICAL][forward-compat][ux] docs/05-ui-ux/user-flows.md:49-53 → comfort apex-BR not reserved as UX structure; animal-first creation + filter-first search + no provider profile → reserve offering/find-nearby/provider IA now (§5).`
- `[MAJOR][doc-spec][ux] docs/05-ui-ux/user-flows.md:29 → account "reactivated later" contradicts user_state_machine.md:35,52,63 (terminal+anonymize) → reword or add a SUSPEND/PAUSED state via ADR (§1.3).`
- `[MAJOR][journey][ux] docs/05-ui-ux/user-flows.md §6 → saved-search implemented, no flow → add save/manage/delete/alert sub-flow + offering_type key (§2.2).`
- `[MAJOR][dead-end][ux] favorites-api.yaml (no controller) + user-flows (no §) → no shortlist flow/empty-state → design against OfferingRef seam (§2.3).`
- `[MAJOR][journey][ux] docs/05-ui-ux/user-flows.md §4 → EXPIRED→DRAFT renew in SM:29,67 but no flow + code gates it (listing.service.ts:224) → design renew flow or mark EXPIRED terminal (§2.4).`
- `[MAJOR][trust][ux] docs/05-ui-ux/user-flows.md:124 → no buyer-facing report affordance though content-report built → add report entry+confirmation to listing-view (§2.5).`
- `[MAJOR][friction][ux] docs/05-ui-ux/user-flows.md:114,146 → no empty/error/loading states (zero-result search, zero-channel reveal, blank analytics) → specify all screen states, esp. helpful zero-result search (§3.3).`
- `[MAJOR][forward-compat][ux] docs/05-ui-ux/user-flows.md §4 → "listing"+animal-pick bakes animal-only IA → re-frame to "offering" now (§5).`
- `[MINOR][doc-spec][ux] docs/05-ui-ux/user-flows.md:46-47 → animal deactivate/reactivate — verify vs animal state machine (§1.3), требует ручной проверки.`
- `[MINOR][a11y][ux] docs/02-requirements/nfr/accessibility.md:180 → 44×44 target is above the 2.1 AA floor; note baseline (§4).`
- `[MINOR][a11y][ux] docs/02-requirements/nfr/accessibility.md:32 → no explicit 2.2 stance; note as roadmap (§4).`
- `[INFO] user-flows.md:89 (moderation), :143 (SOLD), accessibility.md:4 (norm) → three prior CRITICALs + norm resolved.`
- `[INFO][forward-compat][ux] saved-search/favorites lack offering_type → reserve now (§5).`

> **RU-mirror note:** every fix above must be mirrored to `docsRU/05-ui-ux/user-flows.md` /
> `docsRU/02-requirements/nfr/accessibility.md` (EN canon + RU mirror, role-def §2/§10). Delegate the
> mirror to **doc-keeper**. Current RU parity for the 2026-07-01 wave = `требует ручной проверки`.

---

## UX acceptance probes

> Concrete, checkable flow assertions for Phase-3 (reviewer-qa / architect) to run against the
> contracts + state machines. Format: **probe → source-of-truth → expected**. Complementary to
> active-user's Phase-3 scenarios (those are runtime; these are flow/doc/state reachability).

**A. Doc↔spec / state-reachability**
1. **3-valued moderation reachable & documented.** For each of {APPROVE→ACTIVE, CHANGES_REQUESTED→DRAFT,
   REJECTED→DEACTIVATED-terminal}: a transition exists in `listing_state_machine.md:57-59` AND is
   described in `user-flows.md:90-92`. Expected: 3/3 present, no binary wording, no auto-approve on SLA
   (`user-flows.md:96`). ✅ predicted pass.
2. **No `COMPLETED` anywhere.** `grep -ri "COMPLETED" docs/05-ui-ux/` returns no listing-lifecycle use
   (transfer/payment `COMPLETED` in their own SMs is fine). Expected: user-flows uses `SOLD` only. ✅.
3. **Account DEACTIVATED consistency.** `user-flows.md:29` reactivation claim vs
   `user_state_machine.md:52,63` (anonymize + terminal). Expected: **CONTRADICTION** until reworded →
   fails; proves §1.3 residual.
4. **Listing DEACTIVATED terminal.** No `DEACTIVATED → *` transition except system-mandate archival
   (SM `:82`). Expected: terminal; `user-flows.md:92` agrees. ✅.
5. **EXPIRED renew three-way.** SM `:29,67` has `EXPIRED→DRAFT`; `user-flows.md` documents it? code
   allows PATCH from EXPIRED? Expected: SM=yes, flow=no, code=no (`listing.service.ts:224`) → **drift
   flagged** (§2.4).

**B. Journey completeness (a documented flow exists for each built/spec'd surface)**
6. **Ownership-transfer flow exists.** `user-flows.md` contains an initiator-start + recipient
   accept/decline + expiry journey mapping to `ownership_transfer_state_machine.md:18-21`
   (PENDING/COMPLETED/CANCELLED). Expected: **absent** → fails (§2.1).
7. **Saved-search flow exists.** save-from-results / list / delete journey documented. Expected:
   **absent** → fails (§2.2).
8. **Contact-setup journey exists.** A profile step sets contact_phone/telegram/visibility so a reveal
   can return non-empty. Expected: **absent** (DTO `identity.dto.ts:102` lacks fields; flow §2 lacks
   step) → fails (§3.1, active-user #1).
9. **Progressive role-claim flow exists.** A self-service path to acquire BREEDER/FARMER/provider
   without ADMIN. Expected: **absent** (only `admin-user.controller.ts:21`) → fails (§3.2).

**C. Empty/error-state presence (role-def §3: every screen has all states)**
10. **Zero-result search empty-state.** `user-flows.md` §6.2 specifies an empty-state (broaden
    radius / clear filters / save-search CTA). Expected: **absent** → fails (§3.3).
11. **Zero-channel reveal state is distinct & non-charged.** Flow specifies that a reveal against a
    seller with no enabled channels returns a "seller left no contact" state WITHOUT decrementing the
    buyer's rate-limit quota. Expected: doc says empty result (`:135`) but does **not** exempt it from
    the quota → fails; assert desired non-charge (§3.1).
12. **Blank-analytics honest state.** §8.1 specifies what the owner sees when views/reveals are 0/
    uninstrumented. Expected: only happy path documented → fails (§3.3; active-user matured-seller).

**D. Forward-compat structure reservation**
13. **Create-offering generalization.** `user-flows.md` §4 entry lets the user pick an offering-type
    (animal|service|goods|consultation) before the animal-pick. Expected: animal-first only
    (`:53`) → fails; proves the redesign risk (§5).
14. **Find-nearby primary entry.** §6 exposes a map/near-me entry as a first-class discovery surface
    (geo-search-service.md exists). Expected: filter-form-first only → fails (§5, pillar 2).
15. **Offering_type reserved in saved-search/favorites.** The stored search/favorite payload carries an
    `offering_type` key (future-features.md:160,210). Expected: raw query only → fails; reserve now (§5).
16. **Provider-profile IA stub.** Any unified provider/org profile concept in the flow doc. Expected:
    **absent** → fails (§5, pillar 3).

**E. Accessibility**
17. **Correct norm.** `accessibility.md:4` cites 181-ФЗ/419-ФЗ, not 381-ФЗ. Expected: ✅ pass.
18. **WCAG 2.1 AA baseline mapped to frontend-DoD.** `accessibility.md:7-14` marks a11y as a
    frontend-phase DoD entry checklist. Expected: ✅ pass; assert it lands in the FE DoD file when
    created.

---

*Scope note:* I audited docs + state-machines + the active-user code baseline; I did **not** modify
any product code or docs. RU-mirror parity and animal-state-machine specifics are marked `требует
ручной проверки`. This file is my sole output.
