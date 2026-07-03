# Ecosystem ADR Plan & Open-Decision Memo (architect) — for owner ratification

**Status**: decision-memo (architect, 2026-07-01). Not an ADR — a fast-ratification brief.
**✅ Q1–Q6 owner-ratified 2026-07-01.** ADRs 0014 + 0015 accepted jointly (Q1). **Status update (aligned to ADR files 2026-07-02):** 0016 & 0019 **Accepted** 2026-07-01 (on security+legal sign-offs); **0017 Accepted 2026-07-02** (owner go on RF-only topology); **0018 remains Proposed** with an explicit awaiting-condition (see the table and §Ratification outcome). doc-keeper recorded the statuses; nothing committed.
**Inputs**: `AUDIT_2026-06-30.md` (§Open owner/architect decisions Q1–Q6), `docsRU/01-discovery/future-features.md` §145-227 (Ecosystem Expansion vision).
**Companion ADRs** (status as ratified 2026-07-01):

| ADR | Title | Status | One-line essence |
|---|---|---|---|
| **0014** | Offering supertype — polymorphic discovery+moderation seam | **Accepted** (2026-07-01, jointly w/ 0015) | Logical Offering supertype via polymorphic `(offering_type, offering_id)` over per-subtype tables; anti-god-table/anti-EAV; subtypes built only when their side ships. |
| **0015** | `market_scope` refines ADR-0002 | **Accepted** (2026-07-01, jointly w/ 0014) | Hard split stays for animal listings (market derived from species); species-less offerings carry `market_scope ∈ {pet,livestock,both}`; discovery enforces it. **Amends 0002, not supersedes.** |
| **0016** | Provider model | **Accepted** (2026-07-01) — security+legal T0–T3 verification matrix + three-regime immunity; residual product-confirms OD-3/4/5 open | One Provider abstraction `provider_kind ∈ {ORG,INDIVIDUAL,AGENT}` over existing principals; risk-tiered verification = condition of intermediary immunity (legal). |
| **0017** | RF data residency | **Accepted** (2026-07-02) — owner go on RF-only topology; devops implements region-pin + fail-on-non-RF guardrail | РФ-citizen PII primary+replicas+backups+DR+object-store stay in RF; cross-border only for de-identified data. **P0 go-live blocker** (legal A3) — closed at decision level. |
| **0018** | Cross-aggregate access rule | Proposed — ready (low-risk); awaiting owner nod | Route animal reads through `AnimalService`; no raw cross-aggregate table reads. **Reaffirms 0004**, prerequisite for 0014. |
| **0019** | PII-at-rest form enforcement | **Accepted** (2026-07-01) — owner OD-1/OD-2 + security+legal at-rest sign-off; residual certified-СКЗИ investigation | Build ADR-0012's blind-index+crypto seam now (irreversible piece); storage-level baseline at launch; stage field-encryption rollout. **Amends 0012, not supersedes.** |

> **WHY this memo** — Six ADRs above answer the *structural* questions. The six open decisions (Q1–Q6) mix structural, product, money, legal and roadmap calls. This memo gives architect's position on each; the owner ratified all six on 2026-07-01 (see §Ratification outcome), with each non-structural call flagged **«owner decides»** preserved as the recorded decision.

---

## Ratification outcome (owner, 2026-07-01)

The owner reviewed Q1–Q6 and ratified as follows. This stamp is the authoritative record; the per-question sections below keep architect's original reasoning unchanged.

- **Q1 — ratified.** ADR-0014 + ADR-0015 accepted **jointly** (two linked ADRs, not one combined doc). Both flipped Proposed → **Accepted**, each carrying "Ratified by owner 2026-07-01".
- **Q2 — ratified.** Escrow **deferred**: no ADR-F now; only the non-money seams (`monetization_type`, money-as-integer-minor-units) reserved via ADR-0014. Revisit when `payments` is next-up on the roadmap.
- **Q3 — ratified.** contact-exchange / mark-sold / views are **planned, unstarted slices (not regressions)** → **P1 build** (emit the value-events in-tx). Tracked, nothing dropped silently.
- **Q4 — ratified.** Register the `goods_marketplace` feature-toggle **now** (form-now, default off), independent of ADR-0014. Handoff: backend seeds the row (tiny migration + schema + EN↔RU).
- **Q5 — ratified.** Per-market SLA / listing-duration values, defined in **one canonical source** (de-duplicate the constant); `premium_profiles` **split into two** distinct concepts (B2C consumer boost vs B2B subscription) with distinct `monetization_type`. Actual thresholds and launch timing remain **owner-decides** (product/finance/legal).
- **Q6 — ratified.** Livestock B2B is a **separate roadmap track**, same codebase / same seams (ADR-0014/0015/0016, `market_scope=livestock`), **sequenced last**. Dedicated team/sprint = owner resourcing call.

