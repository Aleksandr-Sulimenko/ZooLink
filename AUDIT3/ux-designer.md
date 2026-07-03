# ZooLink HYPER² Audit — Round 3 · ux-designer (forward-compat + UX/IA)

**Date:** 2026-07-02 · **Branch:** `backend` · **HEAD:** `4533e78` (not pushed) ·
**Method:** independent forward-compat + UX/IA pass first (comfort 7-pillar reservation,
missing journeys, single-market/animal-first redesign risk, a11y/WCAG), grounded in real
docs / state-machines / code — **then** diffed against `AUDIT2/ux-designer.md`.
FE is not built → I judge *structure/flow reservation*, not pixels.

Format: `[sev][criterion][NEW|CONFIRMED|REFUTED|SEV-CHG] file:line/flow → problem → fix`.
Sev ∈ BLOCKER/CRITICAL/MAJOR/MINOR/INFO. Uncertain → «требует ручной проверки».

> **Reality baseline (verified this round):**
> - `git log f679f4b..4533e78 -- docs/05-ui-ux/ .../accessibility.md` = **empty** → the two
>   UX docs are **byte-identical to the round-1 base**. Every round-1 doc finding therefore
>   stands unless my re-read refutes it. I re-verified the load-bearing ones against **code**.
> - Independent code checks this round: `listing/listing.service.ts:224-226` (edit-gate),
>   `identity/dto/identity.dto.ts` (no contact fields), `identity/identity.service.ts:100,218`
>   (`role: 'USER'` hard-coded), `saved-search/*` (module present), no `*favorit*` module,
>   `docsRU/05-ui-ux/user-flows.md` (RU parity), `statemachines/listing_state_machine.md:105`
>   (animal→listing cascade), absence of any `animal_state_machine.md`.

---

## 0. Verdict summary

- The two prior UX docs are **unchanged since round-1** → round-1 remains a faithful map.
- The **three prior doc↔spec CRITICALs** (3-valued moderation / phantom `COMPLETED` / a11y
  norm 181-ФЗ) stay **RESOLVED** — re-confirmed, no regression.
- Every open round-1 finding is **CONFIRMED** (docs untouched); the load-bearing ones now
  carry **independent code evidence** (below).
- **4 NEW** findings this round; **1 REFUTED** (RU-parity uncertainty resolved); **1 SEV-CHG**
  (animal-deactivate MINOR→MAJOR — a concrete contradiction, not just "verify").
- Forward-compat headline **stands**: the comfort apex-BR is **not reserved as UX structure**;
  adding services/goods later is a flow **redesign**, not an extension.

---

## 1. NEW findings (independent pass)

### N1 — animal-deactivate "listings stay active" contradicts the cascade
`[MAJOR][doc-spec][NEW] docs/05-ui-ux/user-flows.md:46 → §3.3 says "Deactivate: … existing listings **remain active** but are marked as having a deactivated animal" but statemachines/listing_state_machine.md:105 says "deactivating an animal **forces its listings → DEACTIVATED**" (a terminal state, SM:81-82), and code confirms the cascade (migration 0025 CREATE OR REPLACE cascade_animal_deactivation also sets is_active=false). The UX doc teaches the opposite of the built cascade → FE would render "active listing, deactivated animal" that cannot exist. → Reword §3.3: "deactivating an animal forces its listings to DEACTIVATED (terminal); reactivating the animal restores the ability to create **new** listings but does **not** revive the old ones." Mirror to docsRU:46-47 (same wrong text present).`

### N2 — reverse-marketplace / "Запрос" demand-post has no UX seam
`[INFO][forward-compat][NEW] docs/05-ui-ux/user-flows.md §6 (discovery) → future-features.md §E lists a demand-posted "Запрос" (buyer posts a need → providers respond) as a deliberate **demand-side cold-start** lever (the growth answer to "0 groomers nearby"). The flow doc has no reserved discovery variant for it. → When reserving the find-nearby entry (§5/round-1), reserve two discovery modes on the same geo-anchored IA: **browse offerings** and **post a need**, so the reverse-marketplace is a mode toggle, not a new surface. Idea-stage → INFO, but cheap to reserve now.`

