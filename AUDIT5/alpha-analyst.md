# AUDIT5 · alpha-analyst — lane КОНТРАКТ ↔ КОД

**Date:** 2026-08-04 · **Repo:** `/home/asulimenko/Project/workspace/ZooLink` · **Branch:** `backend` · **HEAD:** `c44874c`
**Lane:** documentation-is-the-contract / truth-hierarchy. Contract surface (13 OpenAPI files + API_CONVENTIONS + specs + event-catalog + ADRs) vs the built backend.
**Method:** **generated worklist, not handwritten.** Every inventory below is produced by a script over the repo, then reconciled machine-side; divergences are reported **by name**, never as a bare count. Scripts live in the session scratchpad (`gen_contract.py`, `gen_code.py`, `reconcile.py`, `roles_invariant.py`, `errcodes.py`, `dupkeys.py`) — they are re-runnable and each prints its own scanned load.
**Boundaries honoured:** only this file written; nothing committed; no tests run; no DB writes.

---

## 0. What this lane will NOT see (declared before the findings)

Read every number below inside these walls.

1. **Runtime behaviour.** I ran nothing. Every "code does X" is *read* from source, not observed. A route that exists in a decorator but is unreachable at runtime (module not imported into `AppModule`, guard short-circuit) reads as PRESENT to me. **I did not verify module wiring** — `@Controller` presence is my evidence, not `app.getHttpServer()`.
2. **Semantic correctness of business rules.** I check *whether* the contract and the code say the same thing, not whether what they say is right for the business. A rule wrong in both places passes this lane silently.
3. **Anything outside the 13 `docs/03-architecture/api-contracts/*.yaml` + the specs/ADRs I name.** GraphQL, internal service interfaces, the worker's non-HTTP surface, DB-level contracts beyond the three reputation tables I traced.
4. **RU prose fidelity.** I machine-compared EN↔RU *operation sets* and *error-code presence*. I did **not** read the RU prose for meaning — a RU mirror can be structurally identical and semantically wrong, and this lane would call it green.
5. **My own two heuristics are fallible, and one of them mis-fired.** (a) Route extraction is regex over TypeScript, not the TS AST — a route built by an unusual decorator composition would be invisible. I mitigated by scanning **all 176 non-spec `.ts` files**, not just `*.controller.ts`, and by eyeballing the full 83-row output against the source. (b) The `x-required-roles` **textual** pass produced 6 candidates that are all false positives (§4) — I adjudicated them by reading, and report the structural pass as the answer. A number I had not adjudicated would have been a lie.
6. **Path-parameter *names* are normalised away** in the reconciliation (`{listingId}` ≡ `:id`). So a contract/code disagreement about what a path param is *called* is invisible here by construction. This was deliberate — the alternative produces false gaps — but it is a blind spot.
7. **Deferred-by-design vs broken is a judgement call.** I separate the two using explicit markers in the docs ("reserved", "deferred", "gated", `deprecated: true`). Where a doc carries **no** marker I treat the item as claimed-live — that is the reading a developer or an agent would take, and finding **M7** exists only because of that reading.
8. **Not my lane (routed, not adjudicated):** whether an access-control gap is exploitable (→ security), whether a schema shape is the right one (→ architect), test adequacy (→ reviewer-qa), deployment topology health (→ devops). **C1 below sits on the devops boundary — I report it because it is literally a contract↔code divergence, and I flag it for devops rather than claiming its operational verdict.**

---

## 1. Top findings

| # | Sev | Antaraya | Where | One line |
|---|---|---|---|---|
| **C1** | **CRITICAL** | `бхранти-даршана` (авивека: набор меряет приложение, а не развёрнутый путь) | `deploy/Caddyfile:17` · `backend/src/main.ts:38-39` · `API_CONVENTIONS.md:22` | Contract base is `/api/v1`, the app serves `/v1`, and the proxy's `handle` does **not** strip `/api` → **all 124 documented operations 404 in the deployed topology**; e2e hits `/v1` directly and stays green. |
| **M1** | MAJOR | `прамада` (знал и не записал — сам поставил константу) | `saved-search-match.consumer.ts:11,91-97` ↔ `docs/specs/07-geo-search-service.md:229,239` | A hard **500-match fan-out cap silently truncates** saved-search alerts, while spec 07 SS-M1 states matching is unconditional and the H4 note explicitly says a cap is *deliberately NOT built*. |
| **M2** | MAJOR | `анавастхитатва` (починка не удержалась по документу) | `docs/specs/18-reputation.md:254,256,270,272,309,310,312,370` ↔ `migrations/20260710_0039_confirmed_sales.sql:93` | Spec 18's **normative** guards/Gherkin/NFR reference `confirm_expires_at`; the shipped column is `expires_at`. §10 recorded other pins but not this rename. |
| **M3** | MAJOR | `бхранти-даршана` (ограничение делает не то, что говорит его же комментарий) | `migrations/20260710_0039_confirmed_sales.sql:109-111` ↔ `docs/specs/18-reputation.md:262` | `uq_confirmed_sales_transfer UNIQUE(ownership_transfer_id)` enforces *one sale per transfer **ever***; §4 states `CANCELLED → [*]: terminal (a new sale record may be created)` — structurally impossible on the TRANSFER anchor. |
| **M4** | MAJOR | `бхранти-даршана` (валидатор объявляет представление, меряет состояние ящика) | `notification-read.service.ts:70-77` | `GET /me/notifications` ETag is keyed on `(userId, total, max(updated_at of the returned page))` — **not on `page`/`limit`** → `?limit=20` and `?limit=5` yield an **identical ETag for different bodies**; a conditional GET returns 304 for the wrong representation. |
| **M5** | MAJOR | `прамада` (правило записано в конвенциях, в него не посмотрели) | `agent-credential.service.ts:151,203,216,228` ↔ `API_CONVENTIONS.md:69-70` | 4 new agent-auth business error codes (`AGENT_AUTH_DISABLED`, `ISSUANCE_HUMAN_ONLY`, `TARGET_NOT_AGENT`, `CAPABILITY_PROFILE_NOT_FOUND`) appear in **zero** doc files, violating the normative "domain-specific codes are listed in each domain spec" rule. 13 undocumented codes total. |
| **M6** | MAJOR | `стьяна` (объявление есть, механизма нет) | `API_CONVENTIONS.md:71` | The normative "every operation documents at least 400,401,403,404,500" rule is violated by **89 of 115 live operations**. Declared for months, never gated — and as written it is unsatisfiable for collection GETs. |
| **M7** | MAJOR | `стьяна` (каталог объявляет продюсера, кода нет) | `docs/specs/event-catalog.md:46,50,52,53,54,55` | 6 events are catalogued **with a named live producer and no deferred marker** yet are emitted **nowhere** in `src`: `Listing.Submitted`, `Listing.Expired`, `Listing.Deactivated`, `User.Registered`, `ContentReport.Filed`, `ContentReport.Actioned`. |
| **m1** | MINOR | `анавастхитатва` | `docs/specs/18-reputation.md:483` vs `:458` | §10 item 5 says polymorphic `offering_type` is on `confirmed_sales`**/`reviews`**; §10 item 2 (same section) says reviews deliberately has none. The DDL has none. Item 5 was left behind. |
| **m2** | MINOR | `бхранти-даршана` (гарантия объявлена, не обеспечена) | `saved-search-match.consumer.ts:291-298` ↔ `07-geo-search-service.md:230` | SS-M2 claims "a `q` never substring-matches across two different fields" because the text is newline-joined — but `q` is `@IsString() @MaxLength(200)` with **no newline restriction**, so a `q` containing `\n` spans the boundary. |
| **m3** | MINOR | `стьяна` | `docs/specs/18-reputation.md:233-243` | Spec 18 §3.4 declares 6 reputation endpoints with "shape reserved now" — **zero** of them appear in any of the 13 contracts, and `POST /listings/{id}/mark-sold` is not extended with the buyer nomination §3.4 says extends it. |
| **m4** | MINOR | `самшая` (два словаря на одно состояние) | `docs/specs/18-reputation.md:277` ↔ `migrations/…0040…:103,122-123` | §4's review lifecycle names states `ELIGIBLE → SUBMITTED → APPROVED`; the shipped `chk_reviews_moderation_status` permits `PENDING, APPROVED, REJECTED, CHANGES_REQUESTED`. `SUBMITTED` is unrepresentable; `REJECTED`/`CHANGES_REQUESTED` are unnamed by the state machine. |
| **m5** | MINOR | `анавастхитатва` | `docs/specs/statemachines/notification_state_machine.md:43` | The new IN_APP lane names `NotificationConsumer` as *the* materialiser; `SavedSearchMatchConsumer` (H4) also materialises IN_APP rows and is absent from the lane. |
| **i1** | INFO | `бхранти-даршана` | `notification-api.yaml:119` | The WHY-BETTER prose justifies the design as "exactly like `GET /favorites`" (own-scope + PageMeta + **ETag**) — `GET /favorites` emits **no ETag**, in code or in `favorites-api.yaml`. A cited precedent that does not exist. |
| **i2** | INFO | `прамада` | `docs/specs/event-catalog.md:72` | Stale note still asserts the notification registry "is an allow-list of `OwnershipTransfer.*`"; the built registry also routes `Moderation.Decided` (`notification.registry.ts:55`). AUDIT4 F1 residual. |
| **i3** | INFO | `бхранти-даршана` | `event-catalog.md:81` ↔ `notification.consumer.ts:10` | Catalog §3 assigns `Moderation.Decided` the channel **email**; the code writes it as **IN_APP**. AUDIT4 F1 residual, unchanged. |

