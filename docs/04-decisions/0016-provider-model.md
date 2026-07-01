# ADR-0016: Provider model — org-backed | individual | agent-provider

**Status**: Accepted — security + legal sign-off received 2026-07-01 (verification **tier-matrix T0–T3** + **three-regime immunity** model); structural model ratified by owner. Residual **product**-confirmations OD-3 / OD-4 / OD-5 remain open (non-structural — see §Residual open decisions).
**Date**: 2026-07-01
**Relates to**: [ADR-0014](0014-offering-supertype-polymorphic-seam.md), [ADR-0015](0015-market-scope-refines-0002.md), [ADR-0006](0006-ai-agents-operate-platform.md) & [ADR-0011](0011-agent-principal-actor-model.md) (agent-as-principal), the organization domain, the Legal launch-compliance checklist (`docs/legal/launch-compliance-checklist.md`).
**Source vision**: `docsRU/01-discovery/future-features.md` §B (Provider-абстракция), §C (Доверие — verification proportional to risk).

> **WHAT** — Define a single **Provider** abstraction — *who stands behind a non-animal Offering* — with three kinds: **ORG** (clinic/hotel/shop, backed by the existing organization domain), **INDIVIDUAL** (solo groomer/walker, a human user acting in a provider role), **AGENT** (an AI consultant, `principal_type=AGENT`, ADR-0006/0011). A **verification record proportional to category risk** attaches to the Provider on a **four-level tier matrix (T0–T3)**; the record — never a client assertion — **derives** the high-trust badge and, for regulated categories, conditions the platform's legal posture under a **three-regime liability model** (ст.1253.1 ГК for content/IP; ЗоЗПП «владелец агрегатора» for service-information accuracy; the "don't become the executor" doctrine for guarantee/control/settlement).
>
> **WHY** — ServiceOffering / ProductOffering / ConsultationOffering (ADR-0014) all need an answer to "who is offering this, and can we trust them?" The three kinds are real and different: an organization already modelled, a lone human with no org, and an AI principal the platform itself operates. A one-size model (e.g. "provider = always an organization") forces fake orgs for solo providers and has no place for an AI provider. Legal is explicit and — after the 2026-07-01 sign-off — **more precise than a single-statute framing**: platform immunity is not one shield but **three distinct regimes** (ст.1253.1 ГК covers *only* intellectual-rights/content; ЗоЗПП ст.9/12 governs *inaccurate information about the service or executor*; a separate *doctrine* strips all immunity the moment the platform guarantees, controls, or settles the service). **Verification supports each regime differently**, which is exactly why it must be a structured, risk-tiered record rather than a boolean.
>
> **WHY-BETTER for the whole project** — Reuses the organization domain instead of duplicating it; lets progressive-role onboarding (one account → provider) work without re-registration (comfort BR); makes the AI-provider path a *typed* case of the actor model already decided in ADR-0006/0011 rather than a special-case bolt-on; and — the sharpest improvement over the prior draft — replaces a single, legally-imprecise "ст.1253.1 shield" with a **three-regime model** each verification tier maps onto, so the trust seam is *legally load-bearing in the correct way*. Security's **T0–T3 tier matrix**, the **derived (not client-asserted) badge**, and four **DB-enforced DoD gates** (object-level authz/IDOR 404-no-leak; XOR CHECK; server-side regulated-publish hard-gate; tamper-proof append-only verification) turn "trust" into enforceable structure — form-now, behaviour gated.

## Context and Problem Statement

The Offering seam (ADR-0014) references a *provider*. The vision names three provider shapes and ties trust to **verification proportional to risk**:
- **ORG-backed** — vet clinic, animal hotel, shop. The `organization` domain already models legal-entity identity, org-admins, INN/KPP.
- **INDIVIDUAL** — a solo groomer/walker/trainer with no organization; a human `user` who, via progressive just-in-time roles, starts offering a service without a second registration.
- **AGENT** — an AI legal/consultation provider, `principal_type=AGENT`, operated by the platform under ADR-0006/0011 (least-privilege, full audit, mandatory human-override on document issuance).

Three cross-cutting requirements, refined by the 2026-07-01 security + legal sign-off:

### 1. Verification is proportional to risk — a four-level tier matrix (security)
Verification is not a boolean; it is a **derived record on a tier ladder**. The badge shown to users is **computed from the verification record, never asserted by the client**:

