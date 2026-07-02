# ZooLink HYPER Forward-Compat Audit — AUDIT2 (2026-07-02)

**Scope:** full re-audit of the implemented system **and** the Ecosystem Expansion vision, with the
primary lens = **FORWARD-COMPAT / ANTI-REWRITE** — "which decisions made now will block the future?"
**Method:** 18 specialist lanes (Phase 1 `active-user` needs-first; Phase 2 the 16 specialists +
`psychologist`, forward-compat lens, each also producing test probes; Phase 3 hyper-test execution by
reviewer-qa + backend; Phase 4 this synthesis). Each lane's full findings + probes live in
`AUDIT2/<role>.md`. Branch `backend`, NOT pushed. Baseline at audit time (Phase-3 **verified real**):
**450 unit / 237 e2e green, zero flakes.**

> **Headline:** the CORE is sound and secure (IDOR/authz exemplary, event-seam in-tx, migrations
> CI-gated 0001–0028, PII crypto built, money in minor-units, monolith absorbs the ecosystem with no
> re-platform). **But two things dominate:** (1) the *built* marketplace is **functionally dead** — a
> real registered user can never expose contact channels, so buyer↔seller exchange returns empty
> (PROVEN by a red test); and (2) a cluster of cheap **"form-now" anti-rewrite seams is absent**, each
> becoming an expensive retrofit or irreversible history-loss the moment its side ships.

---

## Severity summary (de-duplicated across 18 lanes)
| Severity | Count | Notes |
|---|---|---|
| BLOCKER | 2 | contact-reveal dead-marketplace (product); RF-residency guardrail unbuilt (launch gate, legal/ADR-0017) |
| CRITICAL | ~12 | form-now seams absent · ADR-0018 marketOf coupling · progressive-onboarding blocked · north-star uninstrumentable · retention-engine consent seam · finance 54-ФЗ framing · UX/UI comfort-BR unreserved |
| MAJOR | ~40 | security seams · no notification module · no shared authz point · contract drifts · doc↔code drifts |
| MINOR/INFO | ~35 | hygiene, dedup, doc range headers |

Format in lane files: `[severity][criterion][role] file:line → problem → fix`.

---

## FORWARD-COMPAT VERDICT — per seam (the centerpiece)
Verdicts: **SAFE** (extends cleanly) · **RESERVE-NOW** (cheap as a seam now, expensive/irreversible to
retrofit) · **REWRITE-RISK** (an active decision that will force a rewrite).