---

## 2. Generated inventory — the load behind every number

### 2.1 Contract side
`gen_contract.py` parses all 13 EN OpenAPI files and enumerates every `paths.<p>.<method>`.

```
contract files scanned: 13     contract operations: 124   (deprecated: 9)
  admin-api.yaml 17 (6 dep) · animals-api 8 · auth-api 22 · branch-api 5 · favorites-api 3
  geo-search-api 5 (2 dep) · listings-api 14 (1 dep) · matching-api 5 · moderation-api 13
  notification-api 7 · organization-api 13 · payment-api 5 · transfers-api 7
```

**Trust check on that 124.** `yaml.safe_load` keeps only the **last** of duplicate keys — an operation could vanish from my inventory with no trace, and commit `950a7c9` says duplicate keys were recently repaired in `auth-api.yaml`. I therefore ran an explicit duplicate-key detector over **all 26 EN+RU contract files**: `no duplicate keys in any api-contract yaml`. The 124 is safe to build on.

### 2.2 Code side
`gen_code.py` scans **every** non-spec `.ts` under `backend/src` (not just `*.controller.ts`) for `@Controller` blocks and their `@Get/@Post/@Put/@Patch/@Delete/@Head/@Options/@All` decorators, resolving the controller prefix (both string and `{path, version}` object forms).

```
ts files with @Controller: 20     routes found: 83
```
Sample rows (full 83 verified by eye against source):
```
POST   /auth/agent/token                          agent-token.controller.ts:20   AgentTokenController.exchange
GET    /me/notifications                          notification.controller.ts:34  NotificationController.list
POST   /admin/agents/:agentUserId/credentials     admin-agent-credential.controller.ts:36
GET    /saved-searches                            saved-search.controller.ts:45
POST   /me                                        me.controller.ts:48            MeController.deactivate
```

### 2.3 The reconciliation (two counters, both by name)

Path params normalised positionally (`{listingId}` → `{}`, `:id` → `{}`), so param-name choices never create a false gap. 124 operations collapse to **121 unique routes** — the 3 collisions are all `admin-api.yaml`'s deprecated duplicates against the live `moderation-api.yaml` originals, which is the intended supersession shape:

```
GET  /moderation/queue        admin-api getModerationQueue [deprecated]  ↔  moderation-api getModerationQueue
GET  /moderation/listing/{}   admin-api getListingForModeration [dep]    ↔  moderation-api getModerationListing
POST /moderation/action       admin-api performModerationAction [dep]    ↔  moderation-api submitModerationAction
```

```
MATCHED: 80 of 83 code routes
CONTRACT WITHOUT CODE: 41  (35 live · 6 deprecated-by-design)
CODE WITHOUT CONTRACT: 3
```

**Counter A — contract without code (35 live), by name.** These cluster cleanly into four unbuilt domains, which is consistent with the declared phase, not scattered drift:

| Domain | Operations (all live in contract, absent from `src`) |
|---|---|
| organization (10) | `GET/POST /organizations` · `GET/PATCH/DELETE /organizations/{}` · `GET /organizations/{}/analytics` · `GET/POST /organizations/{}/branches` · `GET/POST /organizations/{}/users` · `GET/PATCH/DELETE /organization-users/{}` |
| branch (5) | `GET/POST /branches` · `GET/PATCH/DELETE /branches/{}` |
| matching (5) | `GET /matching/history` · `GET /matching/new-target/{}` · `GET /matching/{}` · `POST /matching/find-matches` · `POST /matching/{}/feedback` |
| payment (5) | `GET/POST /payments` · `GET /payments/{}` · `POST /payments/webhook` · `POST /payments/{}/refund` |
| notification residue (5) | `GET/PATCH /me/notification-preferences` · `GET /notifications/logs` · `GET/POST /notifications/templates` · `POST /notifications/webhook` |

Payment is legitimately gated (`feature_toggles.payments`). Organization/branch/matching are unbuilt domains. The **notification residue is the interesting one**: Slice H3 built `GET /me/notifications` but left five sibling operations in the same file contract-only — including `GET/PATCH /me/notification-preferences`, which the code *depends on the existence of* conceptually (ADR-0021 §3 reasons about `notification_prefs` being ignored) yet no endpoint lets a user see or set them.