### N3 — no localization-UX note in the flow doc (apex-comfort sub-pillar)
`[MINOR][a11y][NEW] docs/05-ui-ux/user-flows.md (whole doc) → localization is an explicit comfort sub-pillar (future-features §C "accessibility + RU/EN localization as part of comfort"; charter §10: Accept-Language ru|en, EN fallback, LocalizedString, RU text-expansion & typography) but no flow/screen note reserves it (label expansion, RU quotation/typography, locale-switch affordance, fallback-when-EN-missing behaviour). → Add a short "Localization behaviour" note to the flow doc + carry it into the frontend a11y/DoD checklist; mirror to docsRU.`

### N4 — no animal state machine to check animal semantics against
`[INFO][doc-spec][NEW] docs/specs/statemachines/ → there is **no** animal_state_machine.md; animal deactivate/reactivate semantics live only implicitly in the listing cascade (listing_state_machine.md:105). Round-1 §1.3 asked to "verify against docs/specs/statemachines/animal_*" — that file does not exist, so the check is unresolvable as written and N1 supersedes it. → Ask alpha-analyst/architect whether an animal_state_machine.md is warranted (deactivate → reactivate; ownership-transfer touchpoints), or the flow doc must cite the cascade explicitly. Until then animal lifecycle wording is un-anchored.`

---

## 2. Diff vs AUDIT2 (round-1) — CONFIRMED / REFUTED / SEV-CHG

### Resolved-and-still-resolved (INFO)
`[INFO][doc-spec][CONFIRMED] user-flows.md:89-92,143 + accessibility.md:4 → the 3 prior CRITICALs (3-valued moderation, SOLD-not-COMPLETED, 181-ФЗ norm) remain fixed; no regression (docs unchanged). RU mirror carries all three (docsRU:89-92,143; grep SOLD/CHANGES_REQUESTED/REJECTED = 5 hits).`

### Open findings — all CONFIRMED (docs untouched; code-verified where noted)
`[BLOCKER][dead-end][CONFIRMED] user-flows.md:25 (§2) → contact-reveal dead-end: identity/dto/identity.dto.ts has **no** contact_phone/telegram/show_*/contact_prefs profile fields (only auth phone + newPhone re-bind), so a reveal returns {} 100% of the time while burning the buyer's 10/h (pet)/5/h (livestock) quota (§6.3). DB column exists (migration 0028, seam-ready, no read-write path) — the gap is the profile journey + DTO. → add a "contact & visibility" profile step (pre-fill phone from verified login); do NOT charge quota when the seller has zero enabled channels (distinct non-charged "seller left no contact" state). Root fix backend; UX owns the journey + no-charge state.`

`[CRITICAL][journey][CONFIRMED] user-flows.md (no §) → ownership-transfer is built (migration 0023; ownership_transfer_state_machine.md:18-21 PENDING/COMPLETED/CANCELLED + expiry) but has no flow. → add "Transferring ownership" flow: initiator start→name recipient→await; recipient notify→accept/decline→confirm; PENDING/expiry/cancelled states; INV-4 "only one PENDING per animal" guard; mark Phase-2 verification superset gated.`

`[CRITICAL][forward-compat][CONFIRMED] user-flows.md:25 (§2) → no progressive just-in-time role flow; identity.service.ts:100,218 hard-code role:'USER', upgrade is ADMIN-only → breeder/farmer/provider personas are silently stuck, blocking comfort pillar 1 (future-features §C). → design a self-service role-claim seam (role activates on first role-gated action, verification proportional to risk); escalate multi-role model (roles[]) to architect (ADR-C).`