**Open follow-ups** (surfaced, not silently parked; updated 2026-07-02): 0016 → **sign-off received/Accepted**; residual product-confirms OD-3/4/5 tracked in the ADR. 0017 → **Accepted**; now a **devops build task** (region-pin + fail-on-non-RF CI guardrail + deployment-spec fix — spec in ADR-0017 §Guardrail specification); legal ст.12 carve-out review remains. 0018 → still **Proposed**: owner nod (low-risk, reaffirms 0004) then backend bounded refactor (its fate is decided at the D8 `marketOf` refactor slice). 0019 → **sign-off received/Accepted**; residual certified-СКЗИ investigation tracked in the ADR.

---

## Q1 — ADR-A & ADR-B: one combined doc or two linked? → **Two linked ADRs, ratified jointly** (architect recommendation, structural)

**Recommendation: two separate, cross-linked ADRs (0014 + 0015), ratified as a pair.**

Reasoning:
- **Different targets & verbs.** ADR-0015 is an **amendment of an existing Accepted decision** (ADR-0002) — it must point cleanly at 0002 and refine its *scope*. ADR-0014 **introduces a new structural concept** (the Offering supertype). Folding an amendment-of-0002 into a new-supertype doc muddies the supersede/amend chain and makes future cross-reference ("what amended 0002?") ambiguous.
- **Precedent.** This is exactly how ADR-0011 was structured — a *separate* doc that "Amends ADR-0006" rather than rewriting it. Keeping the amendment discrete preserves the audit trail.
- **Separable reasoning, coupled validity.** 0014 (how discovery/moderation reference any offering) and 0015 (how market separation survives species-less offerings) have independent rationale but neither is *implementable* without the other — so they are **ratified jointly** and each carries a "ratify jointly — see Q1" cross-link.

Net: clarity of the supersede chain + independent reasoning win over single-document convenience. **Two linked ADRs, joint ratification.**

---

## Q2 — Escrow: ADR-F form-now or fully deferred? → **Defer the ADR; reserve only the cheap seams now** (architect recommendation; money/legal → owner decides the timing)

**Recommendation: do NOT write ADR-F (escrow / money-custody) now; reserve the *non-money* seams via ADR-0014 and defer the escrow decision until `payments` is on the near roadmap.**

