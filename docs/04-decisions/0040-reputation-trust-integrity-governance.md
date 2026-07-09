# ADR-0040: Reputation trust integrity & governance — verification-tier orthogonal (weighting reserved), disputes as a `content_report` subtype, agent-as-review-moderator (not reviewer)

**Status**: Accepted (owner, 2026-07-09 — section-by-section review; both open questions resolved per recommendation)
**Date**: 2026-07-09
**Builds on**: [ADR-0003](0003-pre-moderation-workflow.md) (the moderation workflow reviews/disputes reuse — no parallel court), [ADR-0016](0016-provider-model.md) (the T0–T3 verification-tier matrix whose coupling to reputation is decided here), [ADR-0037](0037-agent-scoped-ability.md) (the scoped-ability seam an agent review-moderator rides — the moderation-agent reference mapping), [ADR-0036](0036-agent-credential-issuance.md) (the credential/JWT that carries an agent moderator's scope).
**Related**: [ADR-0038](0038-confirmed-sale-record-of-truth.md) (the confirmed sale a dispute contests), [ADR-0039](0039-reputation-storage-model.md) (the reviews/aggregate this layer governs), [ADR-0006](0006-ai-agents-operate-platform.md)/[ADR-0011](0011-agent-principal-actor-model.md) (agent-as-principal, human-override, ст.16 transparency), [ADR-0002](0002-hard-split-markets.md).
**Source**: spec `docs/specs/18-reputation.md` §12 items 4, 5, 6 — routed to architect; AUDIT4 **P3-1** + §8 anti-abuse (fake reviews / review-bombing / Sybil). Owner fork §13 (fork 7: reputation never monetised) is a normative constraint on this layer.

---

## Context and Problem Statement

[ADR-0038](0038-confirmed-sale-record-of-truth.md) fixes the record of truth; [ADR-0039](0039-reputation-storage-model.md) fixes how reviews and reputation are stored. This ADR decides the **third cluster** from spec §12 — the **trust-integrity and governance layer**: *who is trusted to create reviews, how disputes and abuse are adjudicated, and whether an AI operator may participate*. The three §12 items are one coherent decision — "who and how may act on the reputation system":

- **§12.4 — verification-tier coupling.** Does an [ADR-0016](0016-provider-model.md) verified identity (T0–T3) **weight** or **gate** reputation (Sybil-resistance), or stay **orthogonal**? Shapes whether the aggregate is a plain mean or a trust-weighted one.
- **§12.5 — dispute → moderation integration.** New reason codes + `decision_templates`, and whether a review dispute is a **first-class `content_report` subtype** or a parallel mechanism.
- **§12.6 — agent-as-reviewer / agent-as-review-moderator (ADR-0006).** May an AI operator **author** a review and/or **adjudicate** one, via the [ADR-0037](0037-agent-scoped-ability.md) scoped-ability seam?

The spec's anti-abuse posture (§8) is the frame: the **proof-of-transaction gate** (a review requires a CONFIRMED sale — [ADR-0039](0039-reputation-storage-model.md)) is the primary structural defence; everything here is the **secondary** governance layer routed to moderation, **not a parallel review-court**.

## Decision Drivers

1. **Proof-of-transaction is the keystone; don't over-build secondary defences (spec §8).** The CONFIRMED-sale gate already blocks the dominant fake-review vector. Verification-tier and dispute machinery must **add** defence-in-depth, not duplicate or over-engineer it. Highest driver.
2. **Reuse moderation, never fork a parallel court (ADR-0003, spec §8).** Disputes and abusive reviews route through the **existing** moderation queue / `moderation_decisions` / `decision_templates` — one trust-and-safety spine, one audit trail.
3. **Least surprise / no trust-cue distortion (fork 7, psychologist TP-8).** Reputation is a public good; coupling it to a *paid* verification badge would smuggle a purchasable trust cue. Any verification coupling must be earned-signal only, never pay-for-trust.
4. **Agent-as-principal, human-override (ADR-0006 #3/#4, ADR-0011 §3).** If an agent ever moderates reviews it must ride the **existing** scoped-ability + autonomy-toggle + human-override contract (ADR-0037 §3), not a new agent path.
5. **Semantic honesty of a review (spec §Constraints, active-user).** A review asserts "I transacted and here is my experience." Whether an AI operator can *author* that assertion is a truth/ethics question, not just a permissions one.
6. **Dormant-form-first / no MVP behaviour change (ADR-0022, migration 0034).** The governance seams ship dormant; behaviour is gated.

---

## §1 — Verification-tier coupling: orthogonal for MVP, aggregate-weighting reserved as a dormant hook (§12.4)

**Considered options**

### Option 1: Verification tier **gates** review eligibility (only T≥n identities may review)
A minimum ADR-0016 verification tier is required to author a review.

Cons:
- **Suppresses honest signal** — most legitimate buyers are low-tier (a first-time pet buyer is T0/T1); gating reviews behind verification would silence the majority and tilt win-win back to sellers (the exact AUDIT4 P3-1 imbalance). The proof-of-transaction gate already ensures the reviewer *actually transacted* — tier adds little against the primary vector and costs real coverage. Rejected as a gate.

### Option 2: Verification tier **weights** the aggregate now (a T3 review counts more than a T0)
Trust-weight each review by the author's tier in the mean.

Pros:
- Sybil-dampening: a cluster of T0 sock-puppets moves the score less than one verified buyer.

Cons:
- **Premature and opaque** — a weighted mean is hard to explain ("why is my 4.8 shown as 4.3?"), risks a fairness/legibility problem, and there is **no fraud data yet** to calibrate weights. The Sybil vector is already throttled by proof-of-transaction (each fake review needs a *confirmed counterparty*) + the per-user create quota (reuse listing-quota H2-B). Build the **hook**, not the behaviour. Deferred, not rejected.

### Option 3: Orthogonal for MVP; reserve a dormant weighting hook (Chosen)
Verification tier and reputation are **orthogonal** in the first phase — tier neither gates nor weights reviews. The **anti-Sybil defence is proof-of-transaction + create-quota + review-bombing anomaly signal** (spec §8), not tier. A **dormant weighting hook** is reserved (the recompute §1 of [ADR-0039](0039-reputation-storage-model.md) can later factor a per-author trust weight without a schema change — the aggregate already stores `rating_sum`/`count`, and a weight column is additive) so tier-weighting can be switched on **if** fraud data later justifies it.

Pros:
- Maximal honest coverage now (every proven buyer's review counts equally) — serves the win-win rebalance (driver 1).
- Sybil is still bounded (proof-of-transaction + quota + anomaly → moderation).
- The weighting hook is reserved, so a data-driven decision later needs no rewrite (defer-by-cost-of-change, correctly: cheap later, no rewrite risk, not a current business requirement).
- Keeps reputation legible and un-gamed by pay-for-tier (driver 3 — a *paid* high tier must never buy a heavier review).

Cons:
- A determined Sybil actor who can manufacture confirmed counterparties is only throttled, not weighted-down, until the hook activates — accepted (routed to moderation as an anomaly; no fraud data yet to weight against).

**Decision:** **Option 3** — verification tier is **orthogonal** to reputation in MVP (no gate, no weight); anti-Sybil = proof-of-transaction + create-quota + review-bombing anomaly → moderation; a **dormant per-author weighting hook is reserved** for a later data-driven activation. A paid/premium tier must **never** weight or gate a review (fork 7).

**ЧТО:** Verification tier neither gates nor weights reviews in MVP; Sybil-resistance rests on the proof-of-transaction gate + per-user create-quota + anomaly-to-moderation; a dormant aggregate-weighting hook is reserved for a future, fraud-data-driven activation; pay-for-tier never influences a review.
**ПОЧЕМУ:** Gating reviews by tier silences the honest low-tier majority (re-tilting win-win to sellers), and weighting is premature without fraud data and hurts legibility — while proof-of-transaction already throttles the Sybil vector; but the option to weight later must not require a rewrite.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** Maximises honest review coverage now (the AUDIT4 P3-1 win-win rebalance) while keeping Sybil bounded by the existing structural gate + quota + moderation, and reserving a cheap additive weighting hook so a data-driven tightening later costs no rewrite; forbidding pay-for-tier influence keeps reputation an un-purchasable public good (fork 7 / TP-8). Alternatives rejected: tier-gates-eligibility (suppresses honest signal, re-tilts win-win); tier-weights-now (premature, opaque, uncalibrated).

---

## §2 — Disputes & abusive reviews: a first-class `content_report` subtype, reusing the moderation spine (§12.5)

**Considered options**

### Option 1: A separate review-dispute mechanism (its own queue, states, resolver)
Build a parallel dispute court for sales/reviews.

Cons:
- **Duplicates moderation** — a second queue, a second audit trail, a second human-override path, a second set of templates to keep consistent. Contradicts driver 2 and spec §8 ("not a parallel court"). Rejected.

### Option 2: Reuse moderation as a first-class `content_report` subtype (Chosen)
A sale dispute (`ConfirmedSale.Disputed`, [ADR-0038](0038-confirmed-sale-record-of-truth.md) §3) and an abusive/contested review both route into the **existing** moderation as a `content_report` **subtype** (a new report reason/entity-type), resolved by a `moderation_decisions` row (append-only, actor-snapshot, human-override — ADR-0011 §3). New **reason codes** and **`decision_templates`** (migration 0022 shape — `body_localized` JSONB, market-scoped, `applies_to_decision`) are proposed for review-removal / dispute-resolution, **added by the moderation-spec owners** (alpha-analyst), not invented here.

Pros:
- One trust-and-safety spine, one audit trail, one human-override path, one template system (driver 2).
- A DISPUTED sale resolves through the same `moderation_decisions` mechanism a listing rejection uses — moderators (human or agent, §3) need no new tooling.
- Consistent with the reviews `moderation_status` field ([ADR-0039](0039-reputation-storage-model.md) §3): a review's `body` is moderated exactly like listing content.

Cons:
- The moderation `content_report` model must widen to admit the new entity-types/reasons — a bounded, additive change owned by the moderation spec.

**Decision:** **Option 2** — a review dispute / abusive review is a **first-class `content_report` subtype** resolved via the existing `moderation_decisions` mechanism; new reason codes + `decision_templates` (migration-0022 shape) are proposed for the moderation spec owners to add. No parallel court.

**ЧТО:** Sale disputes and abusive reviews route into the existing moderation as a `content_report` subtype, resolved by append-only `moderation_decisions` (actor-snapshot + human-override); new reason codes + `decision_templates` are proposed for alpha-analyst/moderation to add, not invented here.
**ПОЧЕМУ:** A parallel dispute court would duplicate the queue, audit trail, override path and templates the platform already has; reputation abuse is a content/behaviour problem moderation already solves.
**ПОЧЕМУ ТАК ЛУЧШЕ:** One trust-and-safety spine (one audit trail, one human-override, one template system) — reusing `moderation_decisions` + the migration-0022 template shape means no new adjudication mechanism to build or review, and an agent moderator (§3) inherits the exact tooling; widening `content_report` is a bounded additive change owned by the right spec. Alternative rejected: a separate review-dispute court (duplicates moderation, drift, double audit).

---

## §3 — Agent participation: agent-as-review-moderator YES (via ADR-0037 scope), agent-as-reviewer NO/deferred (§12.6)

This splits the one §12.6 question into its two very different halves.

**Considered options**

### Option 1: Symmetric — an agent may both author and moderate reviews
Treat "AI reviewer" and "AI review-moderator" the same.

Cons:
- **Conflates a truth claim with an operator action.** A review asserts "*I* transacted and here is *my* experience" — an agent did not buy the animal; an agent-authored review is either fabricated experience or a re-labelled system signal (which belongs in analytics/anomaly, not as a "review"). Moderating a review, by contrast, is a normal operator action the platform already models for agents (moderation is the READY reference). Rejected as symmetric.

### Option 2: Agent-as-review-moderator YES via ADR-0037 scope; agent-as-reviewer NO/deferred (Chosen)
- **Review-moderator (YES, gated):** an AI operator may adjudicate review disputes / moderate review `body` **exactly** via the [ADR-0037](0037-agent-scoped-ability.md) contract — a scoped-ability profile (e.g. `review-moderation-agent` scope = `[{read, ContentReport}, {create, ModerationDecision}, {read, Review}]`), bounded by three gates (master-auth ADR-0036 → scope ADR-0037 → per-domain `agent_moderation`-style autonomy toggle), with human-override untouched (ADR-0011 §3) and ст.16 ФЗ-152 transparency if it ever adjudicates a natural person's rating. This is the direct reuse of the AUDIT4/architect "cross-cutting agent-operable-action contract" (snapshot + scope + autonomy-toggle + override).
- **Reviewer / review-author (NO for MVP/near-term, owner-deferred):** an agent does **not** author proof-of-transaction reviews — the semantics require a party who actually transacted. `reviews.actor_principal_type` already reserves the `AGENT` value (form), so the seam exists, but authoring stays **off** and is an explicit owner/North-Star fork (Open Q1), defaulted NO.

Pros:
- Reuses the existing agent-operable-action contract for the operator half — no new agent path (driver 4); moderation is already the READY template.
- Preserves the honesty of a review (a rating means a real party's real experience) — driver 5.
- The `AGENT` reviewer value stays reserved so a *future* owner decision (e.g. an agent negotiating/transacting on a principal's behalf) needs no schema change.

Cons:
- Splits one §12 item into two policies — accepted; they are genuinely different (operator action vs truth claim).

**Decision:** **Option 2** — **agent-as-review-moderator is allowed, gated exactly by the ADR-0037 three-gate scoped-ability contract with human-override**; **agent-as-reviewer (authoring) is NOT enabled** for MVP/near-term (semantically a real party's claim), with the `AGENT` actor value reserved and the question owner-deferred.

**ЧТО:** An agent may moderate/adjudicate reviews via an ADR-0037 `review-moderation-agent` scope (three-gate: master-auth → scope → autonomy-toggle, human-override intact, ст.16 transparency); an agent may NOT author reviews in MVP/near-term (the `AGENT` actor value stays reserved, owner-deferred).
**ПОЧЕМУ:** Moderating a review is a normal operator action the platform already models for agents; authoring a proof-of-transaction review is a truth claim only a real transacting party can honestly make — the two must not be conflated.
**ПОЧЕМУ ТАК ЛУЧШЕ:** The moderator half reuses the exact four-part agent-operable-action contract (ADR-0037 §3) — no new agent authz path, human-override and ст.16 transparency preserved — advancing the North-Star on proven rails; refusing agent-authored reviews protects the semantic integrity that makes reputation trustworthy (a fabricated "experience" would poison the signal), while reserving the `AGENT` value keeps a future owner decision rewrite-free. Alternative rejected: symmetric agent author+moderate (conflates a truth claim with an operator action, risks fabricated reviews).

---

## §4 — Phase boundary: governance seams dormant, behaviour gated

Per dormant-form-first (ADR-0022, migration 0034):

- **FORM-now (dormant):** the weighting hook (§1, reserved additive), the `content_report` subtype / reason-code shape (§2, proposed to moderation spec), the `AGENT` actor value on reviews + the `review-moderation-agent` scope profile shape (§3, reusing ADR-0037's `agent_capability_profiles`) — all present as seams, none active.
- **Behaviour-later (gated):** dispute adjudication and review moderation go live with the `reputation_reviews` behaviour slice (ADR-0039 §6); agent moderation additionally behind ADR-0036 master-auth + ADR-0037 scope + the per-domain autonomy toggle; tier-weighting only on a future fraud-data decision; agent-authored reviews only on a future owner decision.
- **MVP truth:** no reviews, no disputes, no agents — byte-identical HUMAN behaviour.

**ЧТО:** Ship the weighting hook, `content_report` subtype shape, and `review-moderation-agent` scope profile dormant; gate dispute/moderation behaviour behind `reputation_reviews`, agent moderation behind the ADR-0036/0037 three-gate stack, tier-weighting and agent-authoring behind future owner/data decisions.
**ПОЧЕМУ:** The governance seams are cheapest to reserve now but must not change MVP behaviour or expose live agent/abuse machinery.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Reuses the proven dormant-form-first pattern and the existing moderation + ADR-0037 rails, so activation is a toggle flip, not a build; the graduated gates (feature toggle → agent master-auth → scope → autonomy) give a killable, staged rollout matching ADR-0006 P-A…P-D.

---

## Consequences

### Positive
- Anti-abuse rests on the strongest structural gate (proof-of-transaction) plus reused moderation, not a duplicated court — one trust spine, one audit trail, one human-override path.
- Honest review coverage is maximised now (no tier gate) while a data-driven Sybil-weighting tightening stays a rewrite-free future option.
- The agent-operator path reuses ADR-0037 exactly (moderation is the READY template), advancing the North-Star with human-override and ст.16 transparency intact.
- Review semantics stay honest (no agent-fabricated experience); the `AGENT` value is reserved for a future owner decision.
- Reputation stays an un-purchasable public good (no pay-for-tier influence, fork 7 / TP-8).

### Negative
- Splits one §12 item (agent participation) into two policies; a determined Sybil with manufactured counterparties is only throttled (not weighted-down) until the hook activates.
- The moderation `content_report` model must widen (bounded, additive; owned by the moderation spec, not this ADR).

### Neutral
- MVP behaviour byte-identical (no reviews/disputes/agents live).
- Reason codes + `decision_templates` are added by alpha-analyst/moderation in their spec; this ADR is the routing contract.
- Tier-weighting and agent-authoring remain explicit, reserved future decisions.

## Open questions — RESOLVED by the owner (2026-07-09)

1. **[owner / North-Star] May an AI agent ever *author* a review?** MVP/near-term is NO (a review is a real transacting party's truth claim; the `AGENT` actor value is reserved but off). *Recommendation:* **keep agent-authored reviews OFF** until (and unless) an agent genuinely transacts on a principal's behalf as an identified party — then revisit with legal on whose experience it asserts. **Owner decision 2026-07-09: NO — agent-authored reviews stay OFF until an agent genuinely transacts as an identified party on a principal's behalf; then revisit with legal.**
2. **[owner / security, later — not blocking MVP] Activate verification-tier weighting of the aggregate once fraud data exists?** *Recommendation:* **leave the weighting hook dormant; revisit only when review-fraud/Sybil data shows proof-of-transaction + quota are insufficient** — and even then weight by *earned* verification only, never by a *paid* tier (fork 7). **Owner decision 2026-07-09: as recommended — the hook stays dormant until fraud data justifies it; if ever activated, earned verification only, never a paid tier.**

*(No unresolvable conflict with §13 was found. Fork 7 — reputation never monetised — is honoured structurally: no gate/weight is ever a paid tier. The remaining owner calls are new forward-looking questions, not §13 items.)*

## Related Decisions
- [ADR-0003](0003-pre-moderation-workflow.md) — the moderation workflow disputes/abusive reviews reuse (no parallel court).
- [ADR-0016](0016-provider-model.md) — the T0–T3 verification-tier matrix kept orthogonal to reputation in MVP (weighting hook reserved).
- [ADR-0037](0037-agent-scoped-ability.md) — the scoped-ability contract an agent review-moderator rides (the moderation-agent reference mapping generalised to `review-moderation-agent`).
- [ADR-0036](0036-agent-credential-issuance.md) — the credential/JWT carrying an agent moderator's scope (master-auth gate).
- [ADR-0038](0038-confirmed-sale-record-of-truth.md) — the confirmed sale a dispute contests (`ConfirmedSale.Disputed`).
- [ADR-0039](0039-reputation-storage-model.md) — the reviews/aggregate this layer governs (aggregate weighting hook lives on its recompute path; `moderation_status` on `reviews`).
- [ADR-0011](0011-agent-principal-actor-model.md)/[ADR-0006](0006-ai-agents-operate-platform.md) — agent-as-principal, human-override, ст.16 transparency.

## References
- `docs/specs/18-reputation.md` §8 (anti-abuse), §9 (ФЗ-152 / ст.9 right-to-object), §11 (Trust & Ethics — no coerced/incentivised/purchasable reputation), §12 (items 4, 5, 6), §13 (fork 7).
- `database_schema.sql` (`moderation_decisions`, `decision_templates` migration 0022, `content_reports`/`moderation_reasons`, `agent_capability_profiles` per ADR-0037, `feature_toggles`).
- `AUDIT4_HARDENING.md` §P3-1, §8 anti-abuse family; `AUDIT4/architect.md` #2 (cross-cutting agent-operable-action contract).
- `IMPLEMENTATION_PLAYBOOK.md §5` (phase-boundary / dormant-form-first).