| Seam / decision | Verdict | Evidence | Cheapest action now |
|---|---|---|---|
| **ADR-0018 cross-aggregate** (`marketOf` raw `animals⋈species` join, ×2 copies, bypasses AnimalService) | 🔴 **REWRITE-RISK** | architect+backend+janitor; ADR-0018 still *Proposed* while half-implemented → chain inversion vs its dependent ADR-0014 | Route market/queue reads via `AnimalService`; flip ADR-0018→Accepted **first** (it's the prerequisite for 0014) |
| **ADR-0014 Offering polymorphic** `(offering_type, offering_id)` | 🟠 **RESERVE-NOW** | shape prose-only; `favorites` FK hard-`listing_id`, `saved_searches.filters` opaque, `Listing.animalId` REQUIRED — the "irreversible-if-deferred" shape | Add `OfferingRef{type,id}` to favorites/saved-search/discovery/moderation/events **before** first non-animal offering |
| **ADR-0015 market_scope** | 🟠 **RESERVE-NOW** | no column; market derived from species-join everywhere; species-less offerings can't carry a market | Add `market_scope ∈ {pet,livestock,both}` column on the offering seam |
| **monetization_type** (ADR-0014 §9) | 🟠 **RESERVE-NOW** (HIGH once paid) | grep=0; harmless only because no paid surface exists; becomes a live-revenue migration at first offering | Reserve the column before, not with, the first paid surface |
| **multi-role `roles[]`** | 🟠 **RESERVE-NOW** | `role` single-valued (schema:115), change ADMIN-only → providers can't self-onboard; blocks progressive onboarding (growth+active-user+security) | Model account `roles[]` + just-in-time role activation |
| **value-event / unified `*.Completed` + `views` source** | 🟠 **RESERVE-NOW** | north-star ~15% instrumentable; `views` hard-0 (irrecoverable history); no `OfferingRef`/`*.Completed` marker in payloads | Add view-capture + a unified value-event marker + `market_scope=both` to the event envelope |
| **consent-record model (ФЗ-38)** | 🟠 **RESERVE-NOW** | retention/reorder/boost = advertising; only `contact_prefs Json` exists, no versioned opt-in log (data-analyst+growth+legal) | Add a versioned consent log (transactional vs marketing) before any messaging |
| **geo-anchor / find-nearby** | 🟠 **RESERVE-NOW** | lat/lng only, no first-class geo-anchor / service-area; two conflicting near-me endpoints | Reserve a geo-anchor abstraction; reconcile `/listings` vs `/geo-search` |
| **UX comfort IA + UI OfferingCard** | 🟠 **RESERVE-NOW** (redesign-risk) | flow doc single-market/animal-first; 6/7 comfort pillars unreserved; no design system, empty wireframes, animal-shaped cards | Reserve offering-type/find-nearby/provider IA + a polymorphic OfferingCard now |
| **ADR-0016 provider model** | 🟠 **RESERVE-NOW** (deferrable) | no field reserved but no data yet | Add when the first provider side builds |
| **ADR-0019 PII-at-rest** | ✅ **SAFE** | blind-index + AES built, migration 0028; `full_name` plaintext = accepted T2 | — |
| **Trust layer** (badges/reviews/geo-privacy) | ✅ coherent (timing risk) | designed as one cross-cutting layer, not per-vertical; risk = no primitive yet = first-impression debt | Build the first trust primitive with the first vertical |
| **Infra / monolith** | ✅ **SAFE** except RF-residency | absorbs ecosystem + PostGIS-swap with no re-platform; sole structural blocker = ADR-0017 guardrail (P0) | Build the RF-residency region-pin + CI guardrail |
| **Amend chain** (0011→0006, 0015→0002, 0019→0012, 0018→0004) | ✅ intact | — | Fix status drift: files 0016/0019 Accepted but memo shows Proposed |

**Net forward-compat verdict:** 🟢 **PROCEED on the ecosystem is safe *provided*** (a) ADR-0018 `marketOf`
coupling is resolved first (it's the named prerequisite of 0014), and (b) the **RESERVE-NOW seam pack**
above is laid before/with the first non-animal offering. None of it forces a rewrite *today* — the
window is open and cheap. The one non-negotiable *product* fact is independent of the ecosystem: the
built marketplace is dead until contact-channels are writable (P1).

---

## Top convergent findings (ranked; corroborating lanes in brackets)

1. 🔴 **BLOCKER — dead marketplace (PROVEN).** `contact_phone`/`contact_telegram` have **no writer on
   any path**: absent from `UpdateProfileRequest` (`auth-api.yaml:763` / `identity.dto.ts:102`), never
   set at register (`identity.service.ts:90`); reveal returns `channels:{}` (`listing.service.ts:459`).
   Phase-3 red test: real phone-OTP seller → buyer reveal = empty; `PATCH /v1/me` rejects `contactPhone`
   with 400. **The green suite MASKS it** — the existing test seeds the phone via fixture.
   *[active-user, backend, reviewer-qa, sba, alpha, legal, frontend, psychologist, ux]*
2. 🔴 **Form-now anti-rewrite seams absent** (see verdict table): `OfferingRef`, `market_scope`,
   `monetization_type`, `roles[]`, `geo_anchor`, unified value-event. Corpus grep = 0.
   *[architect, alpha, sba, data-analyst, finance, frontend, ui, growth]*
3. 🔴 **ADR-0018 `marketOf` REWRITE-RISK** — raw cross-aggregate join ×2 bypassing AnimalService,
   propagating into the discovery read-model; ADR still Proposed while half-built. *[architect, backend, janitor]*
4. 🔴 **Progressive onboarding blocked** — single-valued `role`, ADMIN-only change → provider supply
   can't scale except by manual ops (kills the find-nearby comfort promise). *[growth, active-user, security]*
5. 🔴 **North-star uninstrumentable (~15%)** — only the sale leg exists; `views` hard-0 & irrecoverable;
   household/booking/order unmodeled; retention engine has **no ФЗ-38 consent seam**. *[data-analyst, growth, legal]*
6. 🟠 **No notification module** — ownership-transfer & moderation outcomes happen in silence on
   emotionally weighty acts; outbox marks no-consumer events processed (durable log, nothing materializes it).
   *[psychologist, data-analyst]*
7. 🟠 **Security seams** (all verified in code): `avatarUrl` no `@IsUrl` (stored-XSS); `refreshToken` in
   JSON body (XSS-exfil takeover; code+contract both); `/metrics @Public`; **dev-token fail-open on
   default NODE_ENV**; refresh-rotation TOCTOU weakens reuse-detection; JWT no `algorithms` pin;
   animal `getById` **403-not-404 existence oracle** (PROVEN). *[security, alpha, frontend]*
8. 🟠 **Abuse economics (PROVEN GREEN)** — reveal-quota keyed only `market:viewerId` → Sybil reset;
   no per-user listing quota (flood); reveal quota burned *before* returning the empty result (hidden-cost).
   *[active-user, backend, security, psychologist]*
9. 🟠 **No shared authz-scope enforcement point** — each service reimplements `listScope`+404-no-leak;
   will multiply per new offering object. *[security, janitor]*
10. 🟠 **UX/UI comfort-BR unreserved** — 6/7 comfort pillars absent as structure; missing journeys
    (ownership-transfer/saved-search/favorites); no design system/tokens/wireframes; no empty-state for
    the reveal or zero-results ("0 грумеров рядом"). *[ux, ui, active-user]*

---

## Conflicts of opinion (adjudicated)
1. **`contact_prefs` default `show_phone:true`** — backend read it as a *positive* (channel ready);
   legal + psychologist read it as a **pre-checked-consent dark pattern** (distributing the most
   sensitive datum without knowing opt-in). **Adjudication:** both are right about different things —
   the default is *ethically/legally wrong* (should be explicit opt-in) **and** there is *no writer*
   regardless. Fix = add the writer **and** default the distribution off. (Not a contradiction.)
2. **Everything else converged** — unusually high agreement across lanes; no material disputes.

---

## Phase-3 HYPER-TEST results (executable proof)
- **Baseline:** 450 unit / 237 e2e green — **verified real**, exact match to claim, zero flakes.
- **BLOCKER:** **PROVEN RED** via real-registration reveal test (`backend/test/audit2-hypertest.e2e-spec.ts`).
- **Abuse/security (4):** all reproduced **GREEN** (Sybil reset, listing flood, hidden-cost quota, animal oracle).
- **No confirmed finding was wrong.** 11 `it.todo` forward stubs laid for the unbuilt ecosystem surfaces.
- New test files are in the working tree, **NOT committed**; no `src`/existing tests modified; 20/20
  original suites still green alongside them.

---

## Prioritized action list
**P0 — launch gates (owner/legal, not build blockers):** publish offer/ToS/privacy/consent (DRAFTs
exist, honestly marked) + entity identity + counsel review; **ADR-0017 RF data-residency** region-pin +
CI guardrail (devops+legal) — the sole structural infra blocker.

**P1 — make the built product actually work:** (1) contact-channel **writer** on `/me` PATCH + fix
`show_phone` default to explicit opt-in + delete the masking fixture so the suite tells the truth;
(2) re-key contact-reveal quota (per-seller/account-age, not just viewer) + don't burn quota on empty +
per-user listing quota; (3) a **notification path** (or at least an outbox consumer) so transfer/
moderation aren't silent; (4) security seams: refreshToken→HttpOnly cookie, gate `/metrics`, dev-token
fail-**closed**, `avatarUrl @IsUrl`, JWT `algorithms:['HS256']`, animal `getById` 403→404.

**P2 — anti-rewrite form-now seams (the whole point):** `OfferingRef{type,id}` across
favorites/saved-search/discovery/moderation/events; `market_scope` column; `monetization_type`;
multi-role `roles[]`; `geo_anchor`; unified value-event marker + `views` source; **route `marketOf` via
AnimalService (ADR-0018) + flip 0018/0016/0019 status**; a shared authz-scope enforcement point; a
versioned consent-record model.

**P3 — structural debt + docs:** traceability matrix refresh (stale vs Jul-1 commits); migration-range
header `0022`→`0028` (`CLAUDE.md:19`, `engineering-guide.md:25`); user-flows account-reactivate residual
(`:29`) + EXPIRED→renew 3-way drift; `_common.yaml` + reconcile two geo endpoints + §13 304; premium_profiles
B2C/B2B split; ecosystem vision into the **requirements canon** + north-star as a documented metric; UX
comfort IA + UI OfferingCard/empty-states reservation.

**P4 — hygiene:** dedup (`SLA_TARGET_SECONDS`×2, `toBool`×5, `MARKETS`×3, `LocalizedStringDto`×3);
`git rm --cached .idea`; rotate `.env` secret; rename `traceability Matrix.md`; Semgrep/Trivy →
blocking; generate the Kysely `DB` types.

---

## Per-lane reports (full findings + test probes)
`AUDIT2/active-user.md` · `architect.md` · `alpha-analyst.md` · `senior-business-analyst.md` ·
`backend-engineer.md` · `reviewer-qa.md` (incl. the 23-case plan) · `security.md` · `legal.md` ·
`devops.md` · `data-analyst.md` · `finance.md` · `ux-designer.md` · `ui-designer.md` · `psychologist.md`
· `growth.md` · `frontend-engineer.md` · `doc-keeper.md` · `janitor.md` · `PHASE3_HYPERTEST.md`.

**~180 test probes** were authored across the lanes — the executable backlog for the dedicated
"причёсывание тестером" pass. Owner principle honoured: *нет теста → не done*; forward tests laid ahead.

---

## Attention notes for the NEXT round (hot-spots — where a stronger model should look hardest)
This audit round (2026-07-02, model Opus 4.8) is designed to be **re-run and reconciled** by a next
session with a stronger model — see `NEXT_SESSION_HYPER_TEST_PROMPT_V2.md`. The next run must
**re-derive independently first, then diff against this file** (NEW / CONFIRMED / REFUTED /
SEVERITY-CHANGED). Look hardest at:

1. **The contact-reveal BLOCKER's full blast radius** — beyond the missing writer: are there *other*
   "schema-form present, behaviour absent" dead features hiding behind green fixtures? (grep for tables
   with no writer/endpoint, like `contact_reveals` was.) The green suite masked a dead marketplace once
   — assume it masks more.
2. **Every "form-now seam" claim** — we asserted `OfferingRef`/`market_scope`/`monetization_type`/
   `roles[]`/`geo_anchor`/value-event are absent by corpus grep. Re-verify independently; a stronger
   model should also judge the *exact cheapest* migration shape for each and whether any is already
   partially present (e.g. `moderation_decisions` polymorphic pair, `favorites` dormant FK).
3. **ADR-0018 `marketOf` REWRITE-RISK** — trace the full propagation of the raw `animals⋈species` read
   into the discovery read-model; confirm it is the true prerequisite blocker for ADR-0014 and scope the
   route-via-AnimalService refactor precisely.
4. **Security seams that this round rated MINOR/MAJOR** — re-attack with fresh eyes: dev-token fail-open
   on default NODE_ENV, refresh-rotation TOCTOU, `/metrics @Public`, JWT algs pin, animal 403-oracle.
   Try to escalate any to CRITICAL with a concrete exploit chain.
5. **The consent / dark-pattern tension** — `contact_prefs` default `show_phone:true`. Legal+psychologist
   flagged it; confirm the ФЗ-38 consent-record model gap and whether the default is a launch blocker.
6. **North-star instrumentability** — we said ~15%. Re-derive; check whether `views`, household, and a
   unified value-event family can be reserved cheaply now.
7. **Conflicts we adjudicated** — re-open them; a stronger model may disagree with an adjudication.

## Test additions this round (orchestrator's, carried forward)
- `backend/test/audit2-hypertest.e2e-spec.ts` — real-registration proof tests. The **BLOCKER test is
  intentionally RED** (proves the dead marketplace) and MUST stay red until P1 lands a contact-channel
  writer; the 4 abuse/security proofs are GREEN (Sybil reset, listing flood, hidden-cost quota, animal
  403-oracle). The next round should **run these first** as a regression floor.
- `backend/test/audit2-forward-stubs.e2e-spec.ts` — 11 `it.todo` stubs for the unbuilt ecosystem
  surfaces (Offering/booking/reviews, find-nearby, progressive-role). Extend, don't delete.
- `AUDIT2/reviewer-qa.md` §Phase-3 plan — the 23-case executable plan; ~180 probes across all lane files
  are the backlog to actually implement in the "причёсывание тестером" pass.

*Committed to `backend` on owner's explicit request (2026-07-02) as the round-1 artifact, to be grouped
with the round-2 re-audit. Delegates did not modify product code; the only tree changes are these audit
docs + the two `audit2-*` test files.*
