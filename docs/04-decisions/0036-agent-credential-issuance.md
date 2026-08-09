# ADR-0036: Agent-credential issuance — unstub `service_credentials` (human-issued credential → short-lived AGENT JWT)

**Status**: Accepted (owner, 2026-07-09)
**Date**: 2026-07-08
**Amends / refines**: [ADR-0011](0011-agent-principal-actor-model.md) §5 (fixes the concrete credential-presentation, issuance, bootstrap and verification form that ADR-0011 §5.3 left as a *forward-compatible stub* — does **not** rewrite or supersede it).
**Related**: [ADR-0006](0006-ai-agents-operate-platform.md) (AI agents as principals; non-negotiable #4 = scoped, least-privilege agent credentials), [ADR-0009](0009-mvp-vs-target-architecture.md) (in-monolith, no separate auth service), [ADR-0037](0037-agent-scoped-ability.md) (the scope the issued credential/JWT carries), the RBAC matrix `docs/specs/security/rbac-matrix.md`.
**Audit trigger**: AUDIT4 §4a agent-runnability scorecard — *"agent-auth bootstrap — BLOCKED — `service_credentials` issuance is a stub; the single structural blocker to ALL autonomy"*; `AUDIT4/architect.md` anti-North-Star debt #1; `AUDIT4/security.md` §STRATEGIC (agent bootstrap has no live path).

---

## Context and Problem Statement

ADR-0011 §5 laid the **form** of agent service-auth: a source-agnostic principal resolved through an ordered `RequestAuthenticator` chain, an env signing-secret (`AGENT_SERVICE_SIGNING_SECRET`, ≥32) reserved, and a rotatable/revocable hashed-secret store — the `service_credentials` table (migration 0017, `database_schema.sql:1194`). That form is real and correctly shaped (`id`, `agent_user_id FK users ON DELETE RESTRICT`, `secret_hash`, `is_active`, `revoked_at`, `rotated_from`).

But the form is **inert**. AUDIT4 (round-3) code-verified the gap and named it the single structural blocker to the North-Star (ADR-0006 — operator roles performed by AI agents):

- `AgentServiceTokenAuthenticator.tryAuthenticate()` returns `null` for every request (a deliberate stub — `backend/src/lib/auth/agent-service-token.authenticator.ts:23`).
- **No endpoint issues a credential.** `service_credentials` is never populated; `s3.adapter`-style "wired to nothing." There is no path for a machine to obtain, present, rotate, or revoke a credential.
- The agent-as-principal *actor-recording* forms (ADR-0011 §1–§4: `principal_type` snapshots, human-override, deactivate-not-delete) are all in place and wasted — **an AGENT can be represented in a decision ledger but cannot authenticate**, so no domain (moderation is otherwise READY) can actually be agent-operated.

This ADR fixes the **concrete issuance form**: *how* an AGENT principal obtains, presents, rotates and gets revoked credentials; the **bootstrap path** (who issues the first credential — resolving the chicken-and-egg); the **hashing/verification** approach (reusing the existing platform crypto/auth primitives); the **audit trail** (ADR-0006/0011); and the **phase boundary** (what form ships now vs behaviour gated later). It builds **on** the 0017 table; the only schema delta is a small, additive, PROPOSED extension for accountability/operability (§7) — no rewrite.

This ADR decides *issuance & authentication*. **What an authenticated agent is then allowed to do** — least-privilege scope, deny-by-default, no `manage:all` — is the companion decision [ADR-0037](0037-agent-scoped-ability.md) (AUDIT4 P1-6). The two together unblock the North-Star; neither alone is sufficient (an agent is otherwise either powerless — no creds — or over-powered — inherits the human role).

## Decision Drivers

1. **North-Star unblock (ADR-0006)** — a machine must be able to authenticate before any operator domain can be agent-run; this is the literal first step. Highest driver.
2. **Accountability non-negotiable (ADR-0006 #5)** — "a responsible human/legal entity is always accountable." The credential's trust root must terminate in a **HUMAN**, and issuance must be an audited human act. An agent is not a legal person (AUDIT4 §4a legal note) — the registered human operator bears liability.
3. **Least-privilege / scoped credentials (ADR-0006 #4, ADR-0011 §5/§C)** — credentials must be rotatable, revocable, and never plaintext at rest; a leaked or misbehaving credential must be killable immediately with bounded blast radius.
4. **Reuse-don't-reinvent (ADR-0001 platform foundation)** — the access-token verification path (HS256-pinned JWT carrying `principal_type`), constant-time compare, HMAC keyed-hash (`CryptoService`, migration 0028), refresh-rotation discipline, and Redis rate-limiting already exist. The issuance form must ride these, not add a parallel primitive.
5. **In-monolith (ADR-0009, ADR-0011 §5 locked canon)** — no separate auth service; issuance/verification is a principal/guard concern inside the monolith.
6. **Phasing / cost-of-change (`IMPLEMENTATION_PLAYBOOK.md §5`)** — design now (cheapest before Admin Slice 2 hard-wires human-only assumptions); ship the machinery gated (master toggle off), issue nothing in MVP.
7. **Compliance (ФЗ-152, ст.16 solely-automated decisions)** — a regulator must reconstruct which human authorised a given agent's authority and when; the override machinery (ADR-0011 §3) already exists — this ADR supplies the *issuance* half of the audit chain.

---

## §1 — Credential presentation: human-issued secret exchanged for a short-lived AGENT JWT

**Considered options**

### Option 1: Long-lived opaque secret presented on every request (per-request DB verify)
The agent presents its raw `service_credentials` secret as a bearer credential on each call; `AgentServiceTokenAuthenticator` looks up the row and constant-time-compares `secret_hash` per request.

Pros:
- Simplest; the ADR-0011 §5 authenticator-chain shape maps 1:1 (the authenticator returns the principal directly).

Cons:
- A **long-lived, high-value secret travels on the wire on every request** (hottest path) — larger exposure surface (logs, proxies, breach replay) than a short-lived token.
- A DB lookup + hash compare **on every authenticated agent request** (hot-row read on `service_credentials`); revocation latency is per-request-good but the verify cost recurs forever.
- No natural expiry: a leaked secret is valid until someone notices and revokes.

### Option 2: Credential → short-lived AGENT JWT exchange (Chosen)
The agent presents its secret **once** to a token-exchange endpoint (`POST /v1/auth/agent/token`); the endpoint verifies it against `service_credentials`, then issues a **short-lived access JWT** with the existing shape (`AccessTokenClaims { sub, role, principal_type:'AGENT' }`, plus the scope claim from ADR-0037). The agent then uses that JWT exactly like a human access token — verified by the already-built `BearerJwtAuthenticator` (HS256-pinned). The long-lived secret only ever appears on the rate-limited exchange endpoint.

Pros:
- **Reuses the entire existing access-token path** — one downstream authz path, HS256 pin, `principal_type` already a claim; adding agents is "populate the claim," not a new verify subsystem.
- **Bounded blast radius**: the on-the-wire artefact on 99% of requests is a short-lived JWT; revoking the credential stops *new* tokens immediately, and short TTL bounds the window a live token survives revocation (defense-in-depth) — the same reason human refresh↔access is split.
- The long-lived secret touches only one rate-limited endpoint (mirrors phone-OTP / refresh isolation).
- No per-request `service_credentials` hot-row read.

Cons:
- A revoked credential's already-issued JWT stays valid until it expires (bounded by TTL) — mitigated by short TTL + optional deny-list for emergency kill (below).
- Slightly more moving parts than Option 1 (an exchange service) — but they are existing parts (token service, HMAC, rate-limit).

### Option 3: Per-request signed request (HMAC-SigV4-style, no bearer secret on wire)
The agent HMAC-signs each request with its secret; the server recomputes.

Pros:
- Strongest: no reusable bearer artefact on the wire.

Cons:
- **Custom scheme**, does not reuse the JWT path — a whole new verification subsystem and client burden; contradicts driver 4. Over-engineered for MVP-era agent volume. Rejected.

**Decision:** **Option 2** — human-issued secret exchanged for a short-lived AGENT JWT. `AgentServiceTokenAuthenticator` is **repositioned** from "per-request chain link" to "the verifier behind the exchange endpoint" (an elaboration of ADR-0011 §5, fully compatible: the resulting AGENT JWT flows through the source-agnostic `BearerJwtAuthenticator`, so downstream authz stays single-path and agent-agnostic exactly as ADR-0011 §5 intended). The direct-per-request-secret path (Option 1) is a reserved fallback, not built.

**ЧТО:** An AGENT authenticates by exchanging a long-lived, human-issued `service_credentials` secret for a short-lived AGENT access JWT at `POST /v1/auth/agent/token`; per-request auth is the existing bearer-JWT path.
**ПОЧЕМУ:** A machine needs a live authentication path; a short-lived token off a one-time exchange bounds exposure and reuses the whole existing verified access-token pipeline instead of adding a parallel per-request secret check.
**ПОЧЕМУ ТАК ЛУЧШЕ для проекта:** Maximally cheap forward-compat (ADR-0011 §5's "one authenticator, not a subsystem rewrite" realised as "one exchange endpoint feeding the existing pipeline"); one downstream authz path (defense-in-depth unchanged, HS256 pin inherited); least-privilege blast-radius (short TTL + revocable credential) satisfies ADR-0006 #4; keeps the long-lived secret off the hot path (security). Alternatives rejected: per-request secret (larger wire exposure + recurring hot-row verify); custom HMAC signing (new subsystem, contradicts reuse driver).

---

## §2 — Bootstrap: the first credential is issued by a HUMAN ADMIN (no chicken-and-egg)

The chicken-and-egg ("an agent needs a credential to act, but who creates the first credential?") is resolved by **anchoring the trust root in a human**, which also satisfies the accountability non-negotiable.

**Considered options**

### Option 1: Human-admin issuance (Chosen)
An AGENT is an account (`users` row, `principal_type='AGENT'`, ADR-0011 §4) **created by a human ADMIN**, and its credentials are issued **only** by a human operator via an admin endpoint `POST /v1/admin/agents/{agentUserId}/credentials`. The endpoint returns the plaintext secret **once** (never retrievable again; only `secret_hash` persists). No agent can create an agent account or issue any credential — issuance is a HUMAN-only capability (enforced by [ADR-0037](0037-agent-scoped-ability.md): credential-issuance is never in any AGENT scope, even an admin-scoped one).

Pros:
- **No chicken-and-egg**: the trust root is the existing human-admin, provisioned out-of-band exactly like the platform's first human admin (a pre-existing bootstrap concern, unchanged).
- Directly satisfies ADR-0006 #5 (a human/legal entity is the issuer-of-record and accountable party) and ст.16 ФЗ-152 reconstructability.
- Every credential's authority is traceable to a named human act in `audit_log`.

Cons:
- A human is in the loop to onboard/rotate an agent (acceptable — and correct — for the near-term autonomy phases P-A…P-C).

### Option 2: Seed/env break-glass bootstrap credential
Provision a first credential via migration/env at deploy.

Cons:
- Plaintext-in-config or seed risk; hard to rotate cleanly; **no human actor-of-record** for the credential's existence. Rejected (violates driver 2 + ADR-0011 §5.3 "never plaintext at rest").

### Option 3: Agent self-registration / agent-issues-agent
An agent mints its own or a peer's first credential.

Cons:
- The exact anti-pattern: a non-accountable, non-legal-person minting its own authority. Rejected outright (contradicts ADR-0006 #5). Whether a *future* trusted agent may ever issue peer credentials (P-D) is an owner open-question (§Open questions), defaulted to **NO**.

**Decision:** **Option 1.** The bootstrap chain is: human ADMIN creates the AGENT account → human ADMIN issues a credential (audited) → agent exchanges it for a JWT (§1) → agent may act **only** within its ADR-0037 scope **and** only where the per-domain `agent_<domain>` autonomy toggle is on. Issuance is a HUMAN-only capability, permanently in MVP/near-term.

**ЧТО:** The first (and every) agent credential is issued by a human ADMIN through `POST /v1/admin/agents/{agentUserId}/credentials`, returning the plaintext secret once; agents can never issue credentials.
**ПОЧЕМУ:** The credential's authority must terminate in an accountable human; a self-bootstrapping or config-seeded credential breaks accountability and reconstructability.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Resolves the chicken-and-egg by reusing the pre-existing human-admin trust root (no new bootstrap surface); makes every agent's power traceable to a named human act (ADR-0006 #5, ст.16 ФЗ-152); keeps the P-D "fully-autonomous issuance" question explicitly owner-gated rather than silently enabled. Alternatives rejected: env/seed credential (plaintext + no human-of-record); agent self-issuance (non-accountable authority-minting).

---

## §3 — Credential format and hashing/verification (reuse platform crypto)

**Decision (normative):**
1. **Secret shape.** A credential secret is a machine-generated **256-bit** random value, rendered as a prefixed, self-identifying token: `zlk_agent_<credId>_<secret>` (analogous to GitHub PAT `ghp_…`). The `credId` segment = the `service_credentials.id`, so verification is an **O(1) lookup by id** (not a table scan), and the fixed `zlk_agent_` prefix lets a secret-scanner / leak-detector recognise the token type in logs and repos.
2. **At rest.** Store **only** `secret_hash = HMAC-SHA256(secret, AGENT_SERVICE_SIGNING_SECRET)` — reusing the env secret ADR-0011 §5.2 already reserved (≥32, boot-validated) and the HMAC keyed-hash primitive already in `CryptoService` (the blind-index construction, migration 0028). No plaintext, ever (ADR-0011 §5.3).
3. **Verify.** At exchange (§1): parse `credId` → load the row (`is_active AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`) → **constant-time compare** recomputed HMAC vs stored `secret_hash`. Any miss mode (unknown id / inactive / revoked / expired / mismatch) returns **one uniform 401** (no existence/timing oracle — the same discipline as the claim-code single-uniform-422 in transfer).
4. **Rate-limit.** The exchange endpoint is per-`credId` and per-IP Redis rate-limited (429 + Retry-After), mirroring transfer claim-mint — throttles brute-force and credential-stuffing.

Why HMAC-with-the-reserved-env-secret rather than a slow password hash (argon2/bcrypt): a service secret is **full 256-bit entropy** (machine-generated, not a human password), so a memory-hard KDF buys nothing against brute-force and only adds latency to the exchange. A keyed HMAC additionally means a stolen DB alone (without the env secret) cannot verify any credential — a defense-in-depth property a plain salted hash lacks. (Rejected alternative: argon2id — appropriate only for low-entropy human secrets; unnecessary cost here.)

**ЧТО:** Prefixed self-identifying 256-bit secret (`zlk_agent_<id>_<secret>`); at rest only `HMAC-SHA256(secret, AGENT_SERVICE_SIGNING_SECRET)`; constant-time verify with a single uniform 401 on any failure; rate-limited exchange.
**ПОЧЕМУ:** A machine credential needs O(1) verifiable, non-oracle, leak-detectable presentation with no plaintext at rest, using primitives the platform already trusts.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Reuses the reserved env secret + existing HMAC/constant-time/rate-limit primitives (driver 4) — no new crypto to review; keyed-hash beats plain hash under DB-only theft; the id-prefix gives O(1) verify + leak scanning; the uniform-401 mirrors the codebase's established no-oracle pattern. Rejected: argon2id (wrong tool for full-entropy machine secrets).

---

## §4 — Rotation and revocation (the 0017 table already supports both)

**Decision (normative):**
- **Rotation** = issue-new-then-revoke-old with a short **overlap window**: insert a new row with `rotated_from = <old id>`, hand the new secret to the agent, then revoke the old (`is_active=false, revoked_at=now()`). The overlap lets the agent swap credentials with no downtime. Rotation is a HUMAN admin action (§2).
- **Revocation** = immediate `is_active=false, revoked_at=now()`. Verification (§3) rejects the credential on the very next exchange. Already-issued JWTs (§1) survive until TTL; for emergency kill (compromised agent) a short-lived JWT-deny-list keyed on `credId`/`jti` may be layered (reuse the refresh-family-revoke pattern) — flagged as an activation-time hardening, not required for the MVP form.
- **Deactivating the agent account** (ADR-0011 §4, `status='DEACTIVATED'`) SHOULD cascade-revoke its live credentials in the same transaction (a deactivated agent must not retain an authenticating credential). `agent_user_id` FK is `ON DELETE RESTRICT` — credentials can never orphan.

**ЧТО:** Rotation = issue-new (`rotated_from` link) + revoke-old with overlap; revocation = immediate `is_active=false`; agent-deactivation cascade-revokes; emergency JWT-deny-list reserved.
**ПОЧЕМУ:** Least-privilege demands that a credential be swappable without downtime and killable instantly; a deactivated agent must lose all authority.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Uses the table's built-in `rotated_from`/`is_active`/`revoked_at` (zero schema change for the core lifecycle); overlap avoids a downtime-forces-a-risky-shortcut failure mode; deactivation-cascade closes the "retired agent still authenticates" hole; satisfies ADR-0006 #4 + ADR-0011 §5.3 (rotatable/revocable) exactly as the form promised.

---

## §5 — Audit trail (issuance is a first-class, human-attributed act)

**Decision (normative):** Every issuance, rotation and revocation writes an `audit_log` row with `actor_id = <the human admin>`, `actor_principal_type = 'HUMAN'` (ADR-0011 §1), `actor_role` snapshot, entity = the `service_credentials` row (`entity_type='service_credential'`, `entity_id`). The plaintext secret is **never** logged (only the `credId`). When the agent later *acts*, those actions snapshot `actor_principal_type='AGENT'` per ADR-0011 §1–§3 — so the full chain "human X issued credential C at T → agent A (authenticated via C) decided D at T′ → human Y overrode D" is reconstructable end-to-end, satisfying ст.16 ФЗ-152 and ADR-0006 #5.

**ЧТО:** Issuance/rotation/revocation are audited as HUMAN acts on the `service_credential` entity; secret never logged; agent actions remain AGENT-snapshotted (ADR-0011).
**ПОЧЕМУ:** The authority-granting act must itself be attributable to the accountable human, closing the audit chain from human-grant → agent-action → human-override.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Completes the ADR-0011 audit spine (which recorded *actions* but not *authority-grants*); gives a regulator the who-authorised-what-when for solely-automated decisions (ст.16); reuses the existing `audit_log` + actor-snapshot with no new mechanism.

---

## §6 — Phase boundary: form/machinery builds now, behaviour gated (issue nothing in MVP)

Per the cost-of-change rule (AUDIT4 §4c #4: cheapest before Admin Slice 2), the **issuance machinery is designed now and implemented as a gated slice**; **no AGENT is active in MVP**.

- **Master gate.** A new `feature_toggles.agent_service_auth` (default **off**, seeded like `payments`/`ownership_transfer_verification`) gates the exchange endpoint: with it off, `POST /v1/auth/agent/token` issues **no** AGENT JWT (403). The admin issuance endpoint MAY create credential rows for pre-provisioning but they authenticate nothing while the master gate is off.
- **Per-domain autonomy gate (unchanged).** What an authenticated agent may *do* stays additionally gated by the existing per-capability `agent_<domain>` toggles (moderation's `agent_moderation` is the reference — `moderation.service.ts:289`) **and** by its ADR-0037 scope. Three independent bounds: master-auth gate → scope (ADR-0037) → per-domain autonomy toggle.
- **MVP truth.** Master gate off, no agent account provisioned, no secret issued, `service_credentials` empty — byte-identical HUMAN behaviour. The slice ships testable machinery, not live agents.

**ЧТО:** Build issuance/exchange/rotation/revoke now behind `feature_toggles.agent_service_auth` (default off); per-domain `agent_<domain>` toggles + ADR-0037 scope remain the downstream bounds; MVP issues nothing.
**ПОЧЕМУ:** The machinery is cheapest to lay before human-only admin assumptions harden, but must not change MVP behaviour or expose an untested agent-auth surface.
**ПОЧЕМУ ТАК ЛУЧШЕ:** Mirrors the platform's proven form-now/behaviour-gated pattern (payments toggle, moderation agent-toggle, migration 0034 dormant junction) — testable, reversible, zero MVP behaviour change; three independent gates give a graduated, killable rollout (auth → scope → per-domain autonomy) matching ADR-0006's phased P-A…P-D.

---

## §7 — Schema extension — REALISED in migration 0038 (was: «PROPOSED sketch only, this ADR writes no migration»)

> **STATUS CORRECTED 2026-08-09.** The heading said this ADR writes no migration, while the columns had
> ALREADY landed: `service_credentials.issued_by`, `.last_used_at`, `.expires_at` (see the canon's own
> comment «ADR-0036 §7 (migration 0038)» beside them). The risk was concrete, not cosmetic: the next
> engineer, reading the heading literally, would write a DUPLICATE migration for the same objects. The
> code knew the decision had landed; the document did not — the same class as a contract that kept
> advertising an old cookie Path after the code moved. Addressed by CONSTRAINT/COLUMN NAMES below rather
> than line numbers, because line anchors rot silently.

The 0017 table already carries the core lifecycle (`secret_hash`, `is_active`, `revoked_at`, `rotated_from`, FK RESTRICT). The following **additive, nullable, idempotent** columns are needed for accountability-of-record and operability. Backend-engineer implements them in the agent-auth slice per `IMPLEMENTATION_PLAYBOOK.md §3` (edit `database_schema.sql` + new idempotent migration `migrations/YYYYMMDD_NNNN_*.sql` + `ZooLink_ERD.mmd` + `data-model.md` + table-count in both `CLAUDE.md`; run twice on live PG; negative tests; `npm run db:sync`).

```sql
-- Accountable human issuer-of-record on the credential row (ADR-0006 #5), not only via audit_log join.
ALTER TABLE service_credentials
  ADD COLUMN IF NOT EXISTS issued_by UUID REFERENCES users(id) ON DELETE RESTRICT;
-- Operability: detect stale/unused credentials (defense-in-depth; best-effort, never on the hot path).
ALTER TABLE service_credentials
  ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP WITH TIME ZONE;
-- Optional time-boxing: NULL = no expiry; set = credential auto-expires (verify checks it, §3).
ALTER TABLE service_credentials
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
```

- `scope` (the least-privilege ability grant the exchange embeds in the AGENT JWT) is **deliberately NOT added here** — it is owned by [ADR-0037](0037-agent-scoped-ability.md), which decides whether scope lives on the credential row or in a named capability-profile table. §1's exchange reads whatever ADR-0037 defines and embeds it as a JWT claim.
- All three columns are additive/nullable → **N-1 rolling-deploy safe** (old pods that ignore them still `INSERT` fine — heeds AUDIT4 P1-5).
- Table count unchanged (columns only, +0 tables). `expires_at`/`last_used_at` are recommended-but-optional defense-in-depth; `issued_by` is required for the accountability non-negotiable.

---

## Consequences

### Positive
- The North-Star's single structural auth-blocker is removed: a machine can obtain, present, rotate and lose credentials; every otherwise-READY domain (moderation) becomes genuinely agent-operable once its per-domain gate + scope are on.
- The credential's authority is always traceable to an accountable human act (ADR-0006 #5, ст.16 ФЗ-152) — the issuance half of the audit chain ADR-0011 began.
- Reuses the entire existing verified access-token / HMAC / rate-limit / audit machinery — minimal new attack surface, one authz path.
- Bounded blast radius (short-lived JWT + instantly-revocable credential + deactivation-cascade); graduated three-gate rollout.

### Negative
- A revoked credential's already-issued JWT survives until TTL (bounded; emergency deny-list reserved).
- A human remains in the credential-onboarding loop (correct for P-A…P-C; the P-D "agent issues agent" question is deferred, not solved).
- One small additive migration (§7) beyond the 0017 form.

### Neutral
- MVP behaviour unchanged: master gate off, `service_credentials` empty, no agent JWT issued — HUMAN-only, byte-identical.
- The exact JWT scope claim is defined by ADR-0037; this ADR fixes only issuance & authentication.

## Open questions — RESOLVED by the owner (2026-07-09, section-by-section review; each recommendation confirmed)
1. **[owner/North-Star] May a future trusted agent ever issue credentials to another agent (P-D fully-autonomous onboarding)?** Recommendation: **NO** for the foreseeable term — the trust root stays human (issuance permanently HUMAN-only), even under P-D, because an agent minting agent-authority breaks the accountable-legal-person chain (ADR-0006 #5). Revisit only with legal sign-off. **Owner decision 2026-07-09: NO — issuance stays HUMAN-only permanently; revisit only with legal sign-off.**
2. **[owner/security] Default credential TTL / `expires_at` policy at activation.** Security prefers short-lived, auto-expiring credentials + periodic rotation; ops prefers long-lived to avoid churn. Recommendation: `expires_at` optional now (form), with a max default (e.g. 90 days) enforced when the master gate flips — to be set with security/devops at activation. **Owner decision 2026-07-09: as recommended — form now, ~90-day max default fixed with security/devops at activation.**
3. **[design, minor] Emergency JWT kill** — layer a short `credId`/`jti` deny-list for compromised-agent revocation-before-TTL? Recommendation: reserve now, implement at activation (reuse refresh-family-revoke). **Owner decision 2026-07-09: reserve now, build at activation.**

## Related Decisions
- [ADR-0011](0011-agent-principal-actor-model.md) — refines §5 (concrete credential-presentation/issuance/bootstrap/verification form); does not supersede.
- [ADR-0006](0006-ai-agents-operate-platform.md) — realises non-negotiables #4 (scoped credentials) and #5 (accountable human).
- [ADR-0037](0037-agent-scoped-ability.md) — companion; defines the scope the issued JWT carries (deny-by-default, no `manage:all`). Neither alone unblocks the North-Star.
- [ADR-0009](0009-mvp-vs-target-architecture.md) — issuance stays in-monolith.
- [ADR-0016](0016-provider-model.md) — `provider_kind` may be `AGENT`; an agent-provider still authenticates via this issuance path.

## References
- `AUDIT4_HARDENING.md` §4a (agent-runnability scorecard — agent-auth bootstrap BLOCKED), §6 (ADR track P1-6/NS).
- `AUDIT4/architect.md` (anti-North-Star debt #1: agent-auth bootstrap stub → pull forward), `AUDIT4/security.md` §STRATEGIC.
- `database_schema.sql:1187-1208` (`service_credentials`, migration 0017), `feature_toggles` (:651).
- `backend/src/lib/auth/agent-service-token.authenticator.ts` (the stub), `request-authenticator.ts`, `bearer-jwt.authenticator.ts`, `principal.ts` (`AccessTokenClaims.principal_type`), `modules/auth/token.service.ts` (HS256-pinned verify), `lib/crypto/*` (HMAC blind-index, migration 0028).
- `docs/specs/security/rbac-matrix.md` (agent-principal & service-auth form narrative).
- `IMPLEMENTATION_PLAYBOOK.md §3` (DB-workflow), §5 (phase-boundary / rewrite test).