| Tier | Meaning | What is checked |
|---|---|---|
| **T0** | identity floor | account + confirmed phone |
| **T1** | business registration | ОГРН / ИНН, **format-and-existence validation** |
| **T2** | professional credential | diploma / certificate (профильное образование) |
| **T3** | state licence + state system | e.g. Rx pharmacy licence (Росздравнадзор) and/or registration in a state system (ВетИС/«Цербер») |

### 2. Immunity is not one shield but three regimes (legal)
The prior draft bound immunity to a single statute (ст.1253.1 ГК). The sign-off corrects this: the platform's liability posture is governed by **three distinct legal regimes**, each of which verification supports **differently**:

- **Regime 1 — ст.1253.1 ГК (информационный посредник):** covers **only intellectual-property / content** liability (user-posted content that infringes IP). The shield here is *notice-and-takedown of infringing content*; verification of the provider is largely orthogonal to it.
- **Regime 2 — ЗоЗПП «владелец агрегатора» (ст.9/12):** governs **inaccurate information about the service or the executor**. Immunity here is a **pass-through**: if the platform has **verified** the provider (identity + the tier appropriate to the category) and passes accurate information, liability for the *service itself* passes through to the provider. Weak/absent verification breaks the pass-through and pulls liability onto the platform.
- **Regime 3 — the "don't become the executor" doctrine:** the moment the platform **gives guarantees, exercises control over the service, or handles settlements (расчёты)**, it ceases to be a neutral venue and becomes the **executor** — **full liability, no immunity under any regime**. This is defended *architecturally* (MVP takes no guarantee/control/settlement role), not by verification.

Consequence: verification is the *condition* of the Regime-2 pass-through for regulated categories; it does not by itself buy the Regime-1 content shield, and it cannot save the platform if Regime-3 is tripped.

### 3. Object-level authorization on every provider-owned object (security)
IDOR / broken-access-control is the codebase's #1 recurring risk. Every provider-owned object (offering, booking, order, expertise/verification document) is authz-checked per object; **404-no-leak**.

## Decision Drivers

1. **Reuse, don't duplicate** — the org domain already exists; INDIVIDUAL and AGENT are principals already modelled (`users`, `principal_type`).
2. **Progressive roles / comfort BR** — one account becomes a provider with no re-registration.
3. **Verification = the Regime-2 pass-through condition** (legal) — must be a first-class, **risk-tiered (T0–T3)** record, not optional metadata; the badge is **derived** from it.
4. **Three-regime liability, not one shield** (legal) — the model must reflect that content-IP (Regime 1), service-information accuracy (Regime 2), and the executor doctrine (Regime 3) are governed separately.
5. **Agent-as-principal** (ADR-0006/0011) — AGENT provider is a typed reuse of the decided actor model, with least-privilege + human-override + AI-disclosure + a non-lawyer/non-vet disclaimer.
6. **Object-level authz everywhere + DB-enforced integrity** (security) — provider ownership checkable per object (404-no-leak); the org/user/kind/principal_type matrix enforced by a DB CHECK; regulated publishing hard-gated server-side; verification records tamper-proof (append-only).
7. **Anti-rewrite (§5)** — the provider reference + `provider_kind` + verification-tier shape is form-now; behaviour (actual verification workflow, badges) gated.

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
A single Provider concept identified by **exactly one of** `organization_id` (kind=ORG) **xor** `user_id` (kind=INDIVIDUAL or AGENT), with `principal_type` distinguishing AGENT, and a **verification record** carrying a **T0–T3 tier**. The Offering seam references the Provider; object-level authz resolves through the backing principal (org-admin for ORG, owner for INDIVIDUAL, operating-account for AGENT).

Pros:
- Reuses org domain (ORG) and user/principal model (INDIVIDUAL/AGENT) — no duplication.
- One verification seam, one discovery join, one object-authz resolution.
- AGENT is a typed case of ADR-0006/0011, not a special path.
- Progressive role: a `user` gains a Provider without a new account.
- The single verification record cleanly carries the T0–T3 tier that maps onto the three liability regimes.

Cons:
- The "exactly one of org/user" + `provider_kind` + `principal_type` matrix must be CHECK-constrained and documented (mirrors the ownership XOR pattern already used in animals/ownership_transfers).
- Verification tiers must be defined per category (security + legal own the matrix — **now supplied**, below).

## Decision

Adopt **Option 3**. Normative rules:

1. **`provider_kind ∈ {ORG, INDIVIDUAL, AGENT}`**, backed by **exactly one of** `organization_id` (ORG) **xor** `user_id` (INDIVIDUAL/AGENT); `AGENT` is the `user_id` case where the backing principal has `principal_type=AGENT` (ADR-0006/0011). **DoD gate (DB CHECK):** `(organization_id IS NOT NULL) XOR (user_id IS NOT NULL)` together with `provider_kind` and `principal_type` is enforced by a database CHECK constraint (mirroring the ownership-XOR pattern in animals/ownership_transfers) — not application code alone.

2. **Object-level authorization resolves through the backing principal** — ORG → org-admin (existing `isOrgAdmin`), INDIVIDUAL → owner (`user_id==actor`), AGENT → the operating account under least-privilege scope. **DoD gate:** every provider-owned object (offering, booking, order, verification document) is authz-checked **per object**; **404-no-leak** on every new object introduced by this seam.

3. **Verification is a first-class, risk-tiered (T0–T3), append-only record on the Provider** (form-now; workflow gated). The **badge is derived from the record, never client-asserted.** **DoD gate:** verification records are **tamper-proof / append-only** (corrections supersede, never mutate — consistent with the human-override/append-only precedent in ADR-0011). Per-category tier assignment (security + legal):

   | Category | Tier | Notes |
   |---|---|---|
   | **Veterinary (clinic/vet)** | **T3** | diploma **+** ИП/ООО **+** registration in **ВетИС/«Цербер»** — **NOT a licence** (RF vet activity is registered, not licensed). |
   | **Pharmacy / Rx (вет-аптека, prescription)** | **T3 + licence** | pharmaceutical licence (Росздравнадзор). **OFF / gated** at launch — separate track (OD-5). |
   | **Cynologist (kennel/trainer)** | **T2** | professional credential (diploma/certificate). |
   | **Groomer / walker** | **T0** (**+T1 if ИП**) | identity floor; business-reg tier only if operating as ИП. |
   | **Boarding / pet-hotel** | **T0 + geo-coarsening** / **T1 (ORG) + 498-ФЗ** | individual: identity + coarsened geo; organizational: business-reg + 498-ФЗ (humane-treatment) obligations. |
   | **Goods seller** | **T1** | business registration. **Goods marketplace OFF / gated** at launch (OD-5). |
   | **Agent-provider (AI)** | **AGENT-tier** | least-privilege + **human-override** on issuance + **AI-disclosure** to the user + **non-lawyer/non-vet disclaimer** (informational only). |

4. **Immunity follows the three-regime model** (legal) — encode the liability posture as three separate regimes, not one shield:
   - **Regime 1 (ст.1253.1 ГК, content/IP):** notice-and-takedown of infringing user content; provider verification does not condition it.
   - **Regime 2 (ЗоЗПП «владелец агрегатора», ст.9/12, service-information accuracy):** a **pass-through conditioned on verification** — a provider **unverified at the tier its category requires MUST NOT publish a regulated offering** in that category (this is the DoD hard-gate in rule 5). Adequate verification passes service-liability through to the provider.
   - **Regime 3 (executor doctrine):** defended **architecturally** — the MVP platform gives **no guarantees, no control over the service, no settlement/расчёты**; crossing that line forfeits all immunity and is out of MVP scope by design.

5. **Regulated-publish hard-gate is server-side** (security) — the check "provider is verified at the tier this category requires, for this `market_scope`" is enforced **on the server at publish time**, never in the UI only. A regulated offering cannot be published by an under-verified provider even with a crafted request.

6. **AGENT providers carry the ADR-0006/0011 guarantees** — least-privilege credentials (`service_credentials`, migration 0017 form), full audit, **mandatory human-override on any document/decision issuance**, **AI-disclosure**, and a **non-lawyer/non-vet disclaimer** (consultation is informational only, not legal/vet counsel).

7. **`monetization_type` (ADR-0014) lives on the offering, not the provider** — one provider may run lead-gen and take-rate offerings simultaneously.

8. **Verification tier ties to ADR-0015 `market_scope`** — a provider verified only for `pet` cannot publish a regulated offering scoped `livestock`/`both`; the server-side hard-gate (rule 5) checks tier-per-category **and** market_scope.

9. **No behaviour ships in MVP** — provider tables/verification workflow are gated (form per ADR-0014 when the services side is built); the *shape* (provider_kind, XOR backing, T0–T3 verification-tier, AGENT typing, the four DoD gates) is fixed here so activation needs no rewrite.