**Counter B — code without contract (3), by name.** `GET /health/live` (`health.controller.ts:19`), `GET /health/ready` (`:25`), `GET /metrics` (`metrics.controller.ts:18`). All three are operational surfaces documented outside the API contract layer (`docs/06-operations/deployment.md`, `docs/02-requirements/nfr/observability.md`, `docs/specs/deployment/deployment_specification.md`) and deliberately opt out of `/v1` versioning. **Not a defect** — and worth stating plainly: **the July wave introduced zero undocumented endpoints.** Every one of the 8 new routes (4 agent-auth, 1 notifications, 3 saved-search) has a contract operation.

### 2.4 EN↔RU operation parity
```
EN operations: 124   RU operations: 124
EN-only (missing from RU): 0     RU-only (stale in RU): 0
```
Structurally perfect (see blind spot #4 — prose fidelity unchecked).

---

## 3. C1 — the base path: every documented operation is unreachable as deployed

`[CRITICAL][contract-first][NEW]` — antaraya `бхранти-даршана` (авивека: зелёный e2e меряет приложение, а не путь, по которому придёт клиент)

Three artefacts, three different answers to "what URL is a ZooLink endpoint":

- **`API_CONVENTIONS.md:22`** — *"All endpoints under `/api/v1`. … `servers: [{ url: /api/v1 }]`"*. All **26** contract files (13 EN + 13 RU) carry `- url: /api/v1`.
- **`backend/src/main.ts:38-39`** — `app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })` and **no `setGlobalPrefix`** anywhere in `src` (grep: zero hits). The app serves `/v1/*`.
- **`deploy/Caddyfile:17`** —
  ```
  handle /api/* {
      reverse_proxy api:3000
  }
  ```
  In Caddy v2, `handle` passes the **full** path through; `handle_path` is the prefix-stripping directive. `handle_path` appears nowhere in `deploy/` (grep: zero hits).

So a client generated from the contracts calls `https://<domain>/api/v1/listings` → Caddy matches → forwards `/api/v1/listings` verbatim → NestJS has no such route → **404**. This holds for all 124 operations.

**Why it has stayed invisible:** every e2e spec addresses the app directly at `/v1/...` (e.g. `test/admin-system-settings.e2e-spec.ts:35,84,88`), bypassing the proxy entirely. The suite is green and measures a path no external client will ever use. That is the taxonomy's `бхранти-даршана` in its exact form — *замер мерит не то, что объявляет*.

**Fix (one line, but the choice is architectural — route to architect + devops, do not pick silently):**
either (a) `handle_path /api/*` in the Caddyfile — the contract stays the source of truth, or (b) `app.setGlobalPrefix('api')` in `main.ts` so the app itself serves `/api/v1` (then the e2e suite must move to `/api/v1` or it keeps lying), or (c) supersede `API_CONVENTIONS.md:22` to `/v1` and rewrite `servers:` in all 26 files. **(a) is the smallest change consistent with truth-hierarchy** (the contract is above the code), but it leaves `/health/*` correctly unprefixed only by accident of a separate `handle` block.
**Probe:** `curl -sf https://<domain>/api/v1/listings` must return 200/401, not 404. No such probe exists today.

---

## 4. `x-required-roles` invariant — `USER ⟹ {VETERINARIAN, GROOMER}`

Round-9 additive-model closure, `rbac-matrix.md:90`, swept for post-`056617b` violations.

**Structural pass** — YAML-parsed every operation carrying `x-required-roles` across **EN and RU** contract dirs:

```
x-required-roles declarations scanned: 214 (EN+RU yaml operations)
VIOLATIONS: 0
```

**Verdict: the sweep is complete. Zero violations, named or otherwise.** Sample of conforming declarations across the July wave:
`geo-search-api.yaml POST /saved-searches` → `[USER, BREEDER, FARMER, VETERINARIAN, GROOMER, MODERATOR, ADMIN]`; `notification-api.yaml GET /me/notifications` → same 7; `auth-api.yaml POST /me/erase` → same 7.

**The invariant also holds in code**, which the brief did not ask for but is the half that actually gates a request. All 13 USER-bearing `@Roles(...)` sites resolve to lists containing both:
`ALL_ROLES` (`transfer.controller.ts:32`), `NOTIFICATION_ROLES` (`notification.controller.ts:18`), `SAVED_SEARCH_ROLES` (`saved-search.controller.ts:32`), `FAVORITE_ROLES` (`favorite.controller.ts:28`), `REVEAL_ROLES`/`ANALYTICS_ROLES` (`listing.controller.ts:42,44`), `WRITE_ROLES` (`listing.controller.ts:40` — `[USER,BREEDER,FARMER,VETERINARIAN,GROOMER,ADMIN]`), plus literal lists at `animal.controller.ts:38`, `content-report.controller.ts:43,58,68`, `moderation.controller.ts:107`. **0 violations in code.**

**Honest disclosure of my own mis-measurement.** A second, textual pass (raw grep of the literal key across 46 `.md` lines in `docs/` + `docsRU/`) reported **6 candidates**. I read all six; **all six are false positives** — prose lines that merely mention the key and happen to contain the token `USER`:

| Candidate | Why it is not a violation |
|---|---|
| `docs/specs/security/rbac-matrix.md:92` + `docsRU/…:91` | This is **the rule's own statement**: *"for any operation whose `x-required-roles` array contains `USER`…"*. My regex read the rule as an instance of what it forbids. |
| `docs/specs/12-moderation-domain.md:293` + `docsRU/…:294` | M-11 prose: *"a USER (or unauthenticated) hits any operator endpoint"* — a trigger description, not a roles array. |
| `docs/specs/12-moderation-domain.md:344` + `docsRU/…:345` | CR-6 prose: *"a USER (incl. the reporter) PATCHes a report"* — same shape. |

Reporting "6 violations" would have been the `аласья` failure the taxonomy names (счёт вместо имён). **The answer is 0 of 214.**

---

## 5. Deep dive — agent-auth (ADR-0036 / ADR-0037)

### 5.1 DTO ↔ schema — conformant
Field-by-field, `dto/agent-auth.dto.ts` matches `auth-api.yaml`:

| Contract schema | Code | Verdict |
|---|---|---|
| `IssueCredentialRequest {label ≤120, capabilityProfileId int, expiresAt date-time}` (`:833-847`) | `IssueCredentialDto` `@MaxLength(120)` / `@IsInt @IsPositive` / `@IsISO8601` (`:16-33`) | ✅ exact, incl. all-optional |
| `RotateCredentialRequest` (`:848-854`) | `RotateCredentialDto` (`:40-54`) | ✅ |
| `AgentTokenExchangeRequest {credential}` required (`:869-875`) | `AgentTokenExchangeDto` `@IsString @IsNotEmpty` (`:57-61`) | ✅ |
| `CredentialIssuedResponse` required `[id, agentUserId, secret, capabilityProfileId, expiresAt, rotatedFrom, createdAt]` (`:855-868`) | `CredentialIssuedView` — same 7 fields (`:67-76`) | ✅ |
| `AgentAccessTokenResponse {accessToken, tokenType: enum[Bearer]}` (`:876-886`) | `AgentAccessTokenView` `tokenType: 'Bearer'` literal (`:79-82`) | ✅ |

### 5.2 The `zlk_agent_…` format — documented and matched
Contract states the format in **three** places (`auth-api.yaml:246, 325, 864`) and the RU mirror in two (`docsRU/…auth-api.yaml:248, 327`). Code: `TOKEN_PREFIX = 'zlk_agent_'` (`agent-credential.service.ts:31`), minted as `` `${TOKEN_PREFIX}${row.id}_${secret}` `` (`:308`), parsed by splitting on the **first** `_` after the prefix with a UUID shape gate (`:262-271`). ✅ **Format contract and implementation agree exactly**, including the "shown ONCE" semantics.

### 5.3 **`403 ISSUANCE_HUMAN_ONLY` is NOT documented — nor are 3 siblings (M5)**

`[MAJOR][contract-first][NEW]` — antaraya `прамада`

The brief asked specifically. The answer is **no**. `API_CONVENTIONS.md:69-70` is normative:

> *"Domain-specific codes extend this set and are listed in each domain spec's 'Error Handling' section."*

`errcodes.py` swept **176 non-spec `.ts` files → 49 distinct business error codes**, then searched each against **256 doc files** (`docs/` + `docsRU/`, `.md` + `.yaml`). Result: **13 undocumented**, of which **4 are new in this July wave**:

| Code | HTTP | Thrown at | In docs? |
|---|---|---|---|
| `ISSUANCE_HUMAN_ONLY` | 403 | `agent-credential.service.ts:203` | **0 files** |
| `AGENT_AUTH_DISABLED` | 403 | `agent-credential.service.ts:151` | **0 files** |
| `TARGET_NOT_AGENT` | 422 | `agent-credential.service.ts:216` | **0 files** |
| `CAPABILITY_PROFILE_NOT_FOUND` | 422 | `agent-credential.service.ts:228` | **0 files** |
| `INVALID_AGENT_CREDENTIAL` | 401 | `agent-credential.service.ts:284` | ✅ `auth-api.yaml:330` + `docsRU/…:330` |

`ISSUANCE_HUMAN_ONLY` is the sharpest of the four. It is the **structural defence-in-depth** that stops an AGENT holding `role='ADMIN'` from issuing another agent's credential — the rejected ADR-0036 §2 Option-3 anti-pattern — and it has a dedicated test (`agent-credential.service.spec.ts:48-50`, *"carries the stable ISSUANCE_HUMAN_ONLY code"*). Its **contract** side is a bare `'403': { $ref: '#/components/responses/Problem' }` (`auth-api.yaml:270`) with no `code`. An AI operator (ADR-0006) or a client cannot distinguish "you are the wrong role" from "you are the wrong *principal type*" — precisely the distinction the guard exists to make. The 422 pair is described in **prose** (`auth-api.yaml:252`: *"422 if the target is not an AGENT account or the capability profile does not exist"*) but their machine codes are never named.

Carried, pre-existing, same class (9): `ACTIVE_LISTING_EXISTS` (`moderation.service.ts:674`), `BREED_CONFLICT` (`animal.service.ts:467`), `DUPLICATE_IDENTIFIER` (`:550`), `INVALID_REFERENCE` (`:556`), `INVALID_STATE` (`:335`), `OWNERSHIP_CONFLICT` (`:456`), `PEDIGREE_INVALID` (`:580`), `INVALID_OTP` (`identity.service.ts:158`), `PRECONDITION_REQUIRED` (`lib/http/etag.util.ts:26`).

**Clean result on the same sweep:** codes that *are* documented are documented in **both** languages — **EN-only: 0**. The RU mirror does not lag on error codes.

### 5.4 M6 — the response-completeness rule nobody enforces

`[MAJOR][conformance][NEW]` — antaraya `стьяна`

`API_CONVENTIONS.md:71`: *"Every operation must document at least `400, 401, 403, 404, 500` referencing `Problem` (public ones omit 401/403)."* Machine-checked against the generated inventory:

```
scanned: 115 live operations (9 deprecated excluded of 124)
literal rule:                                90 non-conforming
honouring the public-op exemption (17 ops with `security: []`):  89 non-conforming
   missing ONLY 400: 31        missing 404: 53
```
July-wave examples by name: `POST /admin/agents/{}/credentials` missing `400`; `POST /auth/agent/token` missing `400,404`; `POST /saved-searches` missing `400,403,404`; `GET /me/notifications` missing `400,404`; `PATCH /me/notification-preferences` missing `400,403,404`.

Two distinct problems, and they must not be conflated:
1. **The 31 "missing only 400" cases are real defects** — every one of these accepts a body or query params and *will* return 400 from the global `ValidationPipe`, undocumented.
2. **The 53 "missing 404" cases mostly cannot be fixed**, because the rule as written is unsatisfiable: `GET /listings` (a collection) has no meaningful 404. The rule is a declaration with no mechanism and no exemption clause — `стьяна`. **Fix the rule first** (add "…404 where a path parameter identifies a resource"), then gate it in CI; do not bulk-add meaningless 404s to make a bad rule green.

---

## 6. Deep dive — notifications (Slice H3)

### 6.1 AUDIT4 F3 — closed, and closed properly
`GET /me/notifications` exists in code (`notification.controller.ts:31-52`) **and** contract (`notification-api.yaml:100-155`, `operationId: listMyNotifications`). Envelope `{items, meta: PageMeta}` matches on both sides; the `Notification` schema (`:307-330`) — `id/type(enum [IN_APP])/content(nullable)/status/createdAt` — matches `NotificationView` (`dto/notification.dto.ts:39-49`) field-for-field. The `NotificationLog.type` enum now carries `IN_APP` (`:289`). `304` is declared (`:151`) and implemented (`controller:47-50` via `matchesIfNoneMatch`). Own-scope is closed structurally (`notification-read.service.ts:40` — `user_id: actor.userId`, never client-supplied). **Good work; the AUDIT4 finding is genuinely resolved, not papered over.**

The two `[EMAIL, SMS]` enums that remain (`:26` on `GET /notifications/templates`, `:237/:263` on the template schemas) are **correct, not drift** — templates are EMAIL-sourced by design (`notification-writer.service.ts:132`: `WHERE … type = 'EMAIL'`; channel ≠ source, migration 0030).

### 6.2 M4 — the ETag validates the wrong thing

`[MAJOR][contract-first][NEW]` — antaraya `бхранти-даршана`

`notification-read.service.ts:70-77`:
```ts
private inboxEtag(userId: string, total: number, rows: NotificationRow[]): string {
  const latest = rows.reduce<Date>((acc, r) => (r.updated_at > acc ? r.updated_at : acc), new Date(0));
  return weakEtag(`notifications:${userId}:${total}`, latest);
}
```
`rows` is **the returned page**, and neither `page` nor `limit` enters the key. An entity-tag identifies a *specific representation*; two different representations must not share one. Two deterministic collisions:

- **Different `limit`, same page.** Inbox of 30 rows. `?page=1&limit=20` → `total=30`, `latest` = newest row's `updated_at`. `?page=1&limit=5` → `total=30`, **same** newest row → **identical ETag, different body (20 items vs 5)**. A client that fetched with `limit=20` and then re-requests `limit=5` with `If-None-Match` receives **304** and keeps the wrong page.
- **Any two out-of-range pages.** `rows = []` → `latest = new Date(0)` → identical ETag for `?page=5` and `?page=9`, whose `meta.page` differs.

**Why the tests do not catch it:** `notification-read.service.spec.ts:43-51` asserts only that the ETag *rotates when a newer row lands* — the happy direction. Nothing asserts it *differs across representations*. The suite proves the validator changes when it should, never that it stays put only when it may.

**Fix:** fold the pagination selectors into the key — `weakEtag(\`notifications:${userId}:${page}:${limit}:${total}\`, latest)` — and add the negative probe below. **Also note the contract's own internal tension:** `notification-api.yaml:109-110` promises `Cache-Control: private, no-store` alongside an ETag/304 flow (`controller:46` implements exactly that). `no-store` forbids a conforming cache from retaining the representation it would revalidate; the two are semantically at odds. Decide: `private, no-cache` (revalidate, may store) is almost certainly what is meant. Route → architect for the header choice, backend for the key.

### 6.3 AUDIT4 F10 — unchanged, and now shared by two consumers
`notification-writer.service.ts:76-79` still logs a warning and returns `false` on a missing template, while the relay stamps the event processed forward-only. Since H4 this no-op path is shared by **both** consumers, so a mis-seeded `saved_search_matched` template silently kills the entire demand-side return loop with a green suite. The AUDIT4 fix (a startup/CI assertion that every registry `templateName` resolves to a seeded row) is now worth more than when it was raised.

---

## 7. Deep dive — saved-search (Slice H4 + follow-ups)

### 7.1 Contract conformance — clean
`offeringType`/`offeringId` are on **both** the `SavedSearch` and `SavedSearchCreate` schemas (`geo-search-api.yaml`, enum `[ANIMAL_LISTING]`, `offeringId` documented as *"Always null for a saved search"*), and on `SavedSearchView` (`dto/saved-search.dto.ts:171-173`) with the same "always null" comment. Migration 0032's discriminator semantics survive intact into the wire shape. **Dedup semantics are documented precisely and match:** SS-6 / `geo-search-api.yaml` — *"Dedup is by Idempotency-Key only … there is no `(user_id, filters)` uniqueness and no name uniqueness"*, which is exactly what the DB provides (no such constraint exists). The `sort` whitelist is on both sides. ✅

The H4 documentation is, on the whole, **exemplary** — SS-M1..SS-M7 (`07-geo-search-service.md:229-235`) pin the matcher's behaviour with the honesty the SDD method asks for, including its limits. Three defects sit inside otherwise excellent work.

### 7.2 M1 — a 500-match cap the spec says does not exist

`[MAJOR][conformance][NEW]` — antaraya `прамада`

`saved-search-match.consumer.ts:11` — `const MAX_MATCHES_PER_LISTING = 500;` — applied as `LIMIT ${MAX_MATCHES_PER_LISTING}` with `ORDER BY s.created_at ASC` (`:187-192`), and detected only heuristically (`:91-97`, `matches.length === MAX_MATCHES_PER_LISTING` → `logger.warn`).

Against this, spec 07 says two contradictory things:
- **SS-M1** (`:229`): *"a saved search is matched **iff** all of its present filters are satisfied by the listing"* — unconditional.
- **The H4 follow-ups note** (`:237, 239`): *"per-user daily cap is **deliberately NOT built** (deferred)"* and *"In the interim the anti-spam guarantee is **structural**: per-pair dedup (SS-M4) + market anchoring (SS-M3)."*

So the spec asserts there is no cap, and enumerates the two mechanisms that stand in for one — while a **per-listing** cap of 500 is in the code, truncating silently. A popular listing in a mature market alerts only the **500 oldest** saved searches; every newer saver is silently never told, forever (SS-M4's per-pair dedup means the truncated pairs are *not* retried on redelivery — the event is stamped processed).

This is not a request to remove the cap — an unbounded fan-out is a real hazard and the cap is defensible. It is a request to **stop the documents from denying it**: add an `SS-M8` naming the cap, its ordering bias (`created_at ASC`), its silence, and the escalation owner; and correct the "no cap built" claim in the follow-ups note. Route → alpha-analyst (write SS-M8) + architect (is 500 + oldest-first the right policy, or is a digest?) + doc-keeper (RU mirror).

### 7.3 m2 — SS-M2's cross-field guarantee is not enforced
`searchableText()` (`:291-298`) joins title-ru, title-en, description-ru, description-en with `'\n'`, and the docstring plus SS-M2 (`:230`) both claim *"a `q` never substring-matches across two different fields"*. The guarantee holds only if `q` cannot contain a newline — and `q` is validated as `@IsString() @MaxLength(200)` (`dto/saved-search.dto.ts:57-59`) with no such restriction. A `q` of `"Собака\nОписание"` matches across the boundary. Low impact (a false-positive alert), but it is a **normative claim the code does not back**. Fix: `@Matches(/^[^\n\r]*$/)` on `q`, or soften SS-M2 to state the joiner without claiming the guarantee.

### 7.4 Verified clean on this slice
- `SavedSearch.Matched` **is** in the catalog (`event-catalog.md:57`) with `aggregate_type='SavedSearch'`, marked *"none yet (analytics-only; dormant)"*, and the emitted payload (`saved-search-match.consumer.ts:127-133`) is **field-identical** to the catalogued one: `savedSearchId, listingId, subjectUserId, market, matchedAt`. ✅
- Exactly-once is real, not asserted: the event publishes inside `$transaction` **only** when the `ON CONFLICT DO NOTHING` insert affected 1 row (`notification-writer.service.ts:100-105`). ✅
- ADR-0002 market anchoring is structurally enforced in SQL (`:240-249`) and matches SS-M3 clause for clause. ✅

---

## 8. Deep dive — event-catalog ↔ actually-emitted events

Generated both sides: every `Domain.Event`-shaped string literal in non-spec `src` (12 distinct) vs every such token in `event-catalog.md` (23 distinct).

**Emitted but not catalogued: 0.** Every event the code produces is documented — including both the brief's targets:

| Event | Emitted at | Catalogued |
|---|---|---|
| `SavedSearch.Matched` | `saved-search-match.consumer.ts:124` | ✅ `event-catalog.md:57` |
| `ConfirmedSale.Confirmed` | `transfer.service.ts:767` | ✅ `event-catalog.md:63` |

`ConfirmedSale.Confirmed`'s catalogued payload matches the emitted one exactly (`confirmedSaleId, anchorType, ownershipTransferId, animalId, offeringType, offeringId, sellerUserId/OrganizationId, buyerUserId/OrganizationId, status` — `transfer.service.ts:770-781`), and the catalog correctly records the `Created`-vs-`Confirmed` resolution the spec 18 §10 implementation note pins. **This is the single best-maintained contract surface in the audit.**

### 8.1 M7 — six catalogued events have a named producer and no producer

`[MAJOR][conformance][NEW]` — antaraya `стьяна`

Catalogued but never emitted: **11**. Five carry an explicit deferred marker and are fine — `ConfirmedSale.Created` / `.Disputed` / `.Expired` (each *"reserved"*, `:64-66`) and `Payment.Completed`/`.Failed` (*"Фаза 2+ (gated `feature_toggles.payments`)"*, `:67`).

**Six do not**, and each names a concrete live producer:

| Event | Catalogue claims (event-catalog.md) | grep in `src` |
|---|---|---|
| `Listing.Submitted` | *"listing module (DRAFT→PENDING_MODERATION)"* → moderation enqueues (`:46`) | **0 hits** |
| `Listing.Expired` | *"worker (duration elapsed)"* → notification notifies owner (`:50`) | **0 hits** |
| `Listing.Deactivated` | *"listing/moderation module"* (`:52`) | **0 hits** |
| `User.Registered` | *"identity module"* → welcome/verify (`:53`) | **0 hits** |
| `ContentReport.Filed` | *"moderation module"* → enqueue (`:54`) | **0 hits** |
| `ContentReport.Actioned` | *"moderation module"* → notify reporter+owner (`:55`) | **0 hits** |

There is also no listing-expiry scheduler at all (`src/lib/scheduler/` holds only `moderation-escalation.service.ts` and `transfer-expiry.service.ts`), so `Listing.Expired` has no possible producer.

The consequence is concrete and asymmetric: a developer or an ADR-0006 operator agent building a consumer for `Listing.Submitted` would subscribe and wait forever, with nothing anywhere signalling that the producer is unbuilt. This is exactly the `стьяна` shape the taxonomy names — *объявление есть, действия нет*. **Fix is cheap and doc-only:** add the same explicit marker the `ConfirmedSale.*` rows already model — a `**not emitted yet**` / `reserved` annotation per row — so the catalog distinguishes *contract* from *built*. The catalog already knows how to do this; it just was not applied to the older rows. Route → doc-keeper + architect (decide per event: build or mark).

### 8.2 i2 / i3 — AUDIT4 F1 residuals, unchanged
- `event-catalog.md:72` still asserts the notification registry *"is an allow-list of `OwnershipTransfer.*`"*. It has routed `Moderation.Decided` since ADR-0021 (`notification.registry.ts:55`). Stale.
- `event-catalog.md:81` still assigns `Moderation.Decided` channel **email**; `notification.consumer.ts:10` + `notification-writer.service.ts:89` write `'IN_APP'` unconditionally. The three-way disagreement AUDIT4 raised is now a **two**-way one (the registry↔ADR half was fixed); this half was not.

---

## 9. Deep dive — spec 18 §10 SHIPPED-form ↔ migrations 0039/0040

### 9.1 ADR-0038 §5 pins — all seven PRESENT

Traced pin by pin against `migrations/20260710_0039_confirmed_sales.sql`:

| # | ADR-0038 §5 pin (`0038…md:169-175`) | Verdict | DDL evidence |
|---|---|---|---|
| 1 | first-class table (§1), not a view/projection | **PRESENT** | `CREATE TABLE IF NOT EXISTS confirmed_sales (` — `0039:62`; `database_schema.sql:638` |
| 2 | polymorphic `offering_type`, widen-additively CHECK, ANIMAL_LISTING-only | **PRESENT** | `offering_type VARCHAR(30) NOT NULL DEFAULT 'ANIMAL_LISTING'` `0039:69` + `CONSTRAINT chk_confirmed_sales_offering_type CHECK (offering_type IN ('ANIMAL_LISTING'))` `0039:103` |
| 3 | derived `market` cache, ADR-0018/0033 discipline | **PRESENT** | `market VARCHAR(9) NOT NULL` `0039:75` + `chk_confirmed_sales_market CHECK (market IN ('pet','livestock'))` `0039:104`; captured, never re-derived — `transfer.service.ts:735-741` |
| 4 | `UNIQUE(ownership_transfer_id)` — one **live** sale per transfer | **PARTIAL → M3** | `CONSTRAINT uq_confirmed_sales_transfer UNIQUE (ownership_transfer_id)` `0039:111`. Enforces *one sale per transfer **ever***, not *live*. See §9.3. |
| 5 | actor-snapshot pair (ADR-0006/0011) | **PRESENT** | `actor_id UUID REFERENCES users(id) ON DELETE SET NULL` `0039:98`, `actor_principal_type VARCHAR(10) NOT NULL DEFAULT 'HUMAN'` `0039:99`, `chk_confirmed_sales_actor_ptype CHECK (… IN ('HUMAN','AGENT'))` `0039:108`; written from the accepting actor `transfer.service.ts:757-758` |
| 6 | append-only via **reused** `trg_block_modify_append_only` (no second path) | **PRESENT** | `CREATE TRIGGER trg_confirmed_sales_immutable BEFORE UPDATE OR DELETE ON confirmed_sales FOR EACH ROW EXECUTE FUNCTION trg_block_modify_append_only();` `0039:136-139` — the shared function, not a new one ✅ |
| 7 | `amount_minor` reserved nullable, off-record, no writer (Open Q1, owner 2026-07-09) | **PRESENT & honoured** | `amount_minor BIGINT` `0039:96` + `COMMENT … 'NO code path writes it'`. **Verified: zero writers** — the only `amount_minor` occurrence in `backend/src` is the comment at `transfer.service.ts:719`. |

### 9.2 M2 — the normative sections reference a column that does not exist

`[MAJOR][contract-first][NEW]` — antaraya `анавастхитатва`

The shipped column is **`expires_at`** (`0039:93`; index `idx_confirmed_sales_confirm_scan ON confirmed_sales(expires_at) WHERE status = 'PENDING_CONFIRMATION'`, `0039:131-132`). Spec 18 names **`confirm_expires_at`** in **nine** places. Two of them are the §3.1 sketch (`:175, 189`), which is explicitly labelled *"SKETCH — not canonical"* and may diverge. **Seven are not:**

| Line | Section | Status |
|---|---|---|
| `:254`, `:256` | §4 mermaid state machine | normative |
| `:270`, `:272` | §4 **transition-guard table** (*"Transition guards (normative)"*) | normative |
| `:309`, `:310`, `:312` | §5.2 Gherkin | normative |
| `:370` | §7 NFR — idempotent emission markers | normative |

§10 was diligently updated to SHIPPED-form and pins several real implementation decisions — but the rename did not propagate to the sections a behaviour-slice developer actually implements from. A developer building `PENDING → EXPIRED` from the §4 guard table writes against a non-existent column. `анавастхитатва`: the correction was made in one place and did not hold across the document.

**Same class, same section, lower stakes** — three further sketch→shipped deltas §10 never records: `currency VARCHAR(3) DEFAULT 'RUB'` (sketch `:178`) was **dropped**; `initiated_by_user_id` / `initiated_by_principal_type` (sketch `:180-181`) became `actor_id` / `actor_principal_type`; `offering_id` and `nominated_buyer_user_id` were **added**. Only the last is mentioned (§10 item 4).

### 9.3 M3 — the UNIQUE forbids what §4 permits

`[MAJOR][forward-compat][NEW]` — antaraya `бхранти-даршана`

ADR-0038 §5 pins (`0038…md:172`) *"`UNIQUE(ownership_transfer_id)` (§1) — one **live** sale per transfer (transfer INV-4 mirror)"*, and spec 18 §3.1 repeats *"one **live** confirmed-sale per anchored transfer"* (`:183`). The referenced transfer INV-4 is a **partial** unique (`UNIQUE(animal_id) WHERE status='PENDING'`, migration 0023) — *live* is the whole point of the partial predicate.

What shipped is a **full** UNIQUE (`0039:111`). Combined with the append-only trigger (status can never be updated), it means: once **any** row exists for a transfer — `CONFIRMED`, `DISPUTED`, `EXPIRED` or `CANCELLED` — **no second row for that transfer can ever be written**. Spec 18 §4 states the opposite for that terminal state (`:262`):

> `CANCELLED --> [*]: terminal (a new sale record may be created)`

On the TRANSFER anchor, "a new sale record may be created" is structurally impossible. The DDL comment (`0039:109-110`) reasons only about the *markSold* path's NULLs being distinct — which is correct and desirable — and never notices that the non-NULL path is now stricter than the ADR's own word.

**Inert today** (only the transfer accept writes, always `CONFIRMED`, single-winner). **Not inert for the behaviour slice**, which must implement `DISPUTED → CANCELLED` and then, per §4, allow a replacement. Decide now, cheaply: either the ADR/spec drop "live" and state *one sale per transfer, ever* (then §4's `CANCELLED` note must be corrected), or the constraint becomes partial. This is the same forward/backward-pointer class already flagged to architect on `reviews.superseded_by_id` (spec 18 §10 item 2 implementation note) — **route both together**.

### 9.4 Verified clean — no schema↔migration drift

Machine-diffed every definition line of the three reputation tables between `database_schema.sql` and the migrations (normalising comments/whitespace):

```
confirmed_sales:        schema 29 defs | migration 29 defs -> identical definition lines
reviews:                schema 24 defs | migration 24 defs -> identical definition lines
reputation_aggregates:  schema 16 defs | migration 16 defs -> identical definition lines
```
**Zero drift** — the 0026 drift lesson (named constraints instead of auto-generated ones) is visibly held throughout: `chk_confirmed_sales_*`, `uq_confirmed_sales_transfer`, `chk_reviews_*`, `pk_reputation_aggregates`, `chk_reputation_aggregates_*`, and the 0040 rename of `consents_consent_type_check` → `chk_consents_consent_type` (`0040:184-186`).

### 9.5 §10 SHIPPED-form claims — each checked

| §10 claim | Verdict | Evidence |
|---|---|---|
| item 1: passive capture at transfer completion, auto-CONFIRMED, same tx | ✅ | `transfer.service.ts:740-762` in-tx `create` + `:763-781` `outbox.publish(tx, …)` |
| item 1: emits **only** `ConfirmedSale.Confirmed`, not `.Created` | ✅ | `transfer.service.ts:767`; `.Created` appears nowhere in `src` |
| item 2: `trg_reviews_immutable` reuses the shared function | ✅ | `0040:148-151` |
| item 2: `uq_reviews_current_per_direction … WHERE superseded_by_id IS NULL` | ✅ | `0040:138-140` (partial unique index) |
| item 2: `seq BIGINT GENERATED ALWAYS AS IDENTITY` | ✅ | `0040:116` + `COMMENT` `0040:130` |
| item 2: aggregates PK `(subject_user_id, market)`, `rating_avg` GENERATED STORED | ✅ | `0040:170`, `0040:162` |
| item 2: reviews scope offering **through the FK**, no duplicate column | ✅ | `confirmed_sale_id UUID NOT NULL REFERENCES confirmed_sales(id) ON DELETE CASCADE` `0040:94`; **no** `offering_type` on `reviews` — **but see m1** |
| item 3: `reputation_reviews` OFF (0040), `sale_buyer_confirmation` OFF (0039), `consents` CHECK widened `+REVIEW_PUBLICATION` | ✅ | `0040:192`, `0039:145-150`, `0040:184-186` |
| item 4: markSold buyer-nomination column reserved | ✅ | `nominated_buyer_user_id` `0039:89` + `COMMENT` |
| item 5: polymorphic `offering_type` on `confirmed_sales`**/`reviews`** | ❌ **m1** | Present on `confirmed_sales` (`0039:69`); **absent from `reviews`** — and item 2 of the same section says that absence is correct. §10 contradicts itself; item 5 was not updated when item 2 was written. |

### 9.6 m4 — the review lifecycle speaks a vocabulary the storage cannot hold
Spec 18 §4 (`:277-278`) closes with the review lifecycle: `ELIGIBLE (window open) → SUBMITTED (pending moderation) → APPROVED+released → … immutable`. The shipped column is `moderation_status VARCHAR(20) NOT NULL DEFAULT 'PENDING'` with `chk_reviews_moderation_status CHECK (moderation_status IN ('PENDING','APPROVED','REJECTED','CHANGES_REQUESTED'))` (`0040:103, 122-123`).

Both directions diverge: **`SUBMITTED` is unrepresentable** (the DB calls that state `PENDING`), and **`REJECTED` / `CHANGES_REQUESTED` are never named** by the state machine — so §4 describes no path for a rejected review at all, though the storage reserves two. (`ELIGIBLE` is fine — it is the pre-row state, no row exists yet.) `самшая`: two vocabularies for one lifecycle, with no statement of which is normative. Fix: align §4's review lane to the CHECK vocabulary and add the `REJECTED`/`CHANGES_REQUESTED` transitions, or state explicitly that `SUBMITTED` is the prose name for stored `PENDING`.

### 9.7 m3 — the reputation domain has no contract surface at all
Spec 18 §3.4 (`:233-243`) tables six endpoints under the heading *"Endpoint contract (behaviour behind toggle; **shape reserved now**)"*: `POST /v1/listings/{id}/mark-sold` (extended), `POST /v1/confirmed-sales/{id}/confirm`, `.../dispute`, `POST /v1/confirmed-sales/{id}/reviews`, `GET /v1/users/{id}/reputation`, `GET /v1/users/{id}/reviews`.

Grep across all 13 contracts for `confirmed-sales`, `reputation`, `/reviews`: **zero hits**. And `POST /listings/{id}/mark-sold` in `listings-api.yaml` carries no buyer-nomination field. So "shape reserved now" is true of the *schema* (three tables shipped) and false of the *contract* — the layer the phrase names. Given `feature_toggles.reputation_reviews` is OFF this is not urgent, but it is the one place where the reputation wave's otherwise strong FORM-now discipline stopped one layer short. Either reserve the shapes in the contract (marked deferred, the way `payment-api.yaml` already models a gated domain), or amend §3.4 to say the contract shape lands with the behaviour slice.

---

## 10. Diff vs AUDIT4 (`ZooLink/AUDIT4/alpha-analyst.md`)

### FIXED-VERIFIED
- **F3** (IN_APP write-only; no read path; `type` enum omits IN_APP) — **closed**. `GET /me/notifications` built (`notification.controller.ts:31`) and contracted (`notification-api.yaml:100`); `IN_APP` in the `NotificationLog` enum (`:289`) and a dedicated `Notification` schema (`:307`). Residual: the ETag defect **M4** is *new*, introduced by the fix.
- **F2** (`notification_state_machine.md` silent on IN_APP) — **closed**. An IN_APP lane exists (`:26-43`) with `[*] → SENT` terminal, no `notification_prefs` guard, and an explicit note that no read/unread flag exists. Residual **m5**: only `NotificationConsumer` is named; `SavedSearchMatchConsumer` also materialises IN_APP rows.
- **AUDIT4 CONFIRMED item — notification-preferences role gate** — **closed**. `GET/PATCH /me/notification-preferences` now carry the full 7-role list including `VETERINARIAN`, `GROOMER`. Swept repo-wide: **0 violations of 214** (§4).
- **F1** — **half closed**. Catalog §2/§3 now carry the transfer + saved-search rows and the registry matches ADR-0021 for what it routes. Residual: **i2** (stale allow-list note) and **i3** (`Moderation.Decided` channel email vs IN_APP).

### CONFIRMED (still open, re-verified today)
- **F4** — no `consent_state_machine.md` in `docs/specs/statemachines/` (directory listed; absent).
- **F5** — `ConsentService.currentlyGranted` (`consent.service.ts:69-77`) orders by `seq DESC` and returns `latest.granted`; **`policy_version` is still not read anywhere in the guard**. The 0036 tie-break was fixed; the version-fork semantics remain undefined. `[NS]` machine-actionability blocker stands.
- **F8** — `docs/specs/16-contact-exchange.md`: **0** occurrences of `consent` / `NO_CHANNELS`.
- **F9** — `docs/specs/security/rbac-matrix.md`: **0** occurrences of `user_roles` / `multi-role` / `ADR-0022`. The dormant junction remains unspecced. `[PERSP]`
- **F10** — `notification-writer.service.ts:76-79` unchanged, and now shared by both consumers (§6.3) — **impact increased**.
- **AUDIT3 §1 / GAP-BA-001** — `listings-api.yaml`: **0** occurrences of `priceTerms` / `price_terms`. The livestock BR's negotiable/per-straw/package pricing is still unrepresentable. Unchanged since AUDIT2.

---

## 11. Contract-test probes (round-5 additions)

Each is machine-checkable and encodes exactly one finding above.

| Probe | Assertion | Today |
|---|---|---|
| **A18 — deployed base path** | `curl` the proxy at `/api/v1/listings`; assert **not** 404. | **FAILS** (C1) |
| **A19 — base-path single source** | Assert every contract's `servers[0].url` equals the app's effective prefix (`setGlobalPrefix` + versioning) after any proxy rewrite. | **FAILS** (C1) |
| **A20 — error-code documentation closure** | For every `code: '<CODE>'` literal in `backend/src` (non-spec), assert the token appears in `docs/` **and** `docsRU/`. | **FAILS**: 13 undocumented (M5) |
| **A21 — response-completeness gate** | Enforce `API_CONVENTIONS.md:71` in CI, **after** amending the rule to exempt collection GETs from 404. | **FAILS**: 89/115 (M6) |
| **A22 — ETag identifies a representation** | `GET /me/notifications?limit=20` → E1; `GET …?limit=5` → E2; assert `E1 ≠ E2`. Repeat for `page`. | **FAILS** (M4) |
| **A23 — catalogued events have a producer** | For every `event-catalog.md` §2 row without an explicit `reserved`/`deferred`/`gated` marker, assert the literal event name occurs in `backend/src`. | **FAILS**: 6 (M7) |
| **A24 — spec identifiers resolve to real columns** | Extract `snake_case` identifiers from spec 18 §4/§5/§7 (excluding the SKETCH block) and assert each is a real column of the named table. | **FAILS**: `confirm_expires_at` ×7 (M2) |
| **A25 — fan-out cap is documented** | Assert every numeric cap constant in a consumer (`MAX_*_PER_*`) is named in its domain spec. | **FAILS**: `MAX_MATCHES_PER_LISTING` (M1) |
| **A26 — state machine ⊇ storage vocabulary** | For each `chk_*_status` CHECK, assert every permitted value is named in the corresponding `statemachines/*.md` **and** vice-versa. | **FAILS**: `reviews.moderation_status` (m4) |
| **A27 — x-required-roles closure (regression lock)** | The §4 **structural** sweep, in CI, over EN+RU. | **PASSES** 214/214 — lock it in before it can regress |
| **A28 — EN↔RU operation parity (regression lock)** | Operation-set equality across the 26 contracts. | **PASSES** 124/124 — lock it in |
| **A29 — no duplicate YAML keys (regression lock)** | Explicit duplicate-key detection on all 26 contracts. | **PASSES** 0 — lock it in (it silently ate operations before `950a7c9`) |

The last three matter as much as the failures: **A27/A28/A29 are green today and were not always green.** Encoding a passing invariant is how `анавастхитатва` — достигнутое не удержано — gets prevented rather than re-discovered.

---

## 12. Routing

| To | What |
|---|---|
| **devops + architect** | **C1** — pick `handle_path` vs `setGlobalPrefix` vs superseding `API_CONVENTIONS.md:22`; then A18/A19 in CI. |
| **architect** | **M3** (UNIQUE "live" vs "ever" — bundle with the already-flagged `reviews.superseded_by_id` fork) · **M1** (is 500 + oldest-first right, or a digest?) · **M6** (amend the response rule before gating it) · **M4** (`no-store` vs `no-cache`) · **F5** carry (consent version fork) · **F9** carry (multi-role activation). |
| **alpha-analyst (me, next slice)** | **M2** (propagate `expires_at` through §4/§5.2/§7) · **M1** (write SS-M8) · **m1/m3/m4** (spec 18 §10 item 5, §3.4, §4 review lane) · **F4** carry (`consent_state_machine.md`). |
| **backend-engineer** | **M4** (fold `page`/`limit` into the ETag key + the negative test) · **M5** (surface the 4 codes) · **m2** (`q` newline validator) · **F10** carry (fail-fast on unseeded template). |
| **doc-keeper** | **M7** (mark the 6 producerless events) · **i2/i3** (event-catalog stale note + `Moderation.Decided` channel) · **m5** · RU mirror for every doc change above. |
| **reviewer-qa** | Probes **A18–A29**; specifically **A27/A28/A29 as regression locks on currently-green invariants**. |

---

*Scope note.* Everything above is read from source and documents at `c44874c`; nothing was executed. Items explicitly **requires manual verification**: (1) that C1 reproduces against a running stack — my evidence is Caddy v2 `handle` vs `handle_path` semantics plus the absence of any prefix bridge in the repo, not an observed 404; (2) that the unbuilt organization/branch/matching domains are intentionally deferred rather than dropped — I found no ADR either way and did not go looking outside my lane. This file is my sole output; no other file was modified.