`[CRITICAL][forward-compat][CONFIRMED] user-flows.md:49-53 (§4) → comfort apex-BR not reserved as UX structure: create-journey is animal-first ("pick one of your animals"), search is filter-form-first (not find-nearby-first), no provider profile / booking / resume seam. 7-pillar check = 1 Yes (a11y), 1 Partial (trust badges), 5 No. Adding services/goods = flow redesign. → reserve the skeleton now: (a) "create listing"→"create offering" with offering-type up front (animal|service|goods|consultation); (b) find-nearby/map primary discovery entry (geo-search-service.md exists); (c) unified provider-profile IA stub; (d) reserved booking-lifecycle status vocabulary (gated). Sequence behind architect ADR-A/B/C — IA reservation, not building modules.`

`[MAJOR][doc-spec][CONFIRMED] user-flows.md:29 → account deactivate "can be reactivated later" contradicts user_state_machine.md:35,52,63 (DEACTIVATED = anonymize + terminal, no transitions). Present in RU too (docsRU:29 "можно позже реактивировать"). → reword to "permanent + anonymizing", OR add a reversible SUSPEND/PAUSED state via architect ADR before documenting any reactivate path.`

`[MAJOR][journey][CONFIRMED] user-flows.md §6 → saved-search module built (saved-search/* controller+service+dto) but no flow (save-from-results / manage / delete / future new-match alert). → add sub-flow under §6; note stored payload should carry an offering_type key for polymorphic discovery (future-features §F).`

`[MAJOR][dead-end][CONFIRMED] favorites (no module) + user-flows (no §) → confirmed **no** favorites/shortlist code (no *favorit* module) and no flow/empty-state; a buyer comparing 3 kittens cannot pin a set (saved-search is a query, not a pinned set). → design favorites against the polymorphic OfferingRef{type,id} seam so it isn't rebuilt at multi-offering.`

`[MAJOR][journey][CONFIRMED] user-flows.md §4 → EXPIRED→DRAFT renew exists in listing_state_machine.md:29,67 but code gates edits to DRAFT/ACTIVE only (listing.service.ts:224-226 "only DRAFT and ACTIVE are owner-editable"), and no flow documents renew → three-way SM↔code↔flow drift on a seasoned-seller retention path. → design the renew/repost flow OR mark EXPIRED terminal in the SM; reconcile with backend-engineer.`

`[MAJOR][trust][CONFIRMED] user-flows.md:124 (§6.3) → no buyer-facing "report listing / flag scam" affordance though content-report is built (content_report_state_machine.md). → add report entry point + confirmation state to listing-view.`

`[MAJOR][friction][CONFIRMED] user-flows.md:114 (§6.2) & :146 (§8.1) → only happy paths; no empty/error/loading states (zero-result search, zero-channel reveal, blank/uninstrumented analytics) despite charter §3 requiring all six states. → specify every state; esp. a helpful zero-result search empty-state (broaden radius / clear filters / save-search CTA — thin supply is growth's #1 risk) and an honest blank-analytics state.`

`[MAJOR][forward-compat][CONFIRMED] user-flows.md §4 → "Create a listing" title + animal-pick step bake the animal-only mental model into the IA → re-frame to "offering" now (cheap as words) so FE navigation/labels don't harden animal-only.`

`[MINOR][a11y][CONFIRMED] accessibility.md:180,194 → 44×44 target is WCAG 2.1 AAA (2.5.5); AA floor (2.2 §2.5.8) is 24×24 → keep 44×44 but note it's above the 2.1-AA floor.`

`[MINOR][a11y][CONFIRMED] accessibility.md:32 → no explicit stance on WCAG 2.2 additions (2.4.11, 2.5.7, 3.2.6) → note as Phase-2/3 roadmap so not silently dropped.`

`[INFO][forward-compat][CONFIRMED] user-flows.md §6 → saved-search/favorites store no offering_type → reserve the key now for polymorphic discovery (future-features §B/§F).`

