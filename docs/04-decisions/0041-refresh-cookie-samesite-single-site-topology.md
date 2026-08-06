# ADR-0041: Refresh-cookie `SameSite=Strict` binds ZooLink to a single-site edge topology (a cross-site SPA would require revisiting)

**Status**: Accepted (owner-gated via the F1 deploy-pack; keep Strict now — do not weaken preemptively)
**Date**: 2026-08-06
**Builds on**: [ADR-0009](0009-mvp-vs-target-architecture.md) (single public edge — Caddy serves the SPA and the API from the same origin, so the session is same-site by construction), [ADR-0019](0019-pii-at-rest-form-enforcement.md) (the refresh cookie is the HttpOnly transport that keeps the long-lived credential out of page JS).
**Related**: AUDIT5 `frontend-engineer.md` §3 Б-2/Б-3 and §7.2 (the finding that surfaced this coupling); the F1a base-path pack (`config/api-base.ts` single source — the cookie `Path` is derived from the public base `/api/v1`, so it now matches the browser path; `refresh-cookie.ts`).

---

## Context and Problem Statement

The refresh-token transport is an `HttpOnly; Secure; SameSite=Strict` cookie scoped to `Path=/api/v1/auth`
(`backend/src/modules/auth/refresh-cookie.ts`). The `SameSite=Strict` attribute means the browser attaches
the cookie **only to same-site requests** — a request whose top-level site (registrable domain / eTLD+1)
matches the cookie's. This is the strongest CSRF posture available to a cookie: a cross-site page cannot
cause the refresh cookie to ride along.

Under [ADR-0009](0009-mvp-vs-target-architecture.md) this is exactly right and costs nothing: **one** Caddy
serves both the SPA build (`/srv/www`) and the API (`/api/*`) from the **same origin**, so every request
the SPA makes to `/api/v1/auth/refresh` is same-origin → same-site → the cookie flows, with maximal CSRF
resistance and no CORS needed.

The problem is that this correctness is **load-bearing on the topology and nowhere written down**. `Strict`
**silently fixes** ZooLink to a single-site front-end deployment. The choice lives in one constant; a future
decision to host the SPA elsewhere would collide with it in a way that is invisible until a browser fails in
production (the same class of gap that produced the C1 base-path drift — a truth that lived only in code).
This ADR makes the coupling explicit and records the position, so the trade is a decision, not an accident.

Precisely where the coupling bites (SameSite is about *site*, not *origin* — this distinction matters):

- **Same-origin (ADR-0009 today):** SPA and API on the identical origin. `Strict` sends the cookie. ✅ No CORS.
- **Same-site, cross-origin subdomain split** (e.g. `app.zoolink.ru` calling `api.zoolink.ru` — same
  registrable domain `zoolink.ru`): still **same-site**, so `Strict` **still sends** the cookie on the
  cross-origin `fetch`. What this split *does* require is the **CORS** allowlist (exact origin +
  `credentials: true`), which is already seamed (`CORS_ORIGINS` env + `enableCors` in `main.ts`). No
  SameSite change is needed. ⚠ CORS only.
- **Cross-site SPA** (a different registrable domain, or a cross-site static host / CDN — e.g. the SPA on
  `zoolink.app` or a third-party CDN domain calling `zoolink.ru`): now **cross-site**, and `SameSite=Strict`
  **blocks** the refresh cookie on that request. The session cannot be refreshed → silent re-login. This is
  the topology `Strict` forbids. 🚫

## Decision Drivers

1. **CSRF resistance is a security floor, not a convenience (security_specification.md).** `Strict` is the
   strongest same-site posture; weakening it (`Lax`/`None`) trades away CSRF defence and must be *earned* by
   a concrete topology need, never done preemptively "to keep options open".
2. **ADR-0009 is the accepted topology and it is same-origin.** Today there is zero cost to `Strict` — the
   session is same-site by construction. We optimise for the decided reality, not a hypothetical.
3. **Make hidden couplings explicit (the C1 lesson).** A correctness that depends on the topology and lives
   only in a cookie attribute is a second truth waiting to drift. Record it.
4. **Cheapest to reason about before the front-end phase opens.** The SPA does not exist yet; naming the
   constraint now costs a paragraph, discovering it later costs a lost production day (frontend-engineer Б-2).

## Considered Options

### Option 1: Keep `SameSite=Strict`; record the single-site coupling; revisit only if the SPA goes cross-site
Keep the current attribute. Document that `Strict` presupposes a single-site (same registrable domain) front
end, which ADR-0009 guarantees. Any move to a cross-site SPA host reopens this ADR.

Pros:
- Maximal CSRF resistance, matching the accepted same-origin edge (ADR-0009).
- Zero behaviour change; nothing to build; no new attack surface.
- The coupling is now written down, so the future move cannot silently break sessions.

Cons:
- A future cross-site front end is a **blocked** path until this ADR is revisited (by design — that is the point).

### Option 2: Pre-emptively relax to `SameSite=Lax` (or `None; Secure`) now, to keep hosting options open
Weaken the attribute today so a future cross-site SPA "just works".

Pros:
- A later cross-site move needs no cookie change.

Cons:
- **Trades away CSRF defence with no current beneficiary** — the SPA does not exist and ADR-0009 is same-origin.
- `None` additionally *requires* cross-site delivery semantics and broader exposure; `Lax` still would not
  carry the cookie on cross-site *sub-resource* requests (the `fetch` that refresh uses), so it would not even
  solve the cross-site case cleanly — it would weaken security **and** not fully fix the hypothetical.
- Violates "earn the weakening" (driver 1) and fail-safe defaults.

## Decision

**Take Option 1.** Keep the refresh cookie at `HttpOnly; Secure; SameSite=Strict`. Record here that this
attribute **binds the front end to a single-site (same registrable domain) topology**, which
[ADR-0009](0009-mvp-vs-target-architecture.md) provides. **Do not weaken it preemptively.**

Before hosting the SPA on any **cross-site** origin (a different registrable domain, or a cross-site
static/CDN host), this ADR **must be revisited** — the revisit would relax `SameSite` to `Lax` or
`None; Secure`, **and** add a compensating CSRF defence (e.g. a double-submit / origin-checked CSRF token on
the refresh route), because relaxing SameSite removes the structural CSRF guard the cookie relies on today.
A **same-site subdomain split** does **not** need this ADR — it needs only the already-seamed `CORS_ORIGINS`
allowlist.

## Consequences

### Positive
- The session keeps the strongest CSRF posture for the accepted (same-origin) topology, at no cost.
- The topology coupling is explicit: the next front-end-hosting decision is forced to consult this ADR
  instead of discovering the constraint via a production session failure.
- Pairs cleanly with the F1a base-path fix: the cookie `Path` is now derived from the single public-base
  source (`config/api-base.ts` → `/api/v1/auth`), so set and clear match the browser's public path.

### Negative / accepted limitations
- A cross-site front end is a gated path (must reopen this ADR + add CSRF defence). This is intended — the
  gate exists so the security trade is deliberate.
- The distinction "same-site subdomain (CORS only) vs cross-site (SameSite too)" must be respected when the
  front-end topology is chosen; it is documented above to prevent an over-broad "relax the cookie" reflex.

### Neutral
- No code or schema change is required by this ADR; it records the position around the existing attribute.