Reasoning:
- Escrow = **holding user funds** → 115-ФЗ AML + 161-ФЗ payment-agent/banking limits + 54-ФЗ (legal C1/C2). This is the heaviest compliance load in the whole vision and the *last* monetization step (finance: enable `payments`/escrow only once GMV covers 54-ФЗ/115-ФЗ/acquiring; livestock's high ticket pays it back before pet).
- The form-now anti-rewrite seams escrow would need are **already reserved without an escrow ADR**: `monetization_type` field (ADR-0014) and money-as-integer-minor-units (already an API convention). There is **no irreversible schema/contract piece** that deferring escrow would force a rewrite of — so §5 says *defer*.
- Writing a money-custody ADR now would bake assumptions (which PSP, agent vs escrow model, custody legality) that legal+finance can't fix until the model is real → premature.

**Owner decides** the *timing* (when `payments`/escrow enters the roadmap). Architectural position: **no ADR-F now; revisit when `payments` is next-up.** Flag: boost/premium are the Operator's *own* B2C services → 54-ФЗ ККТ applies the moment money is taken regardless of the `payments` toggle (finance/legal) — that fiscal rail is a *separate* trigger from escrow.

---

## Q3 — contact-exchange / mark-sold / views: planned unstarted slices or regression? → **Planned-unstarted (not regression); confirm with backend, then prioritise P1** (architect position; backend confirms)

**Architect read: these are unbuilt slices, not regressions** — `contact_reveals` table exists with no writer/endpoint (a reserved form), `sold_at`/SOLD transition were never wired, `views` has no data source. That pattern (schema-form present, behaviour absent) is consistent with the project's "form-now, behaviour-later" discipline, not with something that worked and broke.

Consequence for severity (the audit asked this to *set* severity): treat as **P1 functional gaps**, not P0 incidents. But two of them are **value-events the North-star depends on** (sale, contact-reveal) — data-analyst flagged the funnel is blind without them. So: **not a launch blocker, but high-priority** because the measurement layer and seller-notification both depend on them.

**Action**: backend confirms each was a planned slice (quick check of the plan/backlog); then prioritise contact-exchange + owner-mark-sold + a `views` source in P1, emitting the corresponding events in-tx (ties to the event-seam P1 item). **Owner decides** only if business wants to formally drop any of them (would violate "nothing dropped silently" — so it must be tracked either way).

---

## Q4 — `goods_marketplace` toggle: INSERT now or wait for ADR-A? → **INSERT now** (architect recommendation, structural)

**Recommendation: register `goods_marketplace` in `feature_toggles` now (form-now, default off), independent of ADR-0014.**

Reasoning:
- The owner explicitly named it a required toggle (vision §B monetization: "Новый toggle к регистрации: `goods_marketplace`"). Absent from `feature_toggles`, that's a **"nothing dropped silently" violation** (audit GAP-BA-011).
- A feature-toggle row is the cheapest possible form — identical to how `payments`, `leasing`, `vet_leadgen` etc. are already seeded "form exists, behaviour deferred." It carries **zero** dependency on ADR-0014's polymorphic seam; the toggle just reserves the name/intent.
- Waiting for ADR-A conflates a trivial registration with a structural design — no reason to couple them.

**Action**: backend adds the seed row `('goods_marketplace', …, false, 0)` in the same form as the other gated toggles (a tiny migration + schema + EN↔RU). Not architect's code to write — handoff to backend. **Decision is architect's: INSERT now.**

---

## Q5 — SLA / duration: single threshold or per-market? + `premium_profiles` B2C vs B2B → **architect recommends per-market with a single canonical source; `premium_profiles` split** (owner decides final numbers)

**SLA / listing-duration — recommendation: per-market values, but defined in ONE canonical source.**
- The audit found contradictions: SLA `24h` (`listing_state_machine.md`) vs `4h/6h` per-market (`12-moderation-domain.md`); duration `30` (SM) vs `60` (pet BR) vs `90` (livestock BR); plus `SLA_TARGET_SECONDS` duplicated in 2 files. The defect is **multiple sources**, not the per-market idea itself.
- ADR-0002 already says the two markets evolve independently → **per-market SLA and per-market duration are architecturally correct** (livestock's higher-value, slower cadence genuinely differs from pet). The fix is to make the per-market values live in **one canonical place** (the moderation/listing spec table), referenced everywhere, with a single constant source in code — not to flatten them to one number.
- **Owner decides** the actual thresholds (4h vs 6h vs 24h; 60 vs 90 days) — that's a product/ops call. Architecture: **per-market, single canonical source, de-duplicate the constant.**

**`premium_profiles` — recommendation: split into two distinct concepts.**
- finance+growth found `premium_profiles` conflates a **B2C consumer feature** (a paid profile boost) with a **B2B subscription**. These have different fiscal treatment (B2C → 54-ФЗ ККТ; B2B → invoice) and different monetization timing.
- Architecture: model them as **two separate offerings/toggles** with distinct `monetization_type` (ADR-0014) — don't overload one toggle. **Owner decides** whether/when each launches; finance owns the economics; legal owns the fiscal ruling.

---

## Q6 — Livestock B2B track: separate team/sprint or a roadmap story? → **Separate roadmap track, not a separate codebase; sequence it last** (architect recommendation; resourcing → owner decides)

**Recommendation: livestock B2B is a *separate roadmap track/sequence*, sharing the same codebase and the ADR-0014/0015 seams — not a separate team or a forked system.**

Reasoning:
- ADR-0002 already hard-separates the two markets *within one platform* (shared kernel: identity, animal entity, infra). Livestock B2B services/goods differ in participants and channels (большой скот vet, оптовые корма, ВетИС, transport) but ride the **same** Offering seam (ADR-0014) with `market_scope=livestock` (ADR-0015) and the same Provider model (ADR-0016). No structural reason to fork.
- growth sequenced it **last** (Stage 4): pet services → pet goods → expertise → livestock B2B. Each category is its own two-sided cold-start; livestock B2B is a distinct channel problem best opened after pet liquidity is proven.
- Whether it gets a **dedicated team/sprint** is a **resourcing decision the owner makes** — architecture neither requires nor forbids it. Architectural position: **one codebase, one seam, separate roadmap track, sequenced last.**

---

## Handoff (what each role does next; none of this is committed)
- **owner**: ratify ADRs 0014–0019 (flip `Proposed → Accepted` per your decision); decide Q2 timing, Q3 (if dropping anything), Q5 thresholds + `premium_profiles` launch, Q6 resourcing; sign-off ADR-0019's launch at-rest floor with security+legal.
- **doc-keeper**: mirror ADRs 0014–0019 + this memo to `docsRU/04-decisions/` (EN↔RU); add the index lines to both READMEs (EN done by architect; verify RU).
- **backend**: Q4 (`goods_marketplace` seed), Q3 (confirm planned slices), ADR-0018 refactor, ADR-0019 crypto-seam/blind-index — all on owner go.
- **devops**: ADR-0017 region pinning + CI guardrail + deployment-spec fix; ADR-0019 storage-level encryption.
- **security + legal**: ADR-0016 verification risk-matrix; ADR-0019 at-rest launch-floor sign-off; ADR-0017 ст.12 carve-out review.
- **alpha-analyst**: polymorphic discovery+moderation contract (ADR-0014), provider+verification contract (ADR-0016), `market_scope` filter Gherkin (ADR-0015) — when the side is built.