### REFUTED / SEV-CHG
`[MAJOR→resolved][doc-consistency][REFUTED] round-1 "RU parity требует ручной проверки" → RU mirror IS in sync: docsRU/05-ui-ux/user-flows.md = 176 lines (EN also 176), SOLD/3-valued/change-note all mirrored. So there is **no** RU-specific drift. Caveat: the round-1 defects are mirrored too (docsRU:29 reactivation, :46-47 animal-listings) → fixes must land in BOTH files (delegate to doc-keeper).`

`[MINOR→MAJOR][doc-spec][SEV-CHG] round-1 §1.3 MINOR "verify animal deactivate/reactivate vs animal state machine" → escalated: no animal_state_machine.md exists (N4), and the concrete contradiction is real (N1, user-flows.md:46 vs listing cascade :105) → treat as MAJOR doc↔spec, not a soft "verify".`

---

## 3. Forward-compat scorecard (comfort 7 pillars — re-confirmed)

| # | Pillar (future-features §C) | Reserved as UX structure? | Evidence |
|---|---|---|---|
| 1 | One account, progressive just-in-time roles | ❌ | role:'USER' hard-coded (identity.service.ts:100,218); no claim flow |
| 2 | Find-nearby as primary entry | ❌ | §6 = filter-form first, not map/near-me first |
| 3 | Unified provider/org profile | ❌ | no provider-profile concept in flow doc |
| 4 | Booking lifecycle | ❌ (correctly Phase-2, but no seam noted) | no reserved status vocabulary |
| 5 | "Continue where you left off" | ❌ | no cross-vertical/resume concept |
| 6 | Trust as through-layer (reviews/verification) | ⚠️ partial | badge shown (§6.2), no review/verification flow |
| 7 | Accessibility + RU/EN localization | ⚠️ partial | a11y strong; localization-UX unreserved (N3) |

**Structural blocker (stands):** every listing requires an owned animal and market is
species-derived (`listing/listing.service.ts` marketOf); the flow inherits the coupling
(§4 "pick one of your animals"). A groomer/walker/vet/goods-seller has no animal → the entry
point of the core creation journey is wrong for every non-animal offering. The
future-features §F "form-now" seams (polymorphic offering key, market_scope, geo-anchor,
reserved provider/review seam, multi-role) are reserved **in architecture docs** but **not in
`user-flows.md`.** IA reservation is owed now (cheap) to avoid a later redesign.

---

## 4. Acceptance probes (for Phase-3 reviewer-qa / architect)

1. `git log <base>..HEAD -- docs/05-ui-ux/` empty ⇒ round-1 map valid — **pass**.
2. `grep -i COMPLETED docs/05-ui-ux/` → no listing-lifecycle use — **pass**.
3. user-flows.md:29 vs user_state_machine.md:52,63 → contradiction — **fails** (§2, MAJOR).
4. user-flows.md:46 vs listing_state_machine.md:105 → contradiction — **fails** (N1).
5. identity.dto.ts has contact_phone/telegram/prefs fields → **absent** (BLOCKER).
6. self-service role-claim path (non-ADMIN) → **absent** (CRITICAL).
7. ownership-transfer / saved-search / favorites flows documented → **absent** (CRITICAL/MAJOR/MAJOR).
8. EXPIRED editable via PATCH → **no** (listing.service.ts:226) while SM:29,67 says renew — drift.
9. §4 offering-type-first + §6 find-nearby-first + provider-profile stub → **absent** (forward-compat).
10. RU mirror line-parity (176/176) → **pass**; but mirrors the defects → fix both.

---

*Scope note:* audited docs + state-machines + code (read-only). No product code/docs changed —
this AUDIT3 file is my sole output. Fixes touching `user-flows.md` must mirror to
`docsRU/05-ui-ux/user-flows.md` (delegate to doc-keeper); schema/IA-shaping items
(offering seam, multi-role, SUSPEND state, animal SM) escalate to architect via ADR-A/B/C.
