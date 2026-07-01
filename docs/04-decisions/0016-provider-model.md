# ADR-0016: Provider model — org-backed | individual | agent-provider

**Status**: Proposed — awaiting security+legal provider-verification matrix (owner reviewed Q1–Q6 2026-07-01)
**Date**: 2026-07-01
**Relates to**: [ADR-0014](0014-offering-supertype-polymorphic-seam.md), [ADR-0006](0006-ai-agents-operate-platform.md) & [ADR-0011](0011-agent-principal-actor-model.md) (agent-as-principal), the organization domain, the Legal launch-compliance checklist (`docs/legal/launch-compliance-checklist.md`).
**Source vision**: `docsRU/01-discovery/future-features.md` §B (Provider-абстракция), §C (Доверие — verification proportional to risk).

> **WHAT** — Define a single **Provider** abstraction — *who stands behind a non-animal Offering* — with three kinds: **ORG** (clinic/hotel/shop, backed by the existing organization domain), **INDIVIDUAL** (solo groomer/walker, a human user acting in a provider role), **AGENT** (an AI consultant, `principal_type=AGENT`, ADR-0006/0011). A **verification record proportional to category risk** attaches to the Provider and gates the high-trust badge and — for regulated categories — the platform's information-intermediary immunity.
>
> **WHY** — ServiceOffering / ProductOffering / ConsultationOffering (ADR-0014) all need an answer to "who is offering this, and can we trust them?" The three kinds are real and different: an organization already modelled, a lone human with no org, and an AI principal the platform itself operates. A one-size model (e.g. "provider = always an organization") forces fake orgs for solo providers and has no place for an AI provider. Legal is explicit: **license/identity verification proportional to risk is the *condition* of keeping intermediary immunity** (ст.1253.1 ГК; aggregator duties ЗоЗПП ст.9/12) for regulated categories (vet, pharmacy, cynologist; ВетИС/«Меркурий», 498-ФЗ).
>
> **WHY-BETTER for the whole project** — Reuses the organization domain instead of duplicating it; lets the progressive-role onboarding (one account → provider) work without re-registration (comfort BR); makes the AI-provider path a *typed* case of the actor model already decided in ADR-0006/0011 rather than a special-case bolt-on; and turns "trust" into an explicit, risk-tiered, legally-load-bearing verification seam (form-now, behaviour gated) rather than an afterthought. Object-level authz on every provider-owned object (IDOR #1 risk) is mandated.

## Context and Problem Statement

The Offering seam (ADR-0014) references a *provider*. The vision names three provider shapes and ties trust to **verification proportional to risk**:
- **ORG-backed** — vet clinic, animal hotel, shop. The `organization` domain already models legal-entity identity, org-admins, INN/KPP.
- **INDIVIDUAL** — a solo groomer/walker/trainer with no organization; a human `user` who, via progressive just-in-time roles, starts offering a service without a second registration.
- **AGENT** — an AI legal/consultation provider, `principal_type=AGENT`, operated by the platform under ADR-0006/0011 (least-privilege, full audit, mandatory human-override on document issuance).

Two cross-cutting requirements:
- **Verification proportional to risk** (security + legal): regulated categories (vet/pharmacy/cynologist) require a license/diploma → high-trust badge; unregulated (groomer/walker/boarding) require verified identity + phone. License verification for regulated categories is a **condition of intermediary immunity** — without it the platform risks "sliding" from neutral venue into executor/guarantor and losing the ст.1253.1 shield.
- **Object-level authorization** on every provider-owned object (offering, booking, order, expertise document) — IDOR/broken-access-control is the codebase's #1 recurring risk; 404-no-leak applies.

## Decision Drivers

1. **Reuse, don't duplicate** — the org domain already exists; INDIVIDUAL and AGENT are principals already modelled (`users`, `principal_type`).
2. **Progressive roles / comfort BR** — one account becomes a provider with no re-registration.
3. **Verification = immunity condition** (legal) — must be a first-class, risk-tiered record, not optional metadata.
4. **Agent-as-principal** (ADR-0006/0011) — AGENT provider is a typed reuse of the decided actor model, with least-privilege + human-override.
5. **Object-level authz everywhere** (security) — provider ownership must be checkable per object; 404-no-leak.
6. **Anti-rewrite (§5)** — the provider reference + `provider_kind` + verification-tier shape is form-now; behaviour (actual verification workflow, badges) gated.

## Considered Options

### Option 1: Provider = always an Organization
Every provider must register an organization; solo providers create a one-person org; AI providers are modelled as a synthetic org.

Pros:
- Single backing entity; reuses org-admin authz uniformly.

Cons:
- Forces **fake one-person orgs** for solo groomers → friction, contradicts progressive-role comfort BR.
- No honest home for an **AI** provider (an org is a legal entity; an agent isn't).
- INN/KPP and legal-entity fields meaningless for individuals → nullable-soup.

### Option 2: A separate Provider table per kind (org_providers, individual_providers, agent_providers)
Three parallel provider tables, each with its own ownership and verification.

Pros:
- Each kind fully tailored.

Cons:
- Triples the verification + discovery + object-authz seam; ADR-0014 read-model needs three join paths.
- Cross-kind queries ("all providers near me") fragment.

### Option 3: One Provider abstraction with `provider_kind` over existing principals + a risk-tiered verification record (Chosen)
A single Provider concept identified by **exactly one of** `organization_id` (kind=ORG) **xor** `user_id` (kind=INDIVIDUAL or AGENT), with `principal_type` distinguishing AGENT, and a **verification record** carrying a risk tier. The Offering seam references the Provider; object-level authz resolves through the backing principal (org-admin for ORG, owner for INDIVIDUAL, operating-account for AGENT).

Pros:
- Reuses org domain (ORG) and user/principal model (INDIVIDUAL/AGENT) — no duplication.
- One verification seam, one discovery join, one object-authz resolution.
- AGENT is a typed case of ADR-0006/0011, not a special path.
- Progressive role: a `user` gains a Provider without a new account.

Cons:
- The "exactly one of org/user" + `provider_kind` + `principal_type` matrix must be CHECK-constrained and documented (mirrors the ownership XOR pattern already used in animals/ownership_transfers).
- Verification tiers must be defined per category (security + legal own the matrix).

## Decision

Adopt **Option 3**. Normative rules:

1. **`provider_kind ∈ {ORG, INDIVIDUAL, AGENT}`**, backed by **exactly one of** `organization_id` (ORG) **xor** `user_id` (INDIVIDUAL/AGENT); `AGENT` is the `user_id` case where the backing principal has `principal_type=AGENT` (ADR-0006/0011). CHECK-constrained, mirroring the existing ownership-XOR pattern.
2. **Object-level authorization resolves through the backing principal** — ORG → org-admin (existing `isOrgAdmin`), INDIVIDUAL → owner (`user_id==actor`), AGENT → the operating account under least-privilege scope. Every provider-owned object (offering, booking, order, document) is authz-checked per object; **404-no-leak**.
3. **Verification is a first-class, risk-tiered record on the Provider** (form-now; workflow gated):
   - **Regulated / high-risk** (vet, pharmacy, cynologist) → license/diploma verification → **high-trust badge** AND a **precondition of intermediary immunity** for that category (legal). A provider unverified for a regulated category MUST NOT publish a regulated offering in it.
   - **Unregulated** (groomer, walker, boarding, training) → verified identity + confirmed phone → standard trust.
4. **AGENT providers carry the ADR-0006/0011 guarantees** — least-privilege credentials (`service_credentials`, migration 0017 form), full audit, and **mandatory human-override on any document/decision issuance** (consultation disclaimer: informational only, not legal/vet counsel).
5. **`monetization_type` (ADR-0014) lives on the offering, not the provider** — one provider may run lead-gen and take-rate offerings simultaneously.
6. **Verification tier ties to ADR-0015 `market_scope`** — a provider verified only for `pet` cannot publish a regulated offering scoped `livestock`/`both`.
7. **No behaviour ships in MVP** — provider tables/verification workflow are gated (form per ADR-0014 when the services side is built); the *shape* (provider_kind, XOR backing, verification-tier, AGENT typing) is fixed here so activation needs no rewrite.

## Consequences

### Positive
- Solo, organizational, and AI providers all fit one clean abstraction; org domain reused.
- Verification becomes an explicit, legally-load-bearing, risk-tiered seam (immunity condition encoded, not implied).
- AGENT provider is the actor model already decided — coherent with the AI-operated-platform vision.
- One discovery/authz/verification path → less drift, less surface for IDOR.

### Negative
- The provider_kind × backing × principal_type matrix needs CHECK constraints + clear docs.
- The per-category verification-tier matrix must be authored (security + legal) before the regulated side opens.

### Neutral
- MVP unchanged (no providers exist yet).
- Reviews/Reputation over provider+offering is a reserved seam (ADR-E, later).

## Implementation Notes (when the services side is built — not now)
- Provider table + `provider_kind` + XOR backing CHECK + verification-tier record (backend; form-now per ADR-0014).
- **security** owns the verification risk-matrix (which categories need license vs identity); **legal** confirms which categories' immunity depends on verification (ВетИС/«Меркурий», 498-ФЗ, 61-ФЗ for Rx — Rx stays OFF, separate gated track).
- alpha-analyst writes the provider + verification contract (object-level authz, 404-no-leak, regulated-offering gate).

## Related Decisions
- **ADR-0014** — Offering seam references the Provider.
- **ADR-0015** — `market_scope` gated by verification for regulated categories.
- **ADR-0006 / ADR-0011** — agent-as-principal; AGENT provider least-privilege + human-override + audit.
- **ADR-E (later)** — Reviews/Reputation over provider + offering (proof-of-transaction).

## References
- `docsRU/01-discovery/future-features.md` §B "Provider-абстракция", §C "Верификация провайдеров, пропорциональная риску".
- `docs/legal/launch-compliance-checklist.md` (intermediary immunity; ВетИС/«Меркурий»; Rx OFF).
- ст.1253.1 ГК (информационный посредник); ЗоЗПП ст.9/12 (aggregator); 498-ФЗ; 61-ФЗ (Rx).