## Residual open decisions (owner product-confirmations — non-structural, non-blocking)

These do **not** affect the structural model above (the reason this ADR is Accepted, not held). They are **product/policy** confirmations to lock before the services side opens:

- **OD-3 — Badge naming/taxonomy.** The badge is *derived* (decided); the user-facing **names/labels** of the trust badges (e.g. "verified vet", "registered business") are a product/copy decision (owner + ux/ui + growth).
- **OD-4 — Immunity treatment of T2 categories.** Whether the Regime-2 pass-through for **T2-only categories (cynologist)** is treated as fully sufficient, or requires an additional disclaimer/liability posture — a legal-product nuance for the owner to confirm when the cynologist category opens.
- **OD-5 — Goods marketplace and Rx stay OFF at launch.** Confirmation that the **goods seller (T1)** track and the **Rx pharmacy (T3+licence)** track remain **OFF/gated** at launch (separate roadmap tracks), as assumed here.

## Consequences

### Positive
- Solo, organizational, and AI providers all fit one clean abstraction; org domain reused.
- Verification is an explicit, legally-load-bearing, **risk-tiered (T0–T3)** seam whose tiers map onto the **three liability regimes** — legally precise, not a single-statute approximation.
- The **derived badge** + **four DB/server-enforced DoD gates** make trust and integrity structural, not conventional.
- AGENT provider is the actor model already decided — coherent with the AI-operated-platform vision.
- One discovery/authz/verification path → less drift, less surface for IDOR.

### Negative
- The provider_kind × backing × principal_type matrix needs a CHECK constraint + clear docs.
- The per-category verification-tier matrix (now authored) must be kept in sync with legal/regulatory change before the regulated side opens.

### Neutral
- MVP unchanged (no providers exist yet).
- Reviews/Reputation over provider+offering is a reserved seam (ADR-E, later).

## Sign-off record (2026-07-01)
- **security** — verification **tier-matrix T0–T3**, the **derived (not client-asserted) badge**, and the **four DoD gates** (object-level authz/IDOR 404-no-leak; XOR CHECK; server-side regulated-publish hard-gate; tamper-proof append-only verification). ✅
- **legal** — the **three-regime immunity model** (ст.1253.1 ГК content/IP; ЗоЗПП «владелец агрегатора» service-information pass-through via verification; the executor doctrine defended architecturally) and per-category tier assignment (vet = registration not licence; Rx OFF). ✅
- **owner** — ratified the structural model; OD-3/OD-4/OD-5 recorded as open product-confirmations (non-blocking).

## Implementation Notes (when the services side is built — not now)
- Provider table + `provider_kind` + **XOR-backing CHECK** + **append-only** verification-tier record (backend; form-now per ADR-0014).
- **security** owns the verification risk-matrix (above) and the four DoD gates; **legal** owns the three-regime mapping and per-category tier assignment (ВетИС/«Цербер», 498-ФЗ, 61-ФЗ for Rx — Rx stays OFF, separate gated track).
- alpha-analyst writes the provider + verification contract (object-level authz, 404-no-leak, server-side regulated-offering hard-gate, tier-per-category × market_scope check).

## Related Decisions
- **ADR-0014** — Offering seam references the Provider.
- **ADR-0015** — `market_scope` gated by verification for regulated categories.
- **ADR-0006 / ADR-0011** — agent-as-principal; AGENT provider least-privilege + human-override + audit; append-only precedent for tamper-proof verification.
- **ADR-E (later)** — Reviews/Reputation over provider + offering (proof-of-transaction).

## References
- `docsRU/01-discovery/future-features.md` §B "Provider-абстракция", §C "Верификация провайдеров, пропорциональная риску".
- `docs/legal/launch-compliance-checklist.md` (intermediary immunity; ВетИС/«Цербер»; Rx OFF).
- **ст.1253.1 ГК РФ** (информационный посредник — content/IP, Regime 1).
- **ЗоЗПП ст.9, ст.12** (владелец агрегатора — service-information accuracy, Regime 2).
- Executor doctrine (Regime 3) — guarantee/control/settlement forfeits neutral-venue status.
- **498-ФЗ** (ответственное обращение с животными — boarding/hotel); **61-ФЗ** (Rx, OFF); ВетИС/«Цербер» (vet registration).
